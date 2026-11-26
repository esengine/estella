// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import type { TextEditorEvent } from '../src/platform/types';
import type { TextInputFilter } from '../src/ui/text/text-input';
import { bootMockApp } from './helpers/mockApp';
import { log } from '../src/util/logger';
import { EditorHiddenEntities } from '../src/camera/EditorView';

const measurements = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn> }>);
const dimensions = vi.hoisted(() => ({ width: vi.fn(() => 0), height: vi.fn(() => 0) }));
vi.mock('../src/ui/util/helpers', async original => ({
    ...await original<typeof import('../src/ui/util/helpers')>(),
    getUINodeWidth: dimensions.width,
    getUINodeHeight: dimensions.height,
}));
vi.mock('../src/ui/text/text-renderer', () => ({
    SdfTextRenderer: class {
        atlas = { renderSize: 64, pixelSizeFor: () => 64, getGlyph: () => ({ advance: 16 }) };
        dispose = vi.fn();
        constructor() { measurements.push(this); }
    },
}));

const surfaces: ReturnType<typeof createSurface>[] = [];
let surfaceAvailable = true;
function createSurface() {
    const listeners = new Set<(event: TextEditorEvent) => void>();
    return {
        listeners,
        focus: vi.fn(), blur: vi.fn(), write: vi.fn(),
        read: () => ({ value: 'typed', selectionStart: 5, selectionEnd: 5, backward: false }),
        subscribe: (listener: (event: TextEditorEvent) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispose: vi.fn(),
    };
}
vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateTextEditor: () => {
        if (!surfaceAvailable) return null;
        const surface = createSurface();
        surfaces.push(surface);
        return surface;
    },
}));
const { App } = await import('../src/app/app');
const { TextInputPlugin } = await import('../src/ui/text/text-input-plugin');
const { FocusManager, FocusManagerState } = await import('../src/ui/input/focusable');
const { UIEvents, UIEventQueue } = await import('../src/ui/core/events');
const { TextInput } = await import('../src/ui/text/text-input');
const { Text, TextAlign } = await import('../src/ui/core/text');
const { ContentRect } = await import('../src/ui/core/content-rect');
const { UIVisual, UIVisualType } = await import('../src/ui/core/ui-visual');
const { UIMask, MaskMode } = await import('../src/ui/core/ui-mask');
const { Children } = await import('../src/ecs/component');
const { defineSystem, Schedule } = await import('../src/ecs/system');
const { Disabled, Transform } = await import('../src/ecs/component');
const { UINode } = await import('../src/ui/core/ui-node');
const { Interactable } = await import('../src/ui/input/interactable');
const { setEditorMode, setPlayMode } = await import('../src/ecs/env');
const { TextPlugin } = await import('../src/ui/text/plugin');
const { LocalizationPlugin } = await import('../src/i18n/LocalizationPlugin');
const apps: ReturnType<typeof App.new>[] = [];
function build(plugin: InstanceType<typeof TextInputPlugin>, editMode = false) {
    const app = bootMockApp().app;
    setEditorMode(editMode);
    apps.push(app);
    app.addPlugin({ name: 'focus', build(app) {
        app.insertResource(FocusManager, new FocusManagerState());
        app.insertResource(UIEvents, new UIEventQueue());
    } }).addPlugin(plugin);
    return app;
}
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    surfaces.length = 0;
    surfaceAvailable = true;
    setEditorMode(false);
    setPlayMode(false);
    measurements.length = 0;
    dimensions.width.mockReturnValue(0);
    dimensions.height.mockReturnValue(0);
    vi.restoreAllMocks();
});

it.each(['editor', 'runtime without an editing surface'])('draws field values and hints in the %s', async realm => {
    const editMode = realm === 'editor';
    surfaceAvailable = editMode;
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin(), editMode);
    app.addPlugin(new TextPlugin());
    if (!editMode) app.addPlugin(new LocalizationPlugin({ catalogs: { en: { hint: 'Translated hint', title: 'Label' } } }));
    app.setPaused(editMode);
    const field = app.world.spawn();
    app.world.insert(field, Transform, {});
    app.world.insert(field, UINode, {});
    app.world.insert(field, Text, { content: 'Caption', i18nKey: 'title' });
    app.world.insert(field, TextInput, { placeholder: 'Authored hint', placeholderI18nKey: 'hint' });
    await app.tick(1 / 60);
    const labels = app.world.getEntitiesWithComponents([Text]).filter(e => e !== field);
    expect(labels).toHaveLength(1);
    const child = labels[0]!;
    expect(app.world.get(field, Children).entities).toEqual([child]);
    expect(app.world.get(child, Text).content).toBe(editMode ? 'Authored hint' : 'Translated hint');
    expect(app.world.get(field, Text).content).toBe(editMode ? 'Caption' : 'Label');
    expect(app.world.get(field, TextInput).placeholder).toBe('Authored hint');
    expect(surfaces).toHaveLength(0);
    expect(app.world.has(field, Interactable)).toBe(false);
    app.world.update(field, TextInput, ti => { ti.placeholderI18nKey = ''; ti.placeholder = 'New literal'; });
    await app.tick(1 / 60);
    expect(app.world.get(child, Text).content).toBe('New literal');
    app.world.update(field, TextInput, ti => { ti.password = true; ti.value = 'abc'; });
    await app.tick(1 / 60);
    expect(app.world.get(child, Text).content).toBe('●●●');
    const insert = vi.spyOn(app.world, 'insert');
    await app.tick(1 / 60);
    expect(insert.mock.calls.filter(([e, component]) => e === child && component === Text)).toHaveLength(0);
    app.world.remove(field, UINode);
    app.world.insert(field, ContentRect, { size: { x: 100, y: 30 }, pivot: { x: 0.5, y: 0.5 } });
    await app.tick(1 / 60);
    const [worldText] = app.world.get(field, Children).entities;
    expect(app.world.has(worldText, ContentRect)).toBe(true);
    expect(app.world.get(worldText, Text).content).toBe('●●●');
    app.world.remove(field, ContentRect);
    await app.tick(1 / 60);
    expect(app.world.valid(worldText)).toBe(false);
    app.world.remove(field, TextInput);
    await app.tick(1 / 60);
    expect(app.world.valid(child)).toBe(false);
    expect(app.world.valid(field)).toBe(true);
});

it.each(['UI', 'world'] as const)('hides generated %s field visuals in Edit and draws the current value when shown or played', async domain => {
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin(), true), world = app.world;
    const field = world.spawn();
    world.insert(field, Transform, {});
    if (domain === 'UI') world.insert(field, UINode, {});
    else world.insert(field, ContentRect, { size: { x: 160, y: 40 } });
    world.insert(field, TextInput, { value: 'before' });
    const hidden = new Set([field]);
    app.insertResource(EditorHiddenEntities, hidden);
    const glyphs = () => world.getEntitiesWithComponents([Text]).map(e => world.get(e, Text).content);
    await app.tick(1 / 60);
    expect(glyphs()).toEqual([]);
    expect(world.has(field, UIVisual)).toBe(false);
    expect(world.has(field, UIMask)).toBe(false);
    expect(measurements).toHaveLength(0);
    hidden.delete(field);
    await app.tick(1 / 60);
    expect(glyphs()).toEqual(['before']);
    expect(world.has(field, UIVisual)).toBe(domain === 'UI');
    expect(world.has(field, UIMask)).toBe(true);
    hidden.add(field);
    world.update(field, TextInput, ti => { ti.value = 'after'; });
    await app.tick(1 / 60);
    expect(glyphs()).toEqual([]);
    expect(world.has(field, UIVisual)).toBe(false);
    expect(world.has(field, UIMask)).toBe(false);
    expect(world.get(field, TextInput).value).toBe('after');
    setPlayMode(true);
    await app.tick(1 / 60);
    expect(glyphs()).toEqual(['after']);
    setPlayMode(false);
    await app.tick(1 / 60);
    expect(glyphs()).toEqual([]);
    hidden.delete(field);
    await app.tick(1 / 60);
    expect(glyphs()).toEqual(['after']);
});

it('opens and releases the input surface when the same edit world enters and leaves Play', async () => {
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin(), true);
    app.addPlugin(new LocalizationPlugin({ catalogs: { en: { hint: 'Play hint' } } }));
    const field = app.world.spawn();
    app.world.insert(field, Transform, {});
    app.world.insert(field, UINode, {});
    app.world.insert(field, TextInput, { placeholder: 'Edit preview', placeholderI18nKey: 'hint' });
    const shown = () => app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content);
    await app.tick(1 / 60);
    expect(shown()).toEqual(['Edit preview']);
    expect(surfaces).toHaveLength(0);
    setPlayMode(true);
    await app.tick(1 / 60);
    expect(shown()).toEqual(['Play hint']);
    expect(surfaces).toHaveLength(1);
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    expect(surfaces[0].focus).toHaveBeenCalledOnce();
    setPlayMode(false);
    const late = [...surfaces[0].listeners];
    for (const listener of late) listener({ kind: 'change' });
    app.setPaused(true);
    await app.tick(1 / 60);
    expect(shown()).toEqual(['Edit preview']);
    expect(app.world.get(field, TextInput).focused).toBe(false);
    expect(app.world.get(field, TextInput).value).toBe('');
    expect(surfaces[0].dispose).toHaveBeenCalledOnce();
    expect(surfaces[0].listeners.size).toBe(0);
    setPlayMode(true);
    app.setPaused(false);
    await app.tick(1 / 60);
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    expect(surfaces[1].focus).toHaveBeenCalledOnce();
    for (const listener of late) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe('');
});

it('keeps a running app interactive while another app context is in edit mode', async () => {
    const plugin = new TextInputPlugin();
    const game = build(plugin), edit = build(plugin, true);
    const field = game.world.spawn();
    game.world.insert(field, TextInput, { value: 'game' });
    game.getResource(FocusManager).focus(field);
    await edit.tick(1 / 60);
    await game.tick(1 / 60);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].focus).toHaveBeenCalledOnce();
    expect(surfaces[0].dispose).not.toHaveBeenCalled();
});

it('releases the fill and scissor created for a field on removal, a box change or plugin cleanup', async () => {
    dimensions.width.mockReturnValue(160); dimensions.height.mockReturnValue(40);
    const plugin = new TextInputPlugin(), app = build(plugin, true), world = app.world;
    const fields = Array.from({ length: 3 }, () => {
        const field = world.spawn();
        world.insert(field, Transform, {}); world.insert(field, UINode, {}); world.insert(field, TextInput, {});
        return field;
    });
    await app.tick(1 / 60);
    for (const field of fields) expect([world.has(field, UIVisual), world.has(field, UIMask)]).toEqual([true, true]);
    const [removed, worldField, retained] = fields;
    const red = { r: 1, g: 0, b: 0, a: 1 };
    world.update(removed, TextInput, ti => { ti.backgroundColor = red; });
    await app.tick(1 / 60);
    expect(world.get(removed, UIVisual).color).toMatchObject(red);
    world.remove(removed, TextInput);
    world.remove(worldField, UINode);
    world.insert(worldField, ContentRect, { size: { x: 100, y: 30 } });
    await app.tick(1 / 60);
    expect([world.has(removed, UIVisual), world.has(removed, UIMask)]).toEqual([false, false]);
    expect([world.has(worldField, UIVisual), world.has(worldField, UIMask)]).toEqual([false, true]);
    plugin.cleanup(app);
    expect(world.has(worldField, UIMask)).toBe(false);
    expect([world.has(retained, UIVisual), world.has(retained, UIMask)]).toEqual([false, false]);
});

it.each(['before', 'after'])('preserves authored fill and mask written %s the field first renders', async when => {
    dimensions.width.mockReturnValue(160); dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin(), true), world = app.world, field = world.spawn();
    world.insert(field, Transform, {}); world.insert(field, UINode, {}); world.insert(field, TextInput, {});
    if (when === 'after') await app.tick(1 / 60);
    const skin = { r: 1, g: 0, b: 0, a: 1 };
    world.insert(field, UIVisual, { visualType: UIVisualType.SolidColor, color: skin });
    // Same value as a generated mask; a new authored write still takes ownership.
    world.insert(field, UIMask, { enabled: true, mode: MaskMode.Scissor });
    await app.tick(1 / 60);
    expect(world.get(field, UIVisual).color).toMatchObject(skin);
    world.remove(field, TextInput);
    await app.tick(1 / 60);
    expect(world.get(field, UIVisual).color).toMatchObject(skin);
    expect(world.get(field, UIMask)).toMatchObject({ enabled: true, mode: MaskMode.Scissor });
});

it('does not release an authored entity in a replacement registry that reuses the old glyph handle', async () => {
    dimensions.width.mockReturnValue(160); dimensions.height.mockReturnValue(40);
    const plugin = new TextInputPlugin(), app = build(plugin, true), world = app.world;
    const field = world.spawn();
    world.insert(field, Transform, {}); world.insert(field, UINode, {}); world.insert(field, TextInput, {});
    await app.tick(1 / 60);
    const [oldGlyph] = world.get(field, Children).entities;
    const { createMockModule } = await import('./mocks/wasm');
    world.disconnectCpp();
    const core = createMockModule();
    app.connectCpp(core.getRegistry(), core);
    const other = world.spawn(), label = world.spawn();
    expect([other, label]).toEqual([field, oldGlyph]);
    world.insert(label, Text, { content: 'Authored' });
    plugin.cleanup(app);
    expect(world.valid(label)).toBe(true);
    expect(world.get(label, Text).content).toBe('Authored');
});

it.each(['change', 'composition', 'submit'] as const)('delivers native %s after UI clearing and before Update consumers', async kind => {
    const app = build(new TextInputPlugin());
    const events = app.getResource(UIEvents);
    app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => { events.drain(); }, { name: 'UIInteractionSystem' }));
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: '' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    const type = kind === 'submit' ? 'submit' : 'change';
    const handler = vi.fn();
    events.on(type, handler);
    const counts: number[] = [];
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { counts.push(events.query(type).length); }));
    for (const listener of surfaces[0].listeners) {
        listener(kind === 'composition' ? { kind, composing: false } : { kind });
    }
    expect(handler).toHaveBeenCalledOnce();
    await app.tick(1 / 60);
    expect(counts).toEqual([1]);
    expect(handler).toHaveBeenCalledOnce();
    await app.tick(1 / 60);
    expect(counts).toEqual([1, 0]);
});

it('drops the frame record when its native input field was destroyed', async () => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: '' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    const handler = vi.fn();
    app.getResource(UIEvents).on('change', handler);
    const events = app.getResource(UIEvents);
    app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => { events.drain(); }, { name: 'UIInteractionSystem' }));
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    app.world.despawn(field);
    await app.tick(1 / 60);
    expect(handler).toHaveBeenCalledOnce();
    expect(events.query('change')).toEqual([]);
});

it('quitting an older app releases only its text surface and preserves newer input', async () => {
    const plugin = new TextInputPlugin(), first = build(plugin), second = build(plugin);
    const field = second.world.spawn();
    second.world.insert(field, TextInput, { value: '' });
    second.getResource(FocusManager).focus(field);
    await second.tick(1 / 60);
    first.quit();
    expect(surfaces[0].dispose).toHaveBeenCalledOnce();
    expect(surfaces[0].listeners.size).toBe(0);
    expect(surfaces[1].dispose).not.toHaveBeenCalled();
    for (const listener of surfaces[1].listeners) listener({ kind: 'change' });
    expect(second.world.get(field, TextInput).value).toBe('typed');
    second.quit();
    expect(surfaces[1].dispose).toHaveBeenCalledOnce();
    expect(surfaces[1].listeners.size).toBe(0);
});

it('releases repeated preview surfaces without losing the main surface', () => {
    const plugin = new TextInputPlugin(), main = build(plugin);
    for (let i = 0; i < 100; i++) build(plugin).quit();
    expect(surfaces[0].dispose).not.toHaveBeenCalled();
    expect(surfaces[0].listeners.size).toBe(1);
    for (const surface of surfaces.slice(1)) {
        expect(surface.dispose).toHaveBeenCalledOnce();
        expect(surface.listeners.size).toBe(0);
    }
    main.quit();
    expect(surfaces[0].dispose).toHaveBeenCalledOnce();
});

it('explicit cleanup is idempotent and leaves another app subscribed', () => {
    const plugin = new TextInputPlugin(), first = build(plugin), second = build(plugin);
    plugin.cleanup(first);
    plugin.cleanup(first);
    first.quit();
    expect(surfaces[0].dispose).toHaveBeenCalledOnce();
    expect(surfaces[1].listeners.size).toBe(1);
    second.quit();
    expect(surfaces[1].dispose).toHaveBeenCalledOnce();
});

it('cleanup without an app releases every remaining surface exactly once', () => {
    const plugin = new TextInputPlugin();
    build(plugin);
    build(plugin);
    plugin.cleanup();
    plugin.cleanup();
    for (const surface of surfaces) {
        expect(surface.dispose).toHaveBeenCalledOnce();
        expect(surface.listeners.size).toBe(0);
    }
});

it.each(['despawn', 'remove'] as const)('blurs the OS surface when the focused field is %s', async removal => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: '' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    expect(surfaces[0].focus).toHaveBeenCalledOnce();
    if (removal === 'despawn') app.world.despawn(field);
    else app.world.remove(field, TextInput);
    await app.tick(1 / 60);
    expect(surfaces[0].blur).toHaveBeenCalledOnce();
    await app.tick(1 / 60);
    expect(surfaces[0].blur).toHaveBeenCalledOnce();
    const next = app.world.spawn();
    app.world.insert(next, TextInput, { value: '' });
    app.getResource(FocusManager).focus(next);
    await app.tick(1 / 60);
    expect(surfaces[0].focus).toHaveBeenCalledTimes(2);
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(next, TextInput).value).toBe('typed');
});

it.each(['entity', 'ancestor', 'interaction'] as const)('rejects queued input after disabling %s', async disabled => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: 'original' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    if (disabled === 'interaction') app.world.insert(field, Interactable, { enabled: false });
    else if (disabled === 'entity') app.world.insert(field, Disabled);
    else {
        const parent = app.world.spawn();
        app.world.setParent(field, parent);
        app.world.insert(parent, Disabled);
    }
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe('original');
    await app.tick(1 / 60);
    expect(surfaces[0].blur).toHaveBeenCalledOnce();
    expect(app.world.get(field, TextInput).focused).toBe(false);
});

it('releases each App measurement atlas without disposing the newer field atlas', async () => {
    const errors = vi.spyOn(log, 'error').mockImplementation(() => {});
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const plugin = new TextInputPlugin();
    const prepare = async () => {
        const app = build(plugin), field = app.world.spawn();
        app.world.insert(field, Transform, {});
        app.world.insert(field, UINode, {});
        app.world.insert(field, TextInput, { value: 'preview', textAlign: TextAlign.Center });
        await app.tick(1 / 60);
        return app;
    };
    const first = await prepare(), second = await prepare();
    expect(errors).not.toHaveBeenCalled();
    expect(measurements).toHaveLength(2);
    first.quit();
    expect(measurements[0].dispose).toHaveBeenCalledOnce();
    expect(measurements[1].dispose).not.toHaveBeenCalled();
    second.quit();
    second.quit();
    expect(measurements[1].dispose).toHaveBeenCalledOnce();
});

it('renders a focused read-only field from its own value without reading the unattached editor', async () => {
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, Transform, {});
    app.world.insert(field, UINode, {});
    app.world.insert(field, TextInput, { value: 'locked value', readOnly: true });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    const texts = app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content);
    expect(texts).toEqual(['locked value']);
    expect(surfaces[0].focus).not.toHaveBeenCalled();
    expect(app.world.get(field, TextInput).focused).toBe(false);
});

it('detaches the editing surface on a read-only transition and reattaches when editing returns', async () => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: 'original' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    app.world.update(field, TextInput, ti => { ti.readOnly = true; });
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe('original');
    await app.tick(1 / 60);
    expect(surfaces[0].blur).toHaveBeenCalledOnce();
    expect(app.world.get(field, TextInput).focused).toBe(false);
    expect(app.getResource(FocusManager).focusedEntity).toBe(field);
    app.world.update(field, TextInput, ti => { ti.readOnly = false; });
    await app.tick(1 / 60);
    expect(surfaces[0].focus).toHaveBeenCalledTimes(2);
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe('typed');
});

it('renders a newly focused field from its value until the surface is attached', async () => {
    dimensions.width.mockReturnValue(160);
    dimensions.height.mockReturnValue(40);
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, Transform, {});
    app.world.insert(field, UINode, {});
    app.world.insert(field, TextInput, { value: 'new field' });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    expect(app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content)).toEqual(['new field']);
    expect(surfaces[0].focus).toHaveBeenCalledOnce();
    await app.tick(1 / 60);
    expect(app.world.getEntitiesWithComponents([Text]).map(e => app.world.get(e, Text).content)).toEqual(['typed']);
});

it.each([
    { value: '🙂', maxLength: 1, expected: '' },
    { value: 'a🙂b', maxLength: 2, expected: 'a' },
    { value: 'a🙂b', maxLength: 3, expected: 'a🙂' },
    { value: '中文', maxLength: 1, expected: '中' },
    { value: '\ud83dX', maxLength: 1, expected: '\ud83d' },
])('clamps oversized host input at complete UTF-16 characters: $maxLength of $value', async ({ value, maxLength, expected }) => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: '', maxLength });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    vi.spyOn(surfaces[0], 'read').mockReturnValue({ value, selectionStart: value.length, selectionEnd: value.length, backward: false });
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe(expected);
    expect(app.world.get(field, TextInput).cursorPos).toBe(expected.length);
    expect(surfaces[0].write).toHaveBeenCalledWith({ value: expected, selectionStart: expected.length, selectionEnd: expected.length, backward: false });
});

it.each([
    { typed: 'x5y', caret: 3, filter: 1, expected: '5', expectedCaret: 1 },
    { typed: '12ab34', caret: 4, filter: 1, expected: '1234', expectedCaret: 2 },
    { typed: '٣４5', caret: 3, filter: 1, expected: '5', expectedCaret: 1 },
    { typed: '', caret: 0, filter: 1, expected: '', expectedCaret: 0 },
])('a digits field removes what it does not accept and keeps the caret in place: $typed', async ({ typed, caret, filter, expected, expectedCaret }) => {
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, TextInput, { value: '', inputFilter: filter as TextInputFilter });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    vi.spyOn(surfaces[0], 'read').mockReturnValue({ value: typed, selectionStart: caret, selectionEnd: caret, backward: false });
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(field, TextInput).value).toBe(expected);
    expect(app.world.get(field, TextInput).cursorPos).toBe(expectedCaret);
    if (typed !== expected) {
        expect(surfaces[0].write).toHaveBeenCalledWith({ value: expected, selectionStart: expectedCaret, selectionEnd: expectedCaret, backward: false });
    }
});

it('a field with no filter takes every character, and a digits field still honours its length limit', async () => {
    const app = build(new TextInputPlugin());
    const open = app.world.spawn();
    app.world.insert(open, TextInput, { value: '' });
    app.getResource(FocusManager).focus(open);
    await app.tick(1 / 60);
    vi.spyOn(surfaces[0], 'read').mockReturnValue({ value: 'x5y', selectionStart: 3, selectionEnd: 3, backward: false });
    for (const listener of surfaces[0].listeners) listener({ kind: 'change' });
    expect(app.world.get(open, TextInput).value).toBe('x5y');
    expect(surfaces[0].write).not.toHaveBeenCalled();

    const priced = app.world.spawn();
    app.world.insert(priced, TextInput, { value: '', inputFilter: 1, maxLength: 3 });
    app.getResource(FocusManager).focus(priced);
    await app.tick(1 / 60);
    const second = surfaces.at(-1)!;
    vi.spyOn(second, 'read').mockReturnValue({ value: '1a2b3c4d5', selectionStart: 9, selectionEnd: 9, backward: false });
    for (const listener of second.listeners) listener({ kind: 'change' });
    expect(app.world.get(priced, TextInput).value).toBe('123');
});

it('puts a field on a world rectangle together from world parts: text, selection and caret placed from the box top-left', async () => {
    const { ContentRect } = await import('../src/ui/core/content-rect');
    const { Sprite } = await import('../src/ecs/component');
    const { Parent, Children } = await import('../src/ecs/component');
    const app = build(new TextInputPlugin());
    const field = app.world.spawn();
    app.world.insert(field, Transform, { position: { x: 100, y: 50, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 100, y: 50, z: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 }, worldScale: { x: 1, y: 1, z: 1 } });
    // 200 by 60, the transform in the middle
    app.world.insert(field, ContentRect, { size: { x: 200, y: 60 }, pivot: { x: 0.5, y: 0.5 } });
    app.world.insert(field, TextInput, { value: 'typed', padding: 8, fontSize: 20 });
    app.getResource(FocusManager).focus(field);
    await app.tick(1 / 60);
    await app.tick(1 / 60);

    // a UI field would have grown UI nodes; this one grew world parts, three of them under it, none a UINode
    const parts = app.world.get(field, Children).entities;
    expect(parts).toHaveLength(3);
    for (const part of parts) {
        expect(app.world.has(part, UINode)).toBe(false);
        expect(app.world.has(part, ContentRect)).toBe(true);
        expect(app.world.get(part, Parent).entity).toBe(field);
    }
    const [selection, text, caret] = parts as [number, number, number];
    expect(app.world.get(text, Text).content).toBe('typed');
    // the text starts one padding in from the left edge (-100), and sits at the top (+30), from the field's own origin
    expect(app.world.get(text, Transform).position.x).toBe(-100 + 8);
    expect(app.world.get(text, Transform).position.y).toBe(30);
    expect(app.world.get(text, ContentRect).size.x).toBe(200 - 16);
    // the caret is a solid bar after the five typed characters (the measuring stub's glyph is 16 at 64, so 5 at this size), 2 wide and a line tall
    expect(app.world.get(caret, ContentRect).size).toEqual({ x: 2, y: 20 });
    expect(app.world.get(caret, Transform).position.x).toBeCloseTo(-100 + 8 + 5 * 5, 3);
    expect(app.world.get(caret, Sprite).enabled).toBe(true);
    expect(app.world.get(selection, Sprite).enabled).toBe(false);
});
