// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { InputState } from '../src/input';
import { defineInputMap, loadInputMapAsset, Axis2D, Button, Keys2D, Key } from '../src/inputMap';
import { AppContext, setDefaultContext } from '../src/context';

beforeEach(() => setDefaultContext(new AppContext()));

describe('.inputmap asset (data-driven input)', () => {
    it('round-trips through toAsset → JSON → loadInputMapAsset, preserving action types', () => {
        const Game = defineInputMap({
            Move: Axis2D(Keys2D('KeyW', 'KeyS', 'KeyA', 'KeyD')),
            Jump: Button(Key('Space')),
        });

        const asset = Game.toAsset();
        expect(asset.version).toBe(1);
        expect(asset.actions.Move.type).toBe('axis2d');
        expect(asset.actions.Jump.type).toBe('button');

        // The on-disk .inputmap shape, reloaded into a live map.
        const loaded = loadInputMapAsset(JSON.parse(JSON.stringify(asset)));

        const input = new InputState();
        input.keysDown.add('Space');
        input.keysDown.add('KeyD');
        loaded.evaluate(input);
        expect(loaded.down('Jump')).toBe(true);
        expect(loaded.axis2d('Move').x).toBeCloseTo(1); // KeyD → +x
    });

    it('exposes pointerOverUI for gameplay to gate on (UI-claimed input)', () => {
        const s = new InputState();
        expect(s.isPointerOverUI()).toBe(false);
        s.pointerOverUI = true; // set each frame by the UI interaction system
        expect(s.isPointerOverUI()).toBe(true);
    });
});
