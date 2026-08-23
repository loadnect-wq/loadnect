package com.hallnect.app.web

import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

/**
 * Chrome-level events: load progress, the hall-photo file chooser, and
 * denial of powers the web app does not use.
 */
class HallnectChromeClient(
    private val callbacks: Callbacks,
) : WebChromeClient() {

    interface Callbacks {
        fun onProgress(percent: Int)
        /**
         * The page asked for files (<input type="file">). The activity owns
         * the ActivityResult plumbing; it MUST resolve [filePathCallback]
         * exactly once — including with null on cancel, or the page's file
         * input wedges permanently and hall-photo upload silently dies.
         */
        fun onShowFileChooser(
            filePathCallback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean
    }

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        callbacks.onProgress(newProgress)
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean = callbacks.onShowFileChooser(filePathCallback, fileChooserParams)

    /** The site never asks for location; deny rather than prompt. */
    override fun onGeolocationPermissionsShowPrompt(
        origin: String,
        callback: GeolocationPermissions.Callback,
    ) = callback.invoke(origin, false, false)

    /** No in-page WebRTC camera/mic either — photo capture goes through the
     *  native file chooser, not getUserMedia. */
    override fun onPermissionRequest(request: PermissionRequest) = request.deny()
}
