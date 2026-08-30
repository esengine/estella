// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-stages.test.ts
 * @brief   The staged pose is the pose a frame runs, and its counters describe
 *          the skeleton it ran on.
 *
 * @details Posing MUTATES, which the staged extraction did not: stopping after
 *          advancing the tracks leaves a skeleton nobody applied anything to. A
 *          short run is still a legitimate prefix — advancing does not read the
 *          skeleton, applying does not read world transforms — but only the full
 *          depth may claim to be a frame's pose, so that is held to one here.
 *
 *          The counters are the point of the probe: a millisecond means nothing
 *          until it is a millisecond per this many timelines and bones.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const SKEL = 'spineboy-38/spineboy-pro.skel';
const ATLAS = 'spineboy-38/spineboy.atlas';
const HAS_ASSETS = hasSideModule('spine38') && existsSync(resolve(FIXTURES, SKEL));

/** The nine counters `spine_probe_pose_counts` writes, in order. */
const COUNTERS = [
    'tracks', 'entries', 'timelines', 'bones',
    'ikConstraints', 'transformConstraints', 'pathConstraints', 'physicsConstraints', 'events',
] as const;
type Counts = Record<(typeof COUNTERS)[number], number>;

const POSE_SETUP = 0;
const POSE_ADVANCE = 1;
const POSE_APPLY = 2;
const POSE_WORLD = 3;
const DT = 1 / 60;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
let skelHandle: number;

beforeAll(async () => {
    if (!HAS_ASSETS) return;
    const factory = (await import(SPINE38_JS)).default as (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(SPINE38_WASM);
    raw = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    api = wrapSpineModule(raw);

    const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, SKEL)));
    const atlasText = readFileSync(resolve(FIXTURES, ATLAS), 'utf-8');
    skelHandle = withScratch(raw, (alloc) => {
        const ptr = alloc(skelData.length);
        raw.HEAPU8.set(skelData, ptr);
        return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
    });
    for (let i = 0, pages = api.getAtlasPageCount(skelHandle); i < pages; i++) {
        api.setAtlasPageTexture(skelHandle, i, 1, 1024, 1024);
    }
});

function playing(animation: string): number {
    const instanceId = api.createInstance(skelHandle);
    if (!api.playAnimation(instanceId, animation, true, 0)) throw new Error(`no animation "${animation}"`);
    return instanceId;
}

function countsOf(): Counts {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(COUNTERS.length * 4);
        api.probePoseCounts(ptr);
        const out = {} as Counts;
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

function bone(instanceId: number, name: string): { x: number; y: number } {
    return withScratch(raw, (alloc) => {
        const xp = alloc(4);
        const yp = alloc(4);
        api.getBonePosition(instanceId, name, xp, yp);
        return { x: raw.HEAPF32[xp >> 2], y: raw.HEAPF32[yp >> 2] };
    });
}

describe.skipIf(!HAS_ASSETS)('the staged pose is the shipped pose', () => {
    it('the full depth lands a bone where a frame lands it', () => {
        const staged = playing('walk');
        const shipped = playing('walk');
        for (let frame = 0; frame < 30; frame++) {
            expect(api.probePose(staged, DT, POSE_WORLD)).toBe(1);
            api.update(shipped, DT);
        }
        expect(bone(staged, 'front-foot'), 'the staged pose drifted from the shipped one')
            .toEqual(bone(shipped, 'front-foot'));
    });

    it('a depth that advances nothing leaves the skeleton where it was', () => {
        const instanceId = playing('walk');
        api.update(instanceId, 0.4);
        const before = bone(instanceId, 'front-foot');

        for (let frame = 0; frame < 10; frame++) expect(api.probePose(instanceId, DT, POSE_SETUP)).toBe(1);

        expect(bone(instanceId, 'front-foot')).toEqual(before);
        // The counters describe the skeleton, so they answer at every depth.
        expect(countsOf().bones).toBeGreaterThan(0);
    });

    it('advancing without applying still moves the clock', () => {
        // One track with no mix makes the pose a function of track time alone,
        // so 29 advances and one whole pose land where 30 whole poses land — and
        // if advancing were a no-op, that last one would be posing frame one.
        const staged = playing('walk');
        const shipped = playing('walk');
        for (let frame = 0; frame < 29; frame++) expect(api.probePose(staged, DT, POSE_ADVANCE)).toBe(1);
        api.probePose(staged, DT, POSE_WORLD);
        for (let frame = 0; frame < 30; frame++) api.update(shipped, DT);

        expect(bone(staged, 'front-foot'), 'depth 1 did not advance the track')
            .toEqual(bone(shipped, 'front-foot'));
    });

    it('applying without resolving leaves the world transforms where they were', () => {
        // Depth 2 writes local bone values; a world position is what depth 3
        // makes of them, so the separation is visible exactly here.
        const instanceId = playing('walk');
        api.probePose(instanceId, DT, POSE_WORLD);
        const resolved = bone(instanceId, 'front-foot');

        for (let frame = 0; frame < 20; frame++) expect(api.probePose(instanceId, DT, POSE_APPLY)).toBe(1);
        expect(bone(instanceId, 'front-foot'), 'depth 2 resolved world transforms').toEqual(resolved);

        api.probePose(instanceId, DT, POSE_WORLD);
        expect(bone(instanceId, 'front-foot')).not.toEqual(resolved);
    });

    it('applying is what makes the animation announce itself', () => {
        // A world position cannot see depth 2: applying writes LOCAL bone values,
        // and re-applying at the same track time writes the same ones. Only an
        // apply drains the event queue — the animation starting is itself an event.
        const instanceId = playing('walk');
        expect(api.probePose(instanceId, DT, POSE_APPLY)).toBe(1);

        expect(countsOf().events, 'depth 2 applied nothing, so nothing announced itself')
            .toBeGreaterThan(0);
    });

    it('what a pose had to do explains the skeleton it did it to', () => {
        const instanceId = playing('walk');
        api.probePose(instanceId, DT, POSE_WORLD);
        const c = countsOf();

        expect(c.tracks).toBe(1);
        expect(c.entries).toBe(1);
        // Exact, not "more than none": a counter wired to a constant satisfies
        // every inequality that could be written about it, and one of these was
        // shipped reading 0xAAAA for two commits before a survey read it back.
        expect(c.timelines, "walk's timelines").toBe(38);
        expect(c.bones).toBe(64);
        expect(c.ikConstraints).toBe(7);
        expect(c.transformConstraints).toBe(7);
        expect(c.pathConstraints).toBe(0);
        expect(c.physicsConstraints, '3.8 has no physics constraints').toBe(0);
    });

    it('an instance playing nothing still has a skeleton to pose', () => {
        const instanceId = api.createInstance(skelHandle);
        api.probePose(instanceId, DT, POSE_WORLD);
        const c = countsOf();

        expect(c.tracks).toBe(0);
        expect(c.entries).toBe(0);
        expect(c.timelines).toBe(0);
        expect(c.bones).toBe(64);
    });

    it('a track mixing out of another applies both animations', () => {
        // What a multi-track axis is measuring: during a mix the entry AND
        // everything it is mixing out of apply, so the timeline count is the sum.
        api.setDefaultMix(skelHandle, 0.4);
        const instanceId = playing('walk');
        api.probePose(instanceId, DT, POSE_WORLD);
        const solo = countsOf();

        expect(api.playAnimation(instanceId, 'run', true, 0)).toBeTruthy();
        api.probePose(instanceId, DT, POSE_WORLD);
        const mixing = countsOf();
        api.setDefaultMix(skelHandle, 0);

        expect(mixing.tracks, 'a mix is one track').toBe(1);
        expect(mixing.entries, 'the entry it is mixing out of did not apply').toBe(2);
        expect(solo.timelines, "walk's timelines").toBe(38);
        expect(mixing.timelines, "run's 41 on top of walk's 38").toBe(79);
    });
});
