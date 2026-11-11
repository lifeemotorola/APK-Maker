/* Choir Tune Finder — offline melody ("choir tune") extraction + exporters.
 *
 * Pure DSP, no DOM: app.js decodes the uploaded song with WebAudio and passes
 * mono PCM + sample rate here; node tests (test_web.mjs) synthesize PCM and
 * verify the extracted tune. Exposed as window.ChoirTuneMelody (and
 * globalThis.ChoirTuneMelody / module.exports for tests).
 *
 * Pipeline: resample to 11025 Hz -> Hann frames (2048, hop 256) -> FFT ->
 * harmonic-sum salience picks the lead pitch per frame (parabolic refined),
 * RMS gate decides voiced/unvoiced -> median smoothing -> note segmentation
 * (same pitch runs >= 70 ms). Key = Krumhansl-Kessler on the voiced chroma,
 * BPM = onset-envelope autocorrelation. Exports: text tune sheet + SMF .mid.
 */
(function (root, factory) {
  var m = factory();
  root.ChoirTuneMelody = m;
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var TARGET_SR = 11025;
  var FRAME = 2048;
  var HOP = 256;
  var MIN_F0 = 70;    // ~C2
  var MAX_F0 = 1100;  // ~C6
  var MIN_NOTE_SEC = 0.07;

  function midiToName(midi, useFlats) {
    var names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
    var m = Math.round(midi);
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function resample(pcm, sr) {
    if (sr === TARGET_SR) return pcm;
    var ratio = sr / TARGET_SR;
    var outLen = Math.floor(pcm.length / ratio);
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var p = i * ratio;
      var i0 = Math.floor(p);
      var frac = p - i0;
      var a = pcm[i0] || 0;
      var b = pcm[i0 + 1] || 0;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  /* in-place iterative radix-2 FFT; n must be a power of two */
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var i = 0; i < n; i += len) {
        var cwr = 1, cwi = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
          var vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr;
          cwr = nwr;
        }
      }
    }
  }

  function hannWindow(n) {
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  /* Krumhansl-Kessler profiles */
  var KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function estimateKey(chroma) {
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += chroma[i];
    if (sum <= 0) return { rootPc: 0, mode: 'major', name: 'C Major' };
    var norm = chroma.map(function (c) { return c / sum; });
    var best = { score: -Infinity, rootPc: 0, mode: 'major' };
    for (var root = 0; root < 12; root++) {
      var sm = 0, sn = 0;
      for (var i = 0; i < 12; i++) {
        var p = KK_MAJOR[(i - root + 12) % 12];
        sm += norm[i] * p;
        sn += p * p;
      }
      var scoreM = sm / Math.sqrt(sn);
      if (scoreM > best.score) best = { score: scoreM, rootPc: root, mode: 'major' };
      var pm = 0;
      for (var j = 0; j < 12; j++) pm += norm[j] * KK_MINOR[(j - root + 12) % 12];
      var minorNorm = KK_MINOR.reduce(function (s, p) { return s + p * p; }, 0);
      var scoreN = pm / Math.sqrt(minorNorm);
      if (scoreN > best.score) best = { score: scoreN, rootPc: root, mode: 'minor' };
    }
    var name = NOTE_NAMES[best.rootPc] + (best.mode === 'major' ? ' Major' : ' Minor');
    return { rootPc: best.rootPc, mode: best.mode, name: name };
  }

  /**
   * Extract the lead melody from mono PCM.
   * pcm: Float32Array (or number[]), sr: sample rate.
   * Returns { notes:[{midi,start,end,dur}], key, bpm, duration, voicedRatio }.
   */
  function* extractionSteps(pcm, sr, opts) {
    if (!Number.isFinite(sr) || sr < 1000 || !pcm) throw new Error("Invalid audio input");
    opts = opts || {};
    var x = resample(pcm instanceof Float32Array ? pcm : new Float32Array(pcm), sr);
    var n = x.length;
    var duration = n / TARGET_SR;
    if (n < FRAME) {
      return { notes: [], key: { rootPc: 0, mode: 'major', name: 'C Major' }, bpm: 120, duration: duration, voicedRatio: 0 };
    }

    var win = hannWindow(FRAME);
    var re = new Float64Array(FRAME);
    var im = new Float64Array(FRAME);
    var binHz = TARGET_SR / FRAME;
    var nFrames = Math.floor((n - FRAME) / HOP) + 1;
    var fps = TARGET_SR / HOP;

    var minBin = Math.max(1, Math.floor(MIN_F0 / binHz));
    var maxBin = Math.min(FRAME / 2 - 1, Math.ceil(MAX_F0 / binHz));

    var f0 = new Float64Array(nFrames);
    var voiced = new Uint8Array(nFrames);
    var rms = new Float64Array(nFrames);
    var chroma = new Float64Array(12);
    var onset = new Float64Array(nFrames);
    var prevMag = null;
    var maxRms = 1e-9;

    for (var f = 0; f < nFrames; f++) {
      if (f % 128 === 0) yield f / nFrames;
      var pos = f * HOP;
      var r = 0;
      for (var i = 0; i < FRAME; i++) {
        var v = x[pos + i] * win[i];
        re[i] = v;
        im[i] = 0;
        r += x[pos + i] * x[pos + i];
      }
      rms[f] = Math.sqrt(r / FRAME);
      if (rms[f] > maxRms) maxRms = rms[f];

      fft(re, im);
      var mag = new Float64Array(FRAME / 2);
      var total = 0;
      for (var b = 0; b < FRAME / 2; b++) {
        var m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        mag[b] = m;
        total += m;
      }

      // onset flux
      var flux = 0;
      if (prevMag) {
        for (var b2 = 1; b2 < FRAME / 2; b2++) {
          var d = mag[b2] - prevMag[b2];
          if (d > 0) flux += d;
        }
      }
      onset[f] = flux;
      prevMag = mag;

      // harmonic-sum salience over candidate pitch bins
      var bestScore = 0, bestBin = 0;
      for (var bin = minBin; bin <= maxBin; bin++) {
        var s = mag[bin];
        var h2 = bin * 2, h3 = bin * 3, h4 = bin * 4;
        if (h2 < FRAME / 2) s += 0.5 * mag[h2];
        if (h3 < FRAME / 2) s += 0.33 * mag[h3];
        if (h4 < FRAME / 2) s += 0.25 * mag[h4];
        if (s > bestScore) { bestScore = s; bestBin = bin; }
      }

      var isVoiced = rms[f] > Math.max(0.012, maxRms * 0.06) && total > 0 && bestScore / total > 0.06;
      voiced[f] = isVoiced ? 1 : 0;
      if (isVoiced && bestBin > 0) {
        // parabolic interpolation around the best bin for sub-bin f0
        var y0 = mag[bestBin - 1] || 0, y1 = mag[bestBin], y2 = mag[bestBin + 1] || 0;
        var denom = (y0 - 2 * y1 + y2);
        var shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
        if (shift > 0.5) shift = 0.5;
        if (shift < -0.5) shift = -0.5;
        f0[f] = (bestBin + shift) * binHz;
        // accumulate chroma from this voiced frame
        for (var midi = 36; midi <= 96; midi++) {
          var fb = Math.round((440 * Math.pow(2, (midi - 69) / 12)) / binHz);
          if (fb > 0 && fb < FRAME / 2) {
            chroma[((midi % 12) + 12) % 12] += mag[fb - 1] + mag[fb] + (mag[fb + 1] || 0);
          }
        }
      } else {
        f0[f] = 0;
      }
    }

    // BPM from onset autocorrelation
    var bpm = 120;
    var minLag = Math.floor((60 / 220) * fps);   // 220 BPM
    var maxLag = Math.ceil((60 / 40) * fps);     // 40 BPM
    if (nFrames > maxLag + 4) {
      var bestLag = -1, bestC = 0;
      for (var lag = minLag; lag <= maxLag; lag++) {
        var c = 0;
        for (var t = 0; t + lag < nFrames; t++) c += onset[t] * onset[t + lag];
        c /= (nFrames - lag);
        if (c > bestC) { bestC = c; bestLag = lag; }
      }
      if (bestLag > 0) bpm = Math.round((60 * fps) / bestLag);
    }

    var key = estimateKey(Array.prototype.slice.call(chroma));

    // median smoothing of pitch track (window 3)
    var midiTrack = new Int16Array(nFrames);
    for (var f2 = 0; f2 < nFrames; f2++) {
      if (!voiced[f2] || f0[f2] <= 0) { midiTrack[f2] = -1; continue; }
      midiTrack[f2] = Math.round(69 + 12 * Math.log2(f0[f2] / 440));
    }
    var sm = new Int16Array(nFrames);
    for (var f3 = 0; f3 < nFrames; f3++) {
      var a = midiTrack[Math.max(0, f3 - 1)], b = midiTrack[f3], c = midiTrack[Math.min(nFrames - 1, f3 + 1)];
      var arr = [a, b, c].sort(function (p, q) { return p - q; });
      sm[f3] = arr[1];
    }

    // segment into notes: runs of equal midi, bridging 1-frame unvoiced gaps
    var notes = [];
    var cur = null; // {midi, startFrame, lastFrame}
    var gap = 0;
    function closeNote() {
      if (cur) {
        var start = (cur.startFrame * HOP + FRAME / 2) / TARGET_SR;
        var end = Math.min(duration, ((cur.lastFrame + 1) * HOP + FRAME / 2) / TARGET_SR);
        var dur = end - start;
        if (dur >= MIN_NOTE_SEC) {
          var measured = cur.count ? cur.hzSum / cur.count : 440 * Math.pow(2, (cur.midi - 69) / 12);
          notes.push({ midi: cur.midi, start: +start.toFixed(3), end: +end.toFixed(3), dur: +dur.toFixed(3), frequencyHz: +measured.toFixed(2) });
        }
        cur = null;
      }
    }
    for (var f4 = 0; f4 < nFrames; f4++) {
      var m = sm[f4];
      if (m < 0) {
        gap++;
        if (gap >= 2) closeNote();
        continue;
      }
      gap = 0;
      if (cur && cur.midi === m) {
        cur.lastFrame = f4;
        if (f0[f4] > 0 && Math.abs(69 + 12 * Math.log2(f0[f4] / 440) - m) < 0.6) { cur.hzSum += f0[f4]; cur.count++; }
      } else {
        closeNote();
        var validHz = f0[f4] > 0 && Math.abs(69 + 12 * Math.log2(f0[f4] / 440) - m) < 0.6;
        cur = { midi: m, startFrame: f4, lastFrame: f4, hzSum: validHz ? f0[f4] : 0, count: validHz ? 1 : 0 };
      }
    }
    closeNote();

    var voicedCount = 0;
    for (var f5 = 0; f5 < nFrames; f5++) voicedCount += voiced[f5];

    return {
      notes: notes,
      key: key,
      bpm: bpm,
      duration: +duration.toFixed(3),
      voicedRatio: +(voicedCount / nFrames).toFixed(3),
    };
  }

  function extractTune(pcm, sr, opts) {
    var steps = extractionSteps(pcm, sr, opts), result;
    do { result = steps.next(); } while (!result.done);
    return result.value;
  }

  async function extractTuneAsync(pcm, sr, onProgress, isCancelled) {
    var steps = extractionSteps(pcm, sr), result;
    do {
      if (isCancelled && isCancelled()) throw new Error('Analysis cancelled');
      result = steps.next();
      if (!result.done) {
        if (onProgress) onProgress(result.value);
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    } while (!result.done);
    return result.value;
  }

  function noteFrequency(note, transpose) {
    return (note.frequencyHz || 440 * Math.pow(2, (note.midi - 69) / 12)) * Math.pow(2, (transpose || 0) / 12);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  /* Plain-text tune sheet (share/export target). */
  function tuneToText(tune, title, transpose, useFlats) {
    transpose = transpose || 0;
    var L = [];
    L.push('CHOIR TUNE — ' + (title || 'song'));
    var names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
    var keyName = names[((tune.key.rootPc + transpose) % 12 + 12) % 12] + (tune.key.mode === 'minor' ? ' Minor' : ' Major');
    L.push('Estimated key: ' + keyName + '   Tempo: ' + tune.bpm + ' BPM   Length: ' + formatTime(tune.duration) + '   Notes: ' + tune.notes.length);
    if (transpose) L.push('Transposed ' + transpose + ' semitones from source key ' + tune.key.name + '.');
    L.push(tune.voice ? 'Estimated ' + tune.voice + ' pitches (range-guided, not isolated audio).' : 'Single-melody estimate. Check against the recording.');
    L.push('');
    L.push('#   Note   Pitch Hz   Start seconds   Dur     Beats');
    var beat = 60 / (tune.bpm || 120);
    tune.notes.forEach(function (n, i) {
      var name = midiToName(n.midi + transpose, useFlats);
      L.push(
        String(i + 1).padStart(2) + '  ' + name.padEnd(4) +
        '  ' + noteFrequency(n, transpose).toFixed(1) + '  ' + n.start.toFixed(3) + '  ' + n.dur.toFixed(2) + 's  ' + (n.dur / beat).toFixed(1)
      );
    });
    L.push('');
    L.push('Melody: ' + tune.notes.map(function (n) { return midiToName(n.midi + transpose, useFlats); }).join(' '));
    return L.join('\n');
  }

  /* Standard MIDI File (type 0) of the extracted tune. */
  function tuneToMidiBytes(tune, bpm, transpose) {
    transpose = transpose || 0;
    var ppq = 480;
    var beat = 60 / (bpm || 120);
    var events = []; // {tick, type: on/off, midi, vel}
    tune.notes.forEach(function (n) {
      var t0 = Math.round(n.start / beat * ppq);
      var t1 = Math.round(n.end / beat * ppq);
      if (t1 <= t0) t1 = t0 + 1;
      events.push({ tick: t0, on: 1, midi: Math.max(0, Math.min(127, n.midi + transpose)), vel: 100 });
      events.push({ tick: t1, on: 0, midi: Math.max(0, Math.min(127, n.midi + transpose)), vel: 0 });
    });
    events.sort(function (a, b) { return a.tick - b.tick || (a.on - b.on); }); // offs before ons at same tick
    var track = [];
    function vlq(v) {
      var bytes = [v & 0x7f];
      v >>= 7;
      while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
      return bytes;
    }
    function push() { for (var i = 0; i < arguments.length; i++) track.push(arguments[i] & 0xff); }
    var lastTick = 0;
    events.forEach(function (e) {
      var delta = e.tick - lastTick;
      lastTick = e.tick;
      var d = vlq(delta);
      for (var i = 0; i < d.length; i++) track.push(d[i]);
      if (e.on) push(0x90, e.midi, e.vel);
      else push(0x80, e.midi, 0x40);
    });
    // end of track
    var endDelta = vlq(Math.max(0, Math.round(tune.duration / beat * ppq) - lastTick + ppq));
    for (var i2 = 0; i2 < endDelta.length; i2++) track.push(endDelta[i2]);
    push(0xff, 0x2f, 0x00);

    var bytes = [];
    function pushStr(s) { for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff); }
    function u32(v) { bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
    function u16(v) { bytes.push((v >>> 8) & 0xff, v & 0xff); }
    pushStr('MThd'); u32(6); u16(0); u16(1); u16(ppq);
    // tempo meta: microseconds per quarter
    var usPerQ = Math.round(60000000 / (bpm || 120));
    pushStr('MTrk'); u32(7 + track.length);
    // tempo event at tick 0: delta 0, FF 51 03 ttt
    bytes.push(0x00, 0xff, 0x51, 0x03, (usPerQ >>> 16) & 0xff, (usPerQ >>> 8) & 0xff, usPerQ & 0xff);
    for (var i3 = 0; i3 < track.length; i3++) bytes.push(track[i3]);
    return new Uint8Array(bytes);
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(s);
  }

  return {
    dsp: { resample: resample, fft: fft, hannWindow: hannWindow },
    extractTune: extractTune,
    extractTuneAsync: extractTuneAsync,
    estimateKey: estimateKey,
    midiToName: midiToName,
    noteFrequency: noteFrequency,
    tuneToText: tuneToText,
    tuneToMidiBytes: tuneToMidiBytes,
    bytesToBase64: bytesToBase64,
    formatTime: formatTime,
    NOTE_NAMES: NOTE_NAMES,
    TARGET_SR: TARGET_SR,
  };
});
