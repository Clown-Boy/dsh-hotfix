package com.deepseek.chatdemo

import android.webkit.JavascriptInterface
import org.json.JSONObject

class AndroidAppBridge(
    private val activity: MainActivity,
    private val config: UpdateConfig,
    private val router: WebAssetRouter,
) {
    @JavascriptInterface
    fun getStatusJson(): String {
        val activeManifest = router.readActiveManifest()
        return JSONObject().apply {
            put("apkVersionName", BuildConfig.VERSION_NAME)
            put("apkVersionCode", BuildConfig.VERSION_CODE)
            put("webVersion", activeManifest?.webVersion ?: BuildConfig.VERSION_NAME)
            put("hasActiveHotUpdate", router.hasActiveHotUpdate())
            put("githubRepo", config.githubRepo)
            put("isRepoConfigured", config.isRepoConfigured())
            put("mirrorBaseUrl", config.mirrorBaseUrl)
            put("autoCheckOnStart", config.autoCheckOnStart)
            put("autoApplyHotUpdate", config.autoApplyHotUpdate)
        }.toString()
    }

    @JavascriptInterface
    fun saveUpdateConfig(
        githubRepo: String,
        mirrorBaseUrl: String,
        autoCheckOnStart: Boolean,
        autoApplyHotUpdate: Boolean,
    ): String {
        config.githubRepo = githubRepo
        config.mirrorBaseUrl = mirrorBaseUrl
        config.autoCheckOnStart = autoCheckOnStart
        config.autoApplyHotUpdate = autoApplyHotUpdate
        return getStatusJson()
    }

    @JavascriptInterface
    fun checkUpdate() {
        activity.triggerManualCheckFromWeb()
    }

    @JavascriptInterface
    fun applyHotUpdate() {
        activity.triggerHotUpdateFromWeb()
    }

    @JavascriptInterface
    fun downloadAndInstallApk() {
        activity.triggerApkUpdateFromWeb()
    }

    @JavascriptInterface
    fun reloadApp() {
        activity.runOnUiThread {
            activity.reloadWebView()
        }
    }

    @JavascriptInterface
    fun saveBase64File(filename: String, mimeType: String, base64Data: String) {
        activity.saveExportedFile(filename, mimeType, base64Data)
    }

    @JavascriptInterface
    fun syncSystemBars(cssColor: String, isDark: Boolean) {
        activity.updateSystemBarsTheme(cssColor, isDark)
    }
}
