// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-pose-stages.bench.ts
 * @brief   What a pose is made of, and which complexity it scales with.
 *
 * @details Once the collector stopped being the frame's first cost, posing was:
 *          2.31 ms of a 4.36 ms thousand-entity frame. This prices its steps the
 *          way the extraction was priced — by running it to four depths and
 *          subtracting — and then varies the SKELETON rather than the entity
 *          count, because "pose = 2.31 ms" is not a model and cannot say what
 *          would make it smaller.
 *
 *          The counters each row reports come from the same probe, so a
 *          millisecond is always next to the timelines, bones and constraints it
 *          was spent on. Depth and counters are asserted in
 *          tests/spine-pose-stages; nothing here is on a frame path.
 *
 *          `SPINE_POSE_REPORT=1` prints the counters each row was measured on.
 *
 *          What it answered, ms per frame at a thousand entities (min of two
 *          runs, differences between adjacent depths):
 *
 *              case                       advance   apply   world+constraints
 *              spineboy, nothing playing    0.005   0.045               1.623
 *              coin, 7 bones                0.010   0.147               0.127
 *              spineboy, walk               0.010   0.438               1.649
 *              spineboy, walk into run      0.010   0.490               1.660
 *              stretchyman, 4 ik 4 path     0.011   0.409               2.203
 *              raptor, 9 ik 74 bones        0.011   0.883               2.091
 *              windmill, 93 bones           0.012   0.986               1.848
 *              tank, 115 bones              0.010   0.472               4.713
 *
 *          Advancing the tracks is flat and negligible whatever is playing.
 *          Applying is ~10 ns per timeline per entity over a fixed 0.045 ms —
 *          except under a mix, where it is half that per DECLARED timeline,
 *          because the entry mixing out skips what the one on top overrides.
 *          Resolving world transforms is the body of a pose: ~20 ns per bone per
 *          entity with no constraints, and it is the same 1.6 ms whether the
 *          skeleton is walking or playing nothing at all.
 */
import { describe, bench, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from '../tests/helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { withScratch } from '../src/wasm/wasmScratch';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, 'fixtures/spine');

/**
 * The axes. `animation` empty means the instance plays nothing — the floor a
 * skeleton costs for existing; `mix` sets a default mix so the second animation
 * enters with the first still applying.
 */
const CASES = [
    { name: 'spineboy, nothing playing', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas', animation: '' },
    { name: 'coin, 7 bones', skel: 'coin-38/coin-pro.skel', atlas: 'coin-38/coin.atlas', animation: 'animation' },
    { name: 'windmill, 93 bones no constraints', skel: 'windmill-38/windmill-ess.skel', atlas: 'windmill-38/windmill.atlas', animation: 'animation' },
    { name: 'stretchyman, 4 ik 2 transform 4 path', skel: 'stretchyman-38/stretchyman-pro.skel', atlas: 'stretchyman-38/stretchyman.atlas', animation: 'sneak' },
    { name: 'raptor, 9 ik 74 bones', skel: 'raptor-38/raptor-pro.skel', atlas: 'raptor-38/raptor.atlas', animation: 'walk' },
    { name: 'tank, 115 bones 6 transform', skel: 'tank-38/tank-pro.skel', atlas: 'tank-38/tank.atlas', animation: 'drive' },
    { name: 'spineboy, walk', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas', animation: 'walk' },
    { name: 'spineboy, walk mixing into run', skel: 'spineboy-38/spineboy-pro.skel', atlas: 'spineboy-38/spineboy.atlas', animation: 'walk', mix: 'run' },
] as const;

const HAS_ASSETS = existsSync(SPINE38_WASM)
    && CASES.every((c) => existsSync(resolve(FIXTURES, c.skel)));

const ENTITIES = 1000;
const FRAMES = 20;
const DT = 1 / 60;
const COUNTERS = [
    'tracks', 'entries', 'timelines', 'bones',
    'ik', 'transform', 'path', 'physics', 'events',
] as const;

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
const instances = new Map<string, number[]>();

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

    for (const test of CASES) {
        const skelData = new Uint8Array(readFileSync(resolve(FIXTURES, test.skel)));
        const atlasText = readFileSync(resolve(FIXTURES, test.atlas), 'utf-8');
        const skelHandle = withScratch(raw, (alloc) => {
            const ptr = alloc(skelData.length);
            raw.HEAPU8.set(skelData, ptr);
            return api.loadSkeleton(ptr, skelData.length, atlasText, atlasText.length, true);
        });
        if (skelHandle < 0) throw new Error(`${test.name}: ${api.getLastError()}`);
        for (let i = 0, pages = api.getAtlasPageCount(skelHandle); i < pages; i++) {
            api.setAtlasPageTexture(skelHandle, i, 1, 2048, 2048);
        }
        if ('mix' in test) api.setDefaultMix(skelHandle, 10);

        const ids: number[] = [];
        for (let i = 0; i < ENTITIES; i++) {
            const id = api.createInstance(skelHandle);
            if (test.animation) {
                if (!api.playAnimation(id, test.animation, true, 0)) {
                    throw new Error(`${test.name}: no animation "${test.animation}"`);
                }
                if ('mix' in test) {
                    // spine replaces an entry that was never applied rather
                    // than mixing out of it, so the first poses once before the
                    // second arrives; the mix is held open for the whole run.
                    api.probePose(id, DT, 3);
                    if (!api.playAnimation(id, test.mix, true, 0)) {
                        throw new Error(`${test.name}: no animation "${test.mix}"`);
                    }
                }
            }
            api.probePose(id, DT, 3);
            ids.push(id);
        }
        instances.set(test.name, ids);
    }

    if (process.env.SPINE_POSE_REPORT) report();
});

function countsOf(): Record<string, number> {
    return withScratch(raw, (alloc) => {
        const ptr = alloc(COUNTERS.length * 4);
        api.probePoseCounts(ptr);
        const out: Record<string, number> = {};
        COUNTERS.forEach((name, i) => { out[name] = raw.HEAPU32[(ptr >> 2) + i]; });
        return out;
    });
}

/** What each case's skeleton is, so a millisecond can be read against it. */
function report(): void {
    const rows = CASES.map((test) => {
        const id = instances.get(test.name)![0];
        api.probePose(id, DT, 3);
        return { case: test.name, ...countsOf() };
    });
    const keys = Object.keys(rows[0]);
    const width = (k: string) => Math.max(k.length, ...rows.map((r) => String((r as never)[k]).length));
    const line = (cells: unknown[]) => cells.map((c, i) => String(c).padStart(width(keys[i]))).join('  ');
    console.log(line(keys));
    for (const row of rows) console.log(line(keys.map((k) => (row as never)[k])));
}

function pass(name: string, stage: number): void {
    const ids = instances.get(name)!;
    for (let f = 0; f < FRAMES; f++) {
        for (const id of ids) api.probePose(id, DT, stage);
    }
}

describe.skipIf(!HAS_ASSETS)(`Spine pose stages: ${ENTITIES} entities x${FRAMES}`, () => {
    for (const test of CASES) {
        bench(`P0 crossing only — ${test.name}`, () => { pass(test.name, 0); });
        bench(`P1 + advance tracks — ${test.name}`, () => { pass(test.name, 1); });
        bench(`P2 + apply timelines — ${test.name}`, () => { pass(test.name, 2); });
        bench(`P3 + world transforms — ${test.name}`, () => { pass(test.name, 3); });
    }
});
