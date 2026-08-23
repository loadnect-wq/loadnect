package com.hallnect.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.hallnect.app.web.HallnectChromeClient
import com.hallnect.app.web.HallnectWebViewClient
import java.io.File

/**
 * The single activity: a full-screen, security-hardened WebView on
 * https://www.hallnect.com with the native affordances a browser tab lacks —
 * splash, offline screen, camera/gallery hall-photo upload, UPI hand-off,
 * downloads, App Links and sane back navigation.
 */
class MainActivity :
    AppCompatActivity(),
    HallnectWebViewClient.Callbacks,
    HallnectChromeClient.Callbacks {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progress: LinearProgressIndicator
    private lateinit var offlineView: View

    // ── Hall-photo file chooser state ────────────────────────────────────────
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            deliverFileChooserResult(it)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progress = findViewById(R.id.progress)
        offlineView = findViewById(R.id.offlineView)

        applyEdgeToEdge()
        configureWebView()
        configureBackNavigation()
        configureOfflineRetry()

        swipeRefresh.setColorSchemeColors(ContextCompat.getColor(this, R.color.gold))
        swipeRefresh.setOnRefreshListener { webView.reload() }
        // Only intercept the pull gesture at the very top of the page.
        swipeRefresh.setOnChildScrollUpCallback { _, _ -> webView.scrollY > 0 }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            loadStartUrl(intent)
        }
    }

    /** App Links (OAuth callback, shared hall URLs) re-enter here. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val uri = intent.data ?: return
        if (UrlPolicy.decide(uri) == UrlPolicy.Verdict.IN_WEBVIEW) {
            webView.loadUrl(UrlPolicy.upgradeToHttps(uri).toString())
        }
    }

    private fun loadStartUrl(intent: Intent?) {
        val deepLink = intent?.data
        val url = if (deepLink != null &&
            UrlPolicy.decide(deepLink) == UrlPolicy.Verdict.IN_WEBVIEW
        ) {
            UrlPolicy.upgradeToHttps(deepLink).toString()
        } else {
            UrlPolicy.HOME_URL
        }
        if (isOnline()) webView.loadUrl(url) else showOffline(true)
    }

    // ── WebView ──────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            // The web app is a JS single-page product; these two are the whole
            // requirement.
            javaScriptEnabled = true
            domStorageEnabled = true

            // Everything below is explicitly OFF — the app renders remote
            // HTTPS content only, and none of these belong anywhere near a
            // remote page:
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)

            // HTTPS only; a page trying to load http:// subresources fails.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // Sensible browsing behaviour.
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT

            // Marks app traffic in server logs without impersonating anything.
            userAgentString = "$userAgentString HallnectApp/1.0"
        }

        // First-party session cookies are the Supabase login; third-party
        // stays OFF — nothing in the product needs it, and payment pages are
        // first-party full-page navigations.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.webViewClient = HallnectWebViewClient(this)
        webView.webChromeClient = HallnectChromeClient(this)

        // Receipts / invoices → system Download manager, session cookie
        // attached so authenticated downloads work.
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            try {
                val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    addRequestHeader("User-Agent", webView.settings.userAgentString)
                    setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    )
                    setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, fileName,
                    )
                    setTitle(fileName)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager)
                    .enqueue(request)
                Toast.makeText(
                    this, getString(R.string.download_started, fileName),
                    Toast.LENGTH_SHORT,
                ).show()
            } catch (e: Exception) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ── System UI ────────────────────────────────────────────────────────────

    /**
     * Android 15 enforces edge-to-edge for targetSdk 35+. The root view is
     * painted brand maroon and padded by the system-bar insets, so the status
     * bar area reads as Hallnect chrome; the keyboard inset keeps focused
     * form fields visible (booking forms, hall pricing).
     */
    private fun applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(
                bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom),
            )
            insets
        }
        // Brand maroon behind the status bar → white icons.
        WindowCompat.getInsetsController(window, root)
            .isAppearanceLightStatusBars = false
    }

    // ── Back navigation ──────────────────────────────────────────────────────

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    when {
                        offlineView.isVisible && webView.url != null -> {
                            // Offline overlay up but a page is loaded behind
                            // it — back returns to the page.
                            showOffline(false)
                        }
                        webView.canGoBack() -> webView.goBack()
                        else -> {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            },
        )
    }

    // ── Offline ──────────────────────────────────────────────────────────────

    private fun configureOfflineRetry() {
        findViewById<View>(R.id.retryButton).setOnClickListener {
            if (isOnline()) {
                showOffline(false)
                if (webView.url == null) {
                    webView.loadUrl(UrlPolicy.HOME_URL)
                } else {
                    webView.reload()
                }
            } else {
                Toast.makeText(this, R.string.still_offline, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun showOffline(show: Boolean) {
        offlineView.isVisible = show
        swipeRefresh.isVisible = !show
    }

    // ── HallnectWebViewClient.Callbacks ──────────────────────────────────────

    override fun openInCustomTab(uri: Uri) {
        // Google sign-in runs in a real browser context (see UrlPolicy). The
        // OAuth callback re-enters this activity via App Link, and the PKCE
        // exchange completes inside the WebView so the session cookie lands
        // in the app's jar.
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(ContextCompat.getColor(this, R.color.maroon_700))
            .build()
        try {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(true)
                .build()
                .launchUrl(this, uri)
        } catch (e: Exception) {
            // No browser that supports Custom Tabs — plain VIEW fallback.
            openExternal(Intent(Intent.ACTION_VIEW, uri))
        }
    }

    override fun openExternal(intent: Intent) {
        startActivity(intent)
    }

    override fun onPageStarted() {
        progress.isVisible = true
    }

    override fun onPageFinished() {
        progress.isVisible = false
        swipeRefresh.isRefreshing = false
    }

    override fun onConnectionLost() {
        progress.isVisible = false
        swipeRefresh.isRefreshing = false
        showOffline(true)
    }

    override fun onRendererGone() {
        // The WebView's renderer process died; the view object is now dead.
        // Recreating the activity rebuilds it and restores state.
        recreate()
    }

    // ── HallnectChromeClient.Callbacks ───────────────────────────────────────

    override fun onProgress(percent: Int) {
        progress.setProgressCompat(percent, true)
        if (percent >= 100) progress.isVisible = false
    }

    /**
     * Hall-photo selection: system gallery picker (multi-select when the page
     * asks for it) with a "take photo" option offered alongside. CAMERA is
     * deliberately not a declared permission — ACTION_IMAGE_CAPTURE delegates
     * to the camera app, which needs nothing from us.
     */
    override fun onShowFileChooser(
        filePathCallback: ValueCallback<Array<Uri>>,
        params: FileChooserParams,
    ): Boolean {
        // A second chooser while one is pending: release the old one first —
        // an unresolved callback wedges the page's <input type="file"> forever.
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = filePathCallback

        val allowMultiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
        val acceptTypes = params.acceptTypes.filter { it.isNotBlank() }

        val galleryIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (acceptTypes.isEmpty()) "image/*" else acceptTypes[0]
            if (acceptTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
        }

        val extraIntents = mutableListOf<Intent>()
        val wantsImages = acceptTypes.isEmpty() || acceptTypes.any { it.startsWith("image") }
        if (wantsImages) {
            createCameraIntent()?.let { extraIntents += it }
        }

        val chooser = Intent.createChooser(
            galleryIntent, getString(R.string.choose_photos),
        ).apply {
            if (extraIntents.isNotEmpty()) {
                putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toTypedArray())
            }
        }

        return try {
            fileChooserLauncher.launch(chooser)
            true
        } catch (e: Exception) {
            pendingFileCallback = null
            filePathCallback.onReceiveValue(null)
            false
        }
    }

    private fun createCameraIntent(): Intent? = try {
        val photoDir = File(cacheDir, "camera").apply { mkdirs() }
        val photoFile = File.createTempFile("hall_", ".jpg", photoDir)
        val uri = FileProvider.getUriForFile(
            this, "com.hallnect.app.fileprovider", photoFile,
        )
        pendingCameraUri = uri
        Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    } catch (e: Exception) {
        null
    }

    private fun deliverFileChooserResult(result: ActivityResult) {
        val callback = pendingFileCallback ?: return
        pendingFileCallback = null
        val cameraUri = pendingCameraUri
        pendingCameraUri = null

        if (result.resultCode != RESULT_OK) {
            // The contract: cancel MUST resolve the callback with null.
            callback.onReceiveValue(null)
            return
        }

        val data = result.data
        val uris: Array<Uri>? = when {
            // Multi-select from the gallery.
            data?.clipData != null -> {
                val clip = data.clipData!!
                Array(clip.itemCount) { clip.getItemAt(it).uri }
            }
            // Single selection.
            data?.data != null -> arrayOf(data.data!!)
            // No data payload = the camera path wrote to EXTRA_OUTPUT.
            cameraUri != null -> arrayOf(cameraUri)
            else -> null
        }
        callback.onReceiveValue(uris)
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        // Session cookies survive process death only if flushed.
        CookieManager.getInstance().flush()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        // Detach before destroy so no callback fires into a dead activity.
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        webView.destroy()
        super.onDestroy()
    }
}
