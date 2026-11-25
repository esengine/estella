// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { parseSoundEvent, SoundEventSelector } from '../src/audio/SoundEvent';
import { AttenuationModel } from '../src/audio/SpatialAudio';

const asset = (extra: Record<string, unknown> = {}) => parseSoundEvent({
    version: 1, clips: [{ clip: 'a.wav' }, { clip: 'b.wav' }, { clip: 'c.wav' }], ...extra,
});
const choices = (selector: SoundEventSelector, count: number) =>
    Array.from({ length: count }, () => selector.next().selection!.clip);

describe('sound event documents', () => {
    it('preserves authored references and applies explicit defaults', () => {
        expect(asset()).toMatchObject({ mode: 'no-repeat', bus: 'sfx', volume: [1, 1], playbackRate: [1, 1],
            maxInstances: 0, cooldown: 0, priority: 0, clips: [{ clip: 'a.wav', weight: 1 }, { clip: 'b.wav', weight: 1 }, { clip: 'c.wav', weight: 1 }] });
    });

    it.each([
        [{ version: 2 }, 'version'], [{ clips: null }, 'clips'], [{ clips: [null] }, 'clips[0]'],
        [{ clips: [{ clip: '' }] }, 'clips[0].clip'], [{ clips: [{ clip: 'a.wav', weight: -1 }] }, 'clips[0].weight'],
        [{ clips: [{ clip: 'a.wav', weight: Infinity }] }, 'clips[0].weight'],
        [{ mode: 'shuffle' }, 'mode'], [{ volume: [2, 1] }, 'volume[1]'], [{ volume: [0, NaN] }, 'volume[1]'],
        [{ playbackRate: [0, 1] }, 'playbackRate'], [{ playbackRate: [1] }, 'playbackRate'],
        [{ bus: '' }, 'bus'], [{ maxInstances: 1.5 }, 'maxInstances'], [{ maxInstances: -1 }, 'maxInstances'],
        [{ cooldown: -1 }, 'cooldown'], [{ priority: NaN }, 'priority'],
        [{ spatial: { model: 8 } }, 'spatial.model'],
        [{ spatial: { model: 1, refDistance: 0 } }, 'spatial.refDistance'],
        [{ spatial: { model: 1, refDistance: 100, maxDistance: 50 } }, 'spatial.maxDistance'],
    ])('rejects malformed parameters at their authored path: %j', (raw, path) => {
        expect(() => asset(raw)).toThrow(path);
    });

    it('rejects non-document input and names a later missing clip slot', () => {
        for (const raw of [null, [], '']) expect(() => parseSoundEvent(raw)).toThrow('soundEvent');
        expect(() => asset({ clips: [{ clip: 'a.wav' }, {}] })).toThrow('clips[1].clip');
    });

    it('round-trips spatial attenuation and rate rules through JSON', () => {
        const original = asset({ volume: [.5, 1.5], playbackRate: [.8, 1.2], maxInstances: 4, cooldown: .1, priority: 5,
            spatial: { model: AttenuationModel.Inverse, refDistance: 50, maxDistance: 500, rolloff: 2 } });
        expect(parseSoundEvent(JSON.parse(JSON.stringify(original)))).toEqual(original);
    });
});

describe('compiled sound event selection', () => {
    it('attributes random weights to the first enabled alias and inspects draws without advancing either random stream', () => {
        const definition = asset({ mode: 'no-repeat', volume: [.4, .9], playbackRate: [.8, 1.2], clips: [
            { clip: 'a.wav', weight: 0 }, { clip: '@uuid:CLIP', weight: 2 }, { clip: '@uuid:clip', weight: 1 },
            { clip: 'clip', weight: 2 }, { clip: 'b.wav' },
        ] });
        const inspected = new SoundEventSelector(definition, 12), twin = new SoundEventSelector(definition, 12);
        const initial = inspected.getVariantShares();
        expect(initial.map(row => row.share)).toEqual([null, .5, null, 2 / 6, 1 / 6]);
        expect(initial.map(row => row.merged)).toEqual([false, false, true, false, false]);
        for (let n = 0; n < 32; n++) {
            const drawn = inspected.next();
            expect(drawn).toEqual(twin.next());
            const shares = inspected.getVariantShares();
            expect(shares[drawn.selection!.slot].share).toBe(0);
            expect(shares.reduce((sum, row) => sum + (row.share ?? 0), 0)).toBeCloseTo(1);
        }
    });

    it('rescales the remaining chances after excluding a dominant group', () => {
        const selector = new SoundEventSelector(asset({ clips: [
            { clip: 'dominant', weight: Number.MAX_VALUE }, { clip: 'tiny', weight: Number.MIN_VALUE },
            { clip: 'twice', weight: Number.MIN_VALUE * 2 },
        ] }));
        expect(selector.next().selection?.slot).toBe(0);
        expect(selector.getVariantShares().map(row => row.share)).toEqual([0, 1 / 3, 2 / 3]);
    });

    it('shows sequence order for repeated authored slots and handles a pool with no alternatives', () => {
        const seq = new SoundEventSelector(asset({ mode: 'sequence', clips: [
            { clip: 'a' }, { clip: 'b', weight: 0 }, { clip: 'a' },
        ] }));
        for (const expected of [[1, null, 0], [0, null, 1], [1, null, 0]]) {
            expect(seq.getVariantShares().map(row => row.share)).toEqual(expected);
            seq.next();
        }
        for (const weight of [0, 1]) {
            const single = new SoundEventSelector(asset({ clips: [{ clip: 'a', weight }] }));
            single.next();
            expect(single.getVariantShares()).toEqual([{ share: weight || null, merged: false }]);
        }
        expect(new SoundEventSelector(asset({ clips: [] })).getVariantShares()).toEqual([]);
    });

    it('distinguishes empty pools from disabled, zero-weight pools', () => {
        expect(new SoundEventSelector(asset({ clips: [] })).next()).toEqual({ selection: null, reason: 'empty' });
        expect(new SoundEventSelector(asset({ clips: [{ clip: 'a.wav', weight: 0 }] })).next())
            .toEqual({ selection: null, reason: 'zero-weight' });
    });

    it.each(['random', 'no-repeat', 'sequence'])('plays a single enabled clip repeatedly in %s mode', mode => {
        const selector = new SoundEventSelector(asset({ mode, clips: [{ clip: 'a.wav', weight: 0 }, { clip: 'b.wav' }] }));
        expect(choices(selector, 12)).toEqual(Array(12).fill('b.wav'));
    });

    it('cycles authored slots in sequence order and skips zero weights', () => {
        const selector = new SoundEventSelector(asset({ mode: 'sequence', clips: [
            { clip: 'a.wav' }, { clip: 'b.wav', weight: 0 }, { clip: 'c.wav', weight: 4 }, { clip: 'a.wav' },
        ] }));
        expect(choices(selector, 6)).toEqual(['a.wav', 'c.wav', 'a.wav', 'a.wav', 'c.wav', 'a.wav']);
    });

    it('reproduces clip choices independently of volume and playback-rate ranges', () => {
        const first = asset({ mode: 'random' }), second = asset({ mode: 'random', volume: [.3, 1.4], playbackRate: [.5, 2] });
        expect(choices(new SoundEventSelector(first, 123), 128)).toEqual(choices(new SoundEventSelector(second, 123), 128));
        expect(choices(new SoundEventSelector(first, 123), 128)).not.toEqual(choices(new SoundEventSelector(first, 124), 128));
    });

    it('honors weights over a deterministic high-frequency trigger stream', () => {
        const selector = new SoundEventSelector(asset({ mode: 'random', clips: [{ clip: 'a.wav', weight: 1 }, { clip: 'b.wav', weight: 3 }] }), 42);
        const count = choices(selector, 100_000).filter(clip => clip === 'b.wav').length;
        expect(count / 100_000).toBeCloseTo(.75, 2);
    });

    it('avoids consecutive audio identity even when it occupies duplicate slots', () => {
        const selector = new SoundEventSelector(asset({ clips: [{ clip: 'a.wav', weight: 5 }, { clip: 'a.wav', weight: 8 }, { clip: 'b.wav' }] }), 9);
        const clips = choices(selector, 512);
        for (let i = 1; i < clips.length; ++i) expect(clips[i]).not.toBe(clips[i - 1]);
    });

    it('treats UUID reference spellings as the same candidate identity', () => {
        const uuid = '01010101-0101-4101-8101-01010101010a';
        const selector = new SoundEventSelector(asset({ clips: [{ clip: `@uuid:${uuid}` }, { clip: uuid.toUpperCase() }, { clip: 'b.wav' }] }), 5);
        const clips = choices(selector, 64).map(clip => clip === 'b.wav' ? 'b' : 'a');
        for (let i = 1; i < clips.length; ++i) expect(clips[i]).not.toBe(clips[i - 1]);
    });

    it('keeps no-repeat choices valid for extreme weights in either slot order', () => {
        for (const clips of [[{ clip: 'a.wav', weight: Number.MAX_VALUE }, { clip: 'b.wav', weight: Number.MIN_VALUE }],
            [{ clip: 'b.wav', weight: Number.MIN_VALUE }, { clip: 'a.wav', weight: Number.MAX_VALUE }]]) {
            const selected = choices(new SoundEventSelector(asset({ clips }), 17), 128);
            for (let i = 1; i < selected.length; ++i) expect(selected[i]).not.toBe(selected[i - 1]);
        }
    });

    it('normalizes duplicate maximal weights without overflowing the cumulative table', () => {
        const selector = new SoundEventSelector(asset({ mode: 'random', clips: [
            { clip: 'a.wav', weight: Number.MAX_VALUE }, { clip: 'a.wav', weight: Number.MAX_VALUE }, { clip: 'b.wav', weight: Number.MAX_VALUE },
        ] }), 52);
        const selected = choices(selector, 10_000);
        expect(selected.filter(clip => clip === 'a.wav').length / selected.length).toBeCloseTo(2 / 3, 1);
    });

    it('owns a snapshot and keeps sampled parameters finite and inside their ranges', () => {
        const original = asset({ volume: [.3, 1.2], playbackRate: [.6, 1.5] }), selector = new SoundEventSelector(original);
        original.clips[0].clip = 'edited.wav'; original.clips.length = 0; original.volume[0] = 999;
        for (let i = 0; i < 100; ++i) {
            const selected = selector.next().selection!;
            expect(selected.clip).not.toBe('edited.wav');
            expect(selected.volume).toBeGreaterThanOrEqual(.3); expect(selected.volume).toBeLessThanOrEqual(1.2);
            expect(selected.playbackRate).toBeGreaterThanOrEqual(.6); expect(selected.playbackRate).toBeLessThanOrEqual(1.5);
        }
        const extreme = new SoundEventSelector(asset({ volume: [Number.MAX_VALUE, Number.MAX_VALUE] }));
        expect(Number.isFinite(extreme.next().selection!.volume)).toBe(true);
        expect(() => new SoundEventSelector(asset(), Infinity)).toThrow('seed');
    });
});
