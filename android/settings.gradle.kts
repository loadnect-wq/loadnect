// Hallnect Android — Gradle settings.
//
// A deliberately minimal, repository-managed build: all dependency resolution
// goes through Google/Maven Central only, and no project-level repositories
// are permitted (FAIL_ON_PROJECT_REPOS), so a stray build script can never
// pull artifacts from an unvetted source.

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Hallnect"
include(":app")
