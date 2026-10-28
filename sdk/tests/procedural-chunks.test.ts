// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Procedural chunks have one owner: made round the sources within the frame's budget, let go past them, and never published
 *        for inputs that are gone.
 */
import { describe, expect, it } from 'vitest';
import { ProceduralChunks, type ChunkLayer, type ChunkSource } from '../src/residency/chunks';
import { Bakes } from '../src/runtime/bakes';

/** A layer that records what it was asked, and what is in the world because of it. */
function recording(over: Partial<ChunkLayer<string>> = {}) {
    const live = new Map<string, string>();
    const log = { made: [] as string[], published: [] as string[], released: [] as string[] };
    const layer: ChunkLayer<string> = {
        label: 'test', originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, extent: null,
        loadRadius: 25, unloadRadius: 40, generation: 1,
        make: (cx, cz) => { log.made.push(`${cx},${cz}`); return `${cx},${cz}@${layer.generation}`; },
        publish: (cx, cz, v) => {
            const key = `${cx},${cz}`;
            // Never two versions of one chunk in the world.
            expect(live.has(key)).toBe(false);
            live.set(key, v);
            log.published.push(v);
        },
        release: (cx, cz, v) => {
            expect(live.get(`${cx},${cz}`)).toBe(v);
            live.delete(`${cx},${cz}`);
            log.released.push(v);
        },
        ...over,
    };
    return { layer, live, log };
}

const always = () => true;

describe('procedural chunks', () => {
    it('hold a bounded number of chunks for a source walking for ever, and make none twice on the way back within the band', () => {
        const chunks = new ProceduralChunks();
        let at: ChunkSource = { x: 0, z: 0 };
        chunks.sources_ = () => [at];
        const { layer, live, log } = recording();
        chunks.set('l', layer);
        let most = 0;
        for (let x = 0; x <= 5000; x += 3) {
            at = { x, z: 0 };
            chunks.step(always);
            most = Math.max(most, live.size);
        }
        // Within the unload radius of one source: (2 * 40 / 10 + 2) squared at most.
        expect(most).toBeLessThanOrEqual(100);
        expect(live.size).toBeGreaterThan(0);
        const before = log.made.length;
        // A step back and forth inside the band makes nothing new.
        for (const x of [4990, 4985, 4995, 5000]) { at = { x, z: 0 }; chunks.step(always); }
        expect(log.made.length).toBe(before);
    });

    it('make the chunk a source stands in at once, and the rest nearest first while there is time', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 5, z: 5 }];
        const { layer, log } = recording();
        chunks.set('l', layer);
        chunks.step(() => false);
        expect(log.made).toEqual(['0,0']);
        let budget = 3;
        chunks.step(() => budget-- > 0);
        // Neighbours across an edge before those across a corner.
        expect(log.made.slice(1, 5).every((k) => ['1,0', '-1,0', '0,1', '0,-1'].includes(k))).toBe(true);
        expect(chunks.status('l')!.pending).toBeGreaterThan(0);
    });

    it('keep a chunk\'s old version in the world until its new one replaces it', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 5, z: 5 }];
        const { layer, live } = recording();
        chunks.set('l', layer);
        chunks.step(always);
        const count = live.size;
        layer.generation = 2;
        chunks.step(() => false);
        // Only the chunk under the source was made again; every other one still stands, old.
        expect(live.size).toBe(count);
        expect(live.get('0,0')).toBe('0,0@2');
        expect(chunks.stateAt('l', 15, 5)).toBe('stale');
        chunks.step(always);
        expect([...live.values()].every((v) => v.endsWith('@2'))).toBe(true);
        expect(chunks.status('l')).toMatchObject({ ready: count, stale: 0, pending: 0 });
    });

    it('throw away an answer for inputs that are gone, and stop what a source has left', async () => {
        const chunks = new ProceduralChunks();
        let at: ChunkSource = { x: 5, z: 5 };
        chunks.sources_ = () => [at];
        const answers: { cx: number; resolve: (v: string) => void; signal: AbortSignal; generation: number | string }[] = [];
        const { layer, live } = recording({ loadRadius: 0, unloadRadius: 0 });
        layer.make = (cx, _cz, signal) => new Promise((resolve) => answers.push({ cx, resolve, signal, generation: layer.generation }));
        chunks.set('l', layer);
        chunks.step(always);
        expect(answers).toHaveLength(1);
        // Teleported to another world: the old world's answer must not land in this one.
        layer.generation = 'planet-b';
        at = { x: 1005, z: 5 };
        chunks.step(always);
        expect(answers[0]!.signal.aborted).toBe(true);
        answers[0]!.resolve('old');
        await Promise.resolve();
        expect(live.size).toBe(0);
        expect(answers).toHaveLength(2);
        answers[1]!.resolve('new');
        await Promise.resolve();
        expect([...live.values()]).toEqual(['new']);
        expect(chunks.stateAt('l', 1005, 5)).toBe('ready');
    });

    it('say why a chunk failed, and try it again once the inputs change', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 5, z: 5 }];
        let broken = true;
        const { layer } = recording({ loadRadius: 0, unloadRadius: 0 });
        const make = layer.make;
        layer.make = (cx, cz, s) => { if (broken) throw new Error('no ground here'); return make(cx, cz, s); };
        chunks.set('l', layer);
        chunks.step(always);
        chunks.step(always);
        expect(chunks.status('l')).toMatchObject({ failed: 1, reason: 'no ground here' });
        broken = false;
        layer.generation = 2;
        chunks.step(always);
        expect(chunks.stateAt('l', 5, 5)).toBe('ready');
    });

    it('release everything a layer published when the layer goes, and keep within its extent', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 0, z: 0 }];
        const { layer, live } = recording({ extent: [0, 0, 2, 2] });
        chunks.set('l', layer);
        chunks.step(always);
        expect([...live.keys()].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
        chunks.remove('l');
        expect(live.size).toBe(0);
    });

    it('follow a layer\'s own sources when it names them, and want nothing where there are none', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 0, z: 0 }];
        let movers: ChunkSource[] = [];
        const { layer, live } = recording({ loadRadius: 0, unloadRadius: 0, sources: () => movers });
        chunks.set('l', layer);
        chunks.step(always);
        expect(live.size).toBe(0);
        movers = [{ x: 55, z: -5 }];
        chunks.step(always);
        expect([...live.keys()]).toEqual(['5,-1']);
    });
});

describe('a layer on the xy plane', () => {
    it('reads the world\'s sources by x and y, where the ground plane reads x and z', () => {
        const at = [{ x: 5, y: 505, z: 10 }];
        const run = (plane: 'xz' | 'xy' | undefined) => {
            const chunks = new ProceduralChunks();
            chunks.sources_ = () => at;
            const { layer, live } = recording({ loadRadius: 12, unloadRadius: 12, plane });
            chunks.set('l', layer);
            chunks.step(always);
            return [...live.keys()].sort();
        };
        // On the ground the source stands at z 10, so the rows it wants are the first few.
        expect(run(undefined).every((k) => Number(k.split(',')[1]) <= 2)).toBe(true);
        // On the screen plane it stands at y 505: row 50.
        const keys = run('xy');
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.every((k) => Number(k.split(',')[1]) >= 49 && Number(k.split(',')[1]) <= 51)).toBe(true);
    });

    it('leaves a layer that names its own sources as they answer', () => {
        const chunks = new ProceduralChunks();
        chunks.sources_ = () => [{ x: 5, y: 505, z: 10 }];
        const { layer, live } = recording({ loadRadius: 12, unloadRadius: 12, plane: 'xy', sources: () => [{ x: 5, z: 15 }] });
        chunks.set('l', layer);
        chunks.step(always);
        expect([...live.keys()].every((k) => Number(k.split(',')[1]) <= 2)).toBe(true);
    });
});

describe('the frame\'s one budget', () => {
    it('is shared: work stepped elsewhere that ran short gets half of the next frame from the jobs', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 10;
        let t = 0;
        const clock = () => t;
        let steps = 0;
        bakes.run('long', (function* () { for (;;) { t += 1; steps++; yield 0; } })());
        bakes.step(clock);
        expect(steps).toBe(10);
        expect(bakes.hasTime()).toBe(false);
        steps = 0;
        bakes.step(clock);
        expect(steps).toBe(5);
        expect(bakes.hasTime()).toBe(true);
    });
});
