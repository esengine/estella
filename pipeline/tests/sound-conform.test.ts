/**
 * @file  A recording made ready for a game: its loudness measured as BS.1770 measures it, brought to a target with its
 *        peaks kept under a ceiling, an effect brought to a peak, silence taken off, a part cut out, and a loop that goes
 *        round without a jump.
 */
import { describe, it, expect } from 'vitest';
import { conformSound, describeChanges, integratedLoudness, soundLevels, type Recording } from '../src/sound/soundConform';

const tone = (rate: number, seconds: number, hz: number, amplitude: number, channels = 1): Recording => ({
    rate,
    channels: Array.from({ length: channels }, () => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate))),
});

/** Seeded noise, so a measurement is the same every run. */
function noise(rate: number, seconds: number, amplitude: number): Recording {
    let s = 7;
    const next = (): number => { s = (s * 1103515245 + 12345) >>> 0; return (s / 0xffffffff) * 2 - 1; };
    return { rate, channels: [Float32Array.from({ length: Math.round(rate * seconds) }, () => amplitude * next())] };
}

const peakDb = (r: Recording): number => {
    let p = 0;
    for (const c of r.channels) for (const v of c) p = Math.max(p, Math.abs(v));
    return 20 * Math.log10(p);
};

describe('loudness as BS.1770 measures it', () => {
    it('reads a full-scale 1 kHz sine on one channel as -3.01 LUFS, at 48 kHz and at 44.1 kHz', () => {
        expect(integratedLoudness(tone(48000, 3, 1000, 1))).toBeCloseTo(-3.01, 1);
        expect(integratedLoudness(tone(44100, 3, 1000, 1))).toBeCloseTo(-3.01, 1);
    });

    it('reads 6 dB quieter for half the amplitude, and 3 dB louder for the same on two channels', () => {
        expect(integratedLoudness(tone(48000, 3, 1000, 0.5))).toBeCloseTo(-9.03, 1);
        expect(integratedLoudness(tone(48000, 3, 1000, 1, 2))).toBeCloseTo(0, 1);
    });

    it('does not count silence: a sound with a long gap measures as the sound', () => {
        const half = tone(48000, 2, 1000, 0.5);
        const gap = { rate: 48000, channels: [Float32Array.from([...half.channels[0]!, ...new Float32Array(48000 * 4)])] };
        expect(integratedLoudness(gap)).toBeCloseTo(integratedLoudness(half), 0);
    });
});

describe('music and ambience are brought to a loudness', () => {
    it('lands on -16 LUFS by default', () => {
        const out = conformSound(noise(44100, 4, 0.05), { kind: 'ambience' });
        expect(out.after.lufs).toBeCloseTo(-16, 0);
        expect(out.steps.map((s) => s.step)).toContain('level');
    });

    it('keeps the peaks under the ceiling, and says how far it had to turn them down', () => {
        const spiky = noise(44100, 4, 0.02);
        for (let i = 0; i < spiky.channels[0]!.length; i += 11025) spiky.channels[0]![i] = 0.9;
        const out = conformSound(spiky, { kind: 'music', loudness: -12, peak: -1 });
        expect(peakDb(out)).toBeLessThanOrEqual(-1 + 0.01);
        expect(out.limitedDb).toBeGreaterThan(0);
        expect(describeChanges(out.steps)).toMatch(/peak limiting/);
    });
});

describe('an effect is brought to its peak', () => {
    it('lands its loudest moment on -3 dBFS', () => {
        const out = conformSound(tone(44100, 0.3, 300, 0.2), { kind: 'effect' });
        expect(peakDb(out)).toBeCloseTo(-3, 1);
    });
});

describe('the part that is kept', () => {
    it('takes the silence off its front and back', () => {
        const body = tone(44100, 1, 440, 0.5).channels[0]!;
        const padded = { rate: 44100, channels: [Float32Array.from([...new Float32Array(22050), ...body, ...new Float32Array(44100)])] };
        const out = conformSound(padded, { kind: 'effect' });
        expect(out.after.seconds).toBeGreaterThan(0.99);
        expect(out.after.seconds).toBeLessThan(1.02);
        expect(describeChanges(out.steps)).toMatch(/0\.5 s of leading silence and 0\.99 s of trailing silence removed/);
    });

    it('cuts out the excerpt asked for', () => {
        const out = conformSound(noise(44100, 10, 0.3), { kind: 'ambience', start: 2, end: 5 });
        expect(out.after.seconds).toBeCloseTo(3, 2);
        expect(describeChanges(out.steps)).toMatch(/^2 s to 5 s of the 10 s original/);
    });

    it('fades in and out', () => {
        const out = conformSound(tone(44100, 2, 220, 0.5), { kind: 'effect', fadeIn: 0.1, fadeOut: 0.5 });
        expect(Math.abs(out.channels[0]![0]!)).toBeLessThan(1e-6);
        expect(Math.abs(out.channels[0]![out.channels[0]!.length - 1]!)).toBeLessThan(1e-4);
    });

    it('refuses an excerpt that leaves nothing', () => {
        expect(() => conformSound(noise(44100, 1, 0.3), { kind: 'effect', start: 3, end: 4 })).toThrow(/leave nothing/);
    });
});

describe('a loop goes round without a seam', () => {
    it('joins its end to its start where the raw recording would jump', () => {
        // 0.53 s of a 110 Hz tone stops mid-cycle: going round raw would jump.
        const raw = tone(44100, 3.53, 110, 0.5);
        const rawJump = Math.abs(raw.channels[0]![0]! - raw.channels[0]![raw.channels[0]!.length - 1]!);
        expect(rawJump).toBeGreaterThan(0.1);
        const out = conformSound(raw, { kind: 'ambience', loopCrossfade: 1 });
        expect(out.seamJump).toBeLessThan(2);
        expect(out.after.seconds).toBeCloseTo(2.53, 1);
        expect(describeChanges(out.steps)).toMatch(/cross-faded into the start for a seamless/);
    });

    it('needs a recording at least twice the crossfade', () => {
        expect(() => conformSound(noise(44100, 1, 0.3), { kind: 'ambience', loopCrossfade: 0.8 })).toThrow(/twice as long/);
    });
});

describe('what it reports', () => {
    it('measures before and after alike', () => {
        const levels = soundLevels(tone(48000, 1, 1000, 1));
        expect(levels.peakDb).toBeCloseTo(0, 1);
        expect(levels.seconds).toBe(1);
    });
});
