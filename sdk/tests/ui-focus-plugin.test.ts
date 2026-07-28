// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FocusPlugin's keyboard + pointer focus, driven through a mock-wasm App
 *        (see tests/helpers/mockApp). The mock backs the builtin Interactable /
 *        UIInteraction fields in JS, so the enabled-gating and click-to-focus
 *        branches — unreachable without a connected module — are covered here
 *        alongside the pure Tab navigation. FocusSystem is playModeOnly, which
 *        the harness satisfies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { flushPendingSystems } from '../src/app/app';
import type { App } from '../src/app/app';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { focusPlugin } from '../src/ui/input/focus';
import { bootMockApp } from './helpers/mockApp';
import type { Entity } from '../src/types';

let app: App;

beforeEach(() => {
  app = bootMockApp().app;
  app.insertResource(Input, new InputState());   // fresh, so key state can't leak between tests
  app.insertResource(UIEvents, new UIEventQueue());
  focusPlugin.build(app); // registers Focusable, inserts a fresh FocusManager, adds FocusSystem
  flushPendingSystems(app);
});

/** A focusable entity. `enabled` drives the (builtin) Interactable gate. */
function addFocusable(tabIndex: number, enabled = true): Entity {
  const e = app.world.spawn();
  app.world.insert(e, Focusable, { tabIndex, isFocused: false });
  app.world.insert(e, Interactable, { enabled });
  return e;
}

async function tab(opts: { shift?: boolean } = {}): Promise<void> {
  const input = app.getResource(Input) as InputState;
  input.keysPressed.add('Tab');
  if (opts.shift) input.keysDown.add('Shift');
  await app.tick(1 / 60);
  input.keysPressed.delete('Tab');
  if (opts.shift) input.keysDown.delete('Shift');
}

const focused = (): Entity | null => app.getResource(FocusManager).focusedEntity;
const isFocused = (e: Entity): boolean =>
  (app.world.get(e, Focusable) as { isFocused: boolean }).isFocused;

describe('FocusPlugin Tab navigation', () => {
  it('focuses the lowest tabIndex first, then advances in tabIndex order', async () => {
    const b = addFocusable(20); // inserted first, but higher tabIndex
    const a = addFocusable(10);
    const c = addFocusable(30);

    await tab();
    expect(focused()).toBe(a); // sorted by tabIndex, not spawn order
    expect(isFocused(a)).toBe(true);

    await tab();
    expect(focused()).toBe(b);
    expect(isFocused(a)).toBe(false); // previous entity blurred
    expect(isFocused(b)).toBe(true);

    await tab();
    expect(focused()).toBe(c);
  });

  it('wraps from the last focusable back to the first', async () => {
    const a = addFocusable(0);
    addFocusable(1);
    await tab(); // → a
    await tab(); // → second
    await tab(); // → wraps to a
    expect(focused()).toBe(a);
  });

  it('Shift+Tab walks the order in reverse, starting from the last entry', async () => {
    const a = addFocusable(0);
    const b = addFocusable(1);
    await tab({ shift: true }); // no current focus + reverse ⇒ last
    expect(focused()).toBe(b);
    await tab({ shift: true });
    expect(focused()).toBe(a);
  });

  it('re-focusing the already-focused entity is a no-op', async () => {
    const only = addFocusable(0);
    await tab();
    await tab(); // single focusable ⇒ stays on itself
    expect(focused()).toBe(only);
    expect(isFocused(only)).toBe(true);
  });

  it('skips a focusable whose Interactable is disabled', async () => {
    const a = addFocusable(0);
    addFocusable(1, /* enabled */ false); // out of the tab order
    const c = addFocusable(2);
    await tab();
    expect(focused()).toBe(a);
    await tab();
    expect(focused()).toBe(c); // jumps over the disabled one
  });
});

describe('FocusPlugin pointer focus', () => {
  it('a justPressed UIInteraction focuses that entity', async () => {
    const e = app.world.spawn();
    app.world.insert(e, Focusable, { tabIndex: 0, isFocused: false });
    app.world.insert(e, UIInteraction, { justPressed: true });
    await app.tick(1 / 60);
    expect(focused()).toBe(e);
    expect(isFocused(e)).toBe(true);
  });

  it('moving focus by click blurs the previously focused entity', async () => {
    const a = addFocusable(0);
    await tab();
    expect(focused()).toBe(a);

    const b = app.world.spawn();
    app.world.insert(b, Focusable, { tabIndex: 5, isFocused: false });
    app.world.insert(b, UIInteraction, { justPressed: true });
    await app.tick(1 / 60);
    expect(focused()).toBe(b);
    expect(isFocused(a)).toBe(false); // a was blurred
    expect(isFocused(b)).toBe(true);
  });
});

// — :focus-visible ————————————————————————————————————————————————————————————
//
// Focus follows a pointer press so Enter/Space act on what you clicked. But a
// clicked control that KEEPS a focus look reads as stuck — the pointer has moved
// on and the button is still lit until you click something else. So focus tracks
// how it arrived, and only keyboard focus is drawn.

const visible = (): boolean => app.getResource(FocusManager).focusVisible;

describe('focus visibility', () => {
  it('is off for pointer focus, on for Tab', async () => {
    const e = app.world.spawn();
    app.world.insert(e, Focusable, { tabIndex: 0, isFocused: false });
    app.world.insert(e, UIInteraction, { justPressed: true });
    await app.tick(1 / 60);
    expect(focused()).toBe(e);
    expect(visible()).toBe(false); // focused, but not drawn

    app.world.insert(e, UIInteraction, { justPressed: false });
    await tab();
    expect(visible()).toBe(true);
  });

  it('starts drawing when Tab lands on a control that was clicked', async () => {
    // The re-focus path: same entity, different acquisition. Focus does not move,
    // so an early return that skipped the update would leave it invisible forever.
    const e = addFocusable(0);
    app.world.insert(e, UIInteraction, { justPressed: true });
    await app.tick(1 / 60);
    expect(focused()).toBe(e);
    expect(visible()).toBe(false);

    app.world.insert(e, UIInteraction, { justPressed: false });
    await tab(); // only one focusable → Tab wraps back to it
    expect(focused()).toBe(e);
    expect(visible()).toBe(true);
  });

  it('stops being visible once focus is dropped', async () => {
    addFocusable(0);
    await tab();
    expect(visible()).toBe(true);

    const input = app.getResource(Input) as InputState;
    input.keysPressed.add('Escape');
    await app.tick(1 / 60);
    input.keysPressed.delete('Escape');
    expect(focused()).toBeNull();
    expect(visible()).toBe(false);
  });
});
