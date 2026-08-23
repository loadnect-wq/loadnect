// Hallnect Android — root build script.
// Plugin versions live here so :app stays free of version noise.
// AGP 8.9.x + Kotlin 2.0.x + Gradle 8.11.1 (wrapper) is a documented-good trio
// that supports compileSdk 36.

plugins {
    id("com.android.application") version "8.9.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
