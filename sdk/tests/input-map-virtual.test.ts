// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The input a touch device actually has.
 *
 * A phone has no keys and no sticks. What it has is a thumb on a control the
 * game drew, and that control knows where it is because the UI put it there —
 * so it feeds its value in by name rather than an action being bound to a
 * rectangle of the screen, which is a rectangle that goes stale the first time
 * the layout moves.
 */
import { describe, it, expect } from 'vitest';
import { InputState } from '../src/input/input';
import { InputMap, Button, Axis2D, Key, Keys2D, Virtual } from '../src/input/inputMap';

describe('Virtual bindings', () => {
    it('drives a 2D action with no keyboard in sight', () => {
        const map = new InputMap({ Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD'), Virtual('move')) });
        const input = new InputState();

        map.evaluate(input);
        expect(map.axis2d('Move')).toEqual({ x: 0, y: 0 });

        input.setVirtual('move', 0.6, -0.8);
        map.evaluate(input);
        expect(map.axis2d('Move').x).toBeCloseTo(0.6);
        expect(map.axis2d('Move').y).toBeCloseTo(-0.8);
    });

    it('drives a button, edges and all', () => {
        const map = new InputMap({ Attack: Button(Key('Space'), Virtual('attack')) });
        const input = new InputState();

        input.setVirtual('attack', 1);
        map.evaluate(input);
        expect(map.pressed('Attack')).toBe(true);
        expect(map.down('Attack')).toBe(true);

        map.evaluate(input);
        expect(map.pressed('Attack'), 'a held control keeps re-pressing').toBe(false);
        expect(map.down('Attack')).toBe(true);

        // A control that stops reporting has to say so, exactly like a key
        // coming up — nothing clears these between frames.
        input.setVirtual('attack', 0);
        map.evaluate(input);
        expect(map.released('Attack')).toBe(true);
    });

    it('adds to the same action a key drives, and stays clamped', () => {
        const map = new InputMap({ Attack: Button(Key('Space'), Virtual('attack')) });
        const input = new InputState();
        input.keysDown.add('Space');
        input.setVirtual('attack', 1);
        map.evaluate(input);
        expect(map.value('Attack')).toBe(1);
    });

    it('reads zero for a name nobody ever wrote', () => {
        const map = new InputMap({ Move: Axis2D(Virtual('never-set')) });
        const input = new InputState();
        map.evaluate(input);
        expect(map.axis2d('Move')).toEqual({ x: 0, y: 0 });
    });

    // The binding model is the serialization format, so a rebind or a shipped
    // `.inputmap` carries on-screen controls like anything else.
    it('survives a round trip through the binding format', () => {
        const map = new InputMap({ Move: Axis2D(Virtual('move')) });
        const back = new InputMap({ Move: Axis2D(Key('KeyW')) });
        back.loadJSON(map.toJSON());
        const input = new InputState();
        input.setVirtual('move', 1, 0);
        back.evaluate(input);
        expect(back.axis2d('Move').x).toBeCloseTo(1);
    });
});
