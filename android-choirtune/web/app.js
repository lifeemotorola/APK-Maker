/* Choir Tune Finder — app logic.
 * Decode uploaded song (WebAudio) -> mono PCM -> melody.js extracts the lead
 * tune -> piano roll + tune sheet + synth playback + txt/.mid export.
 * State (saved-tune library) via window.ChoirTune bridge (localStorage
 * fallback in a plain browser). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var N = window.ChoirTune || null;
  var M = window.ChoirTuneMelody;
  var S = window.ChoirTuneSATB;
  var selectedPart = 'main';
  function activeTune() { return selectedPart !== 'main' && current.parts && current.parts[selectedPart] ? current.parts[selectedPart] : current.tune; }
  function partTitle() { return current.title + ' - ' + (activeTune().voice || 'Main melody'); }

  // ---------------- state ----------------
  var state = { tunes: [] };
  function loadState() {
    var raw = null;
    try { raw = N ? N.loadState() : localStorage.getItem('choirtune.state'); } catch (e) { raw = null; }
    if (raw && raw !== '{}') {
      try { var s = JSON.parse(raw); if (s && Array.isArray(s.tunes)) state.tunes = s.tunes.filter(function (t) { return t && typeof t.id === "string" && t.tune && Array.isArray(t.tune.notes) && t.tune.key; }); } catch (e) { /* keep */ }
    }
  }
  function saveState() {
    var json = JSON.stringify({ tunes: state.tunes });
    try {
      if (N) { if (!N.saveState(json)) throw new Error('Storage full'); }
      else localStorage.setItem('choirtune.state', json);
      return true;
    } catch (e) { toast('Could not save library. Check available storage.'); return false; }
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }
  window.ChoirTuneEvents = { onError: function (msg) { toast('Error: ' + msg); }, onSaved: toast };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uid() {
    return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------------- current tune ----------------
  var current = null; // {id?, title, tune, audioUrl}
  var transpose = 0;
  var synth = null;   // {ctx, oscs:[], t0, raf}
  var origAudio = null;
  var analysisId = 0;

  function setStatus(msg) { $('status').textContent = msg || ''; }

  // ---------------- upload ----------------
  $('pickBtn').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });
  var dz = $('dropZone');
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  async function handleFile(file) {
    if (window.ChoirLocalDemucs && window.ChoirLocalDemucs.busy()) { toast('Offline isolation is running. Cancel it and wait before choosing another song.'); return; }
    var useDemucs = !!(window.ChoirLocalDemucs && window.ChoirLocalDemucs.enabled());
    if (window.ChoirLocalDemucs) window.ChoirLocalDemucs.clear();
    if (file.size > 40 * 1024 * 1024) { toast('Please choose a file smaller than 40 MB'); return; }
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
    var job = ++analysisId;
    var ctx = null;
    stopTune();
    clearOriginal();
    current = null;
    setStatus('Decoding "' + file.name + '"...');
    $('results').classList.add('hidden');
    try {
      var buf = await file.arrayBuffer();
      if (job !== analysisId) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Audio decoding is unavailable. Update Android System WebView.');
      ctx = new AC();
      var audioBuf = await new Promise(function (resolve, reject) { ctx.decodeAudioData(buf, resolve, reject); });
      await ctx.close();
      ctx = null;
      if (job !== analysisId) return;
      if (audioBuf.duration > 300) throw new Error('Please choose a song up to 5 minutes long.');
      if (useDemucs) {
        audioBuf = await window.ChoirLocalDemucs.isolate(audioBuf, function (message) {
          if (job === analysisId) setStatus(message);
        }, function () { return job !== analysisId; });
        if (job !== analysisId) return;
      }
      var pcm = new Float32Array(audioBuf.length);
      for (var c = 0; c < audioBuf.numberOfChannels; c++) {
        var d = audioBuf.getChannelData(c);
        for (var i = 0; i < pcm.length; i++) pcm[i] += d[i] / audioBuf.numberOfChannels;
      }
      var tune = await M.extractTuneAsync(pcm, audioBuf.sampleRate, function (fraction) {
        if (job === analysisId) setStatus('Finding main melody: ' + Math.round(fraction * 35) + '%');
      }, function () { return job !== analysisId; });
      if (job !== analysisId) return;
      var parts = await S.extractSATBAsync(pcm, audioBuf.sampleRate, tune, function (fraction) {
        if (job === analysisId) setStatus('Estimating SATB pitches: ' + Math.round(35 + fraction * 65) + '%');
      }, function () { return job !== analysisId; });
      if (job !== analysisId) return;
      selectedPart = 'main';
      $('partSel').value = 'main';
      transpose = 0;
      $('transposeSel').value = '0';
      origAudio = new Audio();
      origAudio.src = URL.createObjectURL(file);
      origAudio.onended = function () { $('playOrigBtn').textContent = 'Play original'; };
      current = { title: file.name.replace(/\.[^.]+$/, '') + (useDemucs ? ' (Demucs vocals; SATB estimates)' : ''), tune: tune, parts: parts };
      renderResults();
      setStatus((useDemucs ? 'Blended vocals isolated on-device by Demucs. SATB tracks are synthesized estimates, not separated singers. ' : '') + 'Choose a part to inspect pitches in Hz and hear its estimated notes. Check voice assignments against the recording.');
    } catch (err) {
      if (ctx) ctx.close().catch(function () {});
      if (job === analysisId) setStatus('Could not analyze song: ' + (err && err.message ? err.message : 'unsupported or damaged audio file'));
    }
  }

  window.ChoirImportServerAnalysis = function (analysis, title) {
    analysisId++;
    if (window.ChoirLocalDemucs) { window.ChoirLocalDemucs.cancel(); window.ChoirLocalDemucs.clear(); }
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    stopTune(); clearOriginal();
    current = { title: title + ' (server vocals)', tune: analysis.tune, parts: analysis.parts };
    selectedPart = 'soprano'; transpose = 0;
    $('partSel').value = selectedPart; $('transposeSel').value = '0';
    renderResults(); setStatus('Estimated notes tracked from server vocal output. Verify voice assignments before rehearsal.');
  };

  // ---------------- render results ----------------
  function renderResults() {
    if (!current) return;
    var t = activeTune();
    $('playOrigBtn').disabled = !origAudio;
    $('sharePartsBtn').disabled = !current.parts;
    $('partSummary').textContent = current.parts ? S.VOICES.slice().reverse().map(function (v) {
      return v.name + ': ' + current.parts[v.id].notes.length + ' estimated notes (' + M.midiToName(v.min) + '-' + M.midiToName(v.max) + ')';
    }).join(' / ') : 'Older saved tune: SATB data unavailable. Choose the song again to analyze its parts.';
    $('results').classList.remove('hidden');
    $('songInfo').innerHTML =
      '<div class="stat"><div class="n">' + esc(current.title) + '</div><div class="l">song</div></div>' +
      '<div class="stat"><div class="n">' + M.formatTime(t.duration) + '</div><div class="l">length</div></div>' +
      '<div class="stat"><div class="n">' + esc(t.key.name) + '</div><div class="l">source key (estimate)</div></div>' +
      '<div class="stat"><div class="n">' + t.bpm + '</div><div class="l">BPM</div></div>' +
      '<div class="stat"><div class="n">' + t.notes.length + '</div><div class="l">tune notes</div></div>';
    renderSheet();
    drawRoll(0);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSheet() {
    var t = activeTune();
    var beat = 60 / (t.bpm || 120);
    $('sheetBody').innerHTML = t.notes.map(function (n, i) {
      return '<tr><td>' + (i + 1) + '</td><td class="note">' + esc(M.midiToName(n.midi + transpose)) +
        '</td><td>' + M.noteFrequency(n, transpose).toFixed(1) + '</td><td>' + n.start.toFixed(3) + '</td><td>' + n.dur.toFixed(2) + 's</td><td>' +
        (n.dur / beat).toFixed(1) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="dim">no stable pitches estimated for this part; try a clearer vocal recording</td></tr>';
  }

  function drawRoll(playheadSec) {
    var canvas = $('roll');
    var t = activeTune();
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = 190;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!t.notes.length) return;
    var minM = 127, maxM = 0;
    t.notes.forEach(function (n) { minM = Math.min(minM, n.midi + transpose); maxM = Math.max(maxM, n.midi + transpose); });
    minM -= 2; maxM += 2;
    var span = Math.max(1, maxM - minM);
    var dur = Math.max(0.5, t.duration);
    function xOf(sec) { return (sec / dur) * w; }
    function yOf(midi) { return h - ((midi - minM) / span) * (h - 12) - 10; }
    // grid: one row per pitch
    for (var m = minM; m <= maxM; m++) {
      var y = yOf(m);
      ctx.fillStyle = (m % 12 === 0) ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.07)';
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = 'rgba(148,163,184,0.45)';
      ctx.font = '9px monospace';
      ctx.fillText(M.midiToName(m), 3, y - 1);
    }
    // notes
    t.notes.forEach(function (n) {
      var x0 = xOf(n.start), x1 = Math.max(x0 + 2, xOf(n.end));
      var y = yOf(n.midi + transpose);
      ctx.fillStyle = (S.VOICES.filter(function (v) { return v.id === selectedPart; })[0] || { color: '#38bdf8' }).color;
      ctx.strokeStyle = 'rgba(186,230,253,0.9)';
      var bh = Math.max(4, (h - 12) / span - 2);
      ctx.beginPath();
      ctx.rect(x0, y - bh / 2, x1 - x0, bh);
      ctx.fill();
      ctx.stroke();
    });
    // playhead
    if (playheadSec > 0) {
      var px = xOf(playheadSec);
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  // ---------------- playback ----------------
  function stopTune(keepLocal) {
    if (synth) {
      synth.oscs.forEach(function (o) { try { o.stop(); } catch (e) {} });
      if (synth.raf) cancelAnimationFrame(synth.raf);
      if (synth.ctx) synth.ctx.close().catch(function () {});
      synth = null;
    }
    if (origAudio) origAudio.pause();
    if (keepLocal !== true && window.ChoirLocalDemucs) window.ChoirLocalDemucs.stopAudio();
    $('playOrigBtn').textContent = 'Play original';
    if (current) drawRoll(0);
  }

  function clearOriginal() {
    if (origAudio) { origAudio.pause(); URL.revokeObjectURL(origAudio.src); origAudio = null; }
    $('playOrigBtn').textContent = 'Play original';
  }

  window.ChoirSongPlayback = { stop: stopTune };
  $('playTuneBtn').addEventListener('click', function () {
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (!current) return;
    stopTune();
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    var t = activeTune();
    var t0 = ctx.currentTime + 0.05;
    var oscs = [];
    t.notes.forEach(function (n) {
      var freq = M.noteFrequency(n, transpose);
      var osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      var g = ctx.createGain();
      var a = t0 + n.start;
      var e = t0 + n.end;
      g.gain.setValueAtTime(0.0001, a);
      g.gain.linearRampToValueAtTime(0.5, a + 0.02);
      g.gain.setValueAtTime(0.5, Math.max(a + 0.02, e - 0.05));
      g.gain.linearRampToValueAtTime(0.0001, e + 0.03);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(a);
      osc.stop(e + 0.05);
      oscs.push(osc);
    });
    synth = { ctx: ctx, oscs: oscs, t0: t0, raf: 0 };
    var tick = function () {
      if (!synth) return;
      var el = ctx.currentTime - t0;
      drawRoll(el);
      if (el > t.duration + 0.2) { stopTune(); return; }
      synth.raf = requestAnimationFrame(tick);
    };
    synth.raf = requestAnimationFrame(tick);
  });

  $('stopTuneBtn').addEventListener('click', stopTune);

  $('playOrigBtn').addEventListener('click', function () {
    if (window.ChoirServerAudio) window.ChoirServerAudio.stop();
    if (window.ChoirLiveTuner) window.ChoirLiveTuner.stop();
    if (!origAudio) return;
    if (!origAudio.paused) { origAudio.pause(); $('playOrigBtn').textContent = 'Play original'; return; }
    stopTune();
    origAudio.play().catch(function () { toast('cannot play this file'); });
    $('playOrigBtn').textContent = 'Pause original';
  });

  $('transposeSel').addEventListener('change', function (e) {
    stopTune();
    transpose = parseInt(e.target.value, 10) || 0;
    if (current) { renderSheet(); drawRoll(0); }
  });

  $('partSel').addEventListener('change', function () {
    if (!current) return;
    stopTune();
    selectedPart = $('partSel').value;
    if (selectedPart !== 'main' && (!current.parts || !current.parts[selectedPart])) {
      selectedPart = 'main'; $('partSel').value = 'main';
      toast('Re-upload this older saved song to estimate SATB pitches.');
    }
    renderResults();
    if (!activeTune().notes.length) toast('No stable pitches estimated for this part.');
  });
  $('sharePartsBtn').addEventListener('click', function () {
    if (!current || !current.parts) return;
    var text = S.partsToText(current.parts, current.title, transpose);
    if (N) N.shareText('Estimated SATB pitches - ' + current.title, text);
    else downloadText(text, current.title + '_SATB');
  });

  // ---------------- save / export ----------------
  $('saveBtn').addEventListener('click', function () {
    if (!current) return;
    var entry = {
      id: uid(),
      title: current.title,
      savedAt: new Date().toISOString(),
      transpose: transpose,
      tune: current.tune,
      parts: current.parts || null,
      selectedPart: selectedPart,
    };
    state.tunes.unshift(entry);
    state.tunes = state.tunes.slice(0, 50);
    var saved = saveState();
    renderLibrary();
    if (saved) toast('saved to library (' + state.tunes.length + ')');
  });

  $('exportTxtBtn').addEventListener('click', function () {
    if (!current) return;
    var text = M.tuneToText(activeTune(), partTitle(), transpose);
    if (N) N.shareText('Choir tune — ' + current.title, text);
    else downloadText(text, current.title);
  });

  $('exportMidBtn').addEventListener('click', function () {
    if (!current) return;
    var bytes = M.tuneToMidiBytes(activeTune(), activeTune().bpm, transpose);
    var b64 = M.bytesToBase64(bytes);
    var name = partTitle().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_tune.mid';
    if (N) {
      var path = N.saveFile(name, b64, 'audio/midi');
      toast(path === 'pending-permission' ? 'grant storage permission to save'
        : path ? 'saved: ' + path : 'save failed');
    } else {
      var blob = new Blob([bytes], { type: 'audio/midi' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }
  });

  function downloadText(text, title) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/[^A-Za-z0-9_-]/g, '_') + '_tune.txt';
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // ---------------- library ----------------
  function renderLibrary() {
    var el = $('library');
    el.innerHTML = state.tunes.map(function (t) {
      return '<div class="item" data-id="' + esc(t.id) + '">' +
        '<div class="t">' + esc(t.title) + '</div>' +
        '<div class="s">' + esc(t.tune.key.name) + ' · ' + t.tune.bpm + ' BPM · ' + t.tune.notes.length +
        ' notes · ' + M.formatTime(t.tune.duration) + '</div>' +
        '<div class="actions">' +
        '<button class="btn act-load">Open</button>' +
        '<button class="btn act-share">Share sheet</button>' +
        '<button class="btn act-del">Delete</button>' +
        '</div></div>';
    }).join('') || '<div class="item"><div class="s">No saved tunes yet — analyze a song and tap "Save to library".</div></div>';
    el.querySelectorAll('.item[data-id]').forEach(function (row) {
      var id = row.getAttribute('data-id');
      var entry = state.tunes.filter(function (t) { return t.id === id; })[0];
      row.querySelector('.act-load').addEventListener('click', function () {
        analysisId++;
        if (window.ChoirLocalDemucs) { window.ChoirLocalDemucs.cancel(); window.ChoirLocalDemucs.clear(); }
        stopTune();
        clearOriginal();
        setStatus('Saved tune opened. Original audio is not stored.');
        current = { title: entry.title, tune: entry.tune, parts: entry.parts || null };
        selectedPart = entry.selectedPart && entry.parts ? entry.selectedPart : 'main';
        $('partSel').value = selectedPart;
        transpose = entry.transpose || 0;
        $('transposeSel').value = String(transpose);
        renderResults();
      });
      row.querySelector('.act-share').addEventListener('click', function () {
        var text = entry.parts ? S.partsToText(entry.parts, entry.title, entry.transpose || 0) : M.tuneToText(entry.tune, entry.title, entry.transpose || 0);
        if (N) N.shareText('Choir tune — ' + entry.title, text);
        else downloadText(text, entry.title);
      });
      row.querySelector('.act-del').addEventListener('click', function () {
        if (confirm('Delete this saved tune?')) {
          state.tunes = state.tunes.filter(function (t) { return t.id !== id; });
          saveState();
          renderLibrary();
        }
      });
    });
  }

  // ---------------- boot ----------------
  window.addEventListener('resize', function () { if (current) drawRoll(0); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopTune(); });
  loadState();
  renderLibrary();
})();
