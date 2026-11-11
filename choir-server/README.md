# Choir processing service (optional, operator hosted)

This service connects Choir Tune Finder 1.3 to server-side audio processing.
**It is not a hosted service, a bundled trained SATB model, or a claim that SATB
neural separation has been solved.** Deploy and validate models before offering
it to singers. The APK has no default server address or embedded access key.

## Outputs and honest model boundaries

1. `DemucsProvider` invokes the installed **Demucs 4.0.1 htdemucs** model for
   blended **vocals vs. accompaniment**. This is neural source separation,
   not a band-pass filter. It can leave instrumental bleed or vocal artifacts.
   Code integration is supplied; pretrained weights and runtime installation
   are the operator's responsibility. See the upstream
   [Demucs documentation](https://github.com/facebookresearch/demucs).
2. Four actual SATB vocal stems require a **separate choir-trained model**.
   None is bundled or represented as validated. Configure a trusted external
   model adapter using the contract below. Demucs music bass/drums/other outputs
   must NEVER be relabeled as soprano/alto/tenor/bass.
3. Without a SATB adapter the server analyzes the neural-isolated **blended
   vocals** with the existing multi-pitch/continuity/range estimator. It exports
   four **synthesized pitch guides**, per-part MIDI, and a pitch report. These
   guides are NOT recovered singer audio. Empty parts stay silent rather than
   inventing harmonies. The manifest, app and filenames distinguish this mode.
4. With a SATB adapter the server retains its four audio stems and estimates
   notes/Hz/timing from each stem for MIDI, guides and piano-roll practice.
   Models can still make mistakes during crossings or unison; review by ear.

Guide ranges now match the requested bounds: Soprano C4-A5, Alto G3-D5, Tenor
C3-G4, Bass E2-E4. They overlap, are not rules about gender, and do not prove
which singer made a pitch. Ordering/continuity is heuristic without a SATB
model. Synth guides use measured pitch Hz, while MIDI uses semitone numbers.

## Installation and model preparation

Use Linux, **Python 3.11**, **Node.js 22**, enough RAM/disk for model inference,
and optionally a CUDA-compatible GPU. CPU processing may take minutes.
The application imports `../android-choirtune/web` modules, so deploy this
repository, not just the Python folder. FFmpeg may be installed system-wide;
otherwise `imageio-ffmpeg` supplies its executable.

```bash
python3 -m venv choir-server/.venv
. choir-server/.venv/bin/activate
pip install -r choir-server/requirements-neural.txt

# Generate this operator secret in your own terminal. Never commit it or paste
# it into chat. Supply it to authorized app users through your own secure channel.
export CHOIR_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export CHOIR_WORK_DIR="$PWD/choir-server-data"
export TORCH_HOME="$PWD/choir-server/models"
export CHOIR_DEVICE=cpu

# Run once on a licensed test recording to obtain/cache the htdemucs weights
# and verify actual inference before exposing the API. This downloads large
# third-party assets and requires access to the model host, not only PyPI.
python -m demucs.separate -n htdemucs --two-stems vocals --device cpu /path/to/test-recording.wav

uvicorn --app-dir choir-server app:create_app --factory \
  --host 0.0.0.0 --port 8091 --workers 1
```

The optional neural dependency set is large (PyTorch/torchaudio). Match their
versions; GPU wheels may need different installation appropriate for your
hardware. Review upstream code/weight licenses and availability. Model loading
may download weights unless already cached; missing packages, weights or
failed inference produce a failed job, NEVER an unseparated fake vocal result.
The health endpoint reports package presence, not verified model readiness.

Only **one worker process** is supported: job state/queue and ownership are
in-memory. Run one instance per exclusive work directory (an exclusive filesystem lock rejects a second instance). Do not point the
work directory at shared or valuable files: the service removes its own
`job-*` directories there on startup/shutdown. Keep it outside a public static
web root, protect it with restrictive filesystem permissions, and reserve
several GB for bounded pending jobs/results. Model caches stay outside Git.

## HTTPS deployment and app connection

Put the service behind a trusted **HTTPS reverse proxy**. Do not expose the raw
HTTP listener publicly. Set the proxy body limit to at least 40 MB and its
upload timeout consistently with the service's 120-second upload deadline.
Run as an unprivileged user in an isolated environment with CPU/RAM/disk limits.
FFmpeg decoding disables network protocols and playlist demuxers, but decoder
sandboxing and patching remain operational responsibilities. Pre-cache models
and restrict network access during inference where possible.

In the APK's **Optional server vocal isolation** panel:

1. Enter your deployed HTTPS base URL and operator access key. Do not put the
   key in a URL. The app refuses HTTP, credentials in URLs, query/fragment URLs,
   and redirected requests. No access key is persisted by the app. Browser mode also requires HTTPS.
2. Check capabilities. Review whether Demucs is installed, whether a SATB
   adapter is configured, and the retention interval. Package/config presence
   does not certify weights or accuracy.
3. Choose the server recording separately from offline analysis and explicitly
   consent for **each** upload. No offline file selection or live mic audio is
   uploaded automatically.
4. Wait for the reported stage. Play isolated blended vocals or the four-part
   practice mix; all mix tracks share one WebAudio start time. Checkboxes mute
   parts and Solo selects one part. The UI says whether the mix contains
   external-model audio stems or synthesized guides.
5. View the pitch chart to use the existing piano roll/transposition/text/MIDI
   features. Saving notes does not save server audio or extend its retention.
   Download WAV/MIDI/text artifacts separately before expiry.
6. Cancel/delete to request removal. If deletion fails, or upload is interrupted
   before the job ID arrives, retention limits still apply; the UI does not
   claim deletion was confirmed. Clearing/reinstalling the app is not a server
   deletion request. Downloads already saved to a phone are not deleted.

The service also serves the browser app from `/`. On that same origin, leave
its server URL blank to use the relative API. For a separately hosted browser
UI, add its exact origin with `CHOIR_ORIGINS` (comma separated). The default
allowed cross-origin UI is `https://appassets.androidplatform.net`, the APK's
locally intercepted asset origin. Do not use wildcard CORS. TLS is terminated
by your proxy; there is no bypass for untrusted certificates.

## SATB adapter contract (model NOT included)

`CHOIR_SATB_COMMAND_JSON` is a **trusted operator-only JSON argv array**. It is
not accepted from HTTP users and is never executed through a shell. For example,
after you supply and validate your own inference script and choir-trained
weights:

```bash
export CHOIR_SATB_COMMAND_JSON='["/opt/choir/venv/bin/python", "/opt/choir/infer_satb.py"]'
```

The service appends:

```text
--input /private/job/work/demucs/htdemucs/mix/vocals.wav
--output-dir /private/job/work/satb
```

Your script must load its licensed trained model and produce exactly aligned
`soprano.wav`, `alto.wav`, `tenor.wav`, and `bass.wav`, without introducing or
removing leading silence. Each must match the recording length within 150 ms.
Missing/invalid/misaligned files fail the job instead of silently substituting
synthesis. The service converts practice exports to 22,050 Hz mono PCM16.
Adapter code is trusted executable code and must be sandboxed by the operator.
Configuration alone does not prove it is neural or accurate; evaluate on real
choirs and document model provenance. No training procedure or weights are
supplied here. A validated SATB model is still needed to fulfill actual
four-singer isolation.

## API and privacy/resource limits

All `/api/choir/v1` routes require `X-Choir-Key`. The service refuses startup
without an operator key of at least 24 characters. Use only a trusted/private
user group with this shared-key design; it is not a multi-tenant billing or
user-account system. Job IDs are unguessable and keys/tokens are not placed in
artifact URLs. Responses are `Cache-Control: no-store`.

- `GET /health`: model/config/retention capabilities.
- `POST /jobs`: raw audio body (no multipart), `X-Choir-Consent: upload-audio`.
- `GET /jobs/{id}`: queued/running/complete/failed stage and error.
- `GET /jobs/{id}/result`: validated output manifest and pitch analysis.
- `GET /jobs/{id}/files/{name}`: authenticated, allowlisted artifact download.
- `DELETE /jobs/{id}`: immediate revocation, cancellation/removal request.

Bounds: 40 MB streamed upload limit (including chunked requests), 5-minute
recordings, 120-second upload deadline, one processing worker plus two queued
or receiving requests, and ten retained completed/failed jobs. Each subprocess
has a timeout (90 seconds for decoding; 20 minutes per model/tracking stage)
and its whole process group is killed on cancellation. Completed data expires
one hour after completion, checked every five seconds. Operators can set `CHOIR_RETENTION_SECONDS` (60 to 86,400 seconds; default 3,600). Oldest completed jobs
may be evicted earlier to stay within the result count limit. Active processing
can extend total retention until completion; processing timeouts still apply.
Raw inputs and model intermediates are removed after processing; only declared
result files remain until expiry/deletion. Failures remove partial outputs.
Restart/shutdown removes service-owned jobs. Operators can access recordings;
filesystem/log backup policies and legal/copyright permissions remain their
responsibility. There is no automatic cloud deployment or encrypted-at-rest
storage provided by this repository.

## Validation and remaining work

```bash
pip install -r choir-server/requirements-test.txt
python -m unittest discover -s choir-server -p 'test_*.py' -v
node android-choirtune/web/test_server.mjs
```

Tests validate authenticated/consented upload, queue/size bounds, expiry,
revocation, failure cleanup, CORS and artifact access. Controlled fixtures test
FFmpeg conversion, adapter file contracts, tracking, guide WAV/MIDI rendering
and subprocess cancellation. Client tests cover HTTPS/key handling, misleading
manifest rejection, synchronized mix/solo/mute, downloads and deletion.

**These tests use injected non-neural fixtures and do not benchmark learned
separation.** CI deliberately does not install PyTorch or download weights.
Actual Demucs inference, real SATB weights, end-to-end phone networking/memory,
source-separation accuracy and production HTTPS hosting remain unverified or
operator-supplied. Do not describe those as tested or ready-to-use just because
the APK and contract tests build successfully.
