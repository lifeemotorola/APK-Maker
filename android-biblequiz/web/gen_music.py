#!/usr/bin/env python3
"""gen_music.py — synthesizes the Bible Quiz background music (6 seamless
looping ambient tracks) as 16-bit mono WAV files plus a manifest.json.

    python3 web/gen_music.py [outDir]     (default: app/src/main/assets/www/music)

Deterministic (seeded): same output on every build. Each track is 8 bars;
the chord progression has 4 chords so bar 8 would be chord 0 again, making
the loop seamless. Layers: bass (sine), pad (chord tones, slow attack),
melody (seeded random walk on a scale, enveloped so no clicks), sparkle.
"""
import json, math, os, random, struct, sys, wave

SR = 22050  # sample rate

def midi(m): return 440.0 * 2 ** ((m - 69) / 12.0)

class RNG:
    """Seeded PRNG (mulberry32) with randint/choice helpers."""
    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF
    def next(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xFFFFFFFF
        t = (t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    def randint(self, lo, hi):
        return lo + int(self.next() * (hi - lo + 1))
    def choice(self, arr):
        return arr[self.randint(0, len(arr) - 1)]

# scale = semitone offsets from root; chords = 4 triads as scale-degree indices
TRACKS = [
    dict(id='dawn',      name='Dawn Chorus',   bpm=84,  root=60, scale=[0, 2, 4, 7, 9],  seed=11),  # C major pentatonic
    dict(id='parchment', name='Parchment',     bpm=76,  root=57, scale=[0, 3, 5, 7, 10], seed=23),  # A minor pentatonic
    dict(id='river',     name='Quiet River',   bpm=92,  root=62, scale=[0, 2, 3, 7, 9],  seed=37),  # D dorian-ish
    dict(id='starlight', name='Starlight',     bpm=70,  root=65, scale=[0, 2, 4, 6, 7, 9, 11], seed=51),  # F lydian-ish
    dict(id='haven',     name='Haven',         bpm=88,  root=55, scale=[0, 2, 4, 7, 9],  seed=67),  # G major pentatonic
    dict(id='psalm',     name='Morning Psalm', bpm=80,  root=52, scale=[0, 3, 5, 7, 10], seed=83),  # E minor pentatonic
]
BARS = 8
BEATS = 4

def render(t):
    rnd = RNG(t['seed'])
    beat = 60.0 / t['bpm']
    total = BARS * BEATS * beat
    n = int(total * SR)
    mix = [0.0] * n

    def add(freq, t0, dur, vol, attack=0.02, release=0.08, wave_kind='sine'):
        i0 = int(t0 * SR)
        i1 = min(n, int((t0 + dur) * SR))
        rel = max(1, int(release * SR))
        for i in range(i0, i1):
            tt = (i - i0) / SR
            env = min(1.0, tt / attack) * min(1.0, (i1 - i) / rel)
            if wave_kind == 'sine':
                v = math.sin(2 * math.pi * freq * tt)
            else:  # soft triangle-ish
                ph = (freq * tt) % 1.0
                v = 4 * abs(ph - 0.5) - 1
            mix[i] += vol * env * v

    scale = t['scale']
    def deg(d, oct_=0):
        # scale degree d (can exceed scale length) -> midi note
        per = len(scale)
        return t['root'] + 12 * (d // per) + scale[d % per] + 12 * oct_

    # chord progression: 4 triads built on degrees 0, 3, 4, 1 (of the scale, 2 octaves up for pad)
    prog = [0, 3, 4, 1]
    for bar in range(BARS):
        bt = bar * BEATS * beat
        ch = prog[bar % 4]
        # bass: root one octave down, whole bar
        add(midi(deg(ch) - 12), bt, BEATS * beat, 0.34, attack=0.15, release=0.2)
        # pad: triad tones, soft
        for k in (0, 2, 4):
            add(midi(deg(ch + k, 1)), bt, BEATS * beat, 0.10, attack=0.6 * beat, release=0.3 * beat)
        # melody: seeded walk, per beat
        note = rnd.randint(5, 9)
        for b in range(BEATS):
            if rnd.next() < 0.68:
                step = rnd.choice([-2, -1, -1, 1, 1, 2])
                note = max(3, min(14, note + step))
                dur = beat * rnd.choice([0.5, 0.5, 1.0, 1.0])
                add(midi(deg(note, 1)), bt + b * beat, dur * 0.92, 0.30, attack=0.03, release=0.05)
                # sparkle: octave up, quiet, sometimes
                if rnd.next() < 0.25:
                    add(midi(deg(note, 2)), bt + b * beat, dur * 0.5, 0.07, attack=0.02, release=0.04)
    # normalize
    peak = max(1e-9, max(abs(x) for x in mix))
    gain = 0.72 / peak
    return [max(-1.0, min(1.0, x * gain)) for x in mix]

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'main', 'assets', 'www', 'music')
    os.makedirs(out, exist_ok=True)
    manifest = []
    for t in TRACKS:
        samples = render(t)
        fname = t['id'] + '.wav'
        path = os.path.join(out, fname)
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(b''.join(struct.pack('<h', int(s * 32767)) for s in samples))
        secs = round(len(samples) / SR, 1)
        manifest.append(dict(id=t['id'], name=t['name'], file=fname, seconds=secs,
                             bytes=os.path.getsize(path)))
        print('  track: %-14s %-14s %.1fs %d bytes' % (t['id'], t['name'], secs, os.path.getsize(path)))
    with open(os.path.join(out, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
    print('MUSIC:', len(manifest), 'tracks ->', out)

if __name__ == '__main__':
    main()
