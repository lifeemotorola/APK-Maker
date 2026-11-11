/* Bundled Demucs transport: bounded stereo PCM16 to the trusted Java bridge.
 * Audio stays app-private. No fetch to a remote host, no inferred SATB stems.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var N = window.ChoirTune, available = !!(N && N.demucsAvailable && N.demucsAvailable());
  var busy = false, cancelled = false, url = null, vocalBytes = null;
  $('useDemucs').checked = available;
  $('useDemucs').disabled = !available;
  if (!available) $('localModelInfo').textContent = 'Bundled Demucs runs in the Android APK on supported 64-bit ARM phones. It is not available in this browser/device. Ordinary offline SATB estimates and the optional server remain available.';
  function delay() { return new Promise(function (resolve) { setTimeout(resolve, 350); }); }
  function check(stale) {
    if (cancelled || (stale && stale())) throw new Error('Offline isolation cancelled');
  }
  function resetAudio() {
    $('localVocalsPlayer').pause();
    $('localVocalsPlayer').removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    url = null; vocalBytes = null;
    $('localVocals').classList.add('hidden');
  }
  function cancel() {
    if (!busy) return;
    cancelled = true;
    N.demucsCancel();
  }
  function base64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function result(error) { if (error) throw new Error(error); }
  async function isolate(audio, onProgress, stale) {
    if (!available) throw new Error('Bundled Demucs is not available on this device');
    if (busy) throw new Error('Wait for the previous offline job to stop');
    if (!Number.isFinite(audio.duration) || audio.duration < 0.25 || audio.duration > 30)
      throw new Error('Bundled Demucs accepts clips of 0.25 to 30 seconds. Choose a shorter clip or uncheck Demucs for ordinary estimates.');
    busy = true; cancelled = false;
    $('cancelDemucsBtn').disabled = false;
    resetAudio();
    var decode = null, began = false;
    try {
      check(stale);
      onProgress('Resampling stereo audio for offline Demucs...');
      var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OC) throw new Error('Offline resampling is unavailable. Update Android System WebView.');
      var frames = Math.round(audio.duration * 44100);
      var offline = new OC(2, frames, 44100);
      var source = offline.createBufferSource(); source.buffer = audio;
      source.connect(offline.destination); source.start();
      var stereo = await offline.startRendering();
      check(stale);
      result(N.demucsBegin(frames * 4)); began = true;
      var left = stereo.getChannelData(0), right = stereo.getChannelData(1);
      // 8192 frames = 32 KiB per bridge call, well below the native limit.
      for (var start = 0; start < frames; start += 8192) {
        check(stale);
        var count = Math.min(8192, frames - start), bytes = new Uint8Array(count * 4);
        var view = new DataView(bytes.buffer);
        for (var i = 0; i < count; i++) {
          view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[start + i])) * 32767), true);
          view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[start + i])) * 32767), true);
        }
        result(N.demucsAppend(base64(bytes)));
        // Let the Cancel button and UI run during bridge transfer.
        if (start % 65536 === 0) await delay();
      }
      check(stale); result(N.demucsStart());
      var deadline = Date.now() + 20 * 60 * 1000;
      while (true) {
        check(stale);
        if (Date.now() > deadline) throw new Error('Demucs exceeded 20 minutes; processing cancelled. Try a shorter clip.');
        var status = JSON.parse(N.demucsStatus());
        if (status.phase === 'done') break;
        if (status.phase === 'cancelled' || status.phase === 'error') throw new Error(status.error || 'Offline isolation cancelled');
        if (status.phase !== 'processing' && status.phase !== 'loading') throw new Error('Unexpected native job state');
        onProgress(status.phase === 'loading' ? 'Verifying/loading embedded Demucs model. First run copies 84 MB locally...' :
          'Isolating blended vocals offline: ' + Math.round((status.progress || 0) * 100) + '%. Keep the app open; this can take several minutes.');
        await delay();
      }
      check(stale);
      var response = await fetch('https://appassets.androidplatform.net/demucs/vocals.wav', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not read native vocal output');
      var data = await response.arrayBuffer();
      check(stale);
      if (data.byteLength !== frames * 4 + 44) throw new Error('Unexpected vocal WAV size');
      decode = new (window.AudioContext || window.webkitAudioContext)();
      var vocals = await new Promise(function (resolve, reject) { decode.decodeAudioData(data.slice(0), resolve, reject); });
      check(stale);
      vocalBytes = new Uint8Array(data);
      url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
      $('localVocalsPlayer').src = url;
      $('localVocals').classList.remove('hidden');
      return vocals;
    } catch (error) {
      if (began) N.demucsCancel();
      throw error;
    } finally {
      if (decode) await decode.close().catch(function () {});
      busy = false; $('cancelDemucsBtn').disabled = true;
    }
  }
  $('localVocalsPlayer').addEventListener('play', function () {
    if (window.ChoirSongPlayback) window.ChoirSongPlayback.stop(true);
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
  });
  $('cancelDemucsBtn').addEventListener('click', cancel);
  $('saveLocalVocalsBtn').addEventListener('click', function () {
    if (!vocalBytes) return;
    var path = N.saveFile('demucs-blended-vocals.wav', base64(vocalBytes), 'audio/wav');
    if (window.ChoirTuneEvents) window.ChoirTuneEvents.onSaved(path ? 'Vocal WAV saved: ' + path : 'Export requested; check storage permission.');
  });
  window.ChoirLocalDemucs = {
    isolate: isolate, cancel: cancel, clear: resetAudio,
    enabled: function () { return available && $('useDemucs').checked; },
    busy: function () { return busy; },
    stopAudio: function () { $('localVocalsPlayer').pause(); }
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) $('localVocalsPlayer').pause(); });
  window.addEventListener('pagehide', function () { cancel(); resetAudio(); });
}());
