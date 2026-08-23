package com.hallnect.app.web

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.util.Log
import com.hallnect.app.UrlPolicy

/**
 * Navigation control for the Hallnect WebView.
 *
 * Every main-frame navigation is routed through [UrlPolicy]; this class only
 * carries out the verdicts and handles the failure paths (offline, SSL,
 * renderer crash) via callbacks into the activity.
 */
class HallnectWebViewClient(
    private val callbacks: Callbacks,
) : WebViewClient() {

    interface Callbacks {
        fun openInCustomTab(uri: Uri)
        fun openExternal(intent: Intent)
        fun onPageStarted()
        fun onPageFinished()
        /** Main-frame load failed in a way that means "show the offline screen". */
        fun onConnectionLost()
        fun onRendererGone()
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        if (!request.isForMainFrame) return false
        val uri = request.url

        return when (UrlPolicy.decide(uri)) {
            UrlPolicy.Verdict.IN_WEBVIEW -> {
                val upgraded = UrlPolicy.upgradeToHttps(uri)
                if (upgraded != uri) {
                    view.loadUrl(upgraded.toString())
                    true
                } else {
                    false // let the WebView proceed
                }
            }

            UrlPolicy.Verdict.CUSTOM_TAB -> {
                callbacks.openInCustomTab(uri)
                true
            }

            UrlPolicy.Verdict.EXTERNAL -> {
                launchExternally(uri)
                true
            }

            UrlPolicy.Verdict.BLOCK -> true // swallow silently
        }
    }

    /**
     * Hands a URI to whatever app owns it. intent:// URIs (Cashfree's UPI
     * hand-off) are parsed into real Intents, with the documented
     * browser_fallback_url and market:// fallbacks when the target app is
     * not installed — a payment must degrade to "install the app", never to a
     * dead tap.
     */
    private fun launchExternally(uri: Uri) {
        try {
            if (uri.scheme == "intent") {
                val parsed = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                // Never let a web page start our own private components.
                parsed.addCategory(Intent.CATEGORY_BROWSABLE)
                parsed.component = null
                parsed.selector = null
                try {
                    callbacks.openExternal(parsed)
                } catch (_: ActivityNotFoundException) {
                    val fallback = parsed.getStringExtra("browser_fallback_url")
                    when {
                        fallback != null ->
                            launchExternally(Uri.parse(fallback))
                        parsed.`package` != null ->
                            callbacks.openExternal(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    Uri.parse("market://details?id=${parsed.`package`}"),
                                ),
                            )
                    }
                }
            } else {
                callbacks.openExternal(Intent(Intent.ACTION_VIEW, uri))
            }
        } catch (e: Exception) {
            // No handler for this scheme on this device. Log and move on —
            // a failed external hand-off must never crash the app.
            Log.w("Hallnect", "No handler for ${uri.scheme}: ${e.message}")
        }
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        callbacks.onPageStarted()
    }

    override fun onPageFinished(view: WebView, url: String) {
        callbacks.onPageFinished()
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        // Only a failed MAIN FRAME load means the page is broken; a blocked
        // analytics beacon or a missing image must not trigger the offline
        // screen over a perfectly good page.
        if (!request.isForMainFrame) return
        when (error.errorCode) {
            ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT,
            ERROR_IO, ERROR_PROXY_AUTHENTICATION,
            -> callbacks.onConnectionLost()
        }
        // HTTP-level 404/500 are NOT handled here: the web app renders its own
        // branded error pages, which are the correct experience.
    }

    /**
     * SSL failures are fatal, full stop. handler.proceed() would let a
     * man-in-the-middle serve a fake Hallnect over a broken certificate —
     * inside an app whose whole UI says "this is Hallnect".
     */
    override fun onReceivedSslError(
        view: WebView,
        handler: SslErrorHandler,
        error: SslError,
    ) {
        handler.cancel()
        callbacks.onConnectionLost()
    }

    override fun onRenderProcessGone(
        view: WebView,
        detail: android.webkit.RenderProcessGoneDetail,
    ): Boolean {
        // The WebView renderer crashed or was killed under memory pressure.
        // Returning true + rebuilding beats the default (killing the app).
        callbacks.onRendererGone()
        return true
    }
}
