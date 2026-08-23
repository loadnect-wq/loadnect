package com.hallnect.app

import com.hallnect.app.UrlPolicy.Verdict
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The URL policy is the app's security boundary; every rule that decides what
 * may render inside Hallnect's chrome is pinned here.
 */
class UrlPolicyTest {

    private fun verdict(
        scheme: String?,
        host: String?,
        path: String? = "/",
        provider: String? = null,
    ) = UrlPolicy.decide(scheme, host, path, provider)

    // ── Hallnect itself renders in the WebView ───────────────────────────────

    @Test fun `apex domain is trusted`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "hallnect.com"))

    @Test fun `www is trusted`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "www.hallnect.com"))

    @Test fun `future subdomains are trusted`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "app.hallnect.com"))

    @Test fun `lookalike domain is NOT trusted`() =
        assertEquals(Verdict.EXTERNAL, verdict("https", "evil-hallnect.com"))

    @Test fun `suffix trick is NOT trusted`() =
        assertEquals(Verdict.EXTERNAL, verdict("https", "hallnect.com.evil.io"))

    @Test fun `host is matched case-insensitively`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "WWW.HALLNECT.COM"))

    // ── Payment pages stay inside so return_url lands in the app session ─────

    @Test fun `cashfree checkout stays in webview`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "payments.cashfree.com"))

    @Test fun `cashfree api host stays in webview`() =
        assertEquals(Verdict.IN_WEBVIEW, verdict("https", "api.cashfree.com"))

    // ── Google OAuth must escape to a real browser context ───────────────────

    @Test fun `google accounts goes to custom tab`() =
        assertEquals(Verdict.CUSTOM_TAB, verdict("https", "accounts.google.com"))

    @Test fun `supabase google authorize goes to custom tab`() =
        assertEquals(
            Verdict.CUSTOM_TAB,
            verdict(
                "https", "kvcrqhmgthixhqrjytay.supabase.co",
                "/auth/v1/authorize", "google",
            ),
        )

    @Test fun `supabase email verify link stays in webview`() =
        assertEquals(
            Verdict.IN_WEBVIEW,
            verdict("https", "kvcrqhmgthixhqrjytay.supabase.co", "/auth/v1/verify", null),
        )

    // ── Native hand-offs ─────────────────────────────────────────────────────

    @Test fun `tel goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("tel", null))

    @Test fun `mailto goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("mailto", null))

    @Test fun `whatsapp scheme goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("whatsapp", null))

    @Test fun `wa dot me goes external as untrusted https`() =
        assertEquals(Verdict.EXTERNAL, verdict("https", "wa.me"))

    @Test fun `upi collect goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("upi", "pay"))

    @Test fun `phonepe intent scheme goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("phonepe", null))

    @Test fun `intent urls go external for parsing`() =
        assertEquals(Verdict.EXTERNAL, verdict("intent", "pay"))

    @Test fun `arbitrary website goes external`() =
        assertEquals(Verdict.EXTERNAL, verdict("https", "example.org"))

    // ── Dangerous schemes are blocked outright ───────────────────────────────

    @Test fun `file scheme is blocked`() =
        assertEquals(Verdict.BLOCK, verdict("file", null))

    @Test fun `javascript scheme is blocked`() =
        assertEquals(Verdict.BLOCK, verdict("javascript", null))

    @Test fun `content scheme is blocked`() =
        assertEquals(Verdict.BLOCK, verdict("content", "media"))

    @Test fun `null scheme is blocked`() =
        assertEquals(Verdict.BLOCK, verdict(null, "hallnect.com"))
}
