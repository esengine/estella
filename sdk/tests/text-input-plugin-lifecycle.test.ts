// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import type { TextEditorEvent } from '../src/platform/types';
import type { TextInputFilter } from '../src/ui/text/text-input';
import { bootMockApp } from './helpers/mockApp';
import { log } from '../src/util/logger';

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
const { Text } = await import('../src/ui/core/text');
const { defineSystem, Schedule } = await import('../src/ecs/system');
const { Disabled, Transform } = await import('../src/ecs/component');
const { UINode } = await import('../src/ui/core/ui-node');
const { Interactable } = await import('../src/ui/input/interactable');
const apps: ReturnType<typeof App.new>[] = [];
function build(plugin: InstanceType<typeof TextInputPlugin>) {
    const app = bootMockApp().app;
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
    measurements.length = 0;
    dimensions.width.mockReturnValue(0);
    dimensions.height.mockReturnValue(0);
    vi.restoreAllMocks();
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
        app.world.insert(field, TextInput, { value: 'preview' });
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
