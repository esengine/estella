// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The real solver under the character: each of these is a thing the mover got wrong or could not do, measured where a player would feel it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import { setPlayMode } from '../src/ecs/env';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { CharacterController2D, CharacterDynamicBodies } from '../src/physics/CharacterController2D';
import { PlatformerController2D } from '../src/physics/PlatformerController2D';
import { RigidBody2D, BoxCollider2D, CapsuleCollider2D, PolygonCollider2D, OneWayPlatform2D, BodyType } from '../src/physics/PhysicsComponents';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); setPlayMode(false); });

/** The capsule's foot rests this far below its origin: half height + radius + what is left of the default skin. */
const FOOT = 25.5;
const GRAVITY = -1600;

async function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 }, fixedTimestep: 1 / 60 }, async () => module));
    await app.getResource(Physics2DRuntime).initPromise;
    const world = app.world;
    const box = (x: number, y: number, hw: number, hh: number, type: number = BodyType.Static, sensor = false): Entity => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x, y, z: 0 } });
        world.insert(e, RigidBody2D, { bodyType: type, gravityScale: 0 });
        world.insert(e, BoxCollider2D, { halfExtents: { x: hw / 100, y: hh / 100 }, isSensor: sensor } as never);
        return e;
    };
    const oneWay = (x: number, y: number, hw: number, hh: number): Entity => {
        const e = box(x, y, hw, hh);
        world.insert(e, OneWayPlatform2D, { normal: { x: 0, y: 1 }, enabled: true });
        return e;
    };
    const slope = (degrees: number): number => {
        const t = Math.tan(degrees * Math.PI / 180), e = world.spawn(), L = 8;
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(e, PolygonCollider2D, { vertices: [{ x: -L, y: -L * t - 1 }, { x: L, y: L * t - 1 }, { x: L, y: L * t }, { x: -L, y: -L * t }] } as never);
        return t;
    };
    const capsule = (x: number, y: number, fields: Record<string, unknown> = {}): Entity => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x, y, z: 0 } });
        world.insert(e, CapsuleCollider2D, { radius: 0.1, halfHeight: 0.15 });
        world.insert(e, CharacterController2D, { snapLength: 8, ...fields } as never);
        return e;
    };
    const player = (x: number, y: number, fields: Record<string, unknown> = {}, cc: Record<string, unknown> = {}): Entity => {
        const e = capsule(x, y, cc);
        world.insert(e, PlatformerController2D, { readKeyboard: false, ...fields } as never);
        return e;
    };
    // A bare controller is told what to want by gravity and a steady walk.
    const drive = { vx: 0, gravity: GRAVITY };
    app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
        for (const e of world.getEntitiesWithComponents([CharacterController2D])) {
            if (world.has(e, PlatformerController2D)) continue;
            world.update(e, CharacterController2D, (c) => { c.velocity.x = drive.vx; c.velocity.y += drive.gravity / 60; });
        }
    }, { name: 'Drive' }), { runBefore: ['CharacterController2DSystem'] });
    const at = (e: Entity) => world.get(e, Transform).position;
    const cc = (e: Entity) => world.get(e, CharacterController2D);
    const run = (n: number) => app.stepFrames(n, 1 / 60);
    const press = (e: Entity, fields: Record<string, unknown>) => world.update(e, PlatformerController2D, (p) => { Object.assign(p, fields); });
    return { app, world, module, box, oneWay, slope, capsule, player, drive, at, cc, run, press };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('a 2D character on the real solver', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    describe('slopes', () => {
        it.each([20, 30, 44])('stands still on a walkable %s degree slope', async (degrees) => {
            const s = await scene(); s.slope(degrees);
            const c = s.capsule(-100, 200); await s.run(90);
            expect(s.cc(c).isOnFloor).toBe(true);
            const x = s.at(c).x, y = s.at(c).y;
            await s.run(120);
            expect(s.at(c).x).toBeCloseTo(x, 1); expect(s.at(c).y).toBeCloseTo(y, 1);
        });

        it.each([[30, 1], [30, -1], [44, 1], [44, -1]])('walks %s degrees at the speed across the ground it asks for, way %s, without leaving it', async (degrees, way) => {
            const s = await scene(); const t = s.slope(degrees);
            const c = s.capsule(0, 100); await s.run(60);
            const x = s.at(c).x, gap = s.at(c).y - x * t;
            s.drive.vx = 200 * way;
            for (let i = 0; i < 30; i++) { await s.run(1); expect(s.cc(c).isOnFloor).toBe(true); }
            expect(s.at(c).x - x).toBeCloseTo(100 * way, 0);
            expect(s.at(c).y - s.at(c).x * t).toBeCloseTo(gap, 0);
        });

        it('keeps the speed along the slope when asked to', async () => {
            const s = await scene(); s.slope(30);
            const c = s.capsule(0, 100, { constantSlopeSpeed: true }); await s.run(60);
            const a = { x: s.at(c).x, y: s.at(c).y };
            s.drive.vx = 200; await s.run(30);
            expect(Math.hypot(s.at(c).x - a.x, s.at(c).y - a.y)).toBeCloseTo(100, 0);
        });

        it('is not launched off the top of a slope', async () => {
            const s = await scene();
            const e = s.world.spawn();
            s.world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
            s.world.insert(e, RigidBody2D, { bodyType: BodyType.Static });
            s.world.insert(e, PolygonCollider2D, { vertices: [{ x: -3, y: -3 - 1 }, { x: 0, y: 0 }, { x: 0, y: -4 }] } as never);
            s.box(300, -10, 300, 10);
            const c = s.capsule(-200, -100, { snapLength: 2 }); await s.run(60);
            s.drive.vx = 300;
            let top = -Infinity;
            for (let i = 0; i < 90; i++) { await s.run(1); top = Math.max(top, s.at(c).y); }
            expect(top).toBeLessThan(FOOT + 12);
        });

        it('walks into a slope too steep to stand on as into a wall, and slides down it', async () => {
            const s = await scene(); const t = s.slope(55);
            s.box(0, -600, 2000, 10);
            const c = s.capsule(-150, -150 * t + 80); await s.run(60);
            expect(s.cc(c).isOnFloor).toBe(false);
            s.drive.vx = 300;
            const before = s.at(c).x;
            await s.run(10);
            const after = s.at(c).x;
            await s.run(30);
            expect(s.at(c).x).toBeLessThanOrEqual(after + 1);
            expect(s.at(c).y).toBeLessThan(before * t);
        });

        it('walks up one when told it may', async () => {
            const s = await scene(); const t = s.slope(55);
            const c = s.capsule(-150, -150 * t + 80, { blockSteepSlopes: false }); await s.run(40);
            const y = s.at(c).y;
            s.drive.vx = 400; await s.run(30);
            expect(s.at(c).y).toBeGreaterThan(y + 20);
        });
    });

    describe('steps', () => {
        const walk = async (height: number, stepHeight: number) => {
            const s = await scene(); s.box(0, -100, 1000, 20);
            s.box(300, -80 + height / 2, 100, height / 2);
            const c = s.capsule(0, -40, { stepHeight }); await s.run(30);
            s.drive.vx = 200; await s.run(90);
            return { x: s.at(c).x, y: s.at(c).y, floor: s.cc(c).isOnFloor };
        };

        it('walks up a ledge within its reach, and lands on it', async () => {
            const up = await walk(24, 26);
            expect(up.x).toBeGreaterThan(280);
            expect(up.y).toBeCloseTo(-80 + 24 + FOOT, -0.5);
            expect(up.floor).toBe(true);
        });

        it('stops at a ledge beyond it', async () => {
            const blocked = await walk(40, 26);
            expect(blocked.x).toBeLessThan(200);
        });

        it('still rides over what its rounded foot can', async () => {
            expect((await walk(8, 0)).x).toBeGreaterThan(280);
        });

        it('stops at the same ledge without stepHeight, as before', async () => {
            expect((await walk(24, 0)).x).toBeLessThan(200);
        });

        it('does not step up while falling past a ledge', async () => {
            const s = await scene(); s.box(0, -300, 1000, 20);
            s.box(100, -100, 50, 40);
            // Pressed against the face with its foot 15 below the top: a walk would step this, a fall must not.
            const c = s.capsule(38, -49.5, { stepHeight: 30 });
            s.drive.vx = 300; await s.run(14);
            expect(s.at(c).x).toBeLessThan(45);
            expect(s.at(c).y).toBeLessThan(-90);
        });

        it('does not step through a low ceiling', async () => {
            const s = await scene(); s.box(0, -100, 1000, 20);
            s.box(300, -70, 100, 10);
            s.box(300, -5, 100, 10);
            const c = s.capsule(0, -40, { stepHeight: 30 }); await s.run(30);
            s.drive.vx = 200; await s.run(90);
            expect(s.at(c).x).toBeLessThan(205);
        });
    });

    describe('one-way platforms', () => {
        it('jumps up through one and lands on it', async () => {
            const s = await scene(); s.box(0, -100, 1000, 20); s.oneWay(0, 40, 80, 5);
            const c = s.capsule(0, -40); await s.run(30);
            s.world.update(c, CharacterController2D, (v) => { v.velocity.y = 900; });
            let top = -Infinity;
            for (let i = 0; i < 40; i++) { await s.run(1); top = Math.max(top, s.at(c).y); }
            expect(top).toBeGreaterThan(45 + FOOT);
            await s.run(60);
            expect(s.at(c).y).toBeCloseTo(45 + FOOT, 0);
            expect(s.cc(c).isOnFloor).toBe(true);
        });

        it('lands on a thin one at a fall too fast to catch it by overlap', async () => {
            const s = await scene(); s.box(0, -300, 1000, 20); s.oneWay(0, 0, 80, 5);
            const c = s.capsule(0, 1500); await s.run(120);
            expect(s.cc(c).isOnFloor).toBe(true);
            expect(s.at(c).y).toBeCloseTo(5 + FOOT, 0);
        });

        // 60 px/s rises less than the slop in a step: only its direction says it has left.
        it.each([620, 60])('is off it from the moment it rises at %s', async (jumpSpeed) => {
            const s = await scene(); s.oneWay(0, 0, 200, 5);
            const c = s.player(0, 60, { jumpSpeed }); await s.run(60);
            expect(s.cc(c).isOnFloor).toBe(true);
            s.press(c, { jumpHeld: true, jumpPressed: true }); await s.run(1);
            expect(s.cc(c).isOnFloor).toBe(false);
        });

        it('walks in and out of one at its height, side on', async () => {
            const s = await scene(); s.box(0, -100, 1000, 20); s.oneWay(150, -50, 40, 10);
            const c = s.capsule(0, -40); await s.run(30);
            s.drive.vx = 200; await s.run(90);
            expect(s.at(c).x).toBeGreaterThan(270);
        });

        it('drops through while told to, and stands on it otherwise', async () => {
            const s = await scene(); s.box(0, -300, 1000, 20); s.oneWay(0, 0, 80, 5);
            const c = s.capsule(0, 60); await s.run(60);
            expect(s.at(c).y).toBeCloseTo(5 + FOOT, 0);
            s.world.update(c, CharacterController2D, (v) => { v.dropThrough = true; });
            await s.run(30);
            s.world.update(c, CharacterController2D, (v) => { v.dropThrough = false; });
            await s.run(60);
            expect(s.at(c).y).toBeCloseTo(-280 + FOOT, 0);
        });

        // At 6 only the rounded foot is inside and the solver would push it out; at 20 its core is, and the solver reports nothing.
        it.each([6, 20])('is not popped back on top when a drop ends %s in', async (depth) => {
            const s = await scene(); s.box(0, -300, 1000, 20); s.oneWay(0, 0, 80, 30);
            const c = s.capsule(0, 60); await s.run(60);
            s.world.update(c, CharacterController2D, (v) => { v.dropThrough = true; });
            for (let i = 0; i < 60 && s.at(c).y > 30 + FOOT - depth; i++) await s.run(1);
            const y = s.at(c).y;
            expect(y).toBeLessThanOrEqual(30 + FOOT - depth);
            s.world.update(c, CharacterController2D, (v) => { v.dropThrough = false; });
            await s.run(3);
            expect(s.at(c).y).toBeLessThan(y);
            expect(s.cc(c).isOnFloor).toBe(false);
        });
    });

    describe('moving platforms', () => {
        async function onPlatform(fields: Record<string, unknown> = {}) {
            const s = await scene(); s.box(0, -600, 4000, 20);
            const p = s.box(0, -100, 150, 10, BodyType.Kinematic);
            const c = s.capsule(0, -40, fields); await s.run(30);
            expect(s.cc(c).isOnFloor).toBe(true);
            expect(s.cc(c).floorEntity).toBe(p);
            const move = async (dx: number, dy: number, frames: number) => {
                for (let i = 0; i < frames; i++) {
                    s.world.update(p, Transform, (t) => { t.position.x += dx; t.position.y += dy; });
                    await s.run(1);
                    expect(s.cc(c).isOnFloor).toBe(true);
                }
            };
            return { ...s, p, c, move };
        }

        it('rides sideways', async () => {
            const s = await onPlatform();
            const x = s.at(s.c).x;
            await s.move(2, 0, 30);
            await s.run(2);
            expect(s.at(s.c).x - x).toBeCloseTo(60, 0);
        });

        it.each([[3], [-3]])('rides a lift at %s a frame, with its foot on the floor', async (dy) => {
            const s = await onPlatform();
            const gap = s.at(s.c).y - s.at(s.p).y;
            await s.move(0, dy, 30);
            await s.run(2);
            expect(s.at(s.c).y - s.at(s.p).y).toBeCloseTo(gap, 0);
        });

        it('rides a one-way lift up', async () => {
            const s = await scene();
            const p = s.oneWay(0, -100, 400, 10);
            s.world.update(p, RigidBody2D, (b) => { b.bodyType = BodyType.Kinematic; });
            const c = s.capsule(0, -40); await s.run(40);
            const gap = s.at(c).y - s.at(p).y;
            for (let i = 0; i < 30; i++) { s.world.update(p, Transform, (t) => { t.position.y += 3; }); await s.run(1); }
            expect(s.cc(c).isOnFloor).toBe(true);
            expect(s.at(c).y - s.at(p).y).toBeCloseTo(gap, -1);
        });

        it('walks on it at its own speed on top of the ride', async () => {
            const s = await onPlatform();
            const x = s.at(s.c).x;
            s.drive.vx = 60;
            await s.move(1, 0, 30);
            await s.run(1);
            expect(s.at(s.c).x - x).toBeCloseTo(30 + 31, 0);
            expect(s.cc(s.c).velocity.x).toBeCloseTo(60, 3);
        });

        it('is stopped by a wall the platform carries it into', async () => {
            const s = await onPlatform();
            s.box(100, -40, 10, 50);
            await s.move(3, 0, 40);
            expect(s.at(s.c).x).toBeLessThan(90);
        });

        it('stays put when told not to follow', async () => {
            const s = await onPlatform({ followPlatform: false });
            const x = s.at(s.c).x;
            await s.move(2, 0, 30);
            expect(s.at(s.c).x).toBeCloseTo(x, 0);
        });
    });

    describe('what it collides with', () => {
        it('walks through a trigger', async () => {
            const s = await scene(); s.box(0, -100, 1000, 20);
            s.box(100, -40, 20, 50, BodyType.Static, true);
            const c = s.capsule(0, -40); await s.run(30);
            s.drive.vx = 200; await s.run(60);
            expect(s.at(c).x).toBeGreaterThan(190);
        });

        it('stands on no trigger', async () => {
            const s = await scene(); s.box(0, -200, 1000, 20);
            s.box(0, -100, 100, 10, BodyType.Static, true);
            const c = s.capsule(0, 0); await s.run(90);
            expect(s.at(c).y).toBeCloseTo(-180 + FOOT, 0);
        });

        const crate = async (dynamicBodies: number, pushForce = 40) => {
            const s = await scene(); s.box(0, -100, 1000, 20);
            const body = s.box(100, -60, 20, 20, BodyType.Dynamic);
            const c = s.capsule(0, -40, { dynamicBodies, pushForce }); await s.run(30);
            s.drive.vx = 200; await s.run(60);
            return { char: s.at(c).x, crate: s.at(body).x };
        };

        it('is stopped by a crate by default, which stays', async () => {
            const { char, crate: where } = await crate(CharacterDynamicBodies.Block);
            expect(char).toBeLessThan(90);
            expect(where).toBeCloseTo(100, 0);
        });

        it('pushes a crate when told to, and goes with it', async () => {
            const { char, crate: where } = await crate(CharacterDynamicBodies.Push);
            expect(where).toBeGreaterThan(120);
            expect(char).toBeGreaterThan(90);
        });

        it('passes through a crate when told to', async () => {
            const { char, crate: where } = await crate(CharacterDynamicBodies.Ignore);
            expect(char).toBeGreaterThan(190);
            expect(where).toBeCloseTo(100, 0);
        });

        it('moves in the world under a parent', async () => {
            const s = await scene(); s.box(500, -100, 300, 20);
            const parent = s.world.spawn(); s.world.insert(parent, Transform, { position: { x: 500, y: 50, z: 0 } });
            const c = s.capsule(0, -40); s.world.setParent(c, parent);
            await s.run(60);
            s.world.ensureTransformsComposed();
            expect(s.world.get(c, Transform).worldPosition.y).toBeCloseTo(-80 + FOOT, 0);
            expect(s.cc(c).isOnFloor).toBe(true);
        });
    });

    describe('the platformer on top of it', () => {
        const ground = async (p: Record<string, unknown> = {}, cc: Record<string, unknown> = {}) => {
            const s = await scene(); s.box(0, -100, 2000, 20);
            const c = s.player(0, -40, p, cc); await s.run(40);
            expect(s.cc(c).isOnFloor).toBe(true);
            return { ...s, c };
        };

        it('reaches its speed, then stops', async () => {
            const s = await ground();
            s.press(s.c, { moveInput: 1 }); await s.run(30);
            expect(s.cc(s.c).velocity.x).toBeCloseTo(260, 1);
            s.press(s.c, { moveInput: 0 }); await s.run(30);
            expect(s.cc(s.c).velocity.x).toBe(0);
        });

        it('jumps as high as its speed and gravity say, and lands', async () => {
            const s = await ground({ jumpSpeed: 600, gravity: 1600 });
            const y = s.at(s.c).y;
            s.press(s.c, { jumpHeld: true, jumpPressed: true });
            let top = y;
            for (let i = 0; i < 40; i++) { await s.run(1); top = Math.max(top, s.at(s.c).y); }
            expect(top - y).toBeGreaterThan(105); expect(top - y).toBeLessThan(120);
            await s.run(60);
            expect(s.at(s.c).y).toBeCloseTo(y, 0);
            expect(s.cc(s.c).isOnFloor).toBe(true);
        });

        it('jumps lower when the button is let go', async () => {
            const height = async (held: number) => {
                const s = await ground({ jumpSpeed: 600 });
                const y = s.at(s.c).y;
                s.press(s.c, { jumpHeld: true, jumpPressed: true });
                let top = y;
                for (let i = 0; i < 50; i++) {
                    if (i === held) s.press(s.c, { jumpHeld: false });
                    await s.run(1); top = Math.max(top, s.at(s.c).y);
                }
                return top - y;
            };
            expect(await height(4)).toBeLessThan((await height(60)) * 0.6);
        });

        it('still jumps just after running off a ledge, and not long after', async () => {
            const off = async (late: number) => {
                const s = await scene(); s.box(-200, -100, 200, 20); s.box(0, -900, 3000, 20);
                const c = s.player(-40, -40, { coyoteTime: 0.1 }); await s.run(30);
                s.press(c, { moveInput: 1 }); s.world.update(c, CharacterController2D, (v) => { v.velocity.x = 260; });
                while (s.cc(c).isOnFloor) await s.run(1);
                await s.run(late);
                s.press(c, { jumpHeld: true, jumpPressed: true });
                await s.run(1);
                return s.cc(c).velocity.y;
            };
            expect(await off(2)).toBeGreaterThan(500);
            expect(await off(12)).toBeLessThan(0);
        });

        it('remembers a jump pressed just before landing, and not long before', async () => {
            const land = async (frames: number) => {
                const s = await scene(); s.box(0, -100, 2000, 20);
                const c = s.player(0, 400, { jumpBuffer: 0.1 });
                let i = 0;
                while (true) {
                    await s.run(1); i++;
                    // How far above the floor it will be `frames` steps from now, falling as it is.
                    const fall = -s.cc(c).velocity.y / 60 * frames;
                    if (s.at(c).y - fall <= -80 + FOOT || i > 300) break;
                }
                s.press(c, { jumpHeld: true, jumpPressed: true });
                let best = -Infinity;
                for (let n = 0; n < frames + 3; n++) { await s.run(1); best = Math.max(best, s.cc(c).velocity.y); }
                return best;
            };
            expect(await land(3)).toBeGreaterThan(400);
            expect(await land(14)).toBeLessThanOrEqual(0);
        });

        it('does not jump in the air without coyote time or an air jump, and does with one', async () => {
            const s = await scene(); s.box(0, -900, 2000, 20);
            const c = s.player(0, 0, { airJumps: 1 }); await s.run(5);
            s.press(c, { jumpHeld: true, jumpPressed: true }); await s.run(1);
            expect(s.cc(c).velocity.y).toBeGreaterThan(500);
            await s.run(50);
            s.press(c, { jumpPressed: true }); await s.run(1);
            expect(s.cc(c).velocity.y).toBeLessThan(0);
        });

        it('gets its air jumps back on landing', async () => {
            const s = await ground({ airJumps: 1, jumpSpeed: 300 });
            const jump = async () => { s.press(s.c, { jumpHeld: true, jumpPressed: true }); await s.run(1); };
            await jump(); await s.run(4);
            await jump();
            expect(s.cc(s.c).velocity.y).toBeGreaterThan(250);
            await s.run(4);
            await jump();
            expect(s.cc(s.c).velocity.y).toBeLessThan(250);
            await s.run(120);
            expect(s.cc(s.c).isOnFloor).toBe(true);
            await jump(); await s.run(4);
            await jump();
            expect(s.cc(s.c).velocity.y).toBeGreaterThan(250);
        });

        it('spends its coyote time on the jump that used it', async () => {
            const s = await ground({ coyoteTime: 0.5 });
            s.press(s.c, { jumpHeld: true, jumpPressed: true }); await s.run(1);
            const first = s.cc(s.c).velocity.y;
            await s.run(5);
            s.press(s.c, { jumpPressed: true }); await s.run(1);
            expect(s.cc(s.c).velocity.y).toBeLessThan(first);
        });

        it('takes a drop pressed with jump as a drop alone', async () => {
            const s = await scene(); s.box(0, -300, 2000, 20); s.oneWay(0, 0, 200, 5);
            const c = s.player(0, 60, { jumpBuffer: 1, dropTime: 0.1, coyoteTime: 1 }); await s.run(60);
            s.press(c, { jumpPressed: true, dropPressed: true });
            for (let i = 0; i < 20; i++) { await s.run(1); expect(s.cc(c).velocity.y).toBeLessThanOrEqual(0); }
        });

        it('drops through a one-way platform on asking, and not through solid ground', async () => {
            const s = await scene(); s.box(0, -300, 2000, 20); s.oneWay(0, 0, 200, 5);
            const c = s.player(0, 60); await s.run(60);
            const y = s.at(c).y;
            s.press(c, { dropPressed: true }); await s.run(30);
            expect(s.at(c).y).toBeLessThan(y - 20);
            expect(s.cc(c).velocity.y).toBeLessThan(0);
            await s.run(60);
            const low = s.at(c).y;
            s.press(c, { dropPressed: true }); await s.run(30);
            expect(s.at(c).y).toBeCloseTo(low, 0);
        });

        it('keeps a moving platform\'s speed when it jumps off', async () => {
            const s = await scene(); s.box(0, -900, 6000, 20);
            const p = s.box(0, -100, 400, 10, BodyType.Kinematic);
            const c = s.player(0, -40); await s.run(40);
            for (let i = 0; i < 10; i++) { s.world.update(p, Transform, (t) => { t.position.x += 3; }); await s.run(1); }
            s.press(c, { jumpHeld: true, jumpPressed: true }); await s.run(1);
            expect(s.cc(c).velocity.x).toBeCloseTo(180, -1);
        });

        it('does nothing disabled', async () => {
            const s = await ground();
            s.press(s.c, { enabled: false });
            const y = s.cc(s.c).velocity.y;
            s.press(s.c, { jumpPressed: true, moveInput: 1 }); await s.run(5);
            expect(s.cc(s.c).velocity.x).toBe(0);
            expect(s.cc(s.c).velocity.y).toBeCloseTo(y, 3);
        });
    });
});
