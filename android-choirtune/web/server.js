/* Optional, consent-gated server processing. Keys/job IDs stay in memory.
 * No endpoint is preconfigured and offline file selection never uploads.
 * Actual model stems and synthesized practice guides are labelled separately. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var voices = ['soprano', 'alto', 'tenor', 'bass'];
  var session = null, upload = null, generation = 0, mixer = null, mixGeneration = 0;
  function status(text) { $('serverStatus').textContent = text; }
  function settings() {
    var text = $('serverUrl').value.trim(), base;
    if (!text) {
      if (location.hostname === 'appassets.androidplatform.net' || location.protocol !== 'https:') throw new Error('Enter your deployed HTTPS server address.');
      base = location.origin;
    } else {
      var url = new URL(text);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS server URL without credentials, query or fragment.');
      base = url.toString().replace(/\/$/, '');
    }
    var key = $('serverKey').value.trim();
    if (!key) throw new Error('Enter the access key supplied by your server operator.');
    return { base: base + '/api/choir/v1', key: key };
  }
  async function request(config, path, options) {
    options = options || {};
    var response = await fetch(config.base + path, Object.assign({}, options, {
      headers: Object.assign({ 'X-Choir-Key': config.key }, options.headers || {}),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
    }));
    if (!response.ok) {
      var message = 'Server returned ' + response.status;
      try { var error = await response.json(); if (typeof error.detail === 'string') message = error.detail; } catch (e) {}
      throw new Error(message);
    }
    return response;
  }
  function wait(signal) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { signal.removeEventListener('abort', aborted); resolve(); }, 2000);
      function aborted() { clearTimeout(timer); reject(new Error('Cancelled')); }
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  function stopMix() {
    mixGeneration++;
    if (!mixer) return;
    mixer.abort.abort();
    mixer.sources.forEach(function (source) { try { source.stop(); } catch (e) {} });
    mixer.ctx.close().catch(function () {}); mixer = null;
  }
  window.ChoirServerAudio = { stop: stopMix };
  function changeGains() {
    if (!mixer) return;
    voices.forEach(function (voice) {
      if (mixer.gains[voice]) mixer.gains[voice].gain.value = $('include-' + voice).checked ? 0.25 : 0;
    });
  }
  voices.forEach(function (voice) {
    $('include-' + voice).addEventListener('change', changeGains);
    $('solo-' + voice).addEventListener('click', function () {
      voices.forEach(function (other) { $('include-' + other).checked = other === voice; }); changeGains();
    });
  });
  async function erase(old) {
    if (!old) return true;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 8000);
    try { await request(old.config, '/jobs/' + old.id, { method: 'DELETE', signal: controller.signal }); return true; }
    catch (e) { return false; }
    finally { clearTimeout(timer); }
  }
  async function clearSession() {
    generation++; var token = generation;
    if (upload) upload.abort(); upload = null;
    stopMix();
    var old = session; session = null;
    $('serverResults').classList.add('hidden');
    var removed = await erase(old);
    if (token === generation) status(!old ? 'Stopped locally. If upload ended before a job ID arrived, server retention limits still apply.' : removed ? 'Stopped; server deletion requested for the known job.' : 'Stopped locally. Server deletion could not be confirmed; server retention limits still apply.');
  }
  function validTrack(track) {
    return track && Number.isFinite(track.duration) && track.duration > 0 && track.duration <= 300 &&
      Number.isFinite(track.bpm) && track.bpm > 0 && track.key && typeof track.key.name === 'string' &&
      Number.isInteger(track.key.rootPc) && ['major', 'minor'].includes(track.key.mode) &&
      Array.isArray(track.notes) && track.notes.length <= 50000 && track.notes.every(function (note) {
        return Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127 && Number.isFinite(note.start) &&
          Number.isFinite(note.end) && Number.isFinite(note.dur) && note.start >= 0 && note.start < note.end &&
          note.end <= track.duration + .01 && note.dur > 0 && (!('frequencyHz' in note) || Number.isFinite(note.frequencyHz) && note.frequencyHz > 0);
      });
  }
  function validate(result) {
    if (!result || result.schemaVersion !== 1 || !result.analysis || !validTrack(result.analysis.tune) ||
        !voices.every(function (v) { return validTrack(result.analysis.parts && result.analysis.parts[v]); }) ||
        !result.separation || !['external_model', 'range_guided_estimate'].includes(result.separation.satb) ||
        !Array.isArray(result.files) || result.files.length > 20 || !result.files.every(function (file) {
          return typeof file.label === 'string' && /^[a-z-]+\.(wav|mid|txt)$/.test(file.name);
        })) throw new Error('Server returned an invalid analysis manifest.');
    if (result.separation.satb !== 'external_model' && result.files.some(function (file) { return file.kind === 'satb_stem'; })) throw new Error('Server mislabeled estimated guides as audio stems.');
    var names = result.files.map(function (f) { return f.name; });
    var expected = ['vocals.wav'].concat(voices.map(function (v) { return (result.separation.satb === 'external_model' ? '' : 'guide-') + v + '.wav'; }));
    if (!expected.every(function (name) { return names.includes(name); })) throw new Error('Server did not return the expected practice audio.');
    return result;
  }
  $('checkServerBtn').addEventListener('click', async function () {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 10000);
    try {
      status('Checking server...');
      var config = settings(), health = await (await request(config, '/health', { signal: controller.signal })).json();
      status((health.demucsInstalled ? 'Demucs package installed (weights/inference still need verification). ' : 'Server needs Demucs installation. ') +
        (health.satbModelConfigured ? 'External SATB model configured; accuracy not certified. ' : 'No SATB model: practice audio will be synthesized guides, not isolated singers. ') +
        'Retention: ' + health.retentionSeconds + ' seconds after completion.');
    } catch (e) { status('Server check failed: ' + e.message); }
    finally { clearTimeout(timer); }
  });
  $('uploadServerBtn').addEventListener('click', async function () {
    if (!$('uploadConsent').checked) { status('Confirm consent to send this recording to your server.'); return; }
    var file = $('serverFile').files && $('serverFile').files[0];
    if (!file || file.size <= 0 || file.size > 40 * 1024 * 1024) { status('Choose a nonempty audio file up to 40 MB.'); return; }
    var config;
    try { config = settings(); } catch (e) { status(e.message); return; }
    generation++; var job = generation;
    if (upload) upload.abort();
    var previous = session; session = null;
    if (previous) erase(previous); // explicit retention still applies if deletion fails
    stopMix();
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (window.ChoirSongPlayback) window.ChoirSongPlayback.stop();
    $('uploadConsent').checked = false; // each new upload needs fresh consent
    $('serverResults').classList.add('hidden'); $('uploadServerBtn').disabled = true;
    var controller = new AbortController(); upload = controller;
    var deadline = setTimeout(function () { controller.abort(); }, 30 * 60 * 1000);
    try {
      status('Uploading the chosen recording to your configured server...');
      var created = await (await request(config, '/jobs', { method: 'POST', body: file, signal: controller.signal,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Choir-Consent': 'upload-audio' } })).json();
      if (!/^[A-Za-z0-9_-]{24,64}$/.test(created.id)) throw new Error('Invalid server job ID');
      if (job !== generation) { erase({ id: created.id, config: config }); return; }
      session = { id: created.id, config: config, title: file.name.replace(/\.[^.]+$/, '') };
      while (job === generation) {
        var state = await (await request(config, '/jobs/' + created.id, { signal: controller.signal })).json();
        if (job !== generation) return;
        status(state.stage || state.status);
        if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || 'Server processing cancelled');
        if (state.status === 'complete') break;
        await wait(controller.signal);
      }
      var result = validate(await (await request(config, '/jobs/' + created.id + '/result', { signal: controller.signal })).json());
      if (job !== generation || !session) return;
      session.result = result;
      $('serverResults').classList.remove('hidden');
      $('stemKind').textContent = result.separation.satb === 'external_model' ? 'Practice mix: external-model SATB audio stems (may contain bleed).' : 'Practice mix: synthesized pitch guides. These are NOT separated singers.';
      $('serverWarning').textContent = (result.warnings || []).join(' ');
      $('serverArtifact').innerHTML = '';
      result.files.forEach(function (file) { var option = document.createElement('option'); option.value = file.name; option.textContent = file.label; $('serverArtifact').appendChild(option); });
      status('Ready. Read the rehearsal guide, play/solo/mute parts, or download a server output.');
    } catch (e) { if (job === generation) status('Server processing stopped: ' + e.message + '. Use Delete server job to remove any retained data.'); }
    finally { clearTimeout(deadline); if (job === generation) { upload = null; $('uploadServerBtn').disabled = false; } }
  });
  $('deleteServerBtn').addEventListener('click', function () { clearSession(); $('uploadServerBtn').disabled = false; });
  $('importServerBtn').addEventListener('click', function () {
    if (!session || !session.result) return;
    stopMix();
    if (window.ChoirImportServerAnalysis) window.ChoirImportServerAnalysis(session.result.analysis, session.title);
  });
  function artifact(old, name, signal) { return request(old.config, '/jobs/' + old.id + '/files/' + name, { signal: signal }); }
  async function play(vocalsOnly) {
    if (!session || !session.result) return;
    stopMix();
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (window.ChoirSongPlayback) window.ChoirSongPlayback.stop();
    var old = session, token = mixGeneration, ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      mixer = { ctx: ctx, sources: [], gains: {}, abort: new AbortController() };
      var current = mixer;
      await ctx.resume();
      var keys = vocalsOnly ? ['vocals'] : voices;
      var buffers = await Promise.all(keys.map(async function (voice) {
        var name = vocalsOnly ? 'vocals.wav' : (old.result.separation.satb === 'external_model' ? '' : 'guide-') + voice + '.wav';
        var bytes = await (await artifact(old, name, current.abort.signal)).arrayBuffer();
        return new Promise(function (resolve, reject) { ctx.decodeAudioData(bytes, resolve, reject); });
      }));
      if (token !== mixGeneration || session !== old) return;
      var start = ctx.currentTime + .08;
      buffers.forEach(function (buffer, i) {
        var source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer; source.connect(gain); gain.connect(ctx.destination);
        gain.gain.value = vocalsOnly ? .7 : $('include-' + keys[i]).checked ? .25 : 0;
        current.gains[keys[i]] = gain; current.sources.push(source);
        source.start(start);
      });
      current.sources[current.sources.length - 1].onended = function () { if (mixer === current) stopMix(); };
      status(vocalsOnly ? 'Playing neural-isolated blended vocals.' : $('stemKind').textContent + ' Solo and mute controls are active.');
    } catch (e) { if (token === mixGeneration) { stopMix(); status('Playback failed: ' + e.message); } }
  }
  $('playServerPartsBtn').addEventListener('click', function () { play(false); });
  $('playServerVocalsBtn').addEventListener('click', function () { play(true); });
  $('stopServerAudioBtn').addEventListener('click', stopMix);
  $('downloadServerBtn').addEventListener('click', async function () {
    if (!session || !session.result) return;
    var old = session, name = $('serverArtifact').value;
    if (!old.result.files.some(function (file) { return file.name === name; })) return;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 120000);
    try {
      var response = await artifact(old, name, controller.signal), bytes = new Uint8Array(await response.arrayBuffer());
      var mime = name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.mid') ? 'audio/midi' : 'text/plain';
      if (window.ChoirTune) {
        var path = window.ChoirTune.saveFile(name, window.ChoirTuneMelody.bytesToBase64(bytes), mime);
        status(path === 'pending-permission' ? 'Grant storage permission to save the output.' : path ? 'Saved: ' + path : 'Output could not be saved.');
      } else {
        var url = URL.createObjectURL(new Blob([bytes], { type: mime })), a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }
    } catch (e) { status('Download failed: ' + e.message); }
    finally { clearTimeout(timer); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopMix(); });
  window.addEventListener('pagehide', function () { stopMix(); if (upload) upload.abort(); });
})();
