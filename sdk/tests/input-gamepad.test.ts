// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { InputState, GamepadButton, GamepadAxis } from '../src/input';
import type { GamepadSnapshot } from '../src/platform/types';

/** Build a standard-layout snapshot (17 buttons / 4 axes) with specific overrides. */
function pad(o: {
    index?: number;
    connected?: boolean;
    buttons?: Record<number, number>;
    axes?: Record<number, number>;
} = {}): GamepadSnapshot {
    const buttons = new Array(17).fill(0);
    const axes = new Array(4).fill(0);
    for (const [k, v] of Object.entries(o.buttons ?? {})) buttons[+k] = v;
    for (const [k, v] of Object.entries(o.axes ?? {})) axes[+k] = v;
    return { index: o.index ?? 0, connected: o.connected ?? true, buttons, axes, mapping: 'standard' };
}

describe('InputState gamepad', () => {
    it('reports connected pads and button-down state', () => {
        const s = new InputState();
        expect(s.getGamepads()).toEqual([]);
        s.updateGamepads([pad({ buttons: { [GamepadButton.South]: 1 } })]);
        expect(s.getGamepads()).toEqual([0]);
        expect(s.isGamepadConnected(0)).toBe(true);
        expect(s.isGamepadButtonDown(GamepadButton.South)).toBe(true);
        expect(s.isGamepadButtonDown(GamepadButton.East)).toBe(false);
    });

    it('detects pressed/released edges across frames', () => {
        const s = new InputState();
        s.updateGamepads([pad({})]); // up
        expect(s.isGamepadButtonPressed(GamepadButton.South)).toBe(false);
        s.updateGamepads([pad({ buttons: { [GamepadButton.South]: 1 } })]); // down
        expect(s.isGamepadButtonPressed(GamepadButton.South)).toBe(true);
        expect(s.isGamepadButtonDown(GamepadButton.South)).toBe(true);
        s.updateGamepads([pad({ buttons: { [GamepadButton.South]: 1 } })]); // held
        expect(s.isGamepadButtonPressed(GamepadButton.South)).toBe(false);
        s.updateGamepads([pad({})]); // up
        expect(s.isGamepadButtonReleased(GamepadButton.South)).toBe(true);
    });

    it('treats analog triggers via threshold and exposes the raw value', () => {
        const s = new InputState();
        s.updateGamepads([pad({ buttons: { [GamepadButton.RightTrigger]: 0.3 } })]);
        expect(s.isGamepadButtonDown(GamepadButton.RightTrigger)).toBe(false); // below 0.5
        expect(s.getGamepadButtonValue(GamepadButton.RightTrigger)).toBeCloseTo(0.3);
        s.updateGamepads([pad({ buttons: { [GamepadButton.RightTrigger]: 0.8 } })]);
        expect(s.isGamepadButtonDown(GamepadButton.RightTrigger)).toBe(true);
    });

    it('applies a deadzone to axes', () => {
        const s = new InputState();
        s.updateGamepads([pad({ axes: { [GamepadAxis.LeftX]: 0.1, [GamepadAxis.LeftY]: 0.6 } })]);
        expect(s.getGamepadAxis(GamepadAxis.LeftX)).toBe(0); // inside deadzone
        expect(s.getGamepadAxis(GamepadAxis.LeftY)).toBeCloseTo(0.6);
    });

    it('marks pads disconnected when absent from a poll', () => {
        const s = new InputState();
        s.updateGamepads([pad({})]);
        expect(s.isGamepadConnected(0)).toBe(true);
        s.updateGamepads([]); // nothing polled this frame
        expect(s.isGamepadConnected(0)).toBe(false);
        expect(s.getGamepads()).toEqual([]);
        expect(s.isGamepadButtonDown(GamepadButton.South)).toBe(false);
    });

    it('supports multiple pads by index', () => {
        const s = new InputState();
        s.updateGamepads([
            pad({ index: 0, buttons: { [GamepadButton.South]: 1 } }),
            pad({ index: 1, buttons: { [GamepadButton.North]: 1 } }),
        ]);
        expect(s.getGamepads()).toEqual([0, 1]);
        expect(s.isGamepadButtonDown(GamepadButton.South, 0)).toBe(true);
        expect(s.isGamepadButtonDown(GamepadButton.South, 1)).toBe(false);
        expect(s.isGamepadButtonDown(GamepadButton.North, 1)).toBe(true);
    });
});
