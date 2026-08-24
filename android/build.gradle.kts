// Hallnect Android — root build script.
// Plugin versions live here so :app stays free of version noise.
// AGP 8.9.x + Kotlin 2.0.x + Gradle 8.11.1 (wrapper) is a documented-good trio
// that supports compileSdk 36.

plugins {
    id("com.android.application") version "8.9.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

// Optional machine-local build-output relocation. When the checkout lives in a
// cloud-synced folder (OneDrive/Dropbox), the sync client holds locks on
// build/ intermediates and races Gradle to random IOException/AccessDenied
// failures. Setting buildRoot in local.properties (gitignored) moves every
// module's build directory to a plain local path; without it, nothing changes.
val buildRoot: String? = java.util.Properties().let { props ->
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use(props::load)
    props.getProperty("buildRoot")?.trim()?.takeIf { it.isNotEmpty() }
}
if (buildRoot != null) {
    allprojects {
        layout.buildDirectory.set(File("$buildRoot/${project.name}"))
    }
}
