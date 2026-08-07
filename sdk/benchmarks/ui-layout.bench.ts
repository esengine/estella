// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a UI tree costs per frame, split by what actually changed.
 *
 * Three cases, because the layout pass treats them very differently and only
 * one of them is rare:
 *
 *   STATIC   — nothing changed. The gate should skip the solve entirely, so
 *              this measures the floor: the DFS rebuild + structure signature
 *              that runs unconditionally to detect change in the first place.
 *   ONE FIELD— a single node's width moved. This is the common case in a real
 *              UI (a label retypes, a bar fills) and the one worth watching:
 *              the difference between it and STATIC is what one edit costs.
 *   STRUCTURE— a node was added. A full resolve is legitimately required.
 *
 * Runs against the real engine wasm, so the numbers are the shipped ones.
 */
import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import type { ESEngineModule, Registry, Entity } from '../src/wasm/wasm.generated';
import { WASM_DIR as WASM_DIR_SHARED } from '../tests/helpers/loadWasm';
import { Transform, Canvas } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';

let wasm: ESEngineModule;

// Same resolution the integration tests use: $ESENGINE_WASM_DIR, then the
// in-repo build output, then the editor's copy. Hard-coding the last of
// those is why these never found a wasm in CI.
const WASM_DIR = WASM_DIR_SHARED;

beforeAll(async () => {
    const engineMod = await import(path.join(WASM_DIR, 'esengine.js'));
    wasm = await engineMod.default({ locateFile: (p: string) => path.join(WASM_DIR, p) });
});

/**
 * A component in the shape embind takes, defaulted from the generated registry
 * rather than spelled out here: embind rejects a partial struct, so a field added
 * in C++ breaks this file at warmup unless the defaults come from one place.
 * Colors are the one shape the two disagree on — authored r/g/b/a, bound as vec4.
 */
function embindShape(def: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(def)) {
        const c = value as { r?: number; g?: number; b?: number; a?: number };
        out[key] = c && typeof c === 'object' && typeof c.r === 'number' && typeof c.a === 'number'
            ? { x: c.r, y: c.g, z: c.b, w: c.a }
            : value;
    }
    return out;
}

const TRANSFORM = embindShape(Transform._default);

const CANVAS = {
    ...embindShape(Canvas._default),
    designResolution: { x: 800, y: 600 },
    pixelsPerUnit: 1, scaleMode: 0, matchWidthOrHeight: 0,
};

const px = (v: number) => ({ value: v, unit: 0 });

const uiNode = (w: number, h: number) => ({
    ...embindShape(UINode._default),
    width: px(w), height: px(h),
});

/**
 * A Canvas root with `count` UINodes under it, in a realistic shape: rows of
 * children rather than one flat list, so the solve has depth to walk.
 */
function buildTree(reg: Registry, count: number): { root: Entity; leaves: Entity[] } {
    const root = reg.create();
    reg.addTransform(root, TRANSFORM);
    reg.addUINode(root, uiNode(800, 600));
    reg.addCanvas(root, CANVAS);

    const leaves: Entity[] = [];
    const PER_ROW = 10;
    let row: Entity | null = null;
    for (let i = 0; i < count; i++) {
        if (i % PER_ROW === 0) {
            row = reg.create();
            reg.addTransform(row, TRANSFORM);
            reg.addUINode(row, uiNode(800, 40));
            reg.setParent(row, root);
        }
        const leaf = reg.create();
        reg.addTransform(leaf, TRANSFORM);
        reg.addUINode(leaf, uiNode(60, 30));
        reg.setParent(leaf, row!);
        leaves.push(leaf);
    }
    return { root, leaves };
}

const CAM = { l: -400, b: -300, r: 400, t: 300 };
const solve = (reg: Registry, propertyDirty: boolean) =>
    wasm.uiLayout_update(reg as never, CAM.l, CAM.b, CAM.r, CAM.t, propertyDirty);

for (const size of [100, 500, 2000]) {
    describe(`UI layout — ${size} nodes`, () => {
        let reg: Registry;
        let leaves: Entity[];

        const setup = () => {
            reg = new wasm.Registry();
            ({ leaves } = buildTree(reg, size));
            solve(reg, true); // prime: the first pass always solves
        };

        // The floor. Everything here runs whether or not anything changed.
        bench('static frame (nothing changed)', () => {
            solve(reg, false);
        }, { setup });

        // The common case, and the one the dirty granularity is about.
        bench('one node resized', () => {
            const node = reg.getUINode(leaves[(leaves.length / 2) | 0]);
            node.width = px(60 + (Math.random() * 8 | 0));
            reg.addUINode(leaves[(leaves.length / 2) | 0], node);
            solve(reg, true);
        }, { setup });

        // A resolve is genuinely required here — this is the honest upper bound.
        bench('one node added', () => {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM);
            reg.addUINode(e, uiNode(60, 30));
            reg.setParent(e, leaves[0]);
            solve(reg, false);
        }, { setup });
    });
}
