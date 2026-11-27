// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Disabled, Parent, Transform } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UIDialog } from '../src/ui/behavior/dialog';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import { moveUIFocus } from '../src/ui/input/focus-transition';
import { inspectFocusTraversal, isFocusEligible } from '../src/ui/input/focus-inspection';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('focus transitions on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine);
        app.insertResource(Input, new InputState());
        app.insertResource(UIEvents, new UIEventQueue());
        focusPlugin.build(app); flushPendingRegistrations(app);
    });
    afterEach(() => {
        focusPlugin.cleanup(app);
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
    });
    const control = (tabIndex: number) => {
        const entity = app.world.spawn();
        app.world.insert(entity, Focusable, { tabIndex });
        return entity;
    };
    const tab = async () => {
        app.getResource(Input).keysPressed.add('Tab');
        await app.tick(1 / 60);
        app.getResource(Input).keysPressed.clear();
    };
    it.each(['despawn', 'remove', 'modal', 'disable'] as const)(
        'rejects a next target invalidated by blur: %s', async mutation => {
            const first = control(0), next = control(1);
            const modal = app.world.spawn(); app.world.insert(modal, UINode);
            await tab();
            app.getResource(UIEvents).on(first, 'blur', () => {
                if (mutation === 'despawn') app.world.despawn(next);
                if (mutation === 'remove') app.world.remove(next, Focusable);
                if (mutation === 'modal') app.world.insert(modal, UIDialog);
                if (mutation === 'disable') app.world.insert(next, Disabled);
            });
            await tab();
            expect(app.getResource(FocusManager).focusedEntity).toBeNull();
            if (app.world.valid(next) && app.world.has(next, Focusable)) {
                expect(app.world.get(next, Focusable).isFocused).toBe(false);
            }
        });
    it('clears a target deleted by its focus callback in the same tick', async () => {
        const entity = control(0);
        app.getResource(UIEvents).on(entity, 'focus', () => app.world.despawn(entity));
        await tab();
        expect(app.getResource(FocusManager).focusedEntity).toBeNull();
    });
    it('emits one Blur when a live focused control loses its Focusable component', async () => {
        const first = control(0), next = control(1);
        const events = app.getResource(UIEvents), manager = app.getResource(FocusManager);
        const trace: string[] = [];
        events.on(first, 'blur', () => trace.push('blur'));
        events.on(first, 'click', () => trace.push('old click'));
        events.on(next, 'focus', () => trace.push('next focus'));
        await tab();
        app.world.remove(first, Focusable);
        const input = app.getResource(Input);
        input.keysPressed.add('Enter');
        await app.tick(1 / 60);
        input.keysPressed.clear();
        expect(manager.focusedEntity).toBeNull();
        expect(trace).toEqual(['blur']);
        await tab();
        expect(manager.focusedEntity).toBe(next);
        expect(trace).toEqual(['blur', 'next focus']);
    });

    it('balances focus and blur when a focus handler removes its own component', async () => {
        const entity = control(0);
        const events = app.getResource(UIEvents), trace: string[] = [];
        events.on(entity, 'focus', () => { trace.push('focus'); app.world.remove(entity, Focusable); });
        events.on(entity, 'blur', () => trace.push('blur'));
        await tab();
        expect(app.getResource(FocusManager).focusedEntity).toBeNull();
        expect(trace).toEqual(['focus', 'blur']);
    });
    it('does not replay Enter on the control selected by a stale focus blur handler', async () => {
        const first = control(0), next = control(1);
        const events = app.getResource(UIEvents), manager = app.getResource(FocusManager);
        const clicked = vi.fn();
        events.on(first, 'blur', () => moveUIFocus(app.world, events, manager, next, true));
        events.on(next, 'click', clicked);
        await tab();
        app.world.remove(first, Focusable);
        const input = app.getResource(Input);
        input.keysPressed.add('Enter');
        await app.tick(1 / 60);
        expect(manager.focusedEntity).toBe(next);
        expect(clicked).not.toHaveBeenCalled();
        input.keysPressed.clear();
        input.keysPressed.add('Enter');
        await app.tick(1 / 60);
        expect(clicked).toHaveBeenCalledOnce();
    });
    it('checks inherited inactivity without enumerating other focusables', () => {
        const parent = app.world.spawn(), entity = control(0);
        app.world.insert(entity, Parent, { entity: parent });
        expect(isFocusEligible(app.world, entity)).toBe(true);
        app.world.insert(parent, Disabled);
        expect(inspectFocusTraversal(app.world).entries).toEqual([]);
        expect(isFocusEligible(app.world, entity)).toBe(false);
        app.world.remove(parent, Disabled);
        const queries = vi.spyOn(app.world, 'getEntitiesWithComponents');
        expect(isFocusEligible(app.world, entity)).toBe(true);
        expect(queries.mock.calls.every(([components]) => !components.includes(Focusable))).toBe(true);
        queries.mockRestore();
    });

    it('rejects a control immediately after its ancestor is hidden, before another layout pass', () => {
        const root = app.world.spawn(), entity = control(0);
        app.world.insert(root, Canvas);
        app.world.insert(root, Transform);
        app.world.insert(root, UINode);
        app.world.insert(entity, Transform);
        app.world.insert(entity, UINode);
        app.world.setParent(entity, root);
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        expect(isFocusEligible(app.world, entity)).toBe(true);
        app.world.update(root, UINode, n => { n.display = UIDisplay.None; });
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(false);
        expect(isFocusEligible(app.world, entity)).toBe(false);
        app.world.update(root, UINode, n => { n.display = UIDisplay.Flex; });
        expect(isFocusEligible(app.world, entity)).toBe(true);
    });

    it('applies a newly opened modal before its cached hidden bit is refreshed', () => {
        const root = app.world.spawn(), outside = control(0), dialog = control(1);
        app.world.insert(root, Canvas);
        app.world.insert(root, Transform);
        app.world.insert(root, UINode);
        for (const entity of [outside, dialog]) {
            app.world.insert(entity, Transform);
            app.world.insert(entity, UINode, { display: entity === dialog ? UIDisplay.None : UIDisplay.Flex });
            app.world.setParent(entity, root);
        }
        app.world.insert(dialog, UIDialog);
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        expect(engine.getUINodeHiddenInTree!(registry, dialog)).toBe(true);
        expect(isFocusEligible(app.world, outside)).toBe(true);
        app.world.update(dialog, UINode, n => { n.display = UIDisplay.Flex; });
        expect(engine.getUINodeHiddenInTree!(registry, dialog)).toBe(true);
        expect(isFocusEligible(app.world, outside)).toBe(false);
        expect(isFocusEligible(app.world, dialog)).toBe(true);
        app.world.update(dialog, UINode, n => { n.display = UIDisplay.None; });
        expect(isFocusEligible(app.world, outside)).toBe(true);
    });

    it('reads UI data through the generated pointer accessor after pool growth', () => {
        expect(typeof engine.getUINodePtr).toBe('function');
        const entity = control(0);
        app.world.insert(entity, UINode, { display: UIDisplay.None, opacity: 0.375 });
        const get = app.world.resolveGetter(UINode)!;
        const legacy = vi.spyOn(registry, 'getUINode');
        try {
            expect(get(entity)).toMatchObject({ display: UIDisplay.None, opacity: 0.375 });
            for (let i = 0; i < 5000; i++) app.world.insert(app.world.spawn(), UINode);
            app.world.update(entity, UINode, node => { node.display = UIDisplay.Flex; });
            legacy.mockClear();
            expect(get(entity)).toMatchObject({ display: UIDisplay.Flex, opacity: 0.375 });
            expect(legacy).not.toHaveBeenCalled();
        } finally { legacy.mockRestore(); }
        const absent = app.world.spawn();
        expect(engine.getUINodePtr!(registry, absent)).toBe(0);
    });
});
