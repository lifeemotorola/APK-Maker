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

## APK download website

The standalone [APK-Maker download website](https://lifeemotorola.github.io/APK-Maker/downloads/)
provides search, category filters, saved apps, app requirements, published file
sizes/checksums and **one-click individual APK downloads**, without a GitHub
account. The existing KeySense application at the repository root is unchanged.
The website source is in [`downloads/`](downloads/).

### How downloads become available

After this change is merged to `main`, the build workflow publishes successful
APK artifacts as individual public files in the rolling
[`apk-downloads` release](https://github.com/lifeemotorola/APK-Maker/releases/tag/apk-downloads).
The first successful publishing run creates the release. Failed apps keep their
previous public build; unpublished apps show **Not published yet**, never a
fabricated download link. The website reads the public release API and enables
a download button only when the matching, uploaded APK asset exists. GitHub API
outages/rate limits are shown with a retry option. No tokens are sent to visitors.

All ten Android apps are listed in `downloads/apps.json`. The Windows WiFi Cam
driver, removed apps and model archives are not APKs and are not download cards.
The curated descriptions are not app-store safety reviews. Builds use the
repository's signing keys; review source and permissions before sideloading.

The existing GitHub Pages setting serves `main` at `/`, so the website appears
at `/APK-Maker/downloads/` after merge and a successful Pages deployment. No
change to Pages settings or to the current root web app is required.

```bash
# Static preview (no npm install required):
node scripts/apk-store/serve.mjs
# Visit http://localhost:4173 in your local browser.

# Dependency-free tests:
node --test scripts/apk-store/tests/catalog.test.mjs
python3 -m unittest discover -s scripts/apk-store/tests -p 'test_*.py' -v
```

Publishing only runs for trusted `main` push/manual builds, with a job-scoped
release-write token; PRs and `arena/**` branches cannot publish. The publisher
checks APK structure/CRC and badging, computes SHA-256, and labels assets with
version, source commit and workflow run. A serialized publishing job plus
per-asset run checks prevents an older run replacing a newer published build.
It uploads actual `.apk` files, not expiring Actions artifact links or ZIPs.
No generated APKs are committed to Git. Failed download/upload operations fail
the publishing job visibly rather than claiming publication succeeded.

The catalog uses self-hosted DM Sans under the SIL Open Font License
(`downloads/assets/OFL.txt`); no external fonts, analytics or advertising.
Saved apps are a local bookmark list on that browser, not an account or a record
of completed downloads.

Optional real-browser regression checks (Linux):

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix .cache/store-browser --no-package-lock playwright@1.65.0 @sparticuz/chromium@153.0.0
# With the static preview server running in another terminal:
node scripts/apk-store/tests/browser.mjs
```

These browser checks cover desktop/mobile layouts, search, categories, saved
bookmarks, sorting, app details, unavailable/error/retry states, and native
browser download events using **mock release/file responses**. They do not
publish real assets or establish a completed live APK download. Actual release
publication needs the trusted main-branch CI job after merge.
