/* Offline full-song transport. Only 30 seconds are resampled at once; native
 * inference streams contextual blocks and stores WAV/analysis on private disk.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var N = window.ChoirTune, available = !!(N && N.demucsAvailable && N.demucsAvailable());
  var busy = false, cancelled = false, ready = false;
  $('useDemucs').checked = available;
  $('useDemucs').disabled = !available;
  if (!available) $('localModelInfo').textContent = 'Bundled Demucs runs in the Android APK on supported 64-bit ARM phones. It is not available in this browser/device. Ordinary offline SATB estimates support songs up to 15 minutes. The optional server has its own limits.';
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function check(stale) {
    if (cancelled || (stale && stale())) throw new Error('Offline isolation cancelled');
  }
  function resetAudio() {
    $('localVocalsPlayer').pause();
    $('localVocalsPlayer').removeAttribute('src');
    ready = false;
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
    if (!Number.isFinite(audio.duration) || audio.duration < 0.25 || audio.duration > 900)
      throw new Error('Bundled Demucs accepts audio from 0.25 seconds up to 15 minutes. The whole song is processed, including 3-15 minute recordings.');
    busy = true; cancelled = false;
    $('cancelDemucsBtn').disabled = false;
    resetAudio();
    var began = false;
    try {
      check(stale);
      var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OC) throw new Error('Offline resampling is unavailable. Update Android System WebView.');
      var frames = Math.round(audio.duration * 44100);
      result(N.demucsBegin(frames * 4)); began = true;
      for (var offset = 0; offset < frames; offset += 30 * 44100) {
        check(stale);
        onProgress('Preparing full song for offline Demucs: ' + Math.round(offset / frames * 100) + '%');
        var count = Math.min(30 * 44100, frames - offset);
        var offline = new OC(2, count, 44100);
        var source = offline.createBufferSource(); source.buffer = audio;
        source.connect(offline.destination);
        source.start(0, offset / 44100, count / 44100);
        var stereo = await offline.startRendering();
        source.disconnect(); source.buffer = null; source = null; offline = null;
        check(stale);
        var left = stereo.getChannelData(0), right = stereo.getChannelData(1);
        for (var start = 0; start < count; start += 8192) {
          check(stale);
          var length = Math.min(8192, count - start), bytes = new Uint8Array(length * 4);
          var view = new DataView(bytes.buffer);
          for (var i = 0; i < length; i++) {
            view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[start + i])) * 32767), true);
            view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[start + i])) * 32767), true);
          }
          result(N.demucsAppend(base64(bytes)));
          if (start % 65536 === 0) await delay(0);
        }
        left = null; right = null; stereo = null;
      }
      check(stale); result(N.demucsStart());
      var lastProgress = -1, lastChange = Date.now(), status;
      while (true) {
        check(stale);
        status = JSON.parse(N.demucsStatus());
        if (status.phase === 'done') break;
        if (status.phase === 'cancelled' || status.phase === 'error') throw new Error(status.error || 'Offline isolation cancelled');
        if (status.phase !== 'processing' && status.phase !== 'loading') throw new Error('Unexpected native job state');
        var fraction = Number(status.progress) || 0;
        if (fraction > lastProgress) { lastProgress = fraction; lastChange = Date.now(); }
        // No whole-song 20-minute cutoff: a long song can take hours. Abort
        // only after 30 minutes with no progress, or explicit user cancellation.
        if (Date.now() - lastChange > 30 * 60 * 1000) throw new Error('Demucs made no progress for 30 minutes; processing cancelled.');
        onProgress(status.phase === 'loading' ? 'Verifying/loading embedded Demucs model. First run copies 84 MB locally...' :
          'Isolating the full song offline: ' + Math.round(fraction * 100) + '%. Keep the app open and powered; long songs may take hours.');
        await delay(500);
      }
      check(stale);
      // Fetch only mono 11025 Hz analysis (about 40 MB for 15 minutes), not
      // the 159 MB stereo WAV. Playback/export stream the WAV from native disk.
      var response = await fetch('https://appassets.androidplatform.net/demucs/analysis.f32', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not read native vocal analysis');
      var data = await response.arrayBuffer();
      check(stale);
      if (data.byteLength !== Math.ceil(frames / 4) * 4) throw new Error('Unexpected vocal analysis size');
      var pcm = new Float32Array(data.byteLength / 4), samples = new DataView(data);
      for (var n = 0; n < pcm.length; n++) {
        pcm[n] = samples.getFloat32(n * 4, true);
        if (!Number.isFinite(pcm[n])) throw new Error('Invalid vocal analysis sample');
        if (n % 262144 === 0) { await delay(0); check(stale); }
      }
      data = null; samples = null;
      ready = true;
      $('localVocalsPlayer').src = 'https://appassets.androidplatform.net/demucs/vocals.wav?job=' + Date.now();
      $('localVocals').classList.remove('hidden');
      return { length: pcm.length, duration: frames / 44100, sampleRate: 11025,
        numberOfChannels: 1, getChannelData: function () { return pcm; } };
    } catch (error) {
      if (began) N.demucsCancel();
      throw error;
    } finally {
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
    if (ready) N.demucsExport();
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
