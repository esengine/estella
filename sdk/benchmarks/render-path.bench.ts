// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the render path costs as a scene grows.
 *
 * Every other benchmark here measures the ECS, the event queue, UI layout or the
 * wasm boundary. None measured the path a frame actually takes, so how this
 * engine behaves at a thousand objects versus ten thousand was a thing nobody
 * could answer — it had never been run.
 *
 * The transform pass is the half of that path reachable without a GPU: it walks
 * every Transform in the world each frame and rebuilds the world fields the
 * renderer, the physics sync and picking all read. These cases are the shapes a
 * scene comes in — flat, deep, wide — at two sizes each, so the SHAPE of the
 * curve is visible and not just one number: ten times the world costs ten times
 * as much when the pass is linear in it, and says so here when it is not. The
 * sizes are what they are because a ratio needs both sides above the ten
 * microseconds under which a sample is mostly timer.
 */
import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import { Transform } from '../src/ecs/component';
import { wasmData } from '../tests/helpers/wasmComponentData';
import { WASM_DIR } from '../tests/helpers/loadWasm';

let module: any;
let Registry: any;
/** The worlds, built once. A `beforeAll` inside a `describe` does not run before
 *  its benches do, and a bench that throws is SKIPPED while the run still exits
 *  0 — so everything they need is set up here, where it is awaited. */
const worlds: Record<string, any> = {};

beforeAll(async () => {
    const mod = await import(path.join(WASM_DIR, 'esengine.js'));
    module = await mod.default({ locateFile: (p: string) => path.join(WASM_DIR, p) });
    Registry = module.Registry;
    worlds.flatSmall = flatWorld(5_000);
    worlds.flatLarge = flatWorld(50_000);
    // Same 10k transforms both times: the difference is how far the walk
    // recurses, which is the cost a deep rig pays over a wide one.
    worlds.shallow = chainedWorld(10_000, 2);
    worlds.deep = chainedWorld(10_000, 20);
});

const TRANSFORM_DATA = wasmData(Transform);

/** `count` transforms with no parent between them. */
function flatWorld(count: number): any {
    const reg = new Registry();
    for (let i = 0; i < count; i++) {
        reg.addTransform(reg.create(), TRANSFORM_DATA);
    }
    return reg;
}

/** `count` transforms in chains `depth` long — the same total, walked recursively. */
function chainedWorld(count: number, depth: number): any {
    const reg = new Registry();
    for (let root = 0; root < count / depth; root++) {
        let parent = reg.create();
        reg.addTransform(parent, TRANSFORM_DATA);
        for (let d = 1; d < depth; d++) {
            const child = reg.create();
            reg.addTransform(child, TRANSFORM_DATA);
            reg.setParent(child, parent);
            parent = child;
        }
    }
    return reg;
}

/** One frame of the pass: begin clears the once-per-frame latch, then it runs. */
function frame(reg: any): void {
    module.renderer_beginFrame(0);
    module.renderer_updateTransforms(reg);
}

describe('Render path - transform pass, flat world', () => {
    bench('5k roots', () => frame(worlds.flatSmall));
    bench('50k roots', () => frame(worlds.flatLarge));
});

describe('Render path - transform pass, hierarchy', () => {
    bench('10k in chains of 2', () => frame(worlds.shallow));
    bench('10k in chains of 20', () => frame(worlds.deep));
});
