// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RectAnchors: content pinned to its parent's rectangle, or to the screen, in the engine and not in a compatibility layer.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { World } from '../src/ecs/world';
import { Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { ContentRect } from '../src/ui/core/content-rect';
import type { ScreenLayoutData } from '../src/ui/core/screen-layout';
import { AnchorFlag, AnchorMode, RectAnchors, alignAllRectAnchors, anchoredRect, forgetRectAnchors } from '../src/ui/layout/rect-anchors';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const defaults = { left: 0, right: 0, top: 0, bottom: 0, horizontalCenter: 0, verticalCenter: 0, isAbsLeft: true, isAbsRight: true, isAbsTop: true, isAbsBottom: true, isAbsHorizontalCenter: true, isAbsVerticalCenter: true, alignMode: AnchorMode.ON_RESIZE, enabled: true };
const screen = (halfW: number, halfH: number): ScreenLayoutData => ({ valid: true, left: -halfW, right: halfW, bottom: -halfH, top: halfH, safeLeft: -halfW, safeRight: halfW, safeBottom: -halfH, safeTop: halfH, scale: 1, viewportW: halfW * 2, viewportH: halfH * 2 });

describe('anchoredRect', () => {
    const box = { left: 0, right: 100, bottom: 0, top: 50 };
    const own = { width: 10, height: 10, pivotX: 0.5, pivotY: 0.5 };
    const at = { x: 0, y: 0 };

    it('stretches between two edges, with margins', () => {
        const out = anchoredRect({ ...defaults, alignFlags: AnchorFlag.LEFT | AnchorFlag.RIGHT, left: 10, right: 20 }, box, own, { x: 1, y: 1 }, at);
        expect(out.width).toBe(70);
        expect(out.x).toBe(10 + 35);
    });

    it('pins to one edge, by its own pivot', () => {
        expect(anchoredRect({ ...defaults, alignFlags: AnchorFlag.LEFT, left: 5 }, box, own, { x: 1, y: 1 }, at).x).toBe(5 + 5);
        expect(anchoredRect({ ...defaults, alignFlags: AnchorFlag.RIGHT, right: 5 }, box, own, { x: 1, y: 1 }, at).x).toBe(95 - 5);
        expect(anchoredRect({ ...defaults, alignFlags: AnchorFlag.TOP, top: 0 }, box, own, { x: 1, y: 1 }, at).y).toBe(45);
    });

    it('centres with an offset, in units or as a fraction of the parent', () => {
        expect(anchoredRect({ ...defaults, alignFlags: AnchorFlag.CENTER, horizontalCenter: 4 }, box, own, { x: 1, y: 1 }, at).x).toBe(54);
        expect(anchoredRect({ ...defaults, alignFlags: AnchorFlag.CENTER, horizontalCenter: 0.1, isAbsHorizontalCenter: false }, box, own, { x: 1, y: 1 }, at).x).toBe(60);
    });

    it('leaves an axis it does not pin alone', () => {
        const out = anchoredRect({ ...defaults, alignFlags: AnchorFlag.LEFT }, box, own, { x: 1, y: 1 }, { x: 0, y: 33 });
        expect(out.y).toBe(33);
    });
});

describe.skipIf(!HAS_WASM)('the system', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { if (world) forgetRectAnchors(world); world?.disconnectCpp(); registry?.delete(); registry = undefined; world = undefined; });

    function connect(): World {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        registry = new module.Registry();
        world = new World();
        world.connectCpp(registry, module);
        return world;
    }
    const rect = (w: number, h: number) => ({ size: { x: w, y: h }, pivot: { x: 0.5, y: 0.5 } });

    it('stretches a root to the screen and a child to its parent, parents first', () => {
        const w = connect();
        const root = w.spawn(), child = w.spawn();
        w.insert(root, Transform); w.insert(root, ContentRect, rect(10, 10));
        w.insert(root, RectAnchors, { ...defaults, alignFlags: AnchorFlag.HORIZONTAL & ~AnchorFlag.CENTER | AnchorFlag.VERTICAL & ~AnchorFlag.MID });
        w.insert(child, Transform); w.insert(child, ContentRect, rect(1, 1));
        w.insert(child, RectAnchors, { ...defaults, alignFlags: AnchorFlag.LEFT | AnchorFlag.RIGHT | AnchorFlag.TOP | AnchorFlag.BOTTOM, left: 10, right: 10, top: 20, bottom: 20 });
        w.setParent(child, root);

        alignAllRectAnchors(w, screen(540, 960), 1);

        expect(w.get(root, ContentRect).size).toEqual({ x: 1080, y: 1920 });
        expect(w.get(root, Transform).position.x).toBe(0);
        expect(w.get(child, ContentRect).size).toEqual({ x: 1060, y: 1880 });
    });

    it('aligns again when the screen changes, and not when nothing did', () => {
        const w = connect();
        const e = w.spawn();
        w.insert(e, Transform); w.insert(e, ContentRect, rect(10, 10));
        w.insert(e, RectAnchors, { ...defaults, alignFlags: AnchorFlag.LEFT | AnchorFlag.RIGHT });
        alignAllRectAnchors(w, screen(100, 100), 1);
        expect(w.get(e, ContentRect).size.x).toBe(200);
        w.set(e, ContentRect, rect(7, 10));
        alignAllRectAnchors(w, screen(100, 100), 1);          // same screen: left as it was set
        expect(w.get(e, ContentRect).size.x).toBe(7);
        alignAllRectAnchors(w, screen(50, 100), 2);           // a new screen
        expect(w.get(e, ContentRect).size.x).toBe(100);
    });

    it('does nothing for a node that is disabled or pins nothing', () => {
        const w = connect();
        const a = w.spawn(), b = w.spawn();
        for (const e of [a, b]) { w.insert(e, Transform); w.insert(e, ContentRect, rect(10, 10)); }
        w.insert(a, RectAnchors, { ...defaults, alignFlags: AnchorFlag.LEFT | AnchorFlag.RIGHT, enabled: false });
        w.insert(b, RectAnchors, { ...defaults, alignFlags: 0 });
        alignAllRectAnchors(w, screen(100, 100), 1);
        expect(w.get(a, ContentRect).size.x).toBe(10);
        expect(w.get(b, ContentRect).size.x).toBe(10);
    });
});
