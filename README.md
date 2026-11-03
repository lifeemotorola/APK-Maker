# APK-Maker

Signed Android APKs built fully offline (npm/pypi toolchain in `android/tools`,
no Gradle/Android SDK). CI builds every APK — see `.github/workflows/build-apk.yml`.

| APK | Package | Project | Artifact |
| --- | --- | --- | --- |
| KeySense Studio | `com.keysense.studio` | `android/` | `KeySense-Studio-APK` |
| NewsDesk Studio | `com.newsdesk.studio` | `android-newsdesk/` | `NewsDesk-Studio-APK` |
| Bible Quiz (2,500+ questions, 6 Bible translations) | `com.biblequiz.app` | `android-biblequiz/` | `Bible-Quiz-APK` |

Each `*/build.sh` produces a signed APK at the repo root (gitignored) plus
`*/app/build/`. See each project's README for details.
