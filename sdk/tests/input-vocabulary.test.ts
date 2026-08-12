// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  input-vocabulary.test.ts — the frozen half of the input surface.
 *
 * The action/binding vocabulary is what freezes in 0.50; the raw per-frame state
 * stays @beta. So what is pinned here is the part a game DECLARES: that each
 * binding kind reads the source it names, that the three action types answer
 * through the three different queries, and that a map round-trips through the
 * asset shape — the claims a rebind UI and a shipped `.inputmap` both rest on.
 */
import { describe, it, expect } from 'vitest';
import {
    defineInputMap, InputMap, InputState, GamepadAxis, GamepadButton,
    Key, MouseButton, GpButton, GpAxis, Keys1D, Keys2D, Stick, Virtual,
    Button, Axis1D, Axis2D,
} from '../src/core';
import type { ActionDef, ActionType, Binding, InputMapAsset, ListenOptions } from '../src/core';

/** A pad reporting one axis and one button, as the platform would. */
function padded(input: InputState, axes: number[], buttons: number[] = []) {
    input.updateGamepads([{ index: 0, connected: true, axes, buttons }]);
}

describe('binding vocabulary', () => {
    it('every constructor answers the Binding kind it is named for', () => {
        const bindings: Binding[] = [
            Key('KeyW'), MouseButton(0), GpButton(GamepadButton.South), GpAxis(GamepadAxis.LeftX),
            Keys1D('KeyA', 'KeyD'), Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'), Stick('left'), Virtual('pad'),
        ];
        expect(bindings.map((b) => b.kind)).toEqual([
            'key', 'mouse', 'gpButton', 'gpAxis', 'keys1d', 'keys2d', 'stick', 'virtual',
        ]);
    });

    it('a key binding is a physical code, not the character it types', () => {
        const map = defineInputMap({ Fire: Button(Key('KeyZ')) });
        const input = new InputState();
        input.noteKeyDown('KeyY');
        map.evaluate(input);
        expect(map.down('Fire')).toBe(false);
        input.noteKeyDown('KeyZ');
        map.evaluate(input);
        expect(map.down('Fire')).toBe(true);
    });

    it('a mouse binding reads the DOM button numbering', () => {
        const map = defineInputMap({ Fire: Button(MouseButton(2)) });
        const input = new InputState();
        input.noteMouseDown(0);
        map.evaluate(input);
        expect(map.down('Fire')).toBe(false);
        input.noteMouseDown(2);
        map.evaluate(input);
        expect(map.down('Fire')).toBe(true);
    });

    it('Keys1D is a signed axis and both keys cancel', () => {
        const map = defineInputMap({ Throttle: Axis1D(Keys1D('KeyA', 'KeyD')) });
        const input = new InputState();
        input.noteKeyDown('KeyD');
        map.evaluate(input);
        expect(map.value('Throttle')).toBe(1);
        input.noteKeyDown('KeyA');
        map.evaluate(input);
        expect(map.value('Throttle')).toBe(0);
    });

    it('Keys2D puts up at +y, so screen coordinates do not leak into gameplay', () => {
        const map = defineInputMap({ Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD')) });
        const input = new InputState();
        input.noteKeyDown('KeyW');
        input.noteKeyDown('KeyD');
        map.evaluate(input);
        const move = map.axis2d('Move');
        expect(move.y).toBeGreaterThan(0);
        expect(move.x).toBeGreaterThan(0);
    });

    it('GpAxis scale inverts a reading, which is why a stick can point up', () => {
        const map = defineInputMap({
            Raw: Axis1D(GpAxis(GamepadAxis.RightY)),
            Inverted: Axis1D(GpAxis(GamepadAxis.RightY, 0, -1)),
        });
        const input = new InputState();
        padded(input, [0, 0, 0, 1]);
        map.evaluate(input);
        expect(map.value('Raw')).toBeCloseTo(1, 5);
        expect(map.value('Inverted')).toBeCloseTo(-1, 5);
    });

    it('Stick answers +y for up, matching Keys2D rather than the raw axis', () => {
        const map = defineInputMap({ Move: Axis2D(Stick('left')) });
        const input = new InputState();
        // Raw stick Y grows downward; the binding is what flips it.
        padded(input, [0, -1, 0, 0]);
        map.evaluate(input);
        expect(map.axis2d('Move').y).toBeGreaterThan(0);
    });

    it('Virtual reads what the game wrote, so a touch stick needs no new kind', () => {
        const map = defineInputMap({ Move: Axis2D(Virtual('stick')) });
        const input = new InputState();
        input.setVirtual('stick', 0.5, 0.25);
        map.evaluate(input);
        expect(map.axis2d('Move')).toEqual({ x: 0.5, y: 0.25 });
    });
});

describe('action vocabulary', () => {
    it('the three action types carry the three ActionType values', () => {
        const button: ActionDef = Button(Key('Space'));
        const axis: ActionDef = Axis1D(Keys1D('KeyA', 'KeyD'));
        const axis2d: ActionDef = Axis2D(Stick('left'));
        const types: ActionType[] = [button.type, axis.type, axis2d.type];
        expect(types).toEqual(['button', 'axis', 'axis2d']);
    });

    it('bindings are alternatives, so either source drives the action', () => {
        const map = defineInputMap({
            Fire: Button(Key('Space'), GpButton(GamepadButton.South)),
        });
        const input = new InputState();
        padded(input, [], [1]);
        map.evaluate(input);
        expect(map.down('Fire')).toBe(true);

        const keyboard = new InputState();
        keyboard.noteKeyDown('Space');
        map.evaluate(keyboard);
        expect(map.down('Fire')).toBe(true);
    });

    it('pressed and released are edges, down is the level', () => {
        const map = defineInputMap({ Fire: Button(Key('Space')) });
        const held = new InputState();
        held.noteKeyDown('Space');

        map.evaluate(held);
        expect([map.pressed('Fire'), map.down('Fire'), map.released('Fire')]).toEqual([true, true, false]);
        map.evaluate(held);
        expect([map.pressed('Fire'), map.down('Fire'), map.released('Fire')]).toEqual([false, true, false]);
        map.evaluate(new InputState());
        expect([map.pressed('Fire'), map.down('Fire'), map.released('Fire')]).toEqual([false, false, true]);
    });

    it('an analog source counts as down past half its range', () => {
        const map = defineInputMap({ Fire: Button(GpButton(GamepadButton.RightTrigger)) });
        const input = new InputState();
        padded(input, [], [0, 0, 0, 0, 0, 0, 0, 0.3]);
        map.evaluate(input);
        expect(map.down('Fire')).toBe(false);
        padded(input, [], [0, 0, 0, 0, 0, 0, 0, 0.8]);
        map.evaluate(input);
        expect(map.down('Fire')).toBe(true);
    });
});

describe('input map vocabulary', () => {
    it('defineInputMap answers an InputMap listing what it was given', () => {
        const map: InputMap = defineInputMap({ Move: Axis2D(Stick('left')), Fire: Button(Key('Space')) });
        expect(map.actions().sort()).toEqual(['Fire', 'Move']);
    });

    it('a map round-trips through the asset shape it ships as', () => {
        const map = defineInputMap({ Fire: Button(Key('Space'), MouseButton(0)) });
        const asset: InputMapAsset = map.toAsset();
        expect(asset.actions.Fire.type).toBe('button');
        expect(asset.actions.Fire.bindings.map((b) => b.kind)).toEqual(['key', 'mouse']);
    });

    it('setBindings replaces what a rebind persists, and toJSON is bindings only', () => {
        const map = defineInputMap({ Fire: Button(Key('Space')) });
        map.setBindings('Fire', [Key('KeyF')]);
        expect(map.getBindings('Fire')).toEqual([Key('KeyF')]);
        expect(map.toJSON()).toEqual({ Fire: [Key('KeyF')] });
    });

    it('a listen captures the next press and ignores a device it was not asked for', async () => {
        const map = defineInputMap({ Fire: Button(Key('Space')) });
        const opts: ListenOptions = { keyboard: false, mouse: true };
        const pending = map.rebind('Fire', opts);
        expect(map.isListening()).toBe(true);

        const keyOnly = new InputState();
        keyOnly.noteKeyDown('KeyQ');
        map.evaluate(keyOnly);
        expect(map.isListening()).toBe(true);

        const clicked = new InputState();
        clicked.noteMouseDown(1);
        map.evaluate(clicked);
        expect(await pending).toEqual(MouseButton(1));
        expect(map.getBindings('Fire')).toEqual([MouseButton(1)]);
    });

    it('cancelListen resolves with null rather than leaving a promise hanging', async () => {
        const map = defineInputMap({ Fire: Button(Key('Space')) });
        const pending = map.listenForBinding();
        map.cancelListen();
        expect(await pending).toBeNull();
        expect(map.isListening()).toBe(false);
    });
});
