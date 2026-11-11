/* Pure live-tuner DSP: YIN cumulative-mean normalized difference, A4=440.
 * Input is a 4096-sample capture frame (normally 44.1/48 kHz). Average down
 * to about 11 kHz before YIN to keep the 25 Hz UI loop inexpensive. Silence
 * and non-periodic frames return null, never a fabricated note. */
(function (root) {
  'use strict';
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function frequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function name(midi) { return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function mapFrequency(hz, targetMidi) {
    if (!Number.isFinite(hz) || hz <= 0) return null;
    var floating = 69 + 12 * Math.log2(hz / 440);
    var midi = Math.round(floating);
    var target = Number.isFinite(targetMidi) ? targetMidi : midi;
    return { frequencyHz: hz, midi: midi, name: name(midi), targetMidi: target,
      targetName: name(target), cents: 1200 * Math.log2(hz / frequency(target)) };
  }
  function detectPitch(input, sampleRate, options) {
    options = options || {};
    if (!input || input.length < 512 || !Number.isFinite(sampleRate) || sampleRate < 8000) return null;
    var stride = Math.max(1, Math.floor(sampleRate / 11025));
    var sr = sampleRate / stride, n = Math.floor(input.length / stride);
    var x = new Float64Array(n), mean = 0, energy = 0;
    for (var i = 0; i < n; i++) {
      var sum = 0;
      for (var j = 0; j < stride; j++) sum += input[i * stride + j];
      x[i] = sum / stride; mean += x[i];
    }
    mean /= n;
    for (var k = 0; k < n; k++) { x[k] -= mean; energy += x[k] * x[k]; }
    var rms = Math.sqrt(energy / n);
    if (!Number.isFinite(rms) || rms < (options.noiseFloor || 0.008)) return null;
    var minHz = 65, maxHz = 1200;
    var minLag = Math.max(2, Math.floor(sr / maxHz));
    var maxLag = Math.min(Math.ceil(sr / minHz), Math.floor(n / 2) - 1);
    if (maxLag <= minLag) return null;
    var diff = new Float64Array(maxLag + 2), cumulative = 0;
    var span = n - maxLag - 1;
    diff[0] = 1;
    for (var lag = 1; lag <= maxLag + 1; lag++) {
      var d = 0;
      for (var t = 0; t < span; t++) { var delta = x[t] - x[t + lag]; d += delta * delta; }
      cumulative += d;
      diff[lag] = cumulative > 0 ? d * lag / cumulative : 1;
    }
    var tau = -1;
    for (var p = minLag; p <= maxLag; p++) {
      if (diff[p] < 0.15) {
        while (p < maxLag && diff[p + 1] < diff[p]) p++;
        tau = p; break;
      }
    }
    if (tau < 0 || 1 - diff[tau] < 0.85) return null;
    var y0 = diff[tau - 1], y1 = diff[tau], y2 = diff[tau + 1];
    var denominator = y0 - 2 * y1 + y2;
    var shift = denominator ? 0.5 * (y0 - y2) / denominator : 0;
    var hz = sr / (tau + Math.max(-0.5, Math.min(0.5, shift)));
    // Refine the period on the original-rate PCM to avoid decimation bias
    // of several cents on high soprano notes. YIN chose the correct cycle;
    // only five nearby raw lags need comparison, not another full search.
    var center = Math.round(sampleRate / hz), rawDiff = [], rawSpan = input.length - center - 3;
    if (rawSpan > 64 && center > 3) {
      for (var offset = -2; offset <= 2; offset++) {
        var rawSum = 0, rawLag = center + offset;
        for (var index = 0; index < rawSpan; index++) { var rawDelta = input[index] - input[index + rawLag]; rawSum += rawDelta * rawDelta; }
        rawDiff.push(rawSum);
      }
      var best = 1;
      for (var candidate = 2; candidate <= 3; candidate++) if (rawDiff[candidate] < rawDiff[best]) best = candidate;
      var curvature = rawDiff[best - 1] - 2 * rawDiff[best] + rawDiff[best + 1];
      var refinement = curvature ? 0.5 * (rawDiff[best - 1] - rawDiff[best + 1]) / curvature : 0;
      var refined = sampleRate / (center + best - 2 + Math.max(-0.5, Math.min(0.5, refinement)));
      if (Math.abs(1200 * Math.log2(refined / hz)) < 40) hz = refined;
    }
    if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;
    return { frequencyHz: hz, confidence: 1 - diff[tau], rms: rms };
  }
  root.ChoirTunerPitch = { detectPitch: detectPitch, mapFrequency: mapFrequency, frequency: frequency, name: name };
})(typeof globalThis !== 'undefined' ? globalThis : this);
