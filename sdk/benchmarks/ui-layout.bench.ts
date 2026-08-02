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

let wasm: ESEngineModule;

const WASM_DIR = path.resolve(__dirname, '../../desktop/public/wasm');

beforeAll(async () => {
    const engineMod = await import(path.join(WASM_DIR, 'esengine.js'));
    wasm = await engineMod.default({ locateFile: (p: string) => path.join(WASM_DIR, p) });
});

const TRANSFORM = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
};

const px = (v: number) => ({ value: v, unit: 0 });
const auto = () => ({ value: 0, unit: 2 });

const uiNode = (w: number, h: number) => ({
    position: 0, display: 0, opacity: 1, pointerEvents: 0,
    width: px(w), height: px(h),
    minWidth: auto(), minHeight: auto(), maxWidth: auto(), maxHeight: auto(),
    flexGrow: 0, flexShrink: 1, flexBasis: auto(), alignSelf: 0,
    marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
    insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
});

/**
 * A Canvas root with `count` UINodes under it, in a realistic shape: rows of
 * children rather than one flat list, so the solve has depth to walk.
 */
function buildTree(reg: Registry, count: number): { root: Entity; leaves: Entity[] } {
    const root = reg.create();
    reg.addTransform(root, TRANSFORM);
    reg.addUINode(root, uiNode(800, 600));
    reg.addCanvas(root, {
        designResolution: { x: 800, y: 600 },
        pixelsPerUnit: 1, scaleMode: 0, matchWidthOrHeight: 0,
        backgroundColor: { x: 0, y: 0, z: 0, w: 1 },
    });

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
