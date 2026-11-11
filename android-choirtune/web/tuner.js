/* Live monophonic tuner. Android uses native AudioRecord PCM, avoiding file://
 * getUserMedia restrictions. Secure browser previews use getUserMedia instead.
 * Reference drones and capture are mutually exclusive to avoid self-tuning. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = window.ChoirTunerPitch, N = window.ChoirTune;
  var ranges = { soprano: [60, 81, 72], alto: [55, 74, 64], tenor: [48, 67, 55], bass: [40, 64, 48] };
  var part = 'soprano', running = false, starting = false, generation = 0;
  var ctx = null, stream = null, source = null, analyser = null, timer = null, drone = null;
  var toneGeneration = 0;
  var history = [], lockedFrames = 0, lastUpdate = -Infinity, latestFrame = null;
  function status(text) { $('tunerStatus').textContent = text; }
  function clearGauge(label) {
    history = []; lockedFrames = 0;
    $('liveNote').textContent = '--'; $('liveHz').textContent = '-- Hz'; $('liveCents').textContent = '-- cents';
    $('liveState').textContent = label || 'No stable pitch';
    $('pitchGauge').classList.remove('locked');
    $('pitchNeedle').style.left = '50%'; $('pitchNeedle').style.visibility = 'hidden';
    $('pitchGauge').setAttribute('aria-label', label || 'No stable pitch');
  }
  function buttons() { $('startTunerBtn').disabled = running || starting; $('stopTunerBtn').disabled = !running && !starting; }
  function receive(frame, sr) {
    if (!running) return;
    var now = performance.now();
    if (now - lastUpdate < 35) return;
    lastUpdate = now;
    var result = P.detectPitch(frame, sr, { noiseFloor: Number($('noiseFloor').value) });
    if (!result) { clearGauge('Quiet or unclear pitch'); return; }
    var nearest = P.mapFrequency(result.frequencyHz);
    if (history.length && P.mapFrequency(history[history.length - 1]).midi !== nearest.midi) history = [];
    history.push(result.frequencyHz); history = history.slice(-3);
    var sorted = history.slice().sort(function (a, b) { return a - b; });
    var hz = sorted[Math.floor(sorted.length / 2)];
    var target = $('tuningMode').value === 'reference' ? Number($('referenceNote').value) : undefined;
    var reading = P.mapFrequency(hz, target), range = ranges[part];
    $('liveNote').textContent = reading.name;
    $('liveHz').textContent = hz.toFixed(1) + ' Hz';
    $('liveCents').textContent = (reading.cents >= 0 ? '+' : '') + reading.cents.toFixed(1) + ' cents from ' + reading.targetName;
    if (reading.midi < range[0] || reading.midi > range[1]) {
      lockedFrames = 0; $('pitchGauge').classList.remove('locked');
      $('pitchNeedle').style.visibility = 'hidden';
      $('liveState').textContent = 'Outside selected guide range';
      $('pitchGauge').setAttribute('aria-label', 'Outside selected guide range');
      return;
    }
    if (Math.abs(reading.cents) <= 5) lockedFrames++; else lockedFrames = 0;
    var locked = lockedFrames >= 3;
    if (locked) $('pitchGauge').classList.add('locked'); else $('pitchGauge').classList.remove('locked');
    $('pitchNeedle').style.visibility = 'visible';
    $('pitchNeedle').style.left = (50 + Math.max(-50, Math.min(50, reading.cents))) + '%';
    $('liveState').textContent = locked ? 'In tune (within 5 cents)' : Math.abs(reading.cents) <= 5 ? 'Settling' : reading.cents < 0 ? 'Flat - raise pitch' : 'Sharp - lower pitch';
    $('pitchGauge').setAttribute('aria-label', $('liveState').textContent + ', ' + $('liveCents').textContent);
  }
  function stopDrone() {
    toneGeneration++;
    if (!drone) return;
    try { drone.osc.stop(); } catch (e) {}
    drone.ctx.close().catch(function () {}); drone = null;
    $('stopDroneBtn').disabled = true;
  }
  function stopCapture() {
    generation++; running = false; starting = false;
    if (N && N.stopMicrophone) N.stopMicrophone();
    if (timer) clearInterval(timer); timer = null; latestFrame = null;
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); }); stream = null;
    if (source) source.disconnect(); source = null; analyser = null;
    if (ctx) ctx.close().catch(function () {}); ctx = null;
    clearGauge('Microphone stopped'); buttons();
  }
  function stopAll() { stopCapture(); stopDrone(); status('Stopped. Microphone released.'); }
  window.ChoirLiveTuner = { stop: stopAll };
  window.ChoirTunerNative = {
    onReady: function (sampleRate) {
      if (!starting) { if (N) N.stopMicrophone(); return; }
      running = true; starting = false; lastUpdate = -Infinity; buttons();
      status('Listening at ' + sampleRate + ' samples/second. Sing one note at a time.');
    },
    onFrame: function (base64, sampleRate) {
      if (!running) return;
      // Native capture produces overlapping 4096-sample frames at about 25 Hz.
      var raw = atob(base64), data = new Float32Array(raw.length / 2);
      for (var i = 0; i < data.length; i++) {
        var value = raw.charCodeAt(i * 2) | raw.charCodeAt(i * 2 + 1) << 8;
        data[i] = (value >= 32768 ? value - 65536 : value) / 32768;
      }
      latestFrame = { data: data, sampleRate: sampleRate };
    },
    onError: function (message) { stopCapture(); status('Microphone error: ' + message); },
    onStopped: function () { stopAll(); },
  };
  async function start() {
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
    stopAll();
    if (window.ChoirSongPlayback) window.ChoirSongPlayback.stop();
    var job = generation;
    starting = true; buttons(); status('Requesting microphone permission...');
    try {
      if (N && N.startMicrophone) {
        // Decouple analysis from queued native frame delivery; consume only the
        // latest frame so a slow phone cannot build up a stale DSP backlog.
        timer = setInterval(function () {
          if (latestFrame) { var frame = latestFrame; latestFrame = null; receive(frame.data, frame.sampleRate); }
        }, 40);
        N.startMicrophone(); return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Use the Android APK or an HTTPS browser with microphone support.');
      var captured = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: { ideal: 44100 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (job !== generation) { captured.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = captured;
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC(); await ctx.resume();
      if (job !== generation || !ctx) return;
      analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0;
      source = ctx.createMediaStreamSource(stream); source.connect(analyser); // no connection to speakers
      running = true; starting = false; lastUpdate = -Infinity; buttons();
      stream.getTracks().forEach(function (t) { t.onended = function () { if (running) { stopCapture(); status('Microphone disconnected.'); } }; });
      var frame = new Float32Array(4096);
      timer = setInterval(function () { if (analyser && ctx) { analyser.getFloatTimeDomainData(frame); receive(frame, ctx.sampleRate); } }, 40);
      status('Listening at ' + ctx.sampleRate + ' samples/second. Sing one note at a time.');
    } catch (error) { if (job === generation) { stopCapture(); status('Could not start microphone: ' + (error.message || error)); } }
  }
  function preset(id) {
    stopDrone(); part = id; clearGauge();
    var range = ranges[id]; $('referenceNote').innerHTML = '';
    for (var midi = range[0]; midi <= range[1]; midi++) {
      var option = document.createElement('option'); option.value = String(midi); option.textContent = P.name(midi) + ' (' + P.frequency(midi).toFixed(1) + ' Hz)';
      $('referenceNote').appendChild(option);
    }
    $('referenceNote').value = String(range[2]);
    Object.keys(ranges).forEach(function (key) { $('preset-' + key).setAttribute('aria-pressed', String(key === id)); });
    $('liveRange').textContent = id[0].toUpperCase() + id.slice(1) + ': ' + P.name(range[0]) + '-' + P.name(range[1]);
  }
  $('startTunerBtn').addEventListener('click', start);
  $('stopTunerBtn').addEventListener('click', stopAll);
  Object.keys(ranges).forEach(function (id) { $('preset-' + id).addEventListener('click', function () { preset(id); }); });
  $('tuningMode').addEventListener('change', function () { clearGauge(); });
  $('referenceNote').addEventListener('change', function () { stopDrone(); clearGauge(); });
  $('playDroneBtn').addEventListener('click', async function () {
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
    stopAll();
    if (window.ChoirSongPlayback) window.ChoirSongPlayback.stop();
    var job = generation, toneJob = toneGeneration, toneCtx = null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      toneCtx = new AC(); await toneCtx.resume();
      if (job !== generation || toneJob !== toneGeneration) { toneCtx.close(); return; }
      var osc = toneCtx.createOscillator(), gain = toneCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = P.frequency(Number($('referenceNote').value));
      gain.gain.setValueAtTime(0, toneCtx.currentTime); gain.gain.linearRampToValueAtTime(0.12, toneCtx.currentTime + 0.03);
      osc.connect(gain); gain.connect(toneCtx.destination); osc.start();
      drone = { ctx: toneCtx, osc: osc }; $('stopDroneBtn').disabled = false;
      status('Reference tone: ' + P.name(Number($('referenceNote').value)) + '. Microphone is off to avoid measuring the speaker.');
    } catch (e) { if (toneCtx) toneCtx.close().catch(function () {}); if (job === generation && toneJob === toneGeneration) status('Reference tone unavailable: ' + e.message); }
  });
  $('stopDroneBtn').addEventListener('click', function () { stopDrone(); status('Reference tone stopped.'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopAll(); });
  window.addEventListener('pagehide', stopAll);
  preset('soprano'); buttons();
})();
