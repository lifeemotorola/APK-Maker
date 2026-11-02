import { isAndroidNative, readAssetText } from './nativeBridge';

/**
 * fetch() wrapper that works both against the desktop KeySense server
 * (http://localhost:8000) and inside the Android APK, where the native
 * WebView shell intercepts requests and serves bundled assets instead.
 *
 * Inside the APK:
 *   GET /api/health        -> static ok payload
 *   GET /api/demos         -> {"demos": [...]} from assets/demos/manifest.json
 *   GET /api/demos/:id     -> assets/demos/:id.json (precomputed analysis)
 *   POST /api/analyze      -> 422 friendly message (needs the desktop DSP server)
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
    return jsonResponse(
      {
        error:
          'Uploading & analyzing song files requires the KeySense desktop server. ' +
          'In the Android app, use the built-in demo songs or play live via MIDI / Bluetooth (USB or BLE MIDI keyboard).',
      },
      422
    );
  }

  if (path === '/api/export-midi') {
    // Handled by the caller through lib/midiExport.ts on Android.
    return jsonResponse({ error: 'Use client-side MIDI export on Android.' }, 422);
  }

  // Anything else (e.g. /demos/*.wav played by the <audio> element) is served
  // natively by the WebView request interceptor, never through fetch().
  return fetch(input, init);
}
