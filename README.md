# APK-Maker

Signed Android APKs built fully offline (npm/pypi toolchain in `android/tools`,
no Gradle/Android SDK). CI builds every APK — see `.github/workflows/build-apk.yml`.

| APK | Package | Project | Artifact |
| --- | --- | --- | --- |
| KeySense Studio | `com.keysense.studio` | `android/` | `KeySense-Studio-APK` |
| NewsDesk Studio | `com.newsdesk.studio` | `android-newsdesk/` | `NewsDesk-Studio-APK` |
| Bible Quiz (2,500+ questions, 6 Bible translations) | `com.biblequiz.app` | `android-biblequiz/` | `Bible-Quiz-APK` |
| Community Market (offline marketplace & services directory, Monrovia) | `com.marketplace.app` | `android-marketplace/` | `Marketplace-APK` |
| JS Mastery (interactive JavaScript course: 50 topics, 350 runnable practices, full in-app JS book guide, quizzes, printable certificate) | `com.jsmaster.app` | `android-jsmaster/` | `JS-Master-APK` |

Each `*/build.sh` produces a signed APK at the repo root (gitignored) plus
`*/app/build/`. See each project's README for details.

**No emoji anywhere in the APK UIs** — all icons are inline SVG
(`android-biblequiz/web/icons.js`, inline SVGs in the NewsDesk shell/shim, and
`android-newsdesk/tools/deemoji.py` patches the upstream web app at build time).
Every build fails if any emoji/symbol glyph survives in the staged assets —
see `scripts/check_no_emoji.py`.
