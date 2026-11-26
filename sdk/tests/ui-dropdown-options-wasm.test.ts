// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule } from '../src/ecs/system';
import { Canvas, Disabled, Parent, registerComponent } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { Interactable } from '../src/ui/input/interactable';
import { Focusable } from '../src/ui/input/focusable';
import { UINode, UIPointerEvents } from '../src/ui/core/ui-node';
import { spawnUIEntity } from '../src/ui/core/compose';
import { px } from '../src/ui/core/dimension';
import { UIMask, MaskMode } from '../src/ui/core/ui-mask';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiHitAtScreen } from '../src/ui/util/ui-pick';
import { Text, TextAlign, TextOverflow } from '../src/ui/core/text';
import { UIEventQueue } from '../src/ui/core/events';
import { UIDropdown, createDropdownSystem } from '../src/ui/behavior/dropdown';
import { createDropdown } from '../src/ui/widgets/dropdown';
import { UIController } from '../src/ui/controller/ui-controller';
import { UIGear } from '../src/ui/controller/ui-gear';
import { ThemeStyle } from '../src/ui/theme/theme-style';
import { LIGHT_TOKENS, DARK_TOKENS, setTheme } from '../src/ui/theme/tokens';
import { switchTheme } from '../src/ui/behavior/theme-apply';
import { BUILTIN_UI_PREFABS } from '../src/ui/widgets/prefabs/generated';
import { instantiatePrefab } from '../src/prefab';
import { UICollections } from '../src/ui/collection/collection-host';
import { ScrollContainer } from '../src/ui/collection/scroll-container';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('dropdown live options on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); events = new UIEventQueue();
        app.addSystemToSchedule(Schedule.Update, createDropdownSystem(app.world, events));
    });
    afterEach(() => { setTheme(DARK_TOKENS); app.quit({ keepRenderer: true }); registry.delete(); });
    const smallScreen = () => {
        const layout = screenLayoutRect(null, 320, 180, { left: 8, bottom: 8, right: 8, top: 8 });
        const overlay = { ...defaultScreenOverlay(), active: true, projection: screenProjection(layout),
            vpW: 320, vpH: 180, surfaceW: 320, surfaceH: 180 };
        app.insertResource(ScreenLayout, layout);
        app.insertResource(ScreenOverlay, overlay);
        const canvas = spawnUIEntity({ world: app.world, node: { fill: true } });
        app.world.insert(canvas, Canvas);
        const solve = () => {
            engine.uiLayout_update(registry, layout.left, layout.bottom, layout.right, layout.top, true);
            engine.transform_update(registry);
        };
        const hit = (x: number, top: number) => uiHitAtScreen(app.world, UICameraInfo._default, overlay, x, 180 - top);
        return { canvas, solve, hit };
    };
    it('resolves a spawned dropdown against the current world even when roles precede their components', async () => {
        const { world } = app;
        for (const component of [ThemeStyle, Text, UIDropdown, UIGear, UIController, Focusable, Interactable]) {
            registerComponent(component._name, component);
        }
        const saved = structuredClone(BUILTIN_UI_PREFABS.Dropdown!);
        for (const row of saved.entities) {
            if ('components' in row) row.components.sort((a, b) => Number(b.type === 'ThemeStyle') - Number(a.type === 'ThemeStyle'));
        }
        switchTheme(world, LIGHT_TOKENS);
        const existing = createDropdown({ world, events, options: ['First'] });
        const literal = { r: 0.2, g: 0.3, b: 0.4, a: 0.5 };
        world.update(existing.labelEntity, Text, label => { label.color = literal; });
        const { root } = await instantiatePrefab(world, saved);
        const pages = () => world.get(root, UIGear).bindings.find(binding => binding.property === 'color')!.pages;
        const label = world.get(root, UIDropdown).label;
        expect(pages().normal).toEqual(LIGHT_TOKENS.colors.control);
        expect(world.get(label, Text).color).toEqual(LIGHT_TOKENS.colors.text);
        expect(world.get(existing.labelEntity, Text).color).toEqual(literal);
        switchTheme(world, DARK_TOKENS);
        expect(pages().normal).toEqual(DARK_TOKENS.colors.control);
        expect(world.get(label, Text).color).toEqual(DARK_TOKENS.colors.text);
    });

    it('opens above a bottom-edge trigger and lets players pick the last row outside its masked parent', async () => {
        const { world } = app, { canvas, solve, hit } = smallScreen();
        const strip = spawnUIEntity({ world, parent: canvas, node: { position: 1, insetLeft: px(90),
            insetTop: px(140), width: px(120), height: px(24) } });
        world.insert(strip, UIMask, { enabled: true, mode: MaskMode.Scissor });
        const dd = createDropdown({ world, events, parent: strip, options: ['Low', 'Medium', 'High'], optionHeight: 24 });
        solve(); await app.tick(1 / 60);
        expect(hit(150, 152)).toBe(dd.entity);
        dd.open(); await app.tick(1 / 60); solve();
        const rows = world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity);
        expect(rows).toHaveLength(3);
        expect(hit(150, 126)).toBe(rows[2]);
        events.emit(rows[2]!, 'click');
        expect(dd.getSelectedIndex()).toBe(2);
        expect(dd.isOpen()).toBe(false);
        dd.open(); await app.tick(1 / 60); solve();
        world.update(strip, UINode, n => { n.pointerEvents = UIPointerEvents.None; });
        await app.tick(1 / 60); solve();
        expect(dd.isOpen()).toBe(false); expect(hit(150, 126)).toBeNull();
    });
    it('uses the safe area and keeps the current row visible on open, keyboard selection and resize', async () => {
        const { world } = app, { canvas, solve, hit } = smallScreen();
        const attached = new Map<number, ScrollContainer>();
        app.insertResource(UICollections, { registerListView() {}, unregisterListView() {},
            attachScrollContainer: (e, c) => attached.set(e, c), detachScrollContainer: e => { attached.delete(e); } });
        const dd = createDropdown({ world, events, parent: canvas, node: { position: 1, insetLeft: px(227),
            insetTop: px(12), width: px(100), height: px(24) }, optionHeight: 24, selectedIndex: 8,
            options: Array.from({ length: 9 }, (_, i) => 'Quality ' + i) });
        solve(); dd.open(); await app.tick(1 / 60); solve();
        const rows = world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity);
        const [panel, scroll] = [...attached.entries()][0]!;
        expect(scroll.getViewportSize()).toEqual({ x: 100, y: 133 });
        expect(hit(218, 157)).toBe(rows[8]);
        expect(hit(315, 157)).toBeNull();
        expect(world.get(world.getEntitiesWithComponents([Text]).find(e => world.get(e, Text).content === '✓')!, Parent).entity).toBe(rows[8]);
        const label = world.get(dd.labelEntity, Text);
        expect(label.align).toBe(TextAlign.Left); expect(label.overflow).toBe(TextOverflow.Ellipsis);
        // Browsing the list doesn't change the selection or yank the viewport back.
        scroll.setOffset({ x: 0, y: 0 }); await app.tick(1 / 60); solve();
        expect(hit(235, 55)).toBe(rows[0]);
        expect(dd.getSelectedIndex()).toBe(8);
        world.update(dd.entity, Focusable, f => { f.isFocused = true; });
        const input = new InputState(); input.noteKeyDown('ArrowUp'); app.insertResource(Input, input);
        await app.tick(1 / 60); solve(); input.keysPressed.clear();
        expect(dd.getSelectedIndex()).toBe(7);
        expect(hit(235, 157)).toBe(rows[7]);
        const layout = app.getResource(ScreenLayout); layout.safeBottom += 48;
        await app.tick(1 / 60); solve();
        expect(scroll.getViewportSize().y).toBe(85);
        expect(hit(235, 109)).toBe(rows[7]);
        expect(hit(235, 154)).toBeNull();
        dd.dispose();
        expect(world.valid(panel)).toBe(false); expect(attached.size).toBe(0);
        expect(world.getEntitiesWithComponents([Canvas])).toEqual([canvas]);
    });
    it('handles empty options and retires the previous list when another control opens', async () => {
        const { world } = app;
        const empty = createDropdown({ world, events, options: [] as { name: string }[], optionToLabel: o => o.name });
        empty.open();
        expect(world.get(empty.labelEntity, Text).content).toBe('');
        expect(empty.isOpen()).toBe(false);
        const a = createDropdown({ world, events, options: ['A'] });
        const b = createDropdown({ world, events, options: ['B'] });
        a.open();
        const click = events.emit(b.entity, 'click');
        // The enclosing scroll view also hears this dispatch.
        events.emitBubbled(world.spawn(), click);
        expect(a.isOpen()).toBe(false); expect(b.isOpen()).toBe(true);
        world.update(b.entity, UIDropdown, d => { d.options = []; }); await app.tick(1 / 60);
        expect(b.isOpen()).toBe(false);
    });
    it('renaming the selected option repaints the label without changing selection', async () => {
        const changed = vi.fn(), dd = createDropdown({ world: app.world, events, options: ['old'], onSelect: changed });
        await app.tick(1 / 60);
        app.world.update(dd.entity, UIDropdown, d => { d.options[0] = 'new'; }); await app.tick(1 / 60);
        expect(app.world.get(dd.labelEntity, Text).content).toBe('new');
        expect(changed).not.toHaveBeenCalled();
    });
    it('an open popup rebuilds changed rows and clamps a removed selection', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['old-a','old-b'], selectedIndex: 1 });
        await app.tick(1 / 60); dd.open();
        app.world.update(dd.entity, UIDropdown, d => { d.options = ['new-a']; }); await app.tick(1 / 60);
        expect(dd.getSelectedIndex()).toBe(0);
        expect(app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content)).not.toContain('old-b');
        expect(dd.isOpen()).toBe(true);
    });
    it('replacement label receives the current option immediately', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['current'] }); await app.tick(1 / 60);
        const label = app.world.spawn(); app.world.insert(label, Text);
        app.world.update(dd.entity, UIDropdown, d => { d.label = label; }); await app.tick(1 / 60);
        expect(app.world.get(label, Text).content).toBe('current');
    });
    it('change callbacks may dispose a later dropdown without a system error', async () => {
        let later: ReturnType<typeof createDropdown>;
        const error = vi.fn(); app.onError(error);
        const first = createDropdown({ world: app.world, events, options: ['a','b'], onSelect: () => later.dispose() });
        later = createDropdown({ world: app.world, events, options: ['a','b'] }); await app.tick(1 / 60);
        first.setSelectedIndex(1); later.setSelectedIndex(1); await app.tick(1 / 60);
        expect(error).not.toHaveBeenCalled(); expect(app.world.valid(later.entity)).toBe(false);
    });
    it('a stale popup row cannot select an option changed before the next update', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const rows = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity);
        expect(rows).toHaveLength(2);
        app.world.update(dd.entity, UIDropdown, d => { d.options = ['a','replacement']; });
        events.emit(rows[1]!, 'click');
        expect(dd.getSelectedIndex()).toBe(0);
        expect(dd.isOpen()).toBe(false);
    });
    it('closing a row cannot resurrect an owner disposed by popup teardown', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const row = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity)[1]!;
        const panel = app.world.get(row, Parent).entity;
        const off = app.world.onDespawn(e => { if (e === panel) app.world.despawn(dd.entity); });
        try { events.emit(row, 'click'); } finally { off(); }
        expect(app.world.valid(dd.entity)).toBe(false);
        expect(app.world.has(dd.entity, UIDropdown)).toBe(false);
    });
    it('closed dropdowns do not rewrite stable labels', async () => {
        createDropdown({ world: app.world, events, options: ['a','b'] }); await app.tick(1 / 60);
        const write = vi.spyOn(app.world, 'insert');
        for (let i = 0; i < 100; i++) await app.tick(1 / 60);
        expect(write).not.toHaveBeenCalled();
    });
    it.each(['disabled', 'inactive', 'hidden', 'removed'])('%s owners retire open popups and ignore keyboard input', async kind => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        app.world.update(dd.entity, Focusable, d => { d.isFocused = true; });
        if (kind === 'disabled') app.world.update(dd.entity, Interactable, d => { d.enabled = false; });
        if (kind === 'inactive') app.world.insert(dd.entity, Disabled);
        if (kind === 'removed') app.world.remove(dd.entity, UIDropdown);
        if (kind === 'hidden') {
            app.world.insert(dd.entity, Canvas);
            app.world.update(dd.entity, UINode, n => { n.display = 1; });
            engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        }
        const input = new InputState(); input.noteKeyDown('ArrowDown'); app.insertResource(Input, input);
        await app.tick(1 / 60);
        expect(dd.isOpen()).toBe(false);
        if (kind !== 'removed') expect(dd.getSelectedIndex()).toBe(0);
    });
    it('a disabled owner cannot accept a row click before the next frame', async () => {
        const dd = createDropdown({ world: app.world, events, options: ['a','b'] });
        await app.tick(1 / 60); dd.open();
        const row = app.world.getEntitiesWithComponents([UIController]).filter(e => e !== dd.entity)[1]!;
        app.world.update(dd.entity, Interactable, d => { d.enabled = false; });
        events.emit(row, 'click');
        expect(dd.getSelectedIndex()).toBe(0);
        expect(dd.isOpen()).toBe(false);
    });
});
