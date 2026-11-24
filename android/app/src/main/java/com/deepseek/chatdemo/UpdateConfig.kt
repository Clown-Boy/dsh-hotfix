package com.deepseek.chatdemo

import android.content.Context
import android.content.SharedPreferences

class UpdateConfig(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("deepseek_update_prefs", Context.MODE_PRIVATE)

    var githubRepo: String
        get() {
            val saved = prefs.getString(KEY_GITHUB_REPO, BuildConfig.DEFAULT_GITHUB_REPO)
                ?.trim()
                .orEmpty()
            return if (saved.isEmpty() || (saved == "OWNER/REPO" && BuildConfig.DEFAULT_GITHUB_REPO != "OWNER/REPO")) {
                BuildConfig.DEFAULT_GITHUB_REPO
            } else {
                saved
            }
        }
        set(value) {
            prefs.edit().putString(KEY_GITHUB_REPO, value.trim()).apply()
        }

    var mirrorBaseUrl: String
        get() = prefs.getString(KEY_MIRROR_URL, "")?.trim().orEmpty()
        set(value) {
            prefs.edit().putString(KEY_MIRROR_URL, value.trim()).apply()
        }

    var autoCheckOnStart: Boolean
        get() = prefs.getBoolean(KEY_AUTO_CHECK, true)
        set(value) {
            prefs.edit().putBoolean(KEY_AUTO_CHECK, value).apply()
        }

    var autoApplyHotUpdate: Boolean
        get() = prefs.getBoolean(KEY_AUTO_APPLY_HOT, false)
        set(value) {
            prefs.edit().putBoolean(KEY_AUTO_APPLY_HOT, value).apply()
        }

    var baselineApkVersionCode: Int
        get() = prefs.getInt(KEY_BASELINE_APK_CODE, 0)
        set(value) {
            prefs.edit().putInt(KEY_BASELINE_APK_CODE, value).apply()
        }

    fun isRepoConfigured(): Boolean {
        val repo = githubRepo
        if (repo.isBlank() || repo == "OWNER/REPO") return false
        val parts = repo.split('/')
        return parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()
    }

    fun buildReleaseAssetUrl(assetName: String): String {
        val rawUrl = "https://github.com/$githubRepo/releases/latest/download/$assetName"
        val mirror = mirrorBaseUrl.trim()
        if (mirror.isEmpty()) return rawUrl
        val normalizedMirror = if (mirror.endsWith("/")) mirror else "$mirror/"
        return normalizedMirror + rawUrl
    }

    companion object {
        private const val KEY_GITHUB_REPO = "github_repo"
        private const val KEY_MIRROR_URL = "mirror_base_url"
        private const val KEY_AUTO_CHECK = "auto_check_on_start"
        private const val KEY_AUTO_APPLY_HOT = "auto_apply_hot_update"
        private const val KEY_BASELINE_APK_CODE = "baseline_apk_version_code"
    }
}
