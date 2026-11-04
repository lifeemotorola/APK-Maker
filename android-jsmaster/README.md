# JS Mastery v1.1 — interactive JavaScript course APK (beginner -> advanced)

A single signed Android APK, `com.jsmaster.app` (minSdk 23 / targetSdk 34),
**by Emmanuel Suah**: a full **offline** interactive course to learn
JavaScript from absolute beginner to advanced, with real-time practice.

- **50 topics** in 3 levels (18 Beginner, 17 Intermediate, 15 Advanced):
  variables, data types, strings, operators, conditionals, loops, functions,
  scope, arrays, objects, arrow functions, destructuring, spread, map/filter/
  reduce, sorting, JSON, dates, errors, callbacks, promises, async/await,
  timers, DOM, regex, closures, `this`, prototypes, classes, inheritance,
  recursion, higher-order functions, generators, iterators, Proxy, event
  loop, modules, memory/perf, testing, and a final to-do mini-project.
- **5,250 practice problems** (105 per topic), each with a starter snippet, a
  hint, a solution, and a **real test** that runs your code. Every practice's
  solution is executed and verified in a VM at build time
  (`web/test_course.js`), so the course can never ship broken.
- **Real-time "try it yourself"**: a built-in code editor + Playground runs
  any JavaScript live in a sandboxed iframe (`sandbox="allow-scripts"`, 3 s
  time limit, captured `console.log`) — no internet needed.
- **Quizzes**: 8 questions per topic (400 total); pass 5/8 to unlock the next
  topic (sequential unlock).
- **Final exam**: 50 questions (one per topic); 70%+ unlocks the
  **certificate**.
- **Printable certificate**: classical gold-bordered design with your name,
  course title, date, exam score and author signature; the **Print** button
  calls the Android system print dialog (`MainActivity` -> `PrintManager` via
  `webView.createPrintDocumentAdapter`), and `@media print` CSS prints only
  the certificate.
- **v1.1 features**: live topic **search**, practice filters (All / Unsolved /
  **Starred** with a per-practice star toggle), **Random unsolved** jump button,
  **Run solution** (executes the official solution through the same runner),
  a **day streak** counter on Home, and richer lessons — every topic now also
  has a **Common pitfalls** list and a **Where you will use this** section.
- **Runner regression test**: `web/test_runner.js` extracts the shipped
  srcdoc/postMessage runner from `app.js` and executes it in a VM (hello-world,
  practice test, syntax error, failing test, promise test, `</script>` in a
  string) — wired into `build.sh` and CI so a broken Run button can never ship.
- Progress (solved practices, quiz scores, exam, name, stars, streak days) is cached in the
  WebView's **local SQLite database** (WebSQL `jsmaster`, localStorage
  fallback). Hardware BACK walks the in-app screen stack.

## How the data is built
`web/gen_course.js` (seeded, deterministic) generates `data/topics.json`
(lessons + quizzes) and `data/p/<topic>.json` (105 practices each) at build
time; `web/test_course.js` runs all 5,250 solutions + tests in a VM and fails
the build on any failure. Both run in `build.sh` and CI.

## Layout
```
android-jsmaster/
  build.sh                 offline build pipeline (gen + course tests + runner test + emoji gate)
  web/
    index.html             app shell + splash
    styles.css             day/night themes + print stylesheet
    icons.js               inline SVG icon library (no emoji — build-enforced)
    app.js                 router, sandboxed code runner, progress (SQLite), screens
    gen_course.js          course generator (50 topics / 5,250 practices)
    test_course.js         VM validator — executes every solution+test
    test_runner.js         VM test of the shipped in-app code runner
    img/hero.jpg           bundled artwork
  app/
    src/main/AndroidManifest.xml
    src/main/java/com/jsmaster/app/{MainActivity,LocalServer}.java
      MainActivity: loopback WebView shell + BACK bridge + print bridge
    src/main/res/...       launcher icon (</> on indigo/gold), strings, security config
```

## Build
```bash
./android-jsmaster/build.sh     # -> app/build/JS-Master-1.1.apk + ./JS-Master.apk
```
