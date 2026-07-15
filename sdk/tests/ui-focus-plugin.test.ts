// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The keyboard-focus plugin's Tab navigation, exercised through a real
 *        App. App.new() runs the JS-side ECS with no wasm, so this is the
 *        lightweight plugin test path: build the plugin onto a fresh app, drive
 *        the Input resource, tick, assert world/resource state. FocusSystem is
 *        playModeOnly, the default for a standalone runtime.
 *
 *        Scope note: Focusable is a JS-backed defineComponent, so its tabIndex
 *        drives navigation here. Interactable/UIInteraction are wasm-backed
 *        builtins (BuiltinBridge) — their fields (enabled gating, justPressed
 *        click-focus) can't be set without a connected wasm module, so those two
 *        branches belong to a wasm-harness pass, not this one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App, flushPendingSystems } from '../src/app';
import { AppContext, setDefaultContext } from '../src/context';
import { setEditorMode, setPlayMode } from '../src/env';
import { Input, InputState } from '../src/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import type { Entity } from '../src/types';

beforeEach(() => {
  setDefaultContext(new AppContext()); // isolate component/system registration per test
  setEditorMode(false);
  setPlayMode(false); // standalone runtime ⇒ playModeOnly() true ⇒ FocusSystem runs
});

function makeApp(): App {
  const app = App.new();
  app.insertResource(Input, new InputState());
  app.insertResource(UIEvents, new UIEventQueue());
  focusPlugin.build(app); // registers Focusable, inserts a fresh FocusManager, adds FocusSystem
  flushPendingSystems(app);
  return app;
}

function addFocusable(app: App, tabIndex: number): Entity {
  const e = app.world.spawn();
  app.world.insert(e, Focusable, { tabIndex, isFocused: false });
  return e;
}

async function tab(app: App, opts: { shift?: boolean } = {}): Promise<void> {
  const input = app.getResource(Input) as InputState;
  input.keysPressed.add('Tab');
  if (opts.shift) input.keysDown.add('Shift');
  await app.tick(1 / 60);
  input.keysPressed.delete('Tab'); // tick clears keysPressed anyway; explicit for clarity
  if (opts.shift) input.keysDown.delete('Shift');
}

const focused = (app: App): Entity | null => app.getResource(FocusManager).focusedEntity;
const isFocused = (app: App, e: Entity): boolean =>
  (app.world.get(e, Focusable) as { isFocused: boolean }).isFocused;

describe('FocusPlugin Tab navigation', () => {
  it('focuses the lowest tabIndex first, then advances in tabIndex order', async () => {
    const app = makeApp();
    const b = addFocusable(app, 20); // inserted first, but higher tabIndex
    const a = addFocusable(app, 10);
    const c = addFocusable(app, 30);

    await tab(app);
    expect(focused(app)).toBe(a); // sorted by tabIndex, not spawn order
    expect(isFocused(app, a)).toBe(true);

    await tab(app);
    expect(focused(app)).toBe(b);
    expect(isFocused(app, a)).toBe(false); // the previous entity is blurred
    expect(isFocused(app, b)).toBe(true);

    await tab(app);
    expect(focused(app)).toBe(c);
  });

  it('wraps from the last focusable back to the first', async () => {
    const app = makeApp();
    const a = addFocusable(app, 0);
    addFocusable(app, 1);
    await tab(app); // → a
    await tab(app); // → second
    await tab(app); // → wraps back to a
    expect(focused(app)).toBe(a);
  });

  it('Shift+Tab walks the order in reverse, starting from the last entry', async () => {
    const app = makeApp();
    const a = addFocusable(app, 0);
    const b = addFocusable(app, 1);
    await tab(app, { shift: true }); // no current focus + reverse ⇒ last
    expect(focused(app)).toBe(b);
    await tab(app, { shift: true });
    expect(focused(app)).toBe(a);
  });

  it('re-focusing the already-focused entity is a no-op (no redundant blur/focus churn)', async () => {
    const app = makeApp();
    const only = addFocusable(app, 0);
    await tab(app);
    expect(focused(app)).toBe(only);
    await tab(app); // single focusable ⇒ cycles back to itself
    expect(focused(app)).toBe(only);
    expect(isFocused(app, only)).toBe(true);
  });
});
