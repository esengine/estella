// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { createWebTextEditor } from '../src/platform/webTextEditor';
import { TextInputPlugin } from '../src/ui/text/text-input-plugin';
import { TextInput } from '../src/ui/text/text-input';
import { FocusManager, FocusManagerState } from '../src/ui/input/focusable';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { UIDialog } from '../src/ui/behavior/dialog';
import type { App } from '../src/app/app';

vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateTextEditor: () => createWebTextEditor(),
}));
const apps: App[] = [];
function build() {
    const app = bootMockApp().app;
    apps.push(app);
    app.addPlugin({ name: 'focus', build(app) {
        app.insertResource(FocusManager, new FocusManagerState());
        app.insertResource(UIEvents, new UIEventQueue());
    } }).addPlugin(new TextInputPlugin());
    const first = app.world.spawn(), second = app.world.spawn();
    app.world.insert(first, TextInput, { value: 'first' });
    app.world.insert(second, TextInput, { value: 'second' });
    return { app, first, second, textarea: document.querySelector<HTMLTextAreaElement>('textarea[data-estella-text-editor]')! };
}
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

it.each([false, true])('keeps the new field focused when switching, composing=%j', async composing => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    if (composing) textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    fm.focus(second);
    await app.tick(1 / 60);
    expect(fm.focusedEntity).toBe(second);
    expect(app.world.get(first, TextInput).focused).toBe(false);
    expect(app.world.get(second, TextInput).focused).toBe(true);
    textarea.value = 'new text';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(second, TextInput).value).toBe('new text');
    expect(app.world.get(first, TextInput).value).toBe('first');
});

it('rejects old surface input while a new field is awaiting activation', async () => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    fm.focus(second);
    textarea.value = 'old pending input';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(second, TextInput).value).toBe('second');
});

it.each([
    ['input', false], ['compositionend', false], ['input', true], ['compositionend', true],
] as const)('discards stale %s across focus sessions (already refocused: %s)', async (kind, refocused) => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager), changed = vi.fn();
    app.getResource(UIEvents).on(first, 'change', changed);
    fm.focus(first);
    await app.tick(1 / 60);
    if (kind === 'compositionend') textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    fm.focus(second);
    if (refocused) fm.focus(first);
    textarea.value = 'stale text';
    textarea.dispatchEvent(new Event(kind));
    expect(fm.focusedEntity).toBe(refocused ? first : second);
    expect(app.world.get(first, TextInput).value).toBe('first');
    fm.focus(first);
    await app.tick(1 / 60);
    expect(textarea.value).toBe('first');
    expect(app.world.get(second, TextInput).value).toBe('second');
    expect(changed).not.toHaveBeenCalled();
    textarea.value = 'fresh text';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(first, TextInput).value).toBe('fresh text');
    expect(changed).toHaveBeenCalledOnce();
});

it('accepts normal input after an interrupted composition loses and regains focus', async () => {
    const { app, first, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    textarea.blur();
    expect(fm.focusedEntity).toBe(null);
    fm.focus(first);
    await app.tick(1 / 60);
    textarea.value = 'resumed';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(first, TextInput).value).toBe('resumed');
});

it('preserves focus assigned by a submit callback', async () => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    app.getResource(UIEvents).on(first, 'submit', () => fm.focus(second));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(fm.focusedEntity).toBe(second);
    await app.tick(1 / 60);
    textarea.value = 'submitted next';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(second, TextInput).value).toBe('submitted next');
});

it('releases focus after submission when the callback leaves the session unchanged', async () => {
    const { app, first, textarea } = build();
    const fm = app.getResource(FocusManager), onSubmit = vi.fn();
    fm.focus(first);
    await app.tick(1 / 60);
    app.getResource(UIEvents).on(first, 'submit', onSubmit);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(fm.focusedEntity).toBe(null);
    expect(app.world.get(first, TextInput).focused).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
});

it.each(['hidden', 'ancestor', 'modal'] as const)('rejects late editing callbacks after %s and restores the committed value', async mutation => {
    const { app, first, textarea } = build();
    const world = app.world, fm = app.getResource(FocusManager);
    world.insert(first, UINode);
    const root = world.spawn();
    world.insert(root, UINode);
    if (mutation === 'ancestor') world.setParent(first, root);
    fm.focus(first);
    await app.tick(1 / 60);
    const changed = vi.fn(), submitted = vi.fn();
    app.getResource(UIEvents).on(first, 'change', changed);
    app.getResource(UIEvents).on(first, 'submit', submitted);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    if (mutation === 'modal') world.insert(root, UIDialog);
    else world.update(mutation === 'hidden' ? first : root, UINode, n => { n.display = UIDisplay.None; });
    textarea.value = 'late preedit';
    textarea.dispatchEvent(new CompositionEvent('compositionend'));
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(world.get(first, TextInput).value).toBe('first');
    expect(world.get(first, TextInput).focused).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea);
    // Eligibility returns before another focus tick. A rejected composition
    // must not leave a composing latch or stale value attached to this field.
    if (mutation === 'modal') world.remove(root, UIDialog);
    else world.update(mutation === 'hidden' ? first : root, UINode, n => { n.display = UIDisplay.Flex; });
    await app.tick(1 / 60);
    expect(textarea.value).toBe('first');
    textarea.value = 'resumed';
    textarea.dispatchEvent(new Event('input'));
    expect(world.get(first, TextInput).value).toBe('resumed');
    expect(changed).toHaveBeenCalledOnce();
});

it('accepts editing inside the active modal subtree', async () => {
    const { app, first, textarea } = build();
    const root = app.world.spawn();
    app.world.insert(root, UINode);
    app.world.insert(root, UIDialog);
    app.world.setParent(first, root);
    app.getResource(FocusManager).focus(first);
    await app.tick(1 / 60);
    textarea.value = 'modal text';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(first, TextInput).value).toBe('modal text');
});
