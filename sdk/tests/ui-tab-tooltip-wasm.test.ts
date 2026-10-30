// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Disabled, Name, Parent, Transform, registerComponent } from '../src/ecs/component';
import { Schedule } from '../src/ecs/system';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState } from '../src/input/input';
import { UIEventQueue, UIEvents } from '../src/ui/core/events';
import { UITabView, createTabViewSystem } from '../src/ui/behavior/tab-view';
import { UIToggle, UIToggleGroup, createToggleSystem } from '../src/ui/behavior/toggle';
import { UITooltip, createTooltipSystem, placeTooltip } from '../src/ui/behavior/tooltip';
import { createTabView } from '../src/ui/widgets/tab-view';
import { createTooltip } from '../src/ui/widgets/tooltip';
import { spawnUIEntity } from '../src/ui/core/compose';
import { px } from '../src/ui/core/dimension';
import { UINode, UIDisplay, UIPointerEvents } from '../src/ui/core/ui-node';
import { Text } from '../src/ui/core/text';
import { UIVisual } from '../src/ui/core/ui-visual';
import { FocusManager, FocusManagerState, Focusable } from '../src/ui/input/focusable';
import { UIControlPointers, type ControlPointer } from '../src/ui/input/control-pointers';
import { MOUSE_POINTER } from '../src/ui/input/pointerBook';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { UIInteractionPlugin } from '../src/ui/input/interaction';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { cancelPrimaryPointer } from '../src/input/pointerCancellation';
import { ThemeStyle } from '../src/ui/theme/theme-style';
import { UIController } from '../src/ui/controller/ui-controller';
import { UIGear } from '../src/ui/controller/ui-gear';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { widgetToPrefab } from '../src/ui/widgets/toPrefab';
import { instantiatePrefab } from '../src/prefab';
import type { InstantiatePrefabResult } from '../src/prefab';

describe('tooltip placement', () => {
    const screen = { left: 0, right: 320, bottom: 0, top: 240 };
    it.each([0, 1, 2, 3])('keeps side %s inside the screen at all four corners', side => {
        for (const x of [0, 310]) for (const y of [0, 230]) {
            const p = placeTooltip({ left: x, right: x + 10, bottom: y, top: y + 10 }, 100, 40, side, 8, screen, true);
            expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + 100).toBeLessThanOrEqual(320);
            expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y + 40).toBeLessThanOrEqual(240);
        }
    });
    it('flips to the opposite side before clamping', () => {
        expect(placeTooltip({ left: 100, right: 120, bottom: 2, top: 12 }, 100, 40, 0, 8, screen, true).y).toBe(20);
    });
});

describe.skipIf(!HAS_WASM)('TabView and Tooltip on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    let tooltips: ReturnType<typeof createTooltipSystem>;
    let interaction: UIInteractionPlugin | undefined;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        events = new UIEventQueue();
        app.insertResource(UIEvents, events);
        for (const c of [UITabView, UIToggle, UIToggleGroup, Focusable, ThemeStyle, UIController, UIGear, Text, Name]) registerComponent(c._name, c);
        app.insertResource(Input, new InputState()); app.insertResource(FocusManager, new FocusManagerState());
        const layout = screenLayoutRect(null, 800, 600);
        app.insertResource(ScreenLayout, layout);
        app.insertResource(ScreenOverlay, { ...defaultScreenOverlay(), active: true, projection: screenProjection(layout), vpW: 800, vpH: 600, surfaceW: 800, surfaceH: 600 });
        app.insertResource(UICameraInfo, structuredClone(UICameraInfo._default));
        app.insertResource(UIControlPointers, { pointers: new Map(), cancelHold: () => {} });
        app.addSystemToSchedule(Schedule.Update, createTabViewSystem(app.world, events));
        app.addSystemToSchedule(Schedule.Update, createToggleSystem(app.world, events));
        tooltips = createTooltipSystem(app.world);
        app.addSystemToSchedule(Schedule.Update, tooltips.system);
    });
    afterEach(() => { interaction?.cleanup(app); interaction = undefined; tooltips.dispose(); app.quit({ keepRenderer: true }); registry.delete(); });
    const tick = async (delta = 0.1) => {
        engine.uiLayout_update(registry, -400, -300, 400, 300, true); engine.transform_update(registry);
        await app.tick(delta);
        app.getResource(Input).keysPressed.clear();
        for (const p of app.getResource(UIControlPointers).pointers.values()) p.pressedEntity = null;
    };
    const view = () => createTabView({ world: app.world, events, labels: ['Graphics', 'Audio', 'Controls'] });
    const displays = (v: ReturnType<typeof view>) => v.pages.map(e => app.world.get(e, UINode).display);
    const target = () => {
        const root = spawnUIEntity({ world: app.world, node: { width: px(800), height: px(600) } });
        app.world.insert(root, Canvas);
        return createTooltip({ world: app.world, parent: root, content: 'Volume controls the music.' }).entity;
    };
    const pointer = (entity: number, id = MOUSE_POINTER, down = false) => {
        app.world.insert(entity, UIInteraction, { hovered: true, pressed: down, justPressed: down });
        const p: ControlPointer = { id, down, pressed: down, entity: down ? entity : null, pressedEntity: down ? entity : null,
            layoutX: 0, layoutY: 0, worldX: 0, worldY: 0, screenX: 0, screenY: 0 };
        app.getResource(UIControlPointers).pointers.set(id, p); return p;
    };
    const bubbles = () => app.world.getEntitiesWithComponents([Text]).filter(e => app.world.get(e, Text).content === 'Volume controls the music.');
    const realPointerTarget = () => {
        interaction = new UIInteractionPlugin(); interaction.build(app);
        const e = target();
        engine.uiLayout_update(registry, -400, -300, 400, 300, true); engine.transform_update(registry);
        const at = app.world.get(e, Transform).worldPosition;
        return { e, x: at.x + 400, y: 300 - at.y };
    };
    it('real hit testing supplies hover after the capture has been released', async () => {
        const { e, x, y } = realPointerTarget(), input = app.getResource(Input);
        input.mouseX = x; input.mouseY = y;
        await tick(0.2); await tick(0.2); await tick(0.2);
        expect(app.world.get(e, UIInteraction).hovered).toBe(true);
        expect(app.getResource(UIControlPointers).pointers.get(MOUSE_POINTER)?.entity).toBeNull();
        expect(bubbles()).toHaveLength(1);
        await tick();
        const label = bubbles()[0], panel = app.world.get(label, Parent).entity, canvas = app.world.get(panel, Parent).entity;
        for (const entity of [canvas, panel, label]) {
            expect(engine.getUINodeComputedWidth!(registry, entity)).toBeGreaterThan(0);
            expect(engine.getUINodeComputedHeight!(registry, entity)).toBeGreaterThan(0);
        }
    });
    it('real touch capture persists after the one-frame pressedEntity edge', async () => {
        const { e, x, y } = realPointerTarget(), input = app.getResource(Input);
        const point = { id: 7, x, y }; input.touches.set(7, point); input.touchesStarted.set(7, point);
        await tick(0.3); input.touchesStarted.clear(); await tick(0.3);
        const p = app.getResource(UIControlPointers).pointers.get(7)!;
        expect(p.entity).toBe(e); expect(p.pressedEntity).toBeNull(); expect(bubbles()).toHaveLength(1);
    });
    it('a lifted touch cannot reopen a hint through its stale synthesized mouse', async () => {
        const { x, y } = realPointerTarget(), input = app.getResource(Input);
        input.mouseX = x; input.mouseY = y;
        const point = { id: 7, x, y }; input.touches.set(7, point); input.touchesStarted.set(7, point);
        await tick(0.3); input.touchesStarted.clear(); await tick(0.3); expect(bubbles()).toHaveLength(1);
        input.touches.delete(7); input.touchesEnded.set(7, point); await tick(); input.touchesEnded.clear();
        for (let i = 0; i < 7; i++) await tick(); expect(bubbles()).toHaveLength(0);
        input.mouseX += 1; for (let i = 0; i < 6; i++) await tick(); expect(bubbles()).toHaveLength(1);
    });
    it('click and programmatic selection keep ToggleGroup and page visibility in agreement', async () => {
        const v = view(); await tick(); events.emit(v.tabs[1], 'click'); await tick();
        expect(displays(v)).toEqual([1, 0, 1]); expect(app.world.get(v.entity, UITabView).selectedIndex).toBe(1);
        v.select(2); await tick(); expect(displays(v)).toEqual([1, 1, 0]);
        expect(v.tabs.map(e => app.world.get(e, UIToggle).isOn)).toEqual([false, false, true]);
    });
    it('supports all-off and does not switch a mandatory group off', async () => {
        const v = view(); await tick(); events.emit(v.tabs[0], 'click'); await tick(); expect(displays(v)).toEqual([0, 1, 1]);
        app.world.update(v.entity, UITabView, d => { d.allowSwitchOff = true; }); await tick();
        events.emit(v.tabs[0], 'click'); await tick(); expect(displays(v)).toEqual([1, 1, 1]);
        expect(app.world.get(v.entity, UITabView).selectedIndex).toBe(-1);
    });
    it('arrows, Home and End skip disabled tabs and preserve manual activation', async () => {
        const v = view(); await tick(); app.world.insert(v.tabs[1], Interactable, { enabled: false });
        const focus = app.getResource(FocusManager); focus.focus(v.tabs[0], true);
        app.getResource(Input).keysPressed.add('ArrowRight'); await tick();
        expect(focus.focusedEntity).toBe(v.tabs[2]); expect(displays(v)).toEqual([1, 1, 0]);
        app.getResource(Input).keysPressed.add('Home'); await tick(); expect(focus.focusedEntity).toBe(v.tabs[0]);
        app.world.update(v.entity, UITabView, d => { d.selectOnFocus = false; });
        app.getResource(Input).keysPressed.add('End'); await tick(); expect(focus.focusedEntity).toBe(v.tabs[2]); expect(displays(v)).toEqual([0, 1, 1]);
        events.emit(v.tabs[2], 'click'); await tick(); expect(displays(v)).toEqual([1, 1, 0]);
    });
    it('vertical navigation can stop at the edge without consuming horizontal navigation', async () => {
        const v = view(); app.world.update(v.entity, UITabView, d => { d.vertical = true; d.loopNavigation = false; }); await tick();
        const focus = app.getResource(FocusManager); focus.focus(v.tabs[0], true);
        app.getResource(Input).keysPressed.add('ArrowRight'); await tick(); expect(focus.focusedEntity).toBe(v.tabs[0]);
        app.getResource(Input).keysPressed.add('ArrowUp'); await tick(); expect(focus.focusedEntity).toBe(v.tabs[0]);
        app.getResource(Input).keysPressed.add('ArrowDown'); await tick(); expect(focus.focusedEntity).toBe(v.tabs[1]);
    });
    it('a resting keyboard focus does not override later programmatic selection', async () => {
        const v = view(); await tick(); app.getResource(FocusManager).focus(v.tabs[0], true); await tick();
        v.select(2); await tick(); await tick(); expect(displays(v)).toEqual([1, 1, 0]);
        expect(app.getResource(FocusManager).focusedEntity).toBe(v.tabs[0]);
    });
    it('rejects foreign references and recovers after an active page is deleted', async () => {
        const v = view(), foreign = spawnUIEntity({ world: app.world }); await tick();
        app.world.update(v.entity, UITabView, d => { d.pages[0] = foreign; }); await tick();
        expect(app.world.get(foreign, UINode).display).toBe(0);
        expect(app.world.get(v.entity, UITabView).selectedIndex).toBe(1);
        app.world.despawn(v.pages[1]); await tick(); expect(app.world.get(v.entity, UITabView).selectedIndex).toBe(2);
    });
    it('prefab copies remap both entity lists independently', async () => {
        registerComponent('UITabView', UITabView); registerComponent('UIToggle', UIToggle);
        const prefab = widgetToPrefab(world => createTabView({ world, events, labels: ['A', 'B'] }).entity, 'Tabs');
        const first = await instantiatePrefab(app.world, prefab), second = await instantiatePrefab(app.world, prefab);
        await tick(); const a = app.world.get(first.root, UITabView), b = app.world.get(second.root, UITabView);
        expect(new Set([...a.tabs, ...b.tabs]).size).toBe(4);
        events.emit(b.tabs[1], 'click'); await tick();
        expect(app.world.get(a.pages[0], UINode).display).toBe(0); expect(app.world.get(b.pages[0], UINode).display).toBe(1);
    });
    it('hover waits, does not intercept input and retires immediately on leave', async () => {
        const e = target(); const p = pointer(e); await tick(0.2); await tick(0.2); expect(bubbles()).toHaveLength(0);
        await tick(0.2); expect(bubbles()).toHaveLength(1);
        const canvas = app.world.getEntitiesWithComponents([Canvas]).at(-1)!;
        expect(app.world.get(canvas, UINode).pointerEvents).toBe(UIPointerEvents.None);
        expect(app.world.has(bubbles()[0], Focusable)).toBe(false); expect(app.world.has(bubbles()[0], Interactable)).toBe(false);
        p.entity = null; app.world.update(e, UIInteraction, d => { d.hovered = false; }); await tick(); expect(bubbles()).toHaveLength(0);
    });
    it('keyboard focus shows immediately and hides when a page closes', async () => {
        const e = target(); app.getResource(FocusManager).focus(e, true); await tick(); expect(bubbles()).toHaveLength(1);
        app.world.update(e, UINode, d => { d.display = UIDisplay.None; }); await tick(); expect(bubbles()).toHaveLength(0);
    });
    it.each(['drag', 'cancel', 'release'] as const)('touch %s cancels long press without modifying the captured gesture', async kind => {
        const e = target(), p = pointer(e, 7, true); await tick(0.3); expect(bubbles()).toHaveLength(0);
        if (kind === 'drag') p.layoutX = 20;
        if (kind === 'cancel') cancelPrimaryPointer(app.getResource(Input));
        if (kind === 'release') p.down = false;
        await tick(0.3); await tick(0.3); expect(bubbles()).toHaveLength(0);
        expect(p.entity).toBe(e);
    });
    it('stationary long press uses its delay and releases its popup on lift', async () => {
        const e = target(), p = pointer(e, 7, true); await tick(0.3); await tick(0.3); expect(bubbles()).toHaveLength(1);
        p.down = false; await tick(); expect(bubbles()).toHaveLength(0);
    });
    it.each(['disabled', 'removed', 'despawned'] as const)('%s targets remove popup subtrees', async kind => {
        const e = target(); pointer(e); app.world.update(e, UITooltip, d => { d.hoverDelay = 0; }); await tick(); expect(bubbles()).toHaveLength(1);
        if (kind === 'disabled') app.world.insert(e, Disabled);
        if (kind === 'removed') app.world.remove(e, UITooltip);
        if (kind === 'despawned') app.world.despawn(e);
        await tick(); expect(bubbles()).toHaveLength(0);
    });
    it('stable popups and tab views avoid rewriting unchanged geometry', async () => {
        const e = target(); pointer(e); app.world.update(e, UITooltip, d => { d.hoverDelay = 0; }); view();
        await tick(); await tick(); const insert = vi.spyOn(app.world, 'insert'); await tick();
        expect(insert.mock.calls.filter(([, c]) => c === UINode || c === Text || c === UIVisual)).toHaveLength(0);
    });
    it('late style loads cannot resurrect a tooltip after its target is hidden', async () => {
        tooltips.dispose();
        let finish: (v: InstantiatePrefabResult) => void = () => {};
        const loading = new Promise<InstantiatePrefabResult>(resolve => { finish = resolve; });
        tooltips = createTooltipSystem(app.world, { instantiate: () => loading });
        app.addSystemToSchedule(Schedule.Update, { ...tooltips.system, _name: 'LateStyleTooltipSystem' });
        const e = target(); pointer(e); app.world.update(e, UITooltip, d => { d.hoverDelay = 0; d.stylePrefab = 'Tip.esprefab'; });
        await tick(); app.world.update(e, UINode, d => { d.display = UIDisplay.None; }); await tick();
        const late = spawnUIEntity({ world: app.world, text: { content: 'late' } });
        finish({ root: late, entities: new Map([[0, late]]) }); await Promise.resolve(); await Promise.resolve();
        expect(app.world.valid(late)).toBe(false); expect(bubbles()).toHaveLength(0);
    });
    it('unbinding a page restores its original display instead of leaving it hidden', async () => {
        const v = view(); await tick(); v.select(1); await tick(); expect(displays(v)[0]).toBe(1);
        app.world.update(v.entity, UITabView, d => { d.tabs = d.tabs.slice(1); d.pages = d.pages.slice(1); }); await tick();
        expect(app.world.get(v.pages[0], UINode).display).toBe(0);
    });
});
