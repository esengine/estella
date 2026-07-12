// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-anchor-preset.test.ts
 * @brief   Anchor presets map to/from UINode box fields, and lay out through the
 *          real Yoga solver as pinned / centred / stretched.
 *
 * The integration half needs pre-built WASM at desktop/public/wasm/esengine.wasm
 * (`node build-tools/cli.js build -t web`); the pure half always runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    AnchorAxis,
    ANCHOR_AXES,
    anchorPresetFields,
    detectAnchor,
    type AnchorPreset,
} from '../src/ui/layout/anchor';
import { UIPositionType, UINode, type UINodeData } from '../src/ui/core/ui-node';
import { DimensionUnit, px, auto } from '../src/ui/core/dimension';
import { App } from '../src/app';
import { Canvas, Transform, Sprite } from '../src/component';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

function baseNode(over: Partial<UINodeData> = {}): UINodeData {
    return {
        position: 0,
        width: auto(), height: auto(),
        minWidth: auto(), minHeight: auto(),
        maxWidth: auto(), maxHeight: auto(),
        flexGrow: 0, flexShrink: 1, flexBasis: auto(),
        alignSelf: 0,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
        ...over,
    };
}

/** Overlay a preset onto a base node the way an author/editor would. */
function applyPreset(base: UINodeData, preset: AnchorPreset): UINodeData {
    return { ...base, ...anchorPresetFields(preset) };
}

describe('anchor presets (pure)', () => {
    it('always resolves to an Absolute box', () => {
        for (const h of ANCHOR_AXES) {
            for (const v of ANCHOR_AXES) {
                expect(anchorPresetFields({ h, v }).position).toBe(UIPositionType.Absolute);
            }
        }
    });

    it('Center leaves both insets and both margins auto; the size is untouched', () => {
        const f = anchorPresetFields({ h: AnchorAxis.Center, v: AnchorAxis.Center });
        for (const d of [f.insetLeft, f.insetRight, f.insetTop, f.insetBottom,
                         f.marginLeft, f.marginRight, f.marginTop, f.marginBottom]) {
            expect(d.unit).toBe(DimensionUnit.Auto);
        }
        expect(f.width).toBeUndefined();
        expect(f.height).toBeUndefined();
    });

    it('Stretch pins both edges and drives the size via auto', () => {
        const f = anchorPresetFields({ h: AnchorAxis.Stretch, v: AnchorAxis.Stretch });
        expect(f.insetLeft.unit).toBe(DimensionUnit.Px);
        expect(f.insetRight.unit).toBe(DimensionUnit.Px);
        expect(f.width?.unit).toBe(DimensionUnit.Auto);
        expect(f.height?.unit).toBe(DimensionUnit.Auto);
    });

    it('detect ∘ apply round-trips for all 16 presets (from an auto-sized base)', () => {
        for (const h of ANCHOR_AXES) {
            for (const v of ANCHOR_AXES) {
                const preset = { h, v };
                expect(detectAnchor(applyPreset(baseNode(), preset))).toEqual(preset);
            }
        }
    });

    it('detect ∘ apply round-trips from a fixed-size base too', () => {
        const sized = baseNode({ width: px(120), height: px(48) });
        for (const h of ANCHOR_AXES) {
            for (const v of ANCHOR_AXES) {
                const preset = { h, v };
                expect(detectAnchor(applyPreset(sized, preset))).toEqual(preset);
            }
        }
    });

    it('returns null for a Relative (flow) node and for a hand-tuned custom box', () => {
        expect(detectAnchor(baseNode())).toBeNull(); // default = Relative
        // Absolute, both edges pinned, definite size, fixed margins → over-constrained.
        expect(detectAnchor(baseNode({
            position: UIPositionType.Absolute,
            insetLeft: px(0), insetRight: px(0), width: px(100),
            insetTop: px(0), insetBottom: auto(),
        }))).toBeNull();
    });
});

describe.skipIf(!HAS_WASM)('anchor presets lay out via Yoga (WASM integration)', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function createApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0,
            worldLeft: -400, worldBottom: -300, worldRight: 400, worldTop: 300,
            worldMouseX: 0, worldMouseY: 0, valid: true,
        });
        app.addPlugin(uiLayoutPlugin);
        return { app, registry };
    }

    function dispose(app: App, registry: CppRegistry): void {
        for (const e of app.world.getAllEntities()) { try { app.world.despawn(e); } catch (_) {} }
        app.world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    const W = (r: CppRegistry, e: number) => module.getUINodeComputedWidth!(r, e);
    const H = (r: CppRegistry, e: number) => module.getUINodeComputedHeight!(r, e);

    /** Spawn an 800×600 canvas root with one preset-anchored 100×80 child; return
     *  the child's computed size + laid-out local position (canvas sits at origin,
     *  so local == world). */
    async function layoutChild(preset: AnchorPreset) {
        const { app, registry } = createApp();
        const world = app.world;

        const root = world.spawn();
        world.insert(root, Canvas, {});
        world.insert(root, UINode, baseNode({
            position: UIPositionType.Absolute,
            insetLeft: px(0), insetTop: px(0), insetRight: px(0), insetBottom: px(0),
        }));
        world.insert(root, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const child = world.spawn();
        world.setParent(child, root);
        world.insert(child, UINode, applyPreset(baseNode({ width: px(100), height: px(80) }), preset));
        world.insert(child, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(child, Sprite, {
            texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: 100, y: 80 },
            uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, layer: 0, flipX: false, flipY: false,
        });

        await app.tick(1 / 60);
        const w = W(registry, child), h = H(registry, child);
        const p = registry.getTransform(child).position;
        dispose(app, registry);
        return { w, h, x: p.x, y: p.y };
    }

    it('Center/Center sits at the canvas centre, keeping its fixed size', async () => {
        const r = await layoutChild({ h: AnchorAxis.Center, v: AnchorAxis.Center });
        expect(r.w).toBeCloseTo(100, 0);
        expect(r.h).toBeCloseTo(80, 0);
        expect(r.x).toBeCloseTo(0, 0);
        expect(r.y).toBeCloseTo(0, 0);
    });

    it('Start/Start pins the top-left corner', async () => {
        const r = await layoutChild({ h: AnchorAxis.Start, v: AnchorAxis.Start });
        expect(r.w).toBeCloseTo(100, 0);
        expect(r.x).toBeLessThan(-100); // toward the left edge
        expect(r.y).toBeGreaterThan(100); // toward the top edge (world y-up)
    });

    it('End/End pins the bottom-right corner', async () => {
        const r = await layoutChild({ h: AnchorAxis.End, v: AnchorAxis.End });
        expect(r.x).toBeGreaterThan(100);
        expect(r.y).toBeLessThan(-100);
    });

    it('Center-horizontal + Start-vertical centres X and pins the top', async () => {
        const r = await layoutChild({ h: AnchorAxis.Center, v: AnchorAxis.Start });
        expect(r.x).toBeCloseTo(0, 0);
        expect(r.y).toBeGreaterThan(100);
    });

    it('Stretch/Stretch fills the canvas', async () => {
        const r = await layoutChild({ h: AnchorAxis.Stretch, v: AnchorAxis.Stretch });
        expect(r.w).toBeCloseTo(800, 0);
        expect(r.h).toBeCloseTo(600, 0);
        expect(r.x).toBeCloseTo(0, 0);
        expect(r.y).toBeCloseTo(0, 0);
    });
});
