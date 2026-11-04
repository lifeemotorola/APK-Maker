import { isAndroidNative, readAssetText } from './nativeBridge';
import { analyzeAudioBytes } from './offlineAnalyze';

/**
 * fetch() wrapper that works both against the desktop KeySense server
 * (http://localhost:8000) and inside the Android APK, where the native
 * WebView shell intercepts requests and serves bundled assets instead.
 *
 * Inside the APK:
 *   GET /api/health        -> static ok payload
 *   GET /api/demos         -> {"demos": [...]} from assets/demos/manifest.json
 *   GET /api/demos/:id     -> assets/demos/:id.json (precomputed analysis)
 *   POST /api/analyze      -> full OFFLINE analysis via lib/offlineAnalyze.ts (JS DSP)
 *   /demos/* audio files   -> served by the native WebViewClient (not via fetch)
 *   POST /api/export-midi  -> handled client-side via lib/midiExport.ts
 */
function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isAndroidNative()) {
    return fetch(input, init);
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '');

  if (path === '/api/health') {
    return jsonResponse({
      status: 'ok',
      engine: 'KeySense Studio Android (offline)',
      platform: 'android',
    });
  }

  if (path === '/api/demos') {
    const text = readAssetText('demos/manifest.json');
    if (!text) return jsonResponse({ error: 'Demo manifest missing from APK assets' }, 500);
    return jsonResponse({ demos: JSON.parse(text) });
  }

  const demoMatch = path.match(/^\/api\/demos\/([A-Za-z0-9_-]+)$/);
  if (demoMatch) {
    const text = readAssetText(`demos/${demoMatch[1]}.json`);
    if (!text) return jsonResponse({ error: `Demo '${demoMatch[1]}' not found` }, 404);
    return jsonResponse(JSON.parse(text));
  }

  if (path === '/api/analyze') {
    // Fully offline in the APK: decode the uploaded audio with WebAudio and run
    // the JS DSP pipeline (src/lib/offlineAnalyze.ts) — same SongAnalysis shape
    // as the desktop Python engine.
    try {
      const body = init?.body;
      let bytes: Uint8Array;
      if (body instanceof Blob) bytes = new Uint8Array(await body.arrayBuffer());
      else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
      else if (typeof body === 'string') bytes = new TextEncoder().encode(body);
      else if (body && typeof (body as ArrayBufferView).byteLength === 'number') {
        const v = body as ArrayBufferView;
        bytes = new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength);
      } else throw new Error('empty upload body');
      let filename = 'uploaded_song.wav';
      const h = init?.headers as Headers | Record<string, string> | undefined;
      if (h) {
        const xf = h instanceof Headers ? h.get('X-Filename') : h['X-Filename'];
        if (xf) filename = decodeURIComponent(xf);
      }
      const analysis = await analyzeAudioBytes(bytes, filename);
      return jsonResponse(analysis);
    } catch (e) {
      return jsonResponse(
        { error: 'Audio analysis failed: ' + (e instanceof Error ? e.message : String(e)) },
        422
      );
    }
  }

  if (path === '/api/export-midi') {
    // Handled by the caller through lib/midiExport.ts on Android.
    return jsonResponse({ error: 'Use client-side MIDI export on Android.' }, 422);
  }

  // Anything else (e.g. /demos/*.wav played by the <audio> element) is served
  // natively by the WebView request interceptor, never through fetch().
  return fetch(input, init);
}
