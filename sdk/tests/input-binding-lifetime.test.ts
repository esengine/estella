// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Input, InputPlugin, InputState, inputEventCallbacks, inputPlugin } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import type { InputEventCallbacks, PlatformAdapter } from '../src/platform/types';

afterEach(() => {
    webAdapter.unbindInputEvents();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setPlatform(webAdapter);
});

it('keeps the replacement canvas and keyboard live when the previous App quits', () => {
    setPlatform(webAdapter);
    const canvas = () => document.body.appendChild(document.createElement('canvas'));
    const firstCanvas = canvas(), nextCanvas = canvas();
    const first = App.new().addPlugin(new InputPlugin(firstCanvas));
    const oldInput = first.getResource(Input);
    firstCanvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(oldInput.isMouseButtonDown(0)).toBe(true);

    const next = App.new().addPlugin(new InputPlugin(nextCanvas));
    const input = next.getResource(Input);
    expect(oldInput.isMouseButtonDown(0)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    const release = first.holdExecution();
    expect(inputRouter.currentMods.shift).toBe(true);
    release();
    first.quit();
    nextCanvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(input.isKeyDown('ShiftLeft')).toBe(true);
    expect(input.isKeyDown('KeyW')).toBe(true);
    expect(input.isMouseButtonDown(2)).toBe(true);
    expect(oldInput.isKeyDown('KeyW')).toBe(false);

    next.quit();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(input.isKeyDown('KeyA')).toBe(false);
    expect(input.isMouseButtonDown(2)).toBe(false);
});

it('releases input on the adapter that supplied it after the host has changed', () => {
    const oldHost = { bindInputEvents: vi.fn(), unbindInputEvents: vi.fn() };
    const newHost = { bindInputEvents: vi.fn(), unbindInputEvents: vi.fn() };
    setPlatform(oldHost as unknown as PlatformAdapter);
    const app = App.new().addPlugin(inputPlugin);
    setPlatform(newHost as unknown as PlatformAdapter);
    app.quit();
    expect(oldHost.unbindInputEvents).toHaveBeenCalledOnce();
    expect(newHost.unbindInputEvents).not.toHaveBeenCalled();
});

it('preserves replacement input on an adapter with a legacy unbind method', () => {
    let sink: InputEventCallbacks | undefined;
    const platform = {
        bindInputEvents: (callbacks: InputEventCallbacks) => { sink = callbacks; },
        unbindInputEvents: () => { sink = undefined; },
    };
    setPlatform(platform as PlatformAdapter);
    const previous = App.new().addPlugin(inputPlugin);
    const next = App.new().addPlugin(inputPlugin);
    previous.quit();
    sink?.onKeyDown('KeyD');
    expect(next.getResource(Input).isKeyDown('KeyD')).toBe(true);
    next.quit();
    expect(sink).toBeUndefined();
});

it('leaves a host-installed replacement binding live through App cleanup', () => {
    setPlatform(webAdapter);
    const previous = App.new().addPlugin(inputPlugin);
    const input = new InputState(), callbacks = inputEventCallbacks(input);
    webAdapter.bindInputEvents(callbacks);
    inputPlugin.cleanup();
    inputPlugin.cleanup();
    previous.quit();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(input.isKeyDown('KeyS')).toBe(true);
    webAdapter.unbindInputEvents(callbacks);
    expect(input.isKeyDown('KeyS')).toBe(false);
});

it('removes earlier DOM listeners when a target rejects a later registration', () => {
    const input = new InputState(), callbacks = inputEventCallbacks(input);
    const canvas = document.createElement('canvas');
    const error = new Error('canvas closed');
    vi.spyOn(canvas, 'addEventListener').mockImplementationOnce(() => { throw error; });
    expect(() => webAdapter.bindInputEvents(callbacks, canvas)).toThrow(error);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(input.isKeyDown('KeyW')).toBe(false);
    webAdapter.bindInputEvents(callbacks, canvas);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(input.isKeyDown('KeyW')).toBe(true);
});

it('keeps the newest target when releasing a held key starts another App', () => {
    setPlatform(webAdapter);
    const first = App.new().addPlugin(inputPlugin);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    const newest = App.new();
    const off = inputRouter.setEditorHandler({ onKeyUp() { newest.addPlugin(inputPlugin); } });
    try {
        const middle = App.new().addPlugin(inputPlugin);
        middle.quit();
        first.quit();
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        expect(newest.getResource(Input).isKeyDown('KeyW')).toBe(true);
    } finally {
        off();
        newest.quit();
    }
});

it('hands a connected hardware gamepad to the new App and releases its browser listener on quit', async () => {
    setPlatform(webAdapter);
    const poll = vi.fn(() => [{ index: 0, connected: true, buttons: [{ value: 1 }], axes: [], mapping: 'standard' }]);
    vi.stubGlobal('navigator', { getGamepads: poll });
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const first = App.new().addPlugin(inputPlugin);
    await first.tick(0);
    expect(first.getResource(Input).isGamepadButtonDown(0)).toBe(true);
    const next = App.new().addPlugin(inputPlugin);
    expect(first.getResource(Input).isGamepadConnected()).toBe(false);
    poll.mockClear();
    await first.tick(1 / 60);
    expect(poll).not.toHaveBeenCalled();
    first.quit();
    await next.tick(0);
    expect(next.getResource(Input).isGamepadButtonDown(0)).toBe(true);
    next.quit();
    const padListeners = (calls: ReadonlyArray<readonly unknown[]>) =>
        calls.filter(([name]) => name === 'gamepadconnected').map(([, listener]) => listener);
    expect(padListeners(added.mock.calls)).toHaveLength(2);
    expect(padListeners(removed.mock.calls)).toEqual(padListeners(added.mock.calls));
});
