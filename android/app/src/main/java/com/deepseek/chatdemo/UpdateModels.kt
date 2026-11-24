package com.deepseek.chatdemo

import org.json.JSONObject

data class ManifestFile(
    val path: String,
    val assetName: String,
    val sha256: String,
    val size: Long,
)

data class ApkMeta(
    val versionCode: Int,
    val versionName: String,
    val assetName: String,
    val sha256: String,
    val size: Long,
)

data class UpdateManifest(
    val schemaVersion: Int,
    val webVersion: String,
    val minApkVersionCode: Int,
    val publishedAt: String,
    val releaseNotes: String,
    val apk: ApkMeta?,
    val files: List<ManifestFile>,
) {
    companion object {
        fun fromJson(raw: String): UpdateManifest {
            val obj = JSONObject(raw)
            val apkObj = obj.optJSONObject("apk")
            val apkMeta = apkObj?.let {
                ApkMeta(
                    versionCode = it.optInt("versionCode", 0),
                    versionName = it.optString("versionName", ""),
                    assetName = it.optString("assetName", ""),
                    sha256 = it.optString("sha256", "").lowercase(),
                    size = it.optLong("size", 0L),
                )
            }
            val filesArray = obj.optJSONArray("files")
            val files = buildList {
                if (filesArray != null) {
                    for (i in 0 until filesArray.length()) {
                        val item = filesArray.getJSONObject(i)
                        add(
                            ManifestFile(
                                path = item.getString("path"),
                                assetName = item.getString("assetName"),
                                sha256 = item.getString("sha256").lowercase(),
                                size = item.optLong("size", 0L),
                            )
                        )
                    }
                }
            }
            return UpdateManifest(
                schemaVersion = obj.optInt("schemaVersion", 1),
                webVersion = obj.optString("webVersion", ""),
                minApkVersionCode = obj.optInt("minApkVersionCode", 1),
                publishedAt = obj.optString("publishedAt", ""),
                releaseNotes = obj.optString("releaseNotes", ""),
                apk = apkMeta,
                files = files,
            )
        }
    }
}

data class FileDiffResult(
    val reuse: List<ManifestFile>,
    val download: List<ManifestFile>,
    val downloadBytes: Long,
)

sealed class UpdateCheckOutcome {
    data object Unconfigured : UpdateCheckOutcome()
    data class UpToDate(val currentWebVersion: String) : UpdateCheckOutcome()
    data class HotUpdateAvailable(
        val manifest: UpdateManifest,
        val diff: FileDiffResult,
        val currentWebVersion: String,
    ) : UpdateCheckOutcome()

    data class ApkUpdateAvailable(
        val manifest: UpdateManifest,
        val apk: ApkMeta,
        val requiredByMinApk: Boolean,
    ) : UpdateCheckOutcome()

    data class Error(val message: String) : UpdateCheckOutcome()
}
