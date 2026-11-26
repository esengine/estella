// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Parent, Transform } from '../src/ecs/component';
import { defineSystem } from '../src/ecs/system';
import { Input, InputState } from '../src/input/input';
import { spawnUIEntity } from '../src/ui/core/compose';
import { UIEvents } from '../src/ui/core/events';
import { Text } from '../src/ui/core/text';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiHitAtScreen } from '../src/ui/util/ui-pick';
import { px } from '../src/ui/core/dimension';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { UIInteractionPlugin } from '../src/ui/input/interaction';
import { UIBehaviorPlugin } from '../src/ui/behavior/plugin';
import { FocusPlugin } from '../src/ui/input/focus';
import { FocusManager } from '../src/ui/input/focusable';
import { UIInteraction } from '../src/ui/input/interactable';
import { moveUIFocus } from '../src/ui/input/focus-transition';
import { createDialog } from '../src/ui/widgets/dialog';
import { createDropdown } from '../src/ui/widgets/dropdown';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('modal dismissal on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, input: InputState, canvas: Entity;
    const interaction = new UIInteractionPlugin(), behavior = new UIBehaviorPlugin(), keyboard = new FocusPlugin();
    const layout = screenLayoutRect(null, 640, 360);
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        input = new InputState(); app.insertResource(Input, input);
        app.insertResource(ScreenLayout, layout);
        app.insertResource(ScreenOverlay, { ...defaultScreenOverlay(), active: true, projection: screenProjection(layout),
            vpW: 640, vpH: 360, surfaceW: 640, surfaceH: 360 });
        interaction.build(app); behavior.build(app); keyboard.build(app);
        canvas = spawnUIEntity({ world: app.world, node: { fill: true } }); app.world.insert(canvas, Canvas);
    });
    afterEach(() => { keyboard.cleanup(app); behavior.cleanup(app); interaction.cleanup(app); app.quit({ keepRenderer: true }); registry.delete(); });
    async function tick() {
        engine.uiLayout_update(registry, -320, -180, 320, 180, true);
        engine.transform_update(registry); engine.uiRenderOrder_update?.(registry);
        await app.tick(1 / 60); input.clearFrameState();
    }
    async function key(code: string) {
        input.noteKeyDown(code); await tick(); input.noteKeyUp(code); await tick();
    }
    function pressBackdropEachFrame(entity: Entity): void {
        app.addSystem(defineSystem([], () => {
            app.world.update(entity, UIInteraction, state => { state.justPressed = true; });
        }, { name: 'SyntheticBackdropPress', runBefore: ['UIDialogSystem'] }));
    }
    const dialog = (parent: Entity, closeOnEscape = true) => createDialog({ world: app.world, events: app.getResource(UIEvents),
        parent, startHidden: false, closeOnEscape });
    const dropdown = (parent: Entity) => createDropdown({ world: app.world, events: app.getResource(UIEvents),
        parent, node: { position: 1, insetLeft: px(40), insetTop: px(80), width: px(150), height: px(32) },
        options: ['Low', 'Medium', 'High'] });
    function focus(owner: Entity) { moveUIFocus(app.world, app.getResource(UIEvents), app.getResource(FocusManager), owner, true); }
    const focused = () => app.getResource(FocusManager).focusedEntity;
    function rowWith(label: string): Entity {
        const text = app.world.getEntitiesWithComponents([Text]).find(e => app.world.get(e, Text).content === label)!;
        return app.world.get(text, Parent).entity;
    }
    const hit = (x: number, y: number) => uiHitAtScreen(app.world, app.getResource(UICameraInfo),
        app.getResource(ScreenOverlay), x, 360 - y);
    async function tap(x: number, y: number) {
        input.mouseX = x; input.mouseY = y; input.noteMouseDown(0); input.noteMouseUp(0); await tick();
    }

    it('one Escape dismisses the list, the next the inner dialog, and the third the outer dialog', async () => {
        const outer = dialog(canvas), inner = dialog(outer.panelEntity), dd = dropdown(inner.panelEntity);
        await tick(); focus(dd.entity); await key('Enter'); expect(dd.isOpen()).toBe(true);
        await key('Escape');
        expect([dd.isOpen(), inner.isOpen(), outer.isOpen()]).toEqual([false, true, true]);
        expect(app.getResource(FocusManager).focusedEntity).toBe(dd.entity);
        await key('Escape'); expect([inner.isOpen(), outer.isOpen()]).toEqual([false, true]);
        await key('Escape'); expect(outer.isOpen()).toBe(false);
    });
    it('a non-dismissible inner dialog shields its parent from Escape', async () => {
        const outer = dialog(canvas), inner = dialog(outer.panelEntity, false), dd = dropdown(inner.panelEntity);
        await tick(); focus(dd.entity); await key('Escape');
        expect([inner.isOpen(), outer.isOpen()]).toEqual([true, true]);
        expect(app.getResource(FocusManager).focusedEntity).toBe(dd.entity);
    });

    it('dismisses a list opened from code even before a control has focus', async () => {
        const outer = dialog(canvas), dd = dropdown(outer.panelEntity);
        await tick(); dd.open();
        expect(focused()).toBeNull(); await key('Escape');
        expect([dd.isOpen(), outer.isOpen(), dd.getSelectedIndex()]).toEqual([false, true, 0]);
    });

    it('keeps focus on the trigger after tapping a detached option and closes the list on Tab', async () => {
        const outer = dialog(canvas), dd = dropdown(outer.panelEntity), next = dropdown(outer.panelEntity);
        await tick(); focus(dd.entity); dd.open(); await tick(); await tick();
        const row = rowWith('Medium'), pos = app.world.get(row, Transform).worldPosition;
        const x = 320 + pos.x, y = 180 - pos.y;
        expect(hit(x, y)).toBe(row);
        await tap(x, y);
        expect([dd.getSelectedIndex(), dd.isOpen(), outer.isOpen(), focused()]).toEqual([1, false, true, dd.entity]);
        await key('ArrowDown'); expect(dd.getSelectedIndex()).toBe(2);
        await key('Enter'); expect(dd.isOpen()).toBe(true);
        await key('Tab');
        expect([dd.isOpen(), focused(), outer.isOpen()]).toEqual([false, next.entity, true]);
    });

    it('uses the list that was open at the start of a quick scrim tap', async () => {
        const outer = dialog(canvas), dd = dropdown(outer.panelEntity);
        await tick(); focus(dd.entity); dd.open(); await tick(); await tick();
        expect(hit(12, 12)).toBe(outer.entity);
        await tap(12, 12);
        expect([dd.isOpen(), outer.isOpen(), focused()]).toEqual([false, true, dd.entity]);
        await tap(12, 12); expect(outer.isOpen()).toBe(false);
    });

    it('accepts a synthetic backdrop press with no captured pointer', async () => {
        const outer = dialog(canvas), dd = dropdown(outer.panelEntity);
        await tick(); dd.open();
        pressBackdropEachFrame(outer.entity);
        await tick();
        expect([dd.isOpen(), outer.isOpen()]).toEqual([false, true]);
        await tick(); expect(outer.isOpen()).toBe(false);
    });

    it('rejects an old floating row immediately when a child dialog opens', async () => {
        const outer = dialog(canvas), dd = dropdown(outer.panelEntity), inner = dialog(outer.panelEntity);
        inner.close(); await tick(); dd.open(); await tick(); await tick();
        const row = rowWith('High');
        app.world.update(inner.entity, UINode, n => { n.display = UIDisplay.Flex; });
        app.getResource(UIEvents).emit(row, 'click');
        expect(dd.getSelectedIndex()).toBe(0);
        dd.open(); expect(dd.isOpen()).toBe(false);
        await tick(); expect([inner.isOpen(), outer.isOpen()]).toEqual([true, true]);
        inner.close(); dd.open(); expect(dd.isOpen()).toBe(true);
        inner.open(); expect(dd.isOpen()).toBe(false);
    });

    it('prefers the focused dialog among independent branches, then the last drawn visible dialog', async () => {
        const first = dialog(canvas), dd = dropdown(first.panelEntity), second = dialog(canvas);
        const hidden = spawnUIEntity({ world: app.world, parent: canvas });
        const behind = dialog(hidden);
        app.world.update(hidden, UINode, n => { n.display = UIDisplay.None; });
        await tick(); focus(dd.entity); await key('Escape');
        expect([first.isOpen(), second.isOpen(), behind.isOpen()]).toEqual([false, true, true]);
        first.open(); await tick(); expect(focused()).toBeNull();
        await key('Escape');
        expect([first.isOpen(), second.isOpen(), behind.isOpen()]).toEqual([true, false, true]);
    });

    it('a dialog opened by a synchronous close listener survives the same Escape', async () => {
        const outer = dialog(canvas), inner = dialog(outer.panelEntity), next = dialog(canvas);
        next.close(); await tick();
        app.getResource(UIEvents).on(inner.entity, 'change', () => next.open());
        await key('Escape');
        expect([outer.isOpen(), inner.isOpen(), next.isOpen()]).toEqual([true, false, true]);
    });

    it('can remove another dialog from a backdrop close callback', async () => {
        const first = dialog(canvas), second = dialog(canvas);
        await tick();
        const events = app.getResource(UIEvents);
        events.on(first.entity, 'change', () => second.dispose());
        pressBackdropEachFrame(first.entity);
        await tick();
        expect(first.isOpen()).toBe(false);
        expect(app.world.valid(second.entity)).toBe(false);
    });
});
