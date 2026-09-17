// ─────────────────────────────────────────────────────────────────────────────
// app/api/chat/route.ts — the HallNect Assistant endpoint (streaming).
//
// ORDER OF CHECKS, cheapest and most protective first — the model is the last
// thing that runs and the only thing that costs money:
//   1. kill switch (HALLNECT_CHAT_ENABLED=false turns the assistant off)
//   2. same-origin POST (blocks cross-site use of a visitor's session)
//   3. body size and shape (zod; text parts only, bounded history and length)
//   4. who is asking — from the Supabase session cookie, never the body
//   5. quota (lib/ai/quota.server.ts; fails closed)
//   6. model call through Vercel AI Gateway with read-only tools
//
// SECRETS. The gateway credential (AI_GATEWAY_API_KEY, or the Vercel OIDC token
// on Vercel) is read by the AI SDK on the server. Nothing in the response
// carries it, and error text sent to the browser is a fixed friendly sentence.
// ─────────────────────────────────────────────────────────────────────────────

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { CHAT_BUSY_MESSAGE, CHAT_ERROR_MESSAGE, CHAT_RATE_LIMIT_MESSAGE, MAX_HISTORY_MESSAGES, MAX_INPUT_CHARS } from "@/lib/ai/chat-config";
import { consumeChatQuota } from "@/lib/ai/quota.server";
import { chatRoleFor } from "@/lib/ai/knowledge.server";
import { buildSystemPrompt, pageContextFor } from "@/lib/ai/system-prompt.server";
import { buildChatTools } from "@/lib/ai/tools.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * THE MODEL IS CHOSEN FOR THE FREE AI GATEWAY TIER (owner's decision: no paid
 * credits). Verified 2026-09-17 against this team's gateway: Anthropic models
 * are refused on the free tier ("Free tier users do not have access to this
 * model"); DeepSeek V4 Flash is served, calls tools correctly and answers in
 * Tamil and Tanglish. Gemini 2.5 Flash is also served and is the fallback.
 * Free-tier requests are rate-limited per model, which is why a throttled
 * request shows CHAT_BUSY_MESSAGE instead of a generic error.
 *
 * If paid credits are ever added, set HALLNECT_CHAT_MODEL (for example
 * anthropic/claude-sonnet-5) — no code change needed.
 */
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const FALLBACK_MODELS = ["google/gemini-2.5-flash"];
const MAX_BODY_BYTES = 48_000;
/** Assistant turns in history are the model's own words; allow more room than user input. */
const MAX_ASSISTANT_CHARS = 6000;

const textPart = z.object({ type: z.literal("text"), text: z.string() });

const bodySchema = z.object({
  pathname: z.string().max(200).optional(),
  messages: z
    .array(
      z.object({
        id: z.string().max(100),
        role: z.enum(["user", "assistant"]),
        // Other part types (tool calls, files, reasoning) are dropped, not
        // rejected: the UI sends the whole message, but only text goes back to
        // the model, so a client cannot forge tool results into the history.
        parts: z.array(z.unknown()).max(50),
      }),
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES * 2),
});

/** Provider throttling (free tier) gets its own message; everything else is generic. */
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /RateLimit|rate-limited|rate limit|429/i.test(text) ? CHAT_BUSY_MESSAGE : CHAT_ERROR_MESSAGE;
}

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  if ((process.env.HALLNECT_CHAT_ENABLED ?? "").trim().toLowerCase() === "false") {
    return json(503, CHAT_ERROR_MESSAGE);
  }
  if (!isSameOrigin(req)) return json(403, CHAT_ERROR_MESSAGE);

  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_BYTES) return json(413, "That message is too long. Please shorten it and try again.");

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, CHAT_ERROR_MESSAGE);
  }

  // Keep only text, bounded, from the most recent turns.
  const history: UIMessage[] = [];
  for (const m of parsed.messages.slice(-MAX_HISTORY_MESSAGES)) {
    const text = m.parts
      .map((p) => textPart.safeParse(p))
      .filter((r) => r.success)
      .map((r) => r.data.text)
      .join("\n")
      .trim();
    if (!text) continue;
    const limit = m.role === "user" ? MAX_INPUT_CHARS : MAX_ASSISTANT_CHARS;
    if (m.role === "user" && text.length > MAX_INPUT_CHARS) {
      return json(413, `Please keep messages under ${MAX_INPUT_CHARS} characters.`);
    }
    history.push({ id: m.id, role: m.role, parts: [{ type: "text", text: text.slice(0, limit) }] });
  }
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return json(400, CHAT_ERROR_MESSAGE);
  }

  const profile = await getProfile().catch(() => null);
  const activeProfile = profile && profile.is_active ? profile : null;
  const role = chatRoleFor(activeProfile?.role);

  const quota = await consumeChatQuota(activeProfile?.id ?? null);
  if (!quota.ok) {
    return quota.reason === "limited" ? json(429, CHAT_RATE_LIMIT_MESSAGE) : json(503, CHAT_ERROR_MESSAGE);
  }

  try {
    const [instructions, tools] = await Promise.all([
      buildSystemPrompt(role, pageContextFor(parsed.pathname)),
      buildChatTools(role),
    ]);

    const model = (process.env.HALLNECT_CHAT_MODEL ?? "").trim() || DEFAULT_MODEL;
    const result = streamText({
      model,
      instructions,
      messages: await convertToModelMessages(history),
      tools,
      stopWhen: isStepCount(4),
      maxOutputTokens: 1200,
      temperature: 0.3,
      // A retry inside a throttled window only burns the next allowance.
      maxRetries: 1,
      providerOptions: {
        gateway: {
          // Visitors type names and phone numbers: only route to providers
          // that do not train on prompts.
          disallowPromptTraining: true,
          models: FALLBACK_MODELS.filter((m) => m !== model),
        },
      },
      timeout: { totalMs: 55_000 },
      abortSignal: req.signal,
      onError: ({ error }) => {
        console.error("[chat] model stream error:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
      },
    });

    return createUIMessageStreamResponse({
      headers: { "cache-control": "no-store" },
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        sendReasoning: false,
        sendSources: false,
        onError: (error) => {
          console.error("[chat] ui stream error:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
          return friendlyError(error);
        },
      }),
    });
  } catch (e) {
    console.error("[chat] request failed:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
    return json(500, CHAT_ERROR_MESSAGE);
  }
}
