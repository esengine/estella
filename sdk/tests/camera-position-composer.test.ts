// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PositionComposer: a camera slides, without turning, so its target sits at its screen point; the dead zone
 *        leaves it still, the soft zone is a wall the target never crosses, and a 3D camera keeps its distance.
 *        Pure logic over a mock world.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Camera, ProjectionType } from '../src/ecs/component';
import { PositionComposer, composeAxis, composeStep, positionComposerUpdate, type PositionComposerData } from '../src/camera/PositionComposer';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const composer = (over: Partial<PositionComposerData> = {}): PositionComposerData => ({
  target: 1, offsetX: 0, offsetY: 0, offsetZ: 0, screenX: 0.5, screenY: 0.5, deadzoneWidth: 0, deadzoneHeight: 0,
  softzoneWidth: 0.8, softzoneHeight: 0.8, damping: 0, cameraDistance: 0, depthDamping: 0, ...over,
});
const ortho = { projectionType: ProjectionType.Orthographic, orthoSize: 100, fov: 60 } as never;
const persp = { projectionType: ProjectionType.Perspective, orthoSize: 100, fov: 90 } as never;

describe('composeAxis', () => {
  it('leaves the camera still inside the dead zone and brings the target to its edge outside it', () => {
    expect(composeAxis(0.55, 0.5, 0.2, 0.8, 1)).toBe(0);
    expect(composeAxis(0.7, 0.5, 0.2, 0.8, 1)).toBeCloseTo(0.1, 9);
    expect(composeAxis(0.3, 0.5, 0.2, 0.8, 1)).toBeCloseTo(-0.1, 9);
  });

  it('eases inside the soft zone and takes the excess past it at once', () => {
    expect(composeAxis(0.7, 0.5, 0, 0.8, 0.5)).toBeCloseTo(0.1, 9);
    // 0.45 off, soft half 0.4: 0.05 at once, then half of the remaining 0.4.
    expect(composeAxis(0.95, 0.5, 0, 0.8, 0.5)).toBeCloseTo(0.05 + 0.2, 9);
  });
});

describe('composeStep', () => {
  it('puts a 2D target at its screen point, measured on the orthographic screen', () => {
    // A 200-tall, 400-wide screen; the target at the camera's centre is held a quarter in from the left.
    const next = composeStep({ x: 0, y: 0, z: 10 }, IDENTITY, { x: 0, y: 0, z: 0 }, ortho, 2, composer({ screenX: 0.25 }), 1 / 60);
    expect(next.x).toBeCloseTo(100, 6);
    expect(next.y).toBeCloseTo(0, 6);
    expect(next.z).toBe(10);
  });

  it('measures a perspective screen at the target\'s depth, and keeps the distance asked for', () => {
    // fov 90 at depth 300: the screen is 600 tall and 600 wide at aspect 1.
    const next = composeStep({ x: 0, y: 0, z: 500 }, IDENTITY, { x: 0, y: 0, z: 0 }, persp, 1, composer({ screenY: 0.6, cameraDistance: 300 }), 1 / 60);
    expect(next.z).toBeCloseTo(300, 6);
    expect(next.y).toBeCloseTo(-60, 6);
  });

  it('slides across a turned camera\'s own screen, not the world\'s', () => {
    // Turned a quarter about up: it looks down -X, its right is -Z.
    const s = Math.SQRT1_2;
    const turned = { x: 0, y: s, z: 0, w: s };
    const next = composeStep({ x: 500, y: 0, z: 0 }, turned, { x: 0, y: 0, z: 0 }, persp, 1, composer({ screenX: 0.25 }), 1 / 60);
    expect(next.x).toBeCloseTo(500, 6);
    // Held left of centre: the camera moves to its right (world -Z here), by a quarter of a 1000-wide screen.
    expect(next.z).toBeCloseTo(-250, 6);
  });
});

describe('positionComposerUpdate', () => {
  let world: World;
  let hero: Entity;
  let cam: Entity;
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    hero = world.spawn('hero');
    world.insert(hero, Transform, { position: { x: 300, y: 50, z: 0 }, worldPosition: { x: 300, y: 50, z: 0 } });
    cam = world.spawn('camera');
    world.insert(cam, Transform, { position: { x: 0, y: 0, z: 10 }, worldPosition: { x: 0, y: 0, z: 10 } });
    world.insert(cam, Camera, { projectionType: ProjectionType.Orthographic, orthoSize: 100, viewport: { x: 0, y: 0, z: 1, w: 1 } });
  });

  it('brings a 2D camera onto its target, and holds it still while the target stays in the dead zone', () => {
    world.insert(cam, PositionComposer, { target: hero, damping: 0, softzoneWidth: 2, softzoneHeight: 2, deadzoneWidth: 0.1, deadzoneHeight: 0.1 });
    positionComposerUpdate(world, 1 / 60, 2);
    const p = world.get(cam, Transform).worldPosition;
    // To the dead zone's edge: 0.05 of a 400-wide screen short in x, of a 200-tall one in y.
    expect(p.x).toBeCloseTo(300 - 20, 4);
    expect(p.y).toBeCloseTo(50 - 10, 4);
    world.insert(hero, Transform, { position: { x: 290, y: 50, z: 0 }, worldPosition: { x: 290, y: 50, z: 0 } });
    positionComposerUpdate(world, 1 / 60, 2);
    expect(world.get(cam, Transform).worldPosition.x).toBeCloseTo(280, 4);
  });

  it('never lets the target past the soft zone, however much damping there is', () => {
    world.insert(cam, PositionComposer, { target: hero, damping: 10, softzoneWidth: 0.5, softzoneHeight: 0.5 });
    positionComposerUpdate(world, 1 / 60, 2);
    const p = world.get(cam, Transform).worldPosition;
    // Held within a quarter of the 400-wide screen of the point: the camera is at least 300 - 100 across.
    expect(300 - p.x).toBeLessThanOrEqual(100 + 1e-6);
    expect(300 - p.x).toBeGreaterThan(99);
  });
});
