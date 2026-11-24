package com.deepseek.chatdemo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateManager(
    private val context: Context,
    private val config: UpdateConfig,
    private val router: WebAssetRouter,
) {
    private val mutex = Mutex()

    @Volatile
    var lastRemoteManifest: UpdateManifest? = null
        private set

    suspend fun checkForUpdates(): UpdateCheckOutcome = withContext(Dispatchers.IO) {
        if (!config.isRepoConfigured()) {
            return@withContext UpdateCheckOutcome.Unconfigured
        }
        return@withContext runCatching {
            val manifestUrl = config.buildReleaseAssetUrl(WebAssetRouter.MANIFEST_NAME)
            val rawJson = fetchText(manifestUrl)
            val remote = UpdateManifest.fromJson(rawJson)
            lastRemoteManifest = remote

            val localManifest = router.readActiveManifest()
            val localVersion = localManifest?.webVersion ?: BuildConfig.VERSION_NAME
            val currentApkCode = BuildConfig.VERSION_CODE

            val remoteApk = remote.apk
            val needsApkForMin = remote.minApkVersionCode > currentApkCode
            val hasNewerApk = remoteApk != null && remoteApk.versionCode > currentApkCode

            if (needsApkForMin && remoteApk != null) {
                return@runCatching UpdateCheckOutcome.ApkUpdateAvailable(
                    manifest = remote,
                    apk = remoteApk,
                    requiredByMinApk = true,
                )
            }

            if (hasNewerApk && remoteApk != null && remote.webVersion == localVersion) {
                return@runCatching UpdateCheckOutcome.ApkUpdateAvailable(
                    manifest = remote,
                    apk = remoteApk,
                    requiredByMinApk = false,
                )
            }

            val localFiles = localManifest?.files ?: emptyList()
            val diff = computeDiff(localFiles, remote.files)

            if (diff.download.isNotEmpty() || remote.webVersion != localVersion) {
                return@runCatching UpdateCheckOutcome.HotUpdateAvailable(
                    manifest = remote,
                    diff = diff,
                    currentWebVersion = localVersion,
                )
            }

            if (hasNewerApk && remoteApk != null) {
                return@runCatching UpdateCheckOutcome.ApkUpdateAvailable(
                    manifest = remote,
                    apk = remoteApk,
                    requiredByMinApk = false,
                )
            }

            UpdateCheckOutcome.UpToDate(localVersion)
        }.getOrElse { err ->
            UpdateCheckOutcome.Error(err.message ?: "检查更新失败")
        }
    }

    /**
     * 执行单文件/增量热更新：仅从 GitHub Releases 下载 sha256 不一致的文件，
     * 其余文件本地复用；全部通过 SHA-256 校验后再原子切换到 `web_active/`。
     */
    suspend fun applyHotUpdate(
        onProgress: (done: Int, total: Int, currentFile: String) -> Unit,
    ): Result<UpdateManifest> = mutex.withLock {
        withContext(Dispatchers.IO) {
            runCatching {
                val remote = lastRemoteManifest
                    ?: UpdateManifest.fromJson(
                        fetchText(config.buildReleaseAssetUrl(WebAssetRouter.MANIFEST_NAME))
                    )
                if (remote.minApkVersionCode > BuildConfig.VERSION_CODE) {
                    error("当前 APK 版本过低，请先更新完整安装包")
                }

                val staging = router.stagingDir
                staging.deleteRecursively()
                staging.mkdirs()

                val totalFiles = remote.files.size
                remote.files.forEachIndexed { index, fileMeta ->
                    val safePath = WebAssetRouter.sanitizeRelativePath(fileMeta.path)
                        ?: error("非法文件路径: ${fileMeta.path}")
                    val target = File(staging, safePath)
                    target.parentFile?.mkdirs()

                    val reused = tryReuseLocalFile(fileMeta, target)
                    if (!reused) {
                        val url = config.buildReleaseAssetUrl(fileMeta.assetName)
                        downloadToFile(url, target)
                    }

                    val actualSha = sha256File(target)
                    if (!actualSha.equals(fileMeta.sha256, ignoreCase = true)) {
                        error("文件校验失败 (${fileMeta.path})")
                    }
                    onProgress(index + 1, totalFiles, fileMeta.path)
                }

                // 写入新清单（不带 apk 必更阻塞信息，完整保留远端元信息）
                val manifestOut = File(staging, WebAssetRouter.MANIFEST_NAME)
                manifestOut.writeText(serializeManifest(remote), Charsets.UTF_8)

                // 原子切换 staging -> active
                val active = router.activeDir
                val backup = router.backupDir
                backup.deleteRecursively()
                if (active.exists() && !active.renameTo(backup)) {
                    error("无法备份当前前端目录")
                }
                if (!staging.renameTo(active)) {
                    if (backup.exists()) {
                        backup.renameTo(active)
                    }
                    error("切换热更新目录失败，已回滚")
                }
                backup.deleteRecursively()
                lastRemoteManifest = remote
                remote
            }.onFailure {
                router.stagingDir.deleteRecursively()
            }
        }
    }

    suspend fun downloadApk(
        apkMeta: ApkMeta,
        onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit,
    ): Result<File> = mutex.withLock {
        withContext(Dispatchers.IO) {
            runCatching {
                val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
                val targetApk = File(updatesDir, apkMeta.assetName)
                if (targetApk.isFile && sha256File(targetApk).equals(apkMeta.sha256, ignoreCase = true)) {
                    onProgress(targetApk.length(), targetApk.length())
                    return@runCatching targetApk
                }
                val tempApk = File(updatesDir, "${apkMeta.assetName}.part")
                tempApk.delete()
                val url = config.buildReleaseAssetUrl(apkMeta.assetName)
                downloadToFile(url, tempApk) { done, total ->
                    onProgress(done, if (total > 0) total else apkMeta.size)
                }
                if (apkMeta.sha256.isNotBlank()) {
                    val actual = sha256File(tempApk)
                    if (!actual.equals(apkMeta.sha256, ignoreCase = true)) {
                        tempApk.delete()
                        error("APK 校验失败，请重试")
                    }
                }
                targetApk.delete()
                if (!tempApk.renameTo(targetApk)) {
                    error("无法保存安装包")
                }
                targetApk
            }
        }
    }

    private fun tryReuseLocalFile(meta: ManifestFile, destination: File): Boolean {
        val activeCandidate = File(router.activeDir, meta.path)
        if (activeCandidate.isFile &&
            activeCandidate.length() == meta.size &&
            sha256File(activeCandidate).equals(meta.sha256, ignoreCase = true)
        ) {
            activeCandidate.copyTo(destination, overwrite = true)
            return true
        }

        val bundled = router.openBundledAsset(meta.path) ?: return false
        bundled.use { input ->
            FileOutputStream(destination).use { output ->
                input.copyTo(output)
            }
        }
        return destination.length() == meta.size &&
            sha256File(destination).equals(meta.sha256, ignoreCase = true)
    }

    private fun computeDiff(localFiles: List<ManifestFile>, remoteFiles: List<ManifestFile>): FileDiffResult {
        val localByPath = localFiles.associateBy { it.path }
        val reuse = mutableListOf<ManifestFile>()
        val download = mutableListOf<ManifestFile>()
        var downloadBytes = 0L

        for (remote in remoteFiles) {
            val local = localByPath[remote.path]
            val activeFile = File(router.activeDir, remote.path)
            val existsLocally = if (activeFile.isFile) {
                activeFile.length() == remote.size &&
                    sha256File(activeFile).equals(remote.sha256, ignoreCase = true)
            } else {
                local != null && local.sha256 == remote.sha256 && local.size == remote.size
            }

            if (existsLocally) {
                reuse.add(remote)
            } else {
                download.add(remote)
                downloadBytes += remote.size
            }
        }
        return FileDiffResult(reuse = reuse, download = download, downloadBytes = downloadBytes)
    }

    private fun fetchText(urlString: String): String {
        return openConnectionFollowingRedirects(urlString).use { conn ->
            conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        }
    }

    private fun downloadToFile(
        urlString: String,
        destination: File,
        onProgress: ((Long, Long) -> Unit)? = null,
    ) {
        openConnectionFollowingRedirects(urlString).use { conn ->
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    var downloaded = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        downloaded += read
                        onProgress?.invoke(downloaded, total)
                    }
                    output.flush()
                }
            }
        }
    }

    private fun openConnectionFollowingRedirects(urlString: String): CloseableConnection {
        var currentUrl = urlString
        for (hop in 0 until 6) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("User-Agent", "DeepSeekChatDemo-Android/${BuildConfig.VERSION_NAME}")
            }
            val code = conn.responseCode
            if (code in 300..399) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    error("重定向缺少目标地址 ($code)")
                }
                currentUrl = URL(URL(currentUrl), location).toString()
                continue
            }
            if (code !in 200..299) {
                val errBody = runCatching {
                    conn.errorStream?.bufferedReader()?.use { it.readText() }
                }.getOrNull()
                conn.disconnect()
                error("请求失败 HTTP $code${if (!errBody.isNullOrBlank()) ": ${errBody.take(120)}" else ""}")
            }
            return CloseableConnection(conn)
        }
        error("重定向次数过多")
    }

    private class CloseableConnection(val conn: HttpURLConnection) : AutoCloseable {
        val inputStream: InputStream get() = conn.inputStream
        val contentLengthLong: Long get() = conn.contentLengthLong
        override fun close() {
            conn.disconnect()
        }
    }

    private fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun serializeManifest(manifest: UpdateManifest): String {
        val root = org.json.JSONObject()
        root.put("schemaVersion", manifest.schemaVersion)
        root.put("webVersion", manifest.webVersion)
        root.put("minApkVersionCode", manifest.minApkVersionCode)
        root.put("publishedAt", manifest.publishedAt)
        root.put("releaseNotes", manifest.releaseNotes)
        if (manifest.apk != null) {
            val apkObj = org.json.JSONObject()
            apkObj.put("versionCode", manifest.apk.versionCode)
            apkObj.put("versionName", manifest.apk.versionName)
            apkObj.put("assetName", manifest.apk.assetName)
            apkObj.put("sha256", manifest.apk.sha256)
            apkObj.put("size", manifest.apk.size)
            root.put("apk", apkObj)
        } else {
            root.put("apk", org.json.JSONObject.NULL)
        }
        val arr = org.json.JSONArray()
        for (f in manifest.files) {
            val item = org.json.JSONObject()
            item.put("path", f.path)
            item.put("assetName", f.assetName)
            item.put("sha256", f.sha256)
            item.put("size", f.size)
            arr.put(item)
        }
        root.put("files", arr)
        return root.toString(2)
    }
}
