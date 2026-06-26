// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeAll } from 'vitest';
import { InputState, GamepadButton } from '../src/input';
import { InputMap, Button, Key } from '../src/inputMap';
import type { GamepadSnapshot, PlatformAdapter } from '../src/platform/types';
import { setPlatform } from '../src/platform/base';

// save/load goes through the platform Storage; unit tests don't boot a real
// platform (that happens when importing "esengine"), so install an in-memory one.
beforeAll(() => {
    const mem = new Map<string, string>();
    setPlatform({
        getStorageItem: (k: string) => mem.get(k) ?? null,
        setStorageItem: (k: string, v: string) => { mem.set(k, v); },
        removeStorageItem: (k: string) => { mem.delete(k); },
    } as unknown as PlatformAdapter);
});

function padButtons(...pressed: number[]): GamepadSnapshot {
    const buttons = new Array(17).fill(0);
    for (const b of pressed) buttons[b] = 1;
    return { index: 0, connected: true, buttons, axes: new Array(4).fill(0), mapping: 'standard' };
}

describe('InputMap interactive rebind', () => {
    it('listenForBinding resolves on the next key press', async () => {
        const map = new InputMap({ Jump: Button(Key('Space')) });
        const input = new InputState();
        const p = map.listenForBinding();
        expect(map.isListening()).toBe(true);

        input.keysPressed.add('KeyJ');
        map.evaluate(input);

        expect(await p).toEqual({ kind: 'key', code: 'KeyJ' });
        expect(map.isListening()).toBe(false);
    });

    it('rebind captures and replaces the action binding', async () => {
        const map = new InputMap({ Jump: Button(Key('Space')) });
        const input = new InputState();
        const p = map.rebind('Jump');
        input.keysPressed.add('KeyK');
        map.evaluate(input);
        await p;

        expect(map.getBindings('Jump')).toEqual([{ kind: 'key', code: 'KeyK' }]);

        const i2 = new InputState();
        i2.keysDown.add('KeyK');
        map.evaluate(i2);
        expect(map.down('Jump')).toBe(true); // new binding live
    });

    it('captures a gamepad button when keyboard yields nothing', async () => {
        const map = new InputMap({ Fire: Button(Key('Space')) });
        const input = new InputState();
        const p = map.listenForBinding();
        input.updateGamepads([padButtons(GamepadButton.East)]); // pressed edge (prev was empty)
        map.evaluate(input);
        expect(await p).toEqual({ kind: 'gpButton', button: GamepadButton.East, pad: 0 });
    });

    it('cancelListen resolves null and a new listen supersedes the old', async () => {
        const map = new InputMap({ Jump: Button(Key('Space')) });
        const first = map.listenForBinding();
        const second = map.listenForBinding(); // supersedes first → first resolves null
        expect(await first).toBeNull();
        map.cancelListen();
        expect(await second).toBeNull();
        expect(map.isListening()).toBe(false);
    });

    it('ignores mouse unless opted in', async () => {
        const map = new InputMap({ X: Button(Key('Space')) });
        const input = new InputState();
        const p = map.listenForBinding(); // mouse off by default
        input.mouseButtonsPressed.add(0);
        map.evaluate(input);
        expect(map.isListening()).toBe(true); // not captured

        input.keysPressed.add('KeyM');
        map.evaluate(input);
        expect(await p).toEqual({ kind: 'key', code: 'KeyM' });
    });

    it('persists bindings through save / load', () => {
        const a = new InputMap({ Jump: Button(Key('Space')) });
        a.setBindings('Jump', [Key('KeyP')]);
        a.save('test-inputmap-persist');

        const b = new InputMap({ Jump: Button(Key('Space')) });
        expect(b.load('test-inputmap-persist')).toBe(true);
        expect(b.getBindings('Jump')).toEqual([{ kind: 'key', code: 'KeyP' }]);

        expect(new InputMap({ Jump: Button(Key('Space')) }).load('test-inputmap-absent-key')).toBe(false);
    });
});
