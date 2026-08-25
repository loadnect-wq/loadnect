package com.hallnect.app

import android.net.Uri

/**
 * Decides what happens to every main-frame navigation.
 *
 * This is the security boundary of the whole app: nothing renders inside the
 * WebView — wearing Hallnect's chrome and sharing its cookie jar — unless this
 * object says so. It is a pure function of the URL so it can be unit-tested
 * without an emulator.
 *
 * The four verdicts:
 *
 *  IN_WEBVIEW     Hallnect itself, its Supabase project (email-verify links),
 *                 and Cashfree's checkout pages. Payment pages stay inside so
 *                 the return_url lands back in the app's session.
 *
 *  CUSTOM_TAB     Google OAuth. Google refuses to authenticate inside a
 *                 WebView (403 disallowed_useragent) and spoofing the user
 *                 agent to sneak past that is both against policy and
 *                 fragile. A Chrome Custom Tab is Google's supported answer;
 *                 the OAuth callback then re-enters the app via App Link and
 *                 the PKCE code is exchanged INSIDE the WebView, so the
 *                 session lands in the app's cookie jar.
 *
 *  EXTERNAL       Everything with a dedicated Android handler — tel:, mailto:,
 *                 UPI apps, WhatsApp, maps — plus any unrelated website. An
 *                 arbitrary site must never be able to masquerade as Hallnect
 *                 inside the app.
 *
 *  BLOCK          Schemes nothing should handle (file:, content:, about: from
 *                 remote pages, javascript: URLs arriving as navigations).
 */
object UrlPolicy {

    const val HOME_URL = "https://hallnect.com/"

    /** Hosts allowed to render inside the WebView. */
    private val TRUSTED_SUFFIXES = listOf(
        "hallnect.com",       // the product (apex + www + future subdomains)
        "supabase.co",        // auth verify/recover links from Supabase email
        "cashfree.com",       // hosted checkout + payment pages
    )

    /** Hosts whose auth pages must run in a real browser context. */
    private val CUSTOM_TAB_HOSTS = listOf(
        "accounts.google.com",
        "accounts.youtube.com",
    )

    /** Schemes that always leave the app for their native handler. */
    private val EXTERNAL_SCHEMES = setOf(
        "tel", "mailto", "sms", "smsto", "geo", "whatsapp", "upi",
        // Every major Indian UPI app's intent scheme — Cashfree's checkout
        // page fires these to hand off collect requests.
        "phonepe", "gpay", "tez", "paytmmp", "paytm", "bhim", "credpay",
        "market",
    )

    enum class Verdict { IN_WEBVIEW, CUSTOM_TAB, EXTERNAL, BLOCK }

    fun decide(uri: Uri): Verdict = decide(
        scheme = uri.scheme,
        host = uri.host,
        path = uri.path,
        providerParam = try { uri.getQueryParameter("provider") } catch (_: Exception) { null },
    )

    /**
     * String-typed core so the policy is testable on a plain JVM, where
     * android.net.Uri is an unimplemented stub.
     */
    fun decide(
        scheme: String?,
        host: String?,
        path: String?,
        providerParam: String?,
    ): Verdict {
        val sch = scheme?.lowercase() ?: return Verdict.BLOCK
        val h = host?.lowercase() ?: ""

        if (sch in EXTERNAL_SCHEMES) return Verdict.EXTERNAL
        // intent:// URLs carry a serialized Intent (UPI app hand-off);
        // MainActivity parses and launches them.
        if (sch == "intent") return Verdict.EXTERNAL

        if (sch != "https" && sch != "http") return Verdict.BLOCK

        if (CUSTOM_TAB_HOSTS.any { h == it }) return Verdict.CUSTOM_TAB

        // The Supabase Google-authorize endpoint 302s straight to Google, so
        // the whole chain belongs in the Custom Tab — starting it there means
        // an already-signed-in Chrome profile gets one-tap sign-in.
        if (h.endsWith("supabase.co") &&
            path.orEmpty().contains("/auth/v1/authorize") &&
            providerParam == "google"
        ) return Verdict.CUSTOM_TAB

        val trusted = TRUSTED_SUFFIXES.any { suffix ->
            h == suffix || h.endsWith(".$suffix")
        }
        return if (trusted) Verdict.IN_WEBVIEW else Verdict.EXTERNAL
    }

    /**
     * http:// on a trusted host is upgraded rather than loaded — the site is
     * HTTPS-everywhere and cleartext is disabled at the manifest level.
     */
    fun upgradeToHttps(uri: Uri): Uri =
        if (uri.scheme == "http") uri.buildUpon().scheme("https").build() else uri
}
