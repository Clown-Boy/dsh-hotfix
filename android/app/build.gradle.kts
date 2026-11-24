plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val githubRepoProp = (project.findProperty("DEEPSEEK_GITHUB_REPO") as String?) ?: "OWNER/REPO"
val appVersionCodeProp = (project.findProperty("DEEPSEEK_APP_VERSION_CODE") as String?)?.toIntOrNull() ?: 1
val appVersionNameProp = (project.findProperty("DEEPSEEK_APP_VERSION_NAME") as String?) ?: "0.1.3"

android {
    namespace = "com.deepseek.chatdemo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.deepseek.chatdemo"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCodeProp
        versionName = appVersionNameProp

        buildConfigField("String", "DEFAULT_GITHUB_REPO", "\"${githubRepoProp}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        // 如在 CI 中提供了签名密钥则使用正式签名，否则回退 debug 签名
        val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
        if (!ksPath.isNullOrBlank()) {
            create("release") {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSign = signingConfigs.findByName("release")
            signingConfig = releaseSign ?: signingConfigs.getByName("debug")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
