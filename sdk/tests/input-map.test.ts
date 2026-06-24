// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { InputState, GamepadButton, GamepadAxis } from '../src/input';
import {
    InputMap, Button, Axis1D, Axis2D,
    Key, MouseButton, GpButton, Keys1D, Keys2D, Stick,
} from '../src/inputMap';
import type { GamepadSnapshot } from '../src/platform/types';

function pad(o: { buttons?: Record<number, number>; axes?: Record<number, number> } = {}): GamepadSnapshot {
    const buttons = new Array(17).fill(0), axes = new Array(4).fill(0);
    for (const [k, v] of Object.entries(o.buttons ?? {})) buttons[+k] = v;
    for (const [k, v] of Object.entries(o.axes ?? {})) axes[+k] = v;
    return { index: 0, connected: true, buttons, axes, mapping: 'standard' };
}

describe('InputMap', () => {
    it('evaluates a button action from key OR gamepad', () => {
        const map = new InputMap({ Jump: Button(Key('Space'), GpButton(GamepadButton.South)) });
        const input = new InputState();
        map.evaluate(input);
        expect(map.down('Jump')).toBe(false);

        input.keysDown.add('Space');
        map.evaluate(input);
        expect(map.down('Jump')).toBe(true);
        expect(map.pressed('Jump')).toBe(true);

        input.keysDown.delete('Space');
        input.updateGamepads([pad({ buttons: { [GamepadButton.South]: 1 } })]);
        map.evaluate(input);
        expect(map.down('Jump')).toBe(true);     // still down via gamepad
        expect(map.pressed('Jump')).toBe(false); // was already down last frame
    });

    it('detects pressed / released edges', () => {
        const map = new InputMap({ Fire: Button(MouseButton(0)) });
        const input = new InputState();
        map.evaluate(input);
        input.mouseButtons.add(0);
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(true);
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false); // held
        input.mouseButtons.delete(0);
        map.evaluate(input);
        expect(map.released('Fire')).toBe(true);
    });

    it('composes a 1D axis from two keys', () => {
        const map = new InputMap({ Throttle: Axis1D(Keys1D('KeyS', 'KeyW')) });
        const input = new InputState();
        input.keysDown.add('KeyW');
        map.evaluate(input);
        expect(map.value('Throttle')).toBe(1);
        input.keysDown.add('KeyS'); // both → cancel
        map.evaluate(input);
        expect(map.value('Throttle')).toBe(0);
        input.keysDown.delete('KeyW');
        map.evaluate(input);
        expect(map.value('Throttle')).toBe(-1);
    });

    it('composes a 2D axis from WASD, up = +y, normalized', () => {
        const map = new InputMap({ Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD')) });
        const input = new InputState();
        input.keysDown.add('KeyW');
        input.keysDown.add('KeyD');
        map.evaluate(input);
        const v = map.axis2d('Move');
        expect(v.x).toBeCloseTo(Math.SQRT1_2);
        expect(v.y).toBeCloseTo(Math.SQRT1_2);
        expect(map.value('Move')).toBeCloseTo(1);
    });

    it('reads a stick into axis2d with Y inverted and deadzone applied', () => {
        const map = new InputMap({ Move: Axis2D(Stick('left')) });
        const input = new InputState();
        input.updateGamepads([pad({ axes: { [GamepadAxis.LeftX]: 0.05, [GamepadAxis.LeftY]: -0.9 } })]);
        map.evaluate(input);
        const v = map.axis2d('Move');
        expect(v.x).toBe(0);          // 0.05 inside deadzone
        expect(v.y).toBeCloseTo(0.9); // stick up (raw Y -0.9) → +y
    });

    it('combines keyboard and stick on one axis2d (clamped to unit)', () => {
        const map = new InputMap({ Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'), Stick('left')) });
        const input = new InputState();
        input.keysDown.add('KeyD');                                       // +x = 1
        input.updateGamepads([pad({ axes: { [GamepadAxis.LeftX]: 1 } })]); // +x = 1
        map.evaluate(input);
        const v = map.axis2d('Move');
        expect(v.x).toBeCloseTo(1); // 2 clamped to unit length
        expect(v.y).toBe(0);
    });

    it('rebinds and round-trips through JSON', () => {
        const map = new InputMap({ Jump: Button(Key('Space')) });
        const input = new InputState();
        input.keysDown.add('KeyZ');
        map.evaluate(input);
        expect(map.down('Jump')).toBe(false);

        map.setBindings('Jump', [Key('KeyZ')]);
        map.evaluate(input);
        expect(map.down('Jump')).toBe(true);

        const saved = JSON.parse(JSON.stringify(map.toJSON()));
        const map2 = new InputMap({ Jump: Button(Key('Space')) });
        map2.loadJSON(saved);
        map2.evaluate(input);
        expect(map2.down('Jump')).toBe(true); // rebind persisted

        map2.loadJSON({ Ghost: [Key('KeyQ')] }); // unknown action ignored
        expect(map2.actions()).toEqual(['Jump']);
    });
});
