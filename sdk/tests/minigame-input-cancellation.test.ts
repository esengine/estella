// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameTouchEvent } from '../src/platform/minigame/api';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { UiPointerBook, uiPointersOf } from '../src/ui/input/pointerBook';
import type { Entity } from '../src/types';
import { inputRouter } from '../src/input/inputRouter';
afterEach(() => { inputRouter.setEditorHandler(null); inputRouter.dispatchKeyUp('ShiftLeft'); });

function setup() {
    const handlers = new Map<string, Function>();
    const host: Record<string, unknown> = {};
    for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'KeyDown', 'KeyUp', 'Hide']) {
        host['on' + name] = (handler: Function) => handlers.set(name, handler);
        host['off' + name] = vi.fn((handler: Function) => { if (handlers.get(name) === handler) handlers.delete(name); });
    }
    const adapter = new MiniGamePlatformAdapter({ id: 'test', hostLabel: 'Test', global: host as unknown as MiniGameGlobal });
    const input = new InputState(); adapter.bindInputEvents(inputEventCallbacks(input));
    const touch = (kind: string, id: number) => handlers.get(kind)?.({ changedTouches: [{ identifier: id, clientX: 5, clientY: 5 }] } as MiniGameTouchEvent);
    return { adapter, input, handlers, touch };
}
it('cancels hidden input and lets a new finger become primary after showing', () => {
    const { adapter, input, handlers, touch } = setup();
    handlers.get('KeyDown')?.({ code: 'KeyD' }); touch('TouchStart', 1);
    handlers.get('Hide')?.();
    expect(input.keysDown.size).toBe(0); expect(input.touches.size).toBe(0);
    expect(input.isMouseButtonDown(0)).toBe(false);
    input.beginFixedStep();
    expect(input.isKeyPressed('KeyD')).toBe(false); expect(input.isMouseButtonPressed(0)).toBe(false);
    input.endFixedStep();
    touch('TouchStart', 2); expect(input.isMouseButtonDown(0)).toBe(true);
    touch('TouchEnd', 1); expect(input.isMouseButtonDown(0)).toBe(true);
    adapter.unbindInputEvents(); expect(handlers.size).toBe(0);
    expect(input.touches.size).toBe(0);
});
it('does not turn a cancelled quick touch into a UI click', () => {
    const { adapter, input, touch } = setup(), book = new UiPointerBook();
    touch('TouchStart', 1); touch('TouchCancel', 1);
    const events = book.step(uiPointersOf(input), () => 1 as Entity, () => true);
    expect(events.some(event => event.kind === 'click')).toBe(false);
    expect(input.touchesEnded.size).toBe(0);
    input.beginFixedStep(); expect(input.isMouseButtonPressed(0)).toBe(false); input.endFixedStep();
    adapter.unbindInputEvents();
});
it('keeps a cancelled primary touch out of the pointer release route', () => {
    const { adapter, input, touch } = setup();
    const onPointerUp = vi.fn();
    const off = inputRouter.setUIHandler({ onPointerUp });
    try {
        touch('TouchStart', 1); touch('TouchCancel', 1);
        expect(onPointerUp).not.toHaveBeenCalled();
        expect(input.isMouseButtonDown(0)).toBe(false);
        touch('TouchStart', 2); touch('TouchEnd', 2);
        expect(onPointerUp).toHaveBeenCalledOnce();
    } finally { off(); adapter.unbindInputEvents(); }
});
it('cancels a secondary finger without releasing the primary finger', () => {
    const { adapter, input, touch } = setup();
    touch('TouchStart', 1); touch('TouchStart', 2); touch('TouchCancel', 2);
    expect(input.isMouseButtonDown(0)).toBe(true);
    expect(input.touches.has(1)).toBe(true); expect(input.touches.has(2)).toBe(false);
    expect(input.touchesEnded.has(2)).toBe(false);
    adapter.unbindInputEvents();
});
it('clears router modifiers on hide as well as the gameplay key state', () => {
    const { adapter, handlers, touch } = setup();
    handlers.get('KeyDown')?.({ code: 'ShiftLeft' });
    handlers.get('Hide')?.();
    let shifted = true;
    inputRouter.setEditorHandler({ onPointerDown: (_button, _x, _y, mods) => { shifted = mods.shift; } });
    touch('TouchStart', 3);
    expect(shifted).toBe(false);
    adapter.unbindInputEvents();
});
