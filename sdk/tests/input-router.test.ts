// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The chain-of-responsibility input router (editor → UI → game). Its job
 *        is entirely about ORDER and CONSUMPTION — editor sees an event first,
 *        a `true` return stops propagation, a throw must not — and the subtle
 *        key-up modifier timing (a handler sees the modifier as still-held on the
 *        edge that releases it). None of that was asserted.
 */
import { describe, it, expect, vi } from 'vitest';
import { InputRouter, type InputHandler, type Modifiers } from '../src/input/inputRouter';

describe('InputRouter tier ordering & consumption', () => {
  it('dispatches editor before UI and stops when the editor consumes', () => {
    const order: string[] = [];
    const editor: InputHandler = { onKeyDown: () => { order.push('editor'); return true; } };
    const ui: InputHandler = { onKeyDown: () => { order.push('ui'); return true; } };
    const r = new InputRouter();
    r.setEditorHandler(editor);
    r.setUIHandler(ui);
    expect(r.dispatchKeyDown('KeyA')).toBe(true);
    expect(order).toEqual(['editor']); // UI never reached
  });

  it('falls through to UI when the editor returns void/false', () => {
    const order: string[] = [];
    const editor: InputHandler = { onKeyDown: () => { order.push('editor'); /* void */ } };
    const ui: InputHandler = { onKeyDown: () => { order.push('ui'); return true; } };
    const r = new InputRouter();
    r.setEditorHandler(editor);
    r.setUIHandler(ui);
    expect(r.dispatchKeyDown('KeyA')).toBe(true);
    expect(order).toEqual(['editor', 'ui']);
  });

  it('returns false to gameplay when no tier consumes', () => {
    const r = new InputRouter();
    r.setEditorHandler({ onKeyDown: () => false });
    r.setUIHandler({ onKeyDown: () => undefined });
    expect(r.dispatchKeyDown('KeyA')).toBe(false);
  });

  it('treats a throwing handler as non-consuming and keeps dispatching', () => {
    const ui = vi.fn(() => true);
    const r = new InputRouter();
    r.setEditorHandler({ onPointerDown: () => { throw new Error('bad tool'); } });
    r.setUIHandler({ onPointerDown: ui });
    expect(() => r.dispatchPointerDown(0, 5, 6)).not.toThrow();
    expect(r.dispatchPointerDown(0, 5, 6)).toBe(true); // fell through to UI
    expect(ui).toHaveBeenCalledWith(0, 5, 6, expect.any(Object));
  });

  it('only-a-partial handler (missing method) is skipped, not an error', () => {
    const r = new InputRouter();
    r.setEditorHandler({}); // no callbacks at all
    r.setUIHandler({ onWheel: () => true });
    expect(r.dispatchWheel(0, -120)).toBe(true);
  });
});

describe('InputRouter handler registration', () => {
  it('unregister thunk clears the handler', () => {
    const r = new InputRouter();
    const off = r.setEditorHandler({ onKeyDown: () => true });
    expect(r.dispatchKeyDown('KeyA')).toBe(true);
    off();
    expect(r.dispatchKeyDown('KeyA')).toBe(false); // handler gone
  });

  it('a stale unregister thunk does not clobber a replacement handler', () => {
    const r = new InputRouter();
    const off1 = r.setEditorHandler({ onKeyDown: () => false });
    r.setEditorHandler({ onKeyDown: () => true }); // replace
    off1(); // stale: must NOT remove the new handler
    expect(r.dispatchKeyDown('KeyA')).toBe(true);
  });
});

describe('InputRouter modifier tracking', () => {
  it('tracks shift/ctrl/alt/meta across key down and up', () => {
    const r = new InputRouter();
    r.dispatchKeyDown('ShiftLeft');
    r.dispatchKeyDown('ControlRight');
    r.dispatchKeyDown('AltLeft');
    r.dispatchKeyDown('OSLeft'); // meta alias
    expect(r.currentMods).toMatchObject({ shift: true, ctrl: true, alt: true, meta: true });
    r.dispatchKeyUp('ShiftLeft');
    expect(r.currentMods.shift).toBe(false);
    expect(r.currentMods.ctrl).toBe(true); // others untouched
  });

  it('non-modifier keys leave the modifier state (and its identity) unchanged', () => {
    const r = new InputRouter();
    const before = r.currentMods;
    r.dispatchKeyDown('KeyA');
    expect(r.currentMods).toBe(before); // no new object allocated
    expect(r.currentMods).toMatchObject({ shift: false, ctrl: false, alt: false, meta: false });
  });

  it('passes the CURRENT modifiers to handlers on key-down', () => {
    const r = new InputRouter();
    r.dispatchKeyDown('ShiftLeft');
    let seen: Modifiers | null = null;
    r.setEditorHandler({ onKeyDown: (_c, mods) => { seen = mods; } });
    r.dispatchKeyDown('KeyA');
    expect(seen).toMatchObject({ shift: true });
  });

  it('key-up updates modifiers AFTER dispatch: the handler sees it still held', () => {
    const r = new InputRouter();
    r.dispatchKeyDown('ShiftLeft');
    let shiftDuringRelease: boolean | null = null;
    r.setEditorHandler({ onKeyUp: (_c, mods) => { shiftDuringRelease = mods.shift; } });
    r.dispatchKeyUp('ShiftLeft');
    expect(shiftDuringRelease).toBe(true);   // still held on the releasing edge (DOM semantics)
    expect(r.currentMods.shift).toBe(false); // cleared once dispatch returns
  });
});

describe('InputRouter dispatch coverage (args reach the right tier)', () => {
  it('routes pointer, wheel, and touch events with their arguments', () => {
    const calls: Record<string, unknown[]> = {};
    const record = (k: string) => (...a: unknown[]) => { calls[k] = a; return false; };
    const r = new InputRouter();
    r.setUIHandler({
      onPointerMove: record('move'),
      onPointerUp: record('up'),
      onTouchStart: record('tstart'),
      onTouchMove: record('tmove'),
      onTouchEnd: record('tend'),
      onTouchCancel: record('tcancel'),
    });
    r.dispatchPointerMove(3, 4);
    r.dispatchPointerUp(2);
    r.dispatchTouchStart(7, 10, 20);
    r.dispatchTouchMove(7, 11, 21);
    r.dispatchTouchEnd(7);
    r.dispatchTouchCancel(7);
    expect(calls.move.slice(0, 2)).toEqual([3, 4]);
    expect(calls.up[0]).toBe(2);
    expect(calls.tstart).toEqual([7, 10, 20]);
    expect(calls.tmove).toEqual([7, 11, 21]);
    expect(calls.tend).toEqual([7]);
    expect(calls.tcancel).toEqual([7]);
  });
});
