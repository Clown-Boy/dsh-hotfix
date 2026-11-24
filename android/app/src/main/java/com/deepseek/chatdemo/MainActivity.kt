package com.deepseek.chatdemo

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var config: UpdateConfig
    private lateinit var router: WebAssetRouter
    private lateinit var updateManager: UpdateManager

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudioPermissionRequest: PermissionRequest? = null
    private var pendingInstallApk: File? = null
    private var startupCheckDone = false
    private var lastBackPressTime = 0L

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingAudioPermissionRequest
        pendingAudioPermissionRequest = null
        if (request != null) {
            if (granted) {
                request.grant(request.resources)
            } else {
                request.deny()
                Toast.makeText(this, "需要麦克风权限才能使用语音输入", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private val installPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        val apk = pendingInstallApk
        pendingInstallApk = null
        if (apk != null && apk.isFile) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
                launchApkInstaller(apk)
            } else {
                Toast.makeText(this, "未授予安装应用权限，无法完成覆盖安装", Toast.LENGTH_LONG).show()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }

        config = UpdateConfig(this)
        router = WebAssetRouter(this, config)
        updateManager = UpdateManager(this, config, router)

        rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
        }
        webView = WebView(this)
        rootContainer.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(rootContainer)

        // 将安全区和软键盘内边距施加在外层容器上，确保 WebView 自身视口尺寸（100dvh）严格避开状态栏与虚拟导航栏
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(rootContainer)

        configureWebView()
        setupBackNavigation()

        webView.loadUrl(WebAssetRouter.APP_START_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.addJavascriptInterface(AndroidAppBridge(this, config, router), "AndroidAppBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                return router.interceptRequest(request?.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url ?: return false
                if (url.scheme == "https" && url.host == WebAssetRouter.APP_HOST) {
                    return false
                }
                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!startupCheckDone) {
                    startupCheckDone = true
                    if (config.autoCheckOnStart && config.isRepoConfigured()) {
                        runStartupAutoCheck()
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val needsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!needsAudio) {
                    request.deny()
                    return
                }
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    request.grant(request.resources)
                } else {
                    pendingAudioPermissionRequest = request
                    audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                val intent = fileChooserParams?.createIntent()
                    ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                return runCatching {
                    fileChooserLauncher.launch(intent)
                    true
                }.getOrElse {
                    fileChooserCallback = null
                    false
                }
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){return window.__onAndroidBackPress ? window.__onAndroidBackPress() : false;})()"
                ) { result ->
                    if (result == "true") return@evaluateJavascript
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        val now = System.currentTimeMillis()
                        if (now - lastBackPressTime < 2000L) {
                            finish()
                        } else {
                            lastBackPressTime = now
                            Toast.makeText(this@MainActivity, "再按一次退出应用", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        })
    }

    fun updateSystemBarsTheme(cssColor: String, isDark: Boolean) {
        val parsedColor = parseCssColor(cssColor)
            ?: if (isDark) Color.rgb(24, 24, 27) else Color.WHITE
        runOnUiThread {
            rootContainer.setBackgroundColor(parsedColor)
            val controller = WindowCompat.getInsetsController(window, rootContainer)
            controller.isAppearanceLightStatusBars = !isDark
            controller.isAppearanceLightNavigationBars = !isDark
        }
    }

    private fun parseCssColor(raw: String): Int? {
        val trimmed = raw.trim()
        if (trimmed.startsWith("#")) {
            return runCatching { Color.parseColor(trimmed) }.getOrNull()
        }
        val match = Regex("""rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)""").find(trimmed)
        if (match != null) {
            val r = match.groupValues[1].toIntOrNull()?.coerceIn(0, 255) ?: return null
            val g = match.groupValues[2].toIntOrNull()?.coerceIn(0, 255) ?: return null
            val b = match.groupValues[3].toIntOrNull()?.coerceIn(0, 255) ?: return null
            return Color.rgb(r, g, b)
        }
        return null
    }

    fun reloadWebView() {
        webView.clearCache(true)
        webView.loadUrl(WebAssetRouter.APP_START_URL)
    }

    private fun runStartupAutoCheck() {
        lifecycleScope.launch {
            when (val outcome = updateManager.checkForUpdates()) {
                is UpdateCheckOutcome.HotUpdateAvailable -> {
                    emitUpdateEvent(outcomeToJson(outcome))
                    if (config.autoApplyHotUpdate) {
                        executeHotUpdate(silent = true)
                    } else {
                        showHotUpdateDialog(outcome)
                    }
                }

                is UpdateCheckOutcome.ApkUpdateAvailable -> {
                    emitUpdateEvent(outcomeToJson(outcome))
                    showApkUpdateDialog(outcome.apk, outcome.manifest.releaseNotes, outcome.requiredByMinApk)
                }

                else -> Unit
            }
        }
    }

    fun triggerManualCheckFromWeb() {
        lifecycleScope.launch {
            emitUpdateEvent(JSONObject().apply { put("type", "checking") })
            val outcome = updateManager.checkForUpdates()
            emitUpdateEvent(outcomeToJson(outcome))
        }
    }

    fun triggerHotUpdateFromWeb() {
        lifecycleScope.launch {
            executeHotUpdate(silent = false)
        }
    }

    fun triggerApkUpdateFromWeb() {
        val apkMeta = updateManager.lastRemoteManifest?.apk
        if (apkMeta == null) {
            emitUpdateEvent(
                JSONObject().apply {
                    put("type", "error")
                    put("message", "当前 Release 未包含 APK 安装包")
                }
            )
            return
        }
        lifecycleScope.launch {
            executeApkDownloadAndInstall(apkMeta)
        }
    }

    private suspend fun executeHotUpdate(silent: Boolean) {
        emitUpdateEvent(JSONObject().apply {
            put("type", "hot_progress")
            put("done", 0)
            put("total", 0)
            put("file", "")
        })
        val result = updateManager.applyHotUpdate { done, total, currentFile ->
            runOnUiThread {
                emitUpdateEvent(JSONObject().apply {
                    put("type", "hot_progress")
                    put("done", done)
                    put("total", total)
                    put("file", currentFile)
                })
            }
        }
        result.onSuccess { manifest ->
            emitUpdateEvent(JSONObject().apply {
                put("type", "hot_done")
                put("webVersion", manifest.webVersion)
            })
            if (silent) {
                Toast.makeText(
                    this@MainActivity,
                    "已自动更新前端资源至 ${manifest.webVersion}，正在刷新",
                    Toast.LENGTH_SHORT
                ).show()
                reloadWebView()
            } else {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("热更新完成")
                    .setMessage("已增量更新至 ${manifest.webVersion}，是否立即刷新页面？")
                    .setPositiveButton("立即刷新") { _, _ -> reloadWebView() }
                    .setNegativeButton("稍后", null)
                    .show()
            }
        }.onFailure { err ->
            emitUpdateEvent(JSONObject().apply {
                put("type", "error")
                put("message", err.message ?: "热更新失败")
            })
            if (!silent) {
                Toast.makeText(this@MainActivity, err.message ?: "热更新失败", Toast.LENGTH_LONG).show()
            }
        }
    }

    private suspend fun executeApkDownloadAndInstall(apkMeta: ApkMeta) {
        val result = updateManager.downloadApk(apkMeta) { done, total ->
            runOnUiThread {
                emitUpdateEvent(JSONObject().apply {
                    put("type", "apk_progress")
                    put("done", done)
                    put("total", total)
                })
            }
        }
        result.onSuccess { apkFile ->
            emitUpdateEvent(JSONObject().apply {
                put("type", "apk_ready")
                put("versionName", apkMeta.versionName)
            })
            installApk(apkFile)
        }.onFailure { err ->
            emitUpdateEvent(JSONObject().apply {
                put("type", "error")
                put("message", err.message ?: "APK 下载失败")
            })
            Toast.makeText(this@MainActivity, err.message ?: "APK 下载失败", Toast.LENGTH_LONG).show()
        }
    }

    private fun installApk(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingInstallApk = apkFile
            AlertDialog.Builder(this)
                .setTitle("需要安装权限")
                .setMessage("请在系统设置中允许本应用安装更新包，授权后将自动打开安装界面。")
                .setPositiveButton("去授权") { _, _ ->
                    val intent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    )
                    installPermissionLauncher.launch(intent)
                }
                .setNegativeButton("取消") { _, _ -> pendingInstallApk = null }
                .show()
            return
        }
        launchApkInstaller(apkFile)
    }

    private fun launchApkInstaller(apkFile: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    private fun showHotUpdateDialog(outcome: UpdateCheckOutcome.HotUpdateAvailable) {
        val count = outcome.diff.download.size
        val sizeKb = (outcome.diff.downloadBytes / 1024.0).coerceAtLeast(1.0)
        val notes = outcome.manifest.releaseNotes.ifBlank { "发现新的前端资源版本 ${outcome.manifest.webVersion}" }
        AlertDialog.Builder(this)
            .setTitle("发现轻量热更新")
            .setMessage("$notes\n\n本次仅需下载 $count 个变更文件（约 ${"%.1f".format(sizeKb)} KB）。")
            .setPositiveButton("立即更新") { _, _ ->
                lifecycleScope.launch { executeHotUpdate(silent = false) }
            }
            .setNegativeButton("暂不更新", null)
            .show()
    }

    private fun showApkUpdateDialog(apk: ApkMeta, releaseNotes: String, required: Boolean) {
        val sizeMb = apk.size / (1024.0 * 1024.0)
        val notes = releaseNotes.ifBlank { "发现新版本 ${apk.versionName}" }
        val builder = AlertDialog.Builder(this)
            .setTitle(if (required) "发现必需的客户端更新" else "发现新版安装包")
            .setMessage("$notes\n\n版本：${apk.versionName}（约 ${"%.1f".format(sizeMb)} MB）")
            .setPositiveButton("下载安装") { _, _ ->
                lifecycleScope.launch { executeApkDownloadAndInstall(apk) }
            }
        if (!required) {
            builder.setNegativeButton("暂不", null)
        }
        builder.show()
    }

    private fun outcomeToJson(outcome: UpdateCheckOutcome): JSONObject {
        return JSONObject().apply {
            when (outcome) {
                UpdateCheckOutcome.Unconfigured -> put("type", "unconfigured")
                is UpdateCheckOutcome.UpToDate -> {
                    put("type", "up_to_date")
                    put("webVersion", outcome.currentWebVersion)
                }

                is UpdateCheckOutcome.HotUpdateAvailable -> {
                    put("type", "hot_available")
                    put("webVersion", outcome.manifest.webVersion)
                    put("currentWebVersion", outcome.currentWebVersion)
                    put("fileCount", outcome.diff.download.size)
                    put("reuseCount", outcome.diff.reuse.size)
                    put("downloadBytes", outcome.diff.downloadBytes)
                    put("releaseNotes", outcome.manifest.releaseNotes)
                    put("hasApk", outcome.manifest.apk != null && outcome.manifest.apk.versionCode > BuildConfig.VERSION_CODE)
                }

                is UpdateCheckOutcome.ApkUpdateAvailable -> {
                    put("type", "apk_available")
                    put("versionName", outcome.apk.versionName)
                    put("versionCode", outcome.apk.versionCode)
                    put("size", outcome.apk.size)
                    put("required", outcome.requiredByMinApk)
                    put("releaseNotes", outcome.manifest.releaseNotes)
                }

                is UpdateCheckOutcome.Error -> {
                    put("type", "error")
                    put("message", outcome.message)
                }
            }
        }
    }

    private fun emitUpdateEvent(payload: JSONObject) {
        val escaped = JSONObject.quote(payload.toString())
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__onAndroidUpdateEvent && window.__onAndroidUpdateEvent(JSON.parse($escaped));",
                null
            )
        }
    }

    fun saveExportedFile(filename: String, mimeType: String, base64Data: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching {
                val safeName = filename.ifBlank { "chat-export.zip" }
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                        put(MediaStore.Downloads.MIME_TYPE, mimeType.ifBlank { "application/octet-stream" })
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: error("无法创建下载文件")
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                        ?: error("无法写入下载目录")
                } else {
                    @Suppress("DEPRECATION")
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    dir.mkdirs()
                    FileOutputStream(File(dir, safeName)).use { it.write(bytes) }
                }
            }.onSuccess {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "已保存到下载目录：$filename", Toast.LENGTH_LONG).show()
                }
            }.onFailure { err ->
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "保存失败：${err.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
