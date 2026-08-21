// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-layout-incremental.test.ts
 * @brief   An incrementally solved layout equals the same layout solved from
 *          scratch — for every node, not just the one that changed.
 *
 * The layout pass keeps its Yoga nodes, their styles AND their hierarchy between
 * frames, and re-applies styles so Yoga's own value-diffing decides what to
 * resolve. That is what makes editing one field cost one subtree instead of the
 * tree. Its failure mode is silent and invisible to a screenshot of a static
 * scene: a node that SHOULD have been recomputed is skipped and keeps last
 * frame's box, which looks perfectly plausible.
 *
 * So every case here is a differential: drive the change incrementally, then
 * build the same end state in a FRESH registry (which resets the retained
 * cache — Registry::instanceId) and require the two to agree exactly.
 *
 * Needs pre-built WASM at build/wasm/web (`node build-tools/cli.js build -t web`).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { UIPositionType, UINode, type UINodeData } from '../src/ui/core/ui-node';
import { px, auto } from '../src/ui/core/dimension';
import { App } from '../src/app/app';
import { Canvas, Transform } from '../src/ecs/component';
import { FlexContainer } from '../src/ui/layout/flex';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const node = (over: Partial<UINodeData> = {}): UINodeData => ({
    position: 0,
    width: auto(), height: auto(),
    minWidth: auto(), minHeight: auto(),
    maxWidth: auto(), maxHeight: auto(),
    flexGrow: 0, flexShrink: 1, flexBasis: auto(),
    alignSelf: 0,
    marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
    insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
    ...over,
});

const TRANSFORM = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
};

/** Every laid-out node's box, keyed by the caller's own label for it. */
type Boxes = Record<string, { w: number; h: number; x: number; y: number }>;

describe.skipIf(!HAS_WASM)('incremental layout equals a fresh solve', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function createApp(camW = 800, camH = 600) {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0,
            worldLeft: -camW / 2, worldBottom: -camH / 2,
            worldRight: camW / 2, worldTop: camH / 2,
            worldMouseX: 0, worldMouseY: 0, valid: true,
        });
        app.addPlugin(uiLayoutPlugin);
        return { app, registry };
    }

    function dispose(app: App, registry: CppRegistry): void {
        for (const e of app.world.getAllEntities()) { try { app.world.despawn(e); } catch { /* gone */ } }
        app.world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    /**
     * A row of `count` boxes inside a flex container inside a canvas. Returns the
     * entities by label so a case can perturb one and read them all back.
     */
    function build(app: App, count: number, leafWidth = 60) {
        const world = app.world;
        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, node({
            position: UIPositionType.Absolute,
            insetLeft: px(0), insetTop: px(0), insetRight: px(0), insetBottom: px(0),
        }));
        world.insert(root, Transform, TRANSFORM);

        const row = world.spawn();
        world.setParent(row, root);
        world.insert(row, UINode, node({ width: px(600), height: px(200) }));
        world.insert(row, FlexContainer, {
            direction: 0, wrap: 0, justifyContent: 0, alignItems: 0, alignContent: 0,
            gap: { x: 10, y: 10 },
            padding: { left: 8, top: 8, right: 8, bottom: 8 },
        });
        world.insert(row, Transform, TRANSFORM);

        const leaves: number[] = [];
        for (let i = 0; i < count; i++) {
            const leaf = world.spawn();
            world.setParent(leaf, row);
            world.insert(leaf, UINode, node({ width: px(leafWidth), height: px(40) }));
            world.insert(leaf, Transform, TRANSFORM);
            leaves.push(leaf);
        }
        return { root, row, leaves };
    }

    const read = (registry: CppRegistry, labelled: Record<string, number>): Boxes => {
        const out: Boxes = {};
        for (const [label, e] of Object.entries(labelled)) {
            const p = registry.getTransform(e).position;
            out[label] = {
                w: module.getUINodeComputedWidth!(registry, e),
                h: module.getUINodeComputedHeight!(registry, e),
                x: p.x, y: p.y,
            };
        }
        return out;
    };

    const label = (ids: { root: number; row: number; leaves: number[] }) => ({
        root: ids.root, row: ids.row,
        ...Object.fromEntries(ids.leaves.map((e, i) => [`leaf${i}`, e])),
    });

    /**
     * The comparison this file exists for, and the one thing it must not get
     * wrong: the two runs have to reach the same end state by DIFFERENT routes.
     *
     *   live  — solve, then perturb, then solve again. The second solve is the
     *           incremental one under test.
     *   fresh — perturb BEFORE the first solve, so the end state is resolved
     *           from nothing in a registry that has no retained anything.
     *
     * `settle` is how a case asks for a frame mid-perturbation: real for the
     * live run, a no-op for the fresh one, which must reach the end state
     * without ever solving an intermediate.
     */
    async function differential(
        setup: (app: App) => { root: number; row: number; leaves: number[] },
        perturb: (
            app: App,
            ids: { root: number; row: number; leaves: number[] },
            settle: () => Promise<void>,
        ) => void | Promise<void>,
        camAfter?: { w: number; h: number },
    ): Promise<[Boxes, Boxes]> {
        const live = createApp();
        const liveIds = setup(live.app);
        await live.app.tick(1 / 60);
        await perturb(live.app, liveIds, () => live.app.tick(1 / 60));
        if (camAfter) {
            const cam = live.app.getResource(UICameraInfo);
            cam.worldLeft = -camAfter.w / 2; cam.worldRight = camAfter.w / 2;
            cam.worldBottom = -camAfter.h / 2; cam.worldTop = camAfter.h / 2;
        }
        await live.app.tick(1 / 60);
        const incremental = read(live.registry, label(liveIds));
        dispose(live.app, live.registry);

        const fresh = createApp(camAfter?.w, camAfter?.h);
        const freshIds = setup(fresh.app);
        await perturb(fresh.app, freshIds, async () => { /* no intermediate solve */ });
        await fresh.app.tick(1 / 60);
        const scratch = read(fresh.registry, label(freshIds));
        dispose(fresh.app, fresh.registry);

        return [incremental, scratch];
    }

    it('resizing one leaf moves its siblings exactly as a fresh solve would', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 5),
            (app, ids) => {
                const n = app.world.get(ids.leaves[2], UINode) as UINodeData;
                app.world.insert(ids.leaves[2], UINode, { ...n, width: px(160) });
            },
        );
        expect(inc).toEqual(fresh);
        // And the change actually took, so this is not two identical no-ops.
        expect(inc.leaf2.w).toBeCloseTo(160, 3);
    });

    it('changing the container re-places every child', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 5),
            (app, ids) => {
                const fc = app.world.get(ids.row, FlexContainer) as Record<string, unknown>;
                app.world.insert(ids.row, FlexContainer, { ...fc, justifyContent: 2, gap: { x: 40, y: 10 } });
            },
        );
        expect(inc).toEqual(fresh);
    });

    // The retained node keeps whatever style it was last given, so "no
    // FlexContainer" has to actively restore Yoga's defaults rather than leave
    // the removed container's padding and justify in place.
    it('removing the container clears the style it had applied', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 4),
            (app, ids) => { app.world.remove(ids.row, FlexContainer); },
        );
        expect(inc).toEqual(fresh);
    });

    it('adding a node lays out the new sibling and re-places the old ones', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 4),
            (app, ids) => {
                const extra = app.world.spawn();
                app.world.setParent(extra, ids.row);
                app.world.insert(extra, UINode, node({ width: px(50), height: px(40) }));
                app.world.insert(extra, Transform, TRANSFORM);
            },
        );
        expect(inc).toEqual(fresh);
    });

    it('removing a node re-places the survivors', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 5),
            (app, ids) => { app.world.despawn(ids.leaves[1]); },
        );
        // leaf1 is gone in both; compare what is left.
        delete inc.leaf1; delete fresh.leaf1;
        expect(inc).toEqual(fresh);
    });

    // A subtree root positions itself against the camera box, so a resize moves
    // every node even though Yoga may report no new layout for any of them.
    it('resizing the camera re-places the whole tree', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 5),
            () => { /* only the camera changes */ },
            { w: 1200, h: 400 },
        );
        expect(inc).toEqual(fresh);
    });

    // The case the parent-resize propagation exists for, and the only shape that
    // exercises it: a child pinned to its parent's top-left keeps the exact same
    // Yoga box when the parent resizes — same left, top, width, height — so Yoga
    // rightly reports no new layout for it. Its WORLD position still moved,
    // because that is measured from the parent's centre. Skip it and the child
    // silently stays where the smaller parent had put it.
    it('re-places a corner-pinned child when only its parent resized', async () => {
        const buildPinned = (app: App) => {
            const world = app.world;
            const root = world.spawn();
            world.insert(root, Canvas, {});
            world.insert(root, UINode, node({
                position: UIPositionType.Absolute,
                insetLeft: px(0), insetTop: px(0), insetRight: px(0), insetBottom: px(0),
            }));
            world.insert(root, Transform, TRANSFORM);

            const box = world.spawn();
            world.setParent(box, root);
            world.insert(box, UINode, node({ width: px(300), height: px(200) }));
            world.insert(box, Transform, TRANSFORM);

            const pinned = world.spawn();
            world.setParent(pinned, box);
            world.insert(pinned, UINode, node({
                position: UIPositionType.Absolute,
                insetLeft: px(0), insetTop: px(0),
                width: px(50), height: px(30),
            }));
            world.insert(pinned, Transform, TRANSFORM);
            return { root, row: box, leaves: [pinned] };
        };

        const [inc, fresh] = await differential(
            buildPinned,
            (app, ids) => {
                const n = app.world.get(ids.row, UINode) as UINodeData;
                app.world.insert(ids.row, UINode, { ...n, width: px(500) });
            },
        );
        expect(inc).toEqual(fresh);
        // The pinned child's own box is unchanged — which is exactly why Yoga
        // reports nothing for it and the propagation has to carry the move.
        expect(inc.leaf0.w).toBeCloseTo(50, 3);
        expect(inc.leaf0.x).not.toBeCloseTo(fresh.row.x, 3);
    });

    it('a run of edits ends where one fresh solve of the end state does', async () => {
        const [inc, fresh] = await differential(
            (app) => build(app, 6),
            async (app, ids, settle) => {
                for (const [i, w] of [[0, 30], [3, 90], [5, 120], [0, 45]] as const) {
                    const n = app.world.get(ids.leaves[i], UINode) as UINodeData;
                    app.world.insert(ids.leaves[i], UINode, { ...n, width: px(w) });
                    await settle();
                }
            },
        );
        expect(inc).toEqual(fresh);
    });
});
