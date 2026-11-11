/* Offline, range-guided SATB pitch estimation. Not vocal source separation.
 * A shared harmonic dictionary explains a spectrum before assigning pitches
 * to ordered, overlapping vocal ranges. The same detected pitch is never
 * cloned into several parts. Ambiguous unisons and crossing voices cannot be
 * recovered from pitch alone; absent/weak parts remain empty. */
(function (root) {
  'use strict';
  var M = root.ChoirTuneMelody;
  var SR = 11025, N = 4096, HOP = 512;
  var VOICES = [
    { id: 'bass', name: 'Bass', min: 40, max: 64, center: 48, color: '#a78bfa' },
    { id: 'tenor', name: 'Tenor', min: 48, max: 67, center: 55, color: '#34d399' },
    { id: 'alto', name: 'Alto', min: 55, max: 74, center: 64, color: '#fbbf24' },
    { id: 'soprano', name: 'Soprano', min: 60, max: 81, center: 72, color: '#38bdf8' },
  ];
  var templates;
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function sinc(x) { return Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); }
  // Continuous Hann-window lobe, sampled at the actual fractional FFT bin.
  function lobe(x) { return Math.abs(sinc(x) + 0.5 * sinc(x - 1) + 0.5 * sinc(x + 1)); }
  function dictionary() {
    if (templates) return templates;
    templates = [];
    for (var midi = 40; midi <= 84; midi++) {
      // Both pure and harmonic templates allow solo flute-like sounds and
      // voiced harmonic tones without treating each overtone as a singer.
      [-0.3, 0, 0.3].forEach(function (tuning) {
      [1, 6].forEach(function (harmonics) {
        var bins = {}, norm = 0, f0 = hz(midi + tuning);
        for (var h = 1; h <= harmonics && h * f0 < SR / 2 - 20; h++) {
          var center = h * f0 * N / SR;
          for (var b = Math.max(1, Math.floor(center) - 3); b <= Math.ceil(center) + 3; b++) {
            bins[b] = (bins[b] || 0) + lobe(b - center) / Math.pow(h, 1.2);
          }
        }
        var entries = Object.keys(bins).map(function (b) { norm += bins[b] * bins[b]; return [+b, bins[b]]; });
        norm = Math.sqrt(norm);
        entries.forEach(function (e) { e[1] /= norm; });
        templates.push({ midi: midi, entries: entries, fundamental: f0 * N / SR });
      });
      });
    }
    return templates;
  }

  function candidates(mag) {
    var dict = dictionary(), residual = new Float64Array(mag), picked = [];
    var originalEnergy = 0;
    for (var b = 1; b < mag.length; b++) originalEnergy += mag[b] * mag[b];
    if (originalEnergy < 1e-6) return picked;
    // Matching pursuit with nonnegative residual cancellation. A harmonic
    // template is preferred when its partials genuinely explain the input.
    for (var step = 0; step < 4; step++) {
      var best = null, bestDot = 0;
      dict.forEach(function (t) {
        if (picked.some(function (p) { return p.midi === t.midi; })) return;
        var dot = 0;
        t.entries.forEach(function (e) { dot += residual[e[0]] * e[1]; });
        if (dot > bestDot) { bestDot = dot; best = t; }
      });
      if (!best || bestDot * bestDot < originalEnergy * 0.045) break;
      // Require actual residual fundamental energy; an overtone-only match
      // must not invent a low singer with an absent fundamental.
      var bin = Math.round(best.fundamental);
      var fundamental = Math.max(residual[bin - 1], residual[bin], residual[bin + 1]);
      if (fundamental < bestDot * 0.2) break;
      var peak = bin;
      for (var k = bin - 1; k <= bin + 1; k++) if (mag[k] > mag[peak]) peak = k;
      var y0 = mag[peak - 1], y1 = mag[peak], y2 = mag[peak + 1];
      var denom = y0 - 2 * y1 + y2;
      var shift = denom ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / denom)) : 0;
      var frequencyHz = (peak + shift) * SR / N;
      // Do not assign an off-grid/noise peak just because a template won.
      if (Math.abs(12 * Math.log2(frequencyHz / hz(best.midi))) <= 0.6) {
        picked.push({ midi: best.midi, frequencyHz: frequencyHz, strength: bestDot });
      } else break;
      best.entries.forEach(function (e) { residual[e[0]] = Math.max(0, residual[e[0]] - bestDot * e[1]); });
    }
    return picked.sort(function (a, b) { return a.midi - b.midi; });
  }

  // Ordered assignment allows overlapping ranges without duplicating pitches.
  // Continuity is a bias, not proof of voice identity. No synthesized harmony.
  function assignVoices(pitches, previous) {
    var bestCost = Infinity, best = [null, null, null, null];
    function search(i, nextVoice, assignment, cost) {
      if (i === pitches.length) {
        if (cost < bestCost) { bestCost = cost; best = assignment.slice(); }
        return;
      }
      // Leaving a pitch unassigned is preferable to placing it outside a range.
      search(i + 1, nextVoice, assignment, cost + 30);
      var p = pitches[i];
      for (var v = nextVoice; v < 4; v++) {
        var voice = VOICES[v];
        if (p.midi < voice.min || p.midi > voice.max) continue;
        var ref = previous[v] == null ? voice.center : previous[v];
        assignment[v] = p;
        search(i + 1, v + 1, assignment, cost + Math.abs(p.midi - ref) + 0.15 * Math.abs(p.midi - voice.center));
        assignment[v] = null;
      }
    }
    search(0, 0, [null, null, null, null], 0);
    return best;
  }

  function* steps(pcm, sr, metadata) {
    if (!pcm || !Number.isFinite(sr) || sr < 1000) throw new Error('Invalid audio input');
    var x = M.dsp.resample(pcm, sr), duration = x.length / SR;
    var parts = {};
    VOICES.forEach(function (v) {
      parts[v.id] = { voice: v.name, notes: [], key: metadata ? metadata.key : { rootPc: 0, mode: 'major', name: 'C Major' },
        bpm: metadata ? metadata.bpm : 120, duration: duration, estimated: true };
    });
    if (x.length < N) return parts;
    var count = Math.floor((x.length - N) / HOP) + 1;
    var win = M.dsp.hannWindow(N), re = new Float64Array(N), im = new Float64Array(N);
    var previous = [null, null, null, null], held = [null, null, null, null];
    function close(v) {
      var note = held[v];
      if (!note) return;
      var start = (note.first * HOP + N / 2) / SR;
      var end = Math.min(duration, ((note.last + 1) * HOP + N / 2) / SR);
      if (note.count >= 3) {
        var frequency = note.hzSum / note.count;
        parts[VOICES[v].id].notes.push({ midi: note.midi, start: +start.toFixed(3), end: +end.toFixed(3),
          dur: +(end - start).toFixed(3), frequencyHz: +frequency.toFixed(2),
          cents: +(1200 * Math.log2(frequency / hz(note.midi))).toFixed(1) });
      }
      held[v] = null;
    }
    for (var f = 0; f < count; f++) {
      if (f % 32 === 0) yield f / count;
      var energy = 0;
      for (var i = 0; i < N; i++) { var sample = x[f * HOP + i]; energy += sample * sample; re[i] = sample * win[i]; im[i] = 0; }
      var pitches = [];
      if (Math.sqrt(energy / N) > 0.012) {
        M.dsp.fft(re, im);
        var mag = new Float64Array(N / 2);
        for (var b = 1; b < N / 2; b++) mag[b] = Math.hypot(re[b], im[b]);
        pitches = candidates(mag);
      }
      var assignment = assignVoices(pitches, previous);
      for (var v = 0; v < 4; v++) {
        var p = assignment[v], cur = held[v];
        if (!p) {
          if (cur && f - cur.last > 1) close(v);
          if (!cur || f - cur.last > 6) previous[v] = null;
          continue;
        }
        if (cur && cur.midi !== p.midi) close(v);
        if (!held[v]) held[v] = { midi: p.midi, first: f, last: f, count: 0, hzSum: 0 };
        held[v].last = f; held[v].count++; held[v].hzSum += p.frequencyHz;
        previous[v] = p.midi;
      }
    }
    for (var v2 = 0; v2 < 4; v2++) close(v2);
    return parts;
  }
  function extractSATB(pcm, sr, metadata) {
    var iterator = steps(pcm, sr, metadata), result;
    do { result = iterator.next(); } while (!result.done);
    return result.value;
  }
  async function extractSATBAsync(pcm, sr, metadata, onProgress, isCancelled) {
    var iterator = steps(pcm, sr, metadata), result;
    do {
      if (isCancelled && isCancelled()) throw new Error('Analysis cancelled');
      result = iterator.next();
      if (!result.done) {
        if (onProgress) onProgress(result.value);
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    } while (!result.done);
    return result.value;
  }
  function partsToText(parts, title, transpose) {
    return ['ESTIMATED SATB PITCHES: ' + title,
      'Range-guided pitch estimates, not isolated singers. Instruments and overlapping ranges can mislead.']
      .concat(VOICES.slice().reverse().map(function (v) { return M.tuneToText(parts[v.id], title + ' - ' + v.name, transpose); })).join('\n\n');
  }
  root.ChoirTuneSATB = { VOICES: VOICES, extractSATB: extractSATB, extractSATBAsync: extractSATBAsync,
    assignVoices: assignVoices, partsToText: partsToText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
