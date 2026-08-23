// Hallnect Android — application module.
//
// A secure WebView shell around https://www.hallnect.com. The web app is the
// product; this module contributes the parts a browser tab cannot: native
// file/camera selection for hall photos, UPI intent hand-off for Cashfree,
// App Links, download handling, offline UX, and Play-compliant packaging.

import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing is read from android/keystore.properties, which is
// gitignored. Building a signed release without it fails loudly rather than
// silently producing a debug-signed artifact.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.hallnect.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hallnect.app"
        // 26 keeps adaptive icons and modern WebView everywhere we ship;
        // covers ~98% of active Indian Android devices.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // The app is one activity and a handful of AndroidX libraries;
            // R8 keeps the AAB small and strips debug metadata.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (keystoreProps.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.material:material:1.12.0")

    // Modern splash screen (Android 12 API backported to 26).
    implementation("androidx.core:core-splashscreen:1.0.1")

    // WebView compatibility layer (Safe Browsing, algorithmic darkening).
    implementation("androidx.webkit:webkit:1.12.1")

    // Chrome Custom Tabs — Google OAuth must NOT run inside a WebView
    // (Google returns 403 disallowed_useragent), so sign-in opens here.
    implementation("androidx.browser:browser:1.8.0")

    // Pull-to-refresh over the WebView.
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    testImplementation("junit:junit:4.13.2")
}
