/* KeyFinder Player — app logic (plain JS, runs inside the APK WebView).
 * Playback via WebAudio (buffer source + gain), key detection via the bundled
 * window.KeyFinder module (offline chroma/KS key analysis on the decoded PCM).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    fileInput: $('fileInput'), npTitle: $('npTitle'), npArtist: $('npArtist'),
    keyBadge: $('keyBadge'), keyName: $('keyName'), keySub: $('keySub'),
    wave: $('wave'), timeCur: $('timeCur'), timeTotal: $('timeTotal'),
    loopA: $('loopA'), loopB: $('loopB'), loopClear: $('loopClear'), loopLabel: $('loopLabel'),
    prevBtn: $('prevBtn'), playBtn: $('playBtn'), nextBtn: $('nextBtn'),
    rateSel: $('rateSel'), volSlider: $('volSlider'),
    analysisStatus: $('analysisStatus'), keyDetails: $('keyDetails'),
    kdKey: $('kdKey'), kdCamelot: $('kdCamelot'), kdConf: $('kdConf'), kdRel: $('kdRel'),
    kdAlt: $('kdAlt'), kdBpm: $('kdBpm'), confFill: $('confFill'),
    scalePills: $('scalePills'), chromaBars: $('chromaBars'), progChips: $('progChips'),
    playlist: $('playlist'), libCount: $('libCount'),
  };

  var KF = window.KeyFinder;
  if (KF && KF.findKeyInSong) {
    els.analysisStatus.textContent = 'analyzer ready';
    els.analysisStatus.className = 'status ok';
  }

  var actx = null;
  function audioCtx() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  var state = {
    tracks: [],          // { id, title, artist, genre, url? , file? , keyName? }
    index: -1,
    buffer: null,        // AudioBuffer of current track
    analysis: null,      // SongAnalysis of current track
    source: null,
    gain: null,
    playing: false,
    offset: 0,           // seconds into the track when (re)starting
    startedAt: 0,        // actx.currentTime at last start
    rate: 1,
    loopA: null,
    loopB: null,
    analyzing: false,
  };

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ----------------------------- library ----------------------------- */
  function loadLibrary() {
    fetch('demos/manifest.json').then(function (r) { return r.json(); }).then(function (demos) {
      state.tracks = demos.map(function (d) {
        return { id: d.id, title: d.title, artist: d.artist, genre: d.genre, url: d.audioUrl, keyName: d.keyName };
      });
      renderPlaylist();
      if (state.tracks.length) selectTrack(0, true);
    }).catch(function (e) {
      console.error('library load failed', e);
      els.libCount.textContent = 'demo library missing';
    });
  }

  function renderPlaylist() {
    els.playlist.innerHTML = '';
    state.tracks.forEach(function (t, i) {
      var li = document.createElement('li');
      if (i === state.index) li.className = 'active';
      var num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1);
      var meta = document.createElement('div'); meta.className = 'meta';
      var tt = document.createElement('div'); tt.className = 't'; tt.textContent = t.title;
      var aa = document.createElement('div'); aa.className = 'a'; aa.textContent = t.artist + (t.genre ? ' · ' + t.genre : '');
      meta.appendChild(tt); meta.appendChild(aa);
      var tag = document.createElement('span'); tag.className = 'key-tag';
      tag.textContent = t.keyName || 'key?';
      li.appendChild(num); li.appendChild(meta); li.appendChild(tag);
      li.addEventListener('click', function () { selectTrack(i, true); });
      els.playlist.appendChild(li);
    });
    els.libCount.textContent = state.tracks.length + ' songs';
  }

  els.fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(els.fileInput.files || []);
    files.forEach(function (f) {
      state.tracks.push({ id: 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2), title: f.name, artist: 'Your device', genre: 'Local file', file: f, keyName: null });
    });
    els.fileInput.value = '';
    renderPlaylist();
    if (files.length) selectTrack(state.tracks.length - files.length, true);
  });

  /* ----------------------------- loading ----------------------------- */
  function loadBytes(track) {
    if (track.file) return track.file.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    return fetch(track.url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
  }

  function selectTrack(i, autoplay) {
    if (i < 0 || i >= state.tracks.length) return;
    stopSource();
    state.index = i;
    state.playing = false;
    state.offset = 0;
    state.buffer = null;
    state.analysis = null;
    state.loopA = null; state.loopB = null;
    updateLoopLabel();
    var track = state.tracks[i];
    els.npTitle.textContent = track.title;
    els.npArtist.textContent = track.artist + (track.genre ? ' · ' + track.genre : '');
    els.keyName.textContent = '…';
    els.keySub.textContent = 'analyzing key…';
    els.analysisStatus.textContent = 'decoding + analyzing…';
    els.analysisStatus.className = 'status busy';
    els.keyDetails.classList.add('hidden');
    renderPlaylist();
    drawWave(null, 0);

    var bytes;
    loadBytes(track).then(function (b) {
      bytes = b;
      var ctx = audioCtx();
      var copy = bytes.slice();
      return ctx.decodeAudioData(copy.buffer).then(function (buf) {
        state.buffer = buf;
        els.timeTotal.textContent = fmt(buf.duration);
        drawWave(null, 0);
        // key analysis (async, on-device)
        state.analyzing = true;
        return KF.findKeyInSong(bytes, track.title).then(function (a) {
          state.analysis = a;
          state.analyzing = false;
          renderAnalysis(a);
          drawWave(a, currentTime());
        }).catch(function (e) {
          state.analyzing = false;
          console.error('analysis failed', e);
          els.analysisStatus.textContent = 'analysis failed: ' + (e && e.message ? e.message : e);
          els.analysisStatus.className = 'status';
          els.keySub.textContent = 'could not analyze this file';
          // still draw a waveform from the decoded buffer
          drawWaveFromBuffer(buf, 0);
        });
      });
    }).then(function () {
      if (autoplay) play();
    }).catch(function (e) {
      console.error('decode failed', e);
      els.analysisStatus.textContent = 'could not decode this audio file';
      els.analysisStatus.className = 'status';
      els.keySub.textContent = 'unsupported format';
    });
  }

  /* ----------------------------- analysis UI ----------------------------- */
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function renderAnalysis(a) {
    var k = a.key;
    els.analysisStatus.textContent = 'done in ' + a.analysisTimeSec + 's';
    els.analysisStatus.className = 'status ok';
    els.keyDetails.classList.remove('hidden');
    els.keyName.textContent = k.name;
    els.keySub.textContent = 'Camelot ' + k.camelot + ' · ' + Math.round(k.confidence * 100) + '% sure';
    els.kdKey.textContent = k.name;
    els.kdCamelot.textContent = k.camelot;
    els.kdConf.textContent = Math.round(k.confidence * 100) + '%';
    els.kdRel.textContent = k.relativeKey;
    els.kdAlt.textContent = k.alternateKey;
    els.kdBpm.textContent = Math.round(a.bpm) + ' BPM · ' + a.tuningHz.toFixed(1) + ' Hz';
    els.confFill.style.width = Math.round(k.confidence * 100) + '%';

    els.scalePills.innerHTML = '';
    k.scaleNotes.forEach(function (n) {
      var s = document.createElement('span'); s.className = 'pill'; s.textContent = n;
      els.scalePills.appendChild(s);
    });

    els.chromaBars.innerHTML = '';
    var inScale = {};
    k.scalePitchClasses.forEach(function (pc) { inScale[pc] = true; });
    var max = 0.0001;
    (k.chromaProfile || []).forEach(function (v) { if (v > max) max = v; });
    (k.chromaProfile || []).forEach(function (v, pc) {
      var bar = document.createElement('div');
      bar.className = 'bar' + (inScale[pc] ? ' in-scale' : '');
      var fill = document.createElement('i');
      fill.style.height = Math.round((v / max) * 100) + '%';
      var name = document.createElement('b');
      name.textContent = k.useFlats ? NOTE_NAMES[pc].replace('#', 'b') : NOTE_NAMES[pc];
      bar.appendChild(fill); bar.appendChild(name);
      els.chromaBars.appendChild(bar);
    });

    els.progChips.innerHTML = '';
    try {
      var prog = KF.getSongProgression(a);
      prog.slice(0, 12).forEach(function (p) {
        var s = document.createElement('span'); s.className = 'pill prog';
        s.textContent = (p.roman !== '—' ? p.roman : p.nashville) + ' ' + p.symbol;
        els.progChips.appendChild(s);
      });
      if (!prog.length) {
        var none = document.createElement('span'); none.className = 'pill prog'; none.textContent = 'no clear in-key progression';
        els.progChips.appendChild(none);
      }
    } catch (e) { /* ignore */ }

    var t = state.tracks[state.index];
    if (t) { t.keyName = k.name; renderPlaylist(); }
    drawWave(a, currentTime());
  }

  /* ----------------------------- playback ----------------------------- */
  function currentTime() {
    if (!state.buffer) return 0;
    if (state.playing) return Math.min(state.buffer.duration, state.offset + (audioCtx().currentTime - state.startedAt) * state.rate);
    return state.offset;
  }

  function startSource(at) {
    var ctx = audioCtx();
    stopSource();
    var src = ctx.createBufferSource();
    src.buffer = state.buffer;
    src.playbackRate.value = state.rate;
    if (!state.gain) {
      state.gain = ctx.createGain();
      state.gain.gain.value = els.volSlider.value / 100;
      state.gain.connect(ctx.destination);
    }
    src.connect(state.gain);
    src.onended = function () {
      if (state.playing && currentTime() >= state.buffer.duration - 0.05) {
        next();
      }
    };
    src.start(0, at);
    state.source = src;
    state.offset = at;
    state.startedAt = ctx.currentTime;
    state.playing = true;
    els.playBtn.textContent = '||';
  }

  function stopSource() {
    if (state.source) {
      try { state.source.onended = null; state.source.stop(); } catch (e) { /* already stopped */ }
      try { state.source.disconnect(); } catch (e) { /* ignore */ }
      state.source = null;
    }
    state.playing = false;
    els.playBtn.textContent = '>';
  }

  function play() {
    if (!state.buffer) return;
    audioCtx();
    if (state.playing) { pause(); return; }
    if (state.offset >= state.buffer.duration - 0.05) state.offset = 0;
    startSource(state.offset);
  }

  function pause() {
    if (!state.playing) return;
    state.offset = currentTime();
    stopSource();
  }

  function seek(t) {
    if (!state.buffer) return;
    t = Math.max(0, Math.min(state.buffer.duration, t));
    if (state.playing) startSource(t); else { state.offset = t; drawWave(state.analysis, t); }
  }

  function next() { if (state.index >= 0) selectTrack((state.index + 1) % state.tracks.length, true); }
  function prev() { if (state.index >= 0) selectTrack((state.index - 1 + state.tracks.length) % state.tracks.length, true); }

  els.playBtn.addEventListener('click', play);
  els.nextBtn.addEventListener('click', next);
  els.prevBtn.addEventListener('click', prev);
  els.rateSel.addEventListener('change', function () {
    state.rate = parseFloat(els.rateSel.value) || 1;
    if (state.playing && state.buffer) startSource(currentTime());
  });
  els.volSlider.addEventListener('input', function () {
    if (state.gain) state.gain.gain.value = els.volSlider.value / 100;
  });

  els.loopA.addEventListener('click', function () {
    state.loopA = currentTime();
    if (state.loopB !== null && state.loopB <= state.loopA) state.loopB = null;
    els.loopA.classList.add('active'); updateLoopLabel();
  });
  els.loopB.addEventListener('click', function () {
    state.loopB = currentTime();
    if (state.loopA !== null && state.loopB <= state.loopA) state.loopB = state.loopA + 0.5;
    els.loopB.classList.add('active'); updateLoopLabel();
  });
  els.loopClear.addEventListener('click', function () {
    state.loopA = null; state.loopB = null;
    els.loopA.classList.remove('active'); els.loopB.classList.remove('active');
    updateLoopLabel();
  });
  function updateLoopLabel() {
    els.loopLabel.textContent = state.loopA !== null
      ? 'A ' + fmt(state.loopA) + (state.loopB !== null ? ' – B ' + fmt(state.loopB) : '')
      : '';
  }

  els.wave.addEventListener('click', function (ev) {
    if (!state.buffer) return;
    var r = els.wave.getBoundingClientRect();
    seek(((ev.clientX - r.left) / r.width) * state.buffer.duration);
  });

  /* ----------------------------- waveform ----------------------------- */
  function drawWave(analysis, t) {
    var c = els.wave;
    var dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth || 600;
    c.width = w * dpr; c.height = 90 * dpr;
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, 90);
    var peaks = analysis && analysis.waveform && analysis.waveform.length ? analysis.waveform : null;
    if (!peaks && state.buffer) peaks = peaksFromBuffer(state.buffer, w);
    g.fillStyle = 'rgba(56,189,248,0.75)';
    if (peaks) {
      var mid = 45, n = peaks.length;
      for (var x = 0; x < w; x++) {
        var v = peaks[Math.floor((x / w) * n)] || 0;
        var h = Math.max(2, Math.abs(v) * 80);
        g.fillRect(x, mid - h / 2, 1, h);
      }
    }
    // loop region
    if (state.buffer && state.loopA !== null) {
      var dur = state.buffer.duration;
      g.fillStyle = 'rgba(217,164,65,0.18)';
      var x0 = (state.loopA / dur) * w;
      var x1 = (state.loopB !== null ? state.loopB : dur) / dur * w;
      g.fillRect(x0, 0, x1 - x0, 90);
    }
    // playhead
    if (state.buffer && dur0(state.buffer) > 0) {
      var px = (t / state.buffer.duration) * w;
      g.fillStyle = '#F8FAFC';
      g.fillRect(px, 0, 2, 90);
    }
  }
  function dur0(buf) { return buf.duration; }
  function drawWaveFromBuffer(buf, t) {
    var c = els.wave;
    var dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth || 600;
    c.width = w * dpr; c.height = 90 * dpr;
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, 90);
    var peaks = peaksFromBuffer(buf, w);
    g.fillStyle = 'rgba(56,189,248,0.75)';
    var mid = 45;
    for (var x = 0; x < w; x++) {
      var v = peaks[x] || 0;
      var h = Math.max(2, Math.abs(v) * 80);
      g.fillRect(x, mid - h / 2, 1, h);
    }
    var px = (t / buf.duration) * w;
    g.fillStyle = '#F8FAFC';
    g.fillRect(px, 0, 2, 90);
  }
  function peaksFromBuffer(buf, w) {
    var data = buf.getChannelData(0);
    var step = Math.max(1, Math.floor(data.length / w));
    var peaks = new Array(w).fill(0);
    for (var x = 0; x < w; x++) {
      var mx = 0;
      for (var i = x * step; i < Math.min((x + 1) * step, data.length); i++) {
        var a = Math.abs(data[i]);
        if (a > mx) mx = a;
      }
      peaks[x] = mx;
    }
    return peaks;
  }

  /* ----------------------------- ticker ----------------------------- */
  function tick() {
    var t = currentTime();
    els.timeCur.textContent = fmt(t);
    if (state.buffer) {
      // redraw playhead cheaply
      drawWave(state.analysis, t);
      if (state.loopA !== null && state.loopB !== null && state.playing && t >= state.loopB) {
        startSource(state.loopA);
      }
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', function () { drawWave(state.analysis, currentTime()); });

  loadLibrary();
  requestAnimationFrame(tick);
})();
