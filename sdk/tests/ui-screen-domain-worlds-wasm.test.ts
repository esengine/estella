// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { entityIndex } from '../src/types';
import { UINode } from '../src/ui/core/ui-node';
import { px } from '../src/ui/core/dimension';
import { Text } from '../src/ui/core/text';
import { textFrame } from '../src/ui/text/plugin';
import { Interactable } from '../src/ui/input/interactable';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('screen domain ownership on real WASM', () => {
    let engine: ESEngineModule;
    const worlds: Array<{ app: App; registry: CppRegistry }> = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => {
        for (const { app, registry } of worlds.splice(0)) {
            for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
            app.world.disconnectCpp();
            registry.delete();
        }
    });
    const make = (screen: boolean) => {
        setDefaultContext(new AppContext());
        const registry = new engine.Registry(), app = App.new();
        app.connectCpp(registry, engine);
        worlds.push({ app, registry });
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.insert(entity, UINode);
        if (screen) app.world.insert(entity, Canvas);
        return { app, registry, entity };
    };
    it('lays glyphs in the owning label’s resolved box after both Canvases have run', () => {
        const label = (w: number, h: number) => {
            const { app, registry, entity: canvas } = make(true);
            const world = app.world, entity = world.spawn();
            world.insert(entity, Transform);
            world.insert(entity, UINode, { width: px(w), height: px(h) });
            world.insert(entity, Text, { content: 'Label' });
            world.setParent(entity, canvas);
            engine.uiLayout_update(registry, -200, -100, 200, 100, true);
            return { entity, measure: () => textFrame(world, entity, world.get(entity, Text)) };
        };
        const hud = label(120, 32), preview = label(75, 18);
        expect(hud.entity).toBe(preview.entity);
        expect(hud.measure()).toMatchObject({ w: 120, h: 32, ui: true });
        expect(preview.measure()).toMatchObject({ w: 75, h: 18, ui: true });
    });
    it('does not borrow a screen-domain entry from another registry with the same entity ID', () => {
        const first = make(true);
        engine.uiLayout_update(first.registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
        const second = make(false);
        expect(second.entity).toBe(first.entity);
        expect(engine.ui_isScreenDomain!(second.registry, second.entity)).toBe(false);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
        engine.uiLayout_update(second.registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(second.registry, second.entity)).toBe(false);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
        expect(engine.uiHitTest_pick!(first.registry, 0, 0)).toBe(first.entity);
        expect(engine.uiLayout_update(first.registry, -50, -50, 50, 50, false)).toBe(false);
    });
    it('does not classify a despawned entity using the previous layout entry', () => {
        const { app, registry, entity } = make(true);
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(registry, entity)).toBe(true);
        app.world.despawn(entity);
        expect(engine.ui_isScreenDomain!(registry, entity)).toBe(false);
    });
    it('refreshes screen membership when only non-layout descendants change', () => {
        const { app, registry, entity: canvas } = make(true);
        const world = app.world;
        const decoration = world.spawn();
        world.insert(decoration, Transform);
        world.setParent(decoration, canvas);
        const layout = (dirty = false) => engine.uiLayout_update(registry, -50, -50, 50, 50, dirty);
        const isScreen = (entity: number) => engine.ui_isScreenDomain!(registry, entity);

        expect(layout(true)).toBe(true);
        expect(isScreen(decoration)).toBe(true);
        world.removeParent(decoration);
        expect(layout()).toBe(false);
        expect(isScreen(decoration)).toBe(false);
        world.setParent(decoration, canvas);
        expect(layout()).toBe(false);
        expect(isScreen(decoration)).toBe(true);

        world.despawn(decoration);
        const replacement = world.spawn();
        world.insert(replacement, Transform);
        expect(entityIndex(replacement)).toBe(entityIndex(decoration));
        expect(isScreen(replacement)).toBe(false);
        expect(layout()).toBe(false);
        expect(isScreen(replacement)).toBe(false);
        world.setParent(replacement, canvas);
        expect(layout()).toBe(false);
        expect(isScreen(replacement)).toBe(true);
        expect(isScreen(decoration)).toBe(false);
    });
    it('retains each world’s hit, pick list and input change cursor across interleaved queries', () => {
        const hud = make(true), preview = make(true);
        for (const view of [hud, preview]) {
            view.app.world.insert(view.entity, Interactable);
            engine.uiLayout_update(view.registry, -50, -50, 50, 50, true);
            engine.transform_update(view.registry);
            expect(engine.uiHitTest_inputsChanged!(view.registry)).toBe(true);
        }
        expect(engine.uiHitTest_inputsChanged!(hud.registry)).toBe(false);
        const none = 0xffffffff;
        engine.uiHitTest_update(hud.registry, 0, 0, 100, 0, 0, -1);
        engine.uiHitTest_update(preview.registry, 500, 500, 100, 0, 0, -1);
        expect(engine.uiHitTest_getHitEntityInWorld!(hud.registry)).toBe(hud.entity);
        expect(engine.uiHitTest_getHitEntityInWorld!(preview.registry)).toBe(none);
        expect(engine.uiHitTest_getHitEntity()).toBe(none);

        expect(engine.uiHitTest_pickAll!(hud.registry, 0, 0)).toBe(1);
        expect(engine.uiHitTest_pickAll!(preview.registry, 500, 500)).toBe(0);
        expect(engine.uiHitTest_pickResultInWorld!(hud.registry, 0)).toBe(hud.entity);
        expect(engine.uiHitTest_pickResultInWorld!(preview.registry, 0)).toBe(none);
        expect(engine.uiHitTest_pickResult!(0)).toBe(none);
        hud.app.world.despawn(hud.entity);
        expect(engine.uiHitTest_getHitEntityInWorld!(hud.registry)).toBe(none);
        expect(engine.uiHitTest_pickResultInWorld!(hud.registry, 0)).toBe(none);
    });
});
