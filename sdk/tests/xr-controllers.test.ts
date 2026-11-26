// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  VR controllers: their buttons and sticks as input, actions bound to them, and the entities that follow them.
 */
import { describe, expect, it } from 'vitest';
import { InputState, XRAxis, XRButton, xrPadIndex } from '../src/input/input';
import { Axis2D, Button, InputMap, XrButton, XrStick } from '../src/input/inputMap';
import { World } from '../src/ecs/world';
import { Parent, Transform } from '../src/ecs/component';
import type { App } from '../src/app/app';
import { setXRPresentation, type XRControllerState, type XRPresentationState } from '../src/xr/xrPresentation';
import { syncXRPoses, XRController, XRControllerPose, XRHead } from '../src/xr/xrComponents';
import { setWorldUnitsPerMeter } from '../src/ecs/worldUnits';
import { createMockModule } from './mocks/wasm';

const connected = (): World => {
    const world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
};

const controller = (hand: 'left' | 'right', buttons: number[] = [], axes: number[] = []): XRControllerState => ({
    hand, grip: null, aim: null, buttons, touched: buttons.map(() => false), axes, profiles: [],
});

describe('VR controller input', () => {
    it('tells pressed, down and released apart per hand, as a gamepad does', () => {
        const input = new InputState();
        input.updateXRControllers([controller('right', [1])]);
        expect(input.isXRControllerConnected('right')).toBe(true);
        expect(input.isXRControllerConnected('left')).toBe(false);
        expect(input.isXRButtonPressed(XRButton.Trigger, 'right')).toBe(true);
        expect(input.isXRButtonDown(XRButton.Trigger, 'right')).toBe(true);
        expect(input.isXRButtonDown(XRButton.Trigger, 'left')).toBe(false);
        input.updateXRControllers([controller('right', [1])]);
        expect(input.isXRButtonPressed(XRButton.Trigger, 'right')).toBe(false);
        expect(input.isXRButtonDown(XRButton.Trigger, 'right')).toBe(true);
        input.updateXRControllers([controller('right', [0.2])]);
        expect(input.isXRButtonReleased(XRButton.Trigger, 'right')).toBe(true);
        expect(input.getXRButtonValue(XRButton.Trigger, 'right')).toBeCloseTo(0.2);
    });

    it('applies the dead zone to sticks, and forgets a controller that is no longer tracked', () => {
        const input = new InputState();
        input.updateXRControllers([controller('left', [], [0, 0, 0.1, -0.8])]);
        expect(input.getXRAxis(XRAxis.ThumbstickX, 'left')).toBe(0);
        expect(input.getXRAxis(XRAxis.ThumbstickY, 'left')).toBeCloseTo(-0.8);
        input.updateXRControllers([]);
        expect(input.isXRControllerConnected('left')).toBe(false);
        expect(input.getXRAxis(XRAxis.ThumbstickY, 'left')).toBe(0);
    });

    it('are gamepads at indices of their own, which the poll of real pads leaves alone', () => {
        const input = new InputState();
        input.updateXRControllers([controller('right', [1])]);
        // The page's pads are polled every frame; a VR controller is not among them and must not be marked gone.
        input.updateGamepads([]);
        expect(input.isXRControllerConnected('right')).toBe(true);
        expect(input.isGamepadButtonDown(XRButton.Trigger, xrPadIndex('right'))).toBe(true);
        expect(input.getGamepads()).toContain(xrPadIndex('right'));
    });

    it('presses again a button held while the controller was lost', () => {
        const input = new InputState();
        input.updateXRControllers([controller('right', [1])]);
        input.updateXRControllers([]);
        input.updateXRControllers([controller('right', [1])]);
        expect(input.isXRButtonPressed(XRButton.Trigger, 'right')).toBe(true);
    });

    it('drives actions bound to its buttons and stick', () => {
        const map = new InputMap({
            Fire: Button(XrButton(XRButton.Trigger, 'right')),
            Move: Axis2D(XrStick('left')),
        });
        const input = new InputState();
        input.updateXRControllers([controller('right', [1]), controller('left', [], [0, 0, 0.5, -1])]);
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(true);
        // Pushed away from the player (axis -1) is forward, +y, as Keys2D's up is; the stick's direction is kept.
        const move = map.axis2d('Move');
        expect(move.y).toBeGreaterThan(0);
        expect(move.x / move.y).toBeCloseTo(0.5);
    });

    it('takes a VR button when listening for a rebind', async () => {
        const map = new InputMap({ Fire: Button() });
        const input = new InputState();
        const heard = map.listenForBinding();
        input.updateXRControllers([controller('left', [0, 0, 0, 0, 1])]);
        map.evaluate(input);
        expect(await heard).toEqual(XrButton(XRButton.Primary, 'left'));
    });
});

describe('entities that follow the headset', () => {
    const presenting = (world: World, rig: number, controllers: XRControllerState[]): App => {
        const app = { world } as unknown as App;
        const state: XRPresentationState = {
            views: [], framebufferWidth: 0, framebufferHeight: 0,
            headPosition: { x: 0, y: 0.1, z: 0 }, headOrientation: { x: 0, y: 0, z: 0, w: 1 },
            depthNear: 0.1, depthFar: 100, wantNear: 0.1, wantFar: 100, controllers, rigEntity: rig,
            frameActive: true, drawnFrames: 0, missedFrames: 0,
        };
        setXRPresentation(app, state);
        return app;
    };

    it('puts a controller entity where the controller is, through the rig', () => {
        setWorldUnitsPerMeter(100);
        const world = connected();
        const rig = world.spawn();
        // The rig a quarter turn left, at (500, 150, 0): the player's right is -Z.
        const turn = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
        world.insert(rig, Transform, { worldPosition: { x: 500, y: 150, z: 0 }, worldRotation: turn });
        const hand = world.spawn();
        world.insert(hand, Transform);
        world.insert(hand, XRController, { hand: 1, pose: XRControllerPose.Grip });
        const head = world.spawn();
        world.insert(head, Transform);
        world.insert(head, XRHead);
        const right = controller('right');
        right.grip = { position: { x: 0.3, y: -0.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
        syncXRPoses(presenting(world, rig, [right]));
        const p = world.get(hand, Transform).position;
        expect(p.x).toBeCloseTo(500);
        expect(p.y).toBeCloseTo(130);
        expect(p.z).toBeCloseTo(-30);
        expect(world.get(head, Transform).position.y).toBeCloseTo(160);
    });

    it('gives a child the local pose that puts it there, and leaves an untracked hand where it was', () => {
        setWorldUnitsPerMeter(100);
        const world = connected();
        const rig = world.spawn();
        world.insert(rig, Transform, { worldPosition: { x: 0, y: 0, z: 0 } });
        const parent = world.spawn();
        world.insert(parent, Transform, { worldPosition: { x: 10, y: 0, z: 0 }, worldScale: { x: 2, y: 2, z: 2 } });
        const hand = world.spawn();
        world.insert(hand, Transform);
        world.insert(hand, Parent, { entity: parent });
        world.insert(hand, XRController, { hand: 0, pose: XRControllerPose.Aim });
        const left = controller('left');
        left.aim = { position: { x: 0.5, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
        syncXRPoses(presenting(world, rig, [left]));
        // World x 50 is 40 from the parent, which is scaled by 2: 20 locally.
        expect(world.get(hand, Transform).position.x).toBeCloseTo(20);

        const other = world.spawn();
        world.insert(other, Transform, { position: { x: 7, y: 7, z: 7 } });
        world.insert(other, XRController, { hand: 1, pose: XRControllerPose.Grip });
        syncXRPoses(presenting(world, rig, [left]));
        expect(world.get(other, Transform).position).toEqual({ x: 7, y: 7, z: 7 });
    });
});
