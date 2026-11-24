package com.deepseek.chatdemo

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * 在固定 Origin `https://appassets.androidplatform.net/` 下路由静态资源：
 * 优先从热更新目录 `filesDir/web_active/` 读取单个文件，缺失时回退 APK 内置 `assets/www/`。
 */
class WebAssetRouter(
    private val context: Context,
    private val config: UpdateConfig,
) {
    val activeDir = File(context.filesDir, "web_active")
    val stagingDir = File(context.filesDir, "web_staging")
    val backupDir = File(context.filesDir, "web_backup")

    init {
        ensureBaselineConsistency()
    }

    /**
     * 若刚通过覆盖安装升级了更高版本 APK，清理旧版热更新目录，避免旧前端覆盖新包内置资源。
     */
    @Synchronized
    fun ensureBaselineConsistency() {
        val currentCode = BuildConfig.VERSION_CODE
        if (config.baselineApkVersionCode < currentCode) {
            activeDir.deleteRecursively()
            stagingDir.deleteRecursively()
            backupDir.deleteRecursively()
            config.baselineApkVersionCode = currentCode
        }
    }

    fun hasActiveHotUpdate(): Boolean {
        return File(activeDir, MANIFEST_NAME).isFile && File(activeDir, "index.html").isFile
    }

    fun readActiveManifest(): UpdateManifest? {
        val hotManifestFile = File(activeDir, MANIFEST_NAME)
        if (hotManifestFile.isFile) {
            runCatching {
                return UpdateManifest.fromJson(hotManifestFile.readText(Charsets.UTF_8))
            }
        }
        return runCatching {
            val raw = context.assets.open("$ASSET_ROOT/$MANIFEST_NAME")
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
            UpdateManifest.fromJson(raw)
        }.getOrNull()
    }

    fun openBundledAsset(relativePath: String): InputStream? {
        val safePath = sanitizeRelativePath(relativePath) ?: return null
        return runCatching {
            context.assets.open("$ASSET_ROOT/$safePath")
        }.getOrNull()
    }

    fun interceptRequest(uri: Uri?): WebResourceResponse? {
        if (uri == null || uri.scheme != "https" || uri.host != APP_HOST) {
            return null
        }
        val rawPath = uri.path?.trimStart('/') ?: ""
        val relativePath = if (rawPath.isEmpty()) "index.html" else rawPath
        val safePath = sanitizeRelativePath(relativePath) ?: return null

        val activeFile = File(activeDir, safePath)
        val stream: InputStream? = if (activeFile.isFile) {
            runCatching { FileInputStream(activeFile) }.getOrNull()
        } else {
            openBundledAsset(safePath)
        }

        if (stream == null) return null

        val mimeType = guessMimeType(safePath)
        val encoding = if (isTextMime(mimeType)) "UTF-8" else null
        return WebResourceResponse(mimeType, encoding, stream)
    }

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val APP_ORIGIN = "https://$APP_HOST"
        const val APP_START_URL = "$APP_ORIGIN/"
        const val MANIFEST_NAME = "update-manifest.json"
        private const val ASSET_ROOT = "www"

        fun sanitizeRelativePath(path: String): String? {
            val cleaned = path.replace('\\', '/').trimStart('/')
            if (cleaned.isEmpty()) return null
            val segments = cleaned.split('/')
            if (segments.any { it.isEmpty() || it == "." || it == ".." }) {
                return null
            }
            return cleaned
        }

        private fun guessMimeType(path: String): String {
            return when (path.substringAfterLast('.', "").lowercase()) {
                "html", "htm" -> "text/html"
                "js", "mjs" -> "application/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "ico" -> "image/x-icon"
                "woff2" -> "font/woff2"
                "woff" -> "font/woff"
                "ttf" -> "font/ttf"
                "txt", "md", "license" -> "text/plain"
                else -> "application/octet-stream"
            }
        }

        private fun isTextMime(mimeType: String): Boolean {
            return mimeType.startsWith("text/") ||
                mimeType == "application/javascript" ||
                mimeType == "application/json" ||
                mimeType == "image/svg+xml"
        }
    }
}
