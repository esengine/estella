/**
 * @file  A trailer of the real game: shots its own camera flies through on the game clock, made the view through the
 *        camera director, and a stand-in that walks, sprints and fights through the keys a player would press.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule } from '../src/wasm';
import { App } from '../src/app/app';
import { Transform, Camera, type TransformData } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { CameraDirector, createDirectorState } from '../src/camera/CameraDirector';
import { TrailerDirector, trailerPlan, shotAt, pathPoint, lookRotation, trailerSeconds, clearEye } from '../src/camera/TrailerDirector';
import { ThirdPersonController, ThirdPersonCamera, Hunter, Health } from '../src/gameplay';

const rotate = (q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] => {
    const [x, y, z] = v;
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
};

describe('the pieces of a shot', () => {
    it('passes the path through every point, at its ends and in between', () => {
        const pts: [number, number, number][] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
        expect(pathPoint(pts, 0)).toEqual([0, 0, 0]);
        expect(pathPoint(pts, 0.5).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 0, 0]);
        expect(pathPoint(pts, 1).map((v) => Math.round(v * 1e3) / 1e3)).toEqual([10, 0, 10]);
    });

    it('turns -Z toward what it looks at, the horizon level', () => {
        for (const to of [[5, 0, 0], [0, 3, -4], [-2, -1, 7]] as [number, number, number][]) {
            const f = rotate(lookRotation([0, 0, 0], to), [0, 0, -1]);
            const n = Math.hypot(...to);
            f.forEach((v, k) => expect(v).toBeCloseTo(to[k]! / n, 5));
            expect(rotate(lookRotation([0, 0, 0], to), [1, 0, 0])[1]).toBeCloseTo(0, 6);
        }
    });

    it('finds the shot for a time, holding the last at its end', () => {
        const plan = trailerPlan({ shots: [{ seconds: 2, path: [[0, 0, 0]], look: [0, 0, -1] }, { seconds: 3, path: [[0, 0, 0]], look: [0, 0, -1] }] });
        expect(trailerSeconds(plan)).toBe(5);
        expect(shotAt(plan, 1)).toEqual({ index: 0, local: 1 });
        expect(shotAt(plan, 2.5)).toEqual({ index: 1, local: 0.5 });
        expect(shotAt(plan, 9)).toEqual({ index: 1, local: 3 });
    });

    it('keeps the eye in front of a wall between it and what it looks at, but not of what it looks at', () => {
        const wall = { sphereCast: () => ({ entity: 9, fraction: 0.25 }) };
        expect(clearEye([0, 0, 8], [0, 0, 0], wall, 0.1, null)).toEqual([0, 0, 2]);
        expect(clearEye([0, 0, 8], [0, 0, 0], wall, 0.1, 9)).toEqual([0, 0, 8]);
        expect(clearEye([0, 0, 8], [0, 0, 0], { sphereCast: () => null }, 0.1, null)).toEqual([0, 0, 8]);
        expect(clearEye([0, 0, 8], [0, 0, 0], null, 0.1, null)).toEqual([0, 0, 8]);
        // Looking at a point on the ground starts the probe inside it: that is no wall.
        expect(clearEye([0, 0, 8], [0, 0, 0], { sphereCast: () => ({ entity: 9, fraction: 0 }) }, 0.1, null)).toEqual([0, 0, 8]);
    });

    it('says which shot and field cannot be filmed', () => {
        expect(() => trailerPlan({ shots: [] })).toThrow(/shots/);
        expect(() => trailerPlan({ shots: [{ seconds: 1, path: [], look: [0, 0, 0] }] })).toThrow(/shots\[0\]\.path/);
        expect(() => trailerPlan({ shots: [{ seconds: 1, path: [[0, 0, 0]], look: 'there' }] })).toThrow(/shots\[0\]\.look/);
        expect(() => trailerPlan({ shots: [{ seconds: 1, path: [[0, 0, 0]], look: [0, 0, 0], act: [{ do: 'walk_to' }] }] })).toThrow(/act\[0\]\.to/);
    });
});

describe.skipIf(!HAS_WASM)('filming the game', () => {
    const apps: App[] = [];
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });
    afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

    async function game() {
        core.setActiveContext(null);
        const app = App.new();
        apps.push(app);
        app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
        app.insertResource(CameraDirector, createDirectorState());
        app.insertResource(Input, new InputState());
        const w = app.world;
        const main = w.spawn();
        w.insert(main, Transform, { position: { x: 0, y: 2, z: 6 } });
        w.insert(main, Camera, { isActive: true, priority: 0, fov: 60, farPlane: 5000 });
        const player = w.spawn();
        w.insert(player, Transform, { position: { x: 0, y: 0, z: 0 } });
        w.insert(player, ThirdPersonController, { ...(ThirdPersonController as any)._default });
        const view = w.spawn();
        w.insert(view, Transform, {});
        w.insert(view, ThirdPersonCamera, { ...(ThirdPersonCamera as any)._default, target: player });
        return { app, w, main, player, view };
    }

    it('flies its own camera along the shot on the game clock, and makes it the view', async () => {
        const { app, w } = await game();
        const director = new TrailerDirector(app, trailerPlan({ shots: [{ seconds: 2, path: [[0, 5, 10], [10, 5, 10]], look: [0, 0, 0], ease: false, fov: [40, 60] }] }));
        for (let i = 0; i < 60; i++) await app.tick(1 / 60);
        const t = w.get(director.camera, Transform) as TransformData;
        expect(director.time).toBeCloseTo(1, 2);
        expect(t.position.x).toBeCloseTo(5, 0);
        expect((w.get(director.camera, Camera) as { fov: number }).fov).toBeCloseTo(50, 0);
        const f = rotate(t.rotation, [0, 0, -1]);
        const to = [0 - t.position.x, 0 - t.position.y, 0 - t.position.z], n = Math.hypot(...to);
        f.forEach((v, k) => expect(v).toBeCloseTo(to[k]! / n, 3));
        expect(app.getResource(CameraDirector).timelineShot?.to).toBe(director.camera);
        expect((w.get(director.camera, Camera) as { farPlane: number }).farPlane).toBe(5000);
        director.end();
        expect(app.getResource(CameraDirector).timelineShot).toBeNull();
        expect(w.valid(director.camera)).toBe(false);
    });

    it('rides along with the player when the shot follows it', async () => {
        const { app, w, player } = await game();
        const director = new TrailerDirector(app, trailerPlan({ shots: [{ seconds: 4, path: [[0, 3, 8]], follow: 'player', look: { entity: 'player', offset: [0, 1, 0] } }] }));
        w.update(player, Transform, (t: TransformData) => { t.position.x = 40; });
        await app.tick(1 / 60);
        expect((w.get(director.camera, Transform) as TransformData).position.x).toBeCloseTo(40, 3);
        director.end();
    });

    it('walks the stand-in toward a point through the game camera and the forward key, sprinting when asked', async () => {
        const { app, w, view } = await game();
        const director = new TrailerDirector(app, trailerPlan({ shots: [{ seconds: 3, path: [[0, 5, 10]], look: [0, 0, 0], act: [{ do: 'walk_to', to: [100, 0], sprint: true }] }] }));
        director.act(1 / 30);
        const input = app.getResource(Input) as InputState;
        expect(input.isKeyDown('KeyW')).toBe(true);
        expect(input.isKeyDown('ShiftLeft')).toBe(true);
        // Forward along +X: the camera's yaw that looks that way.
        expect((w.get(view, ThirdPersonCamera) as { yaw: number }).yaw).toBeCloseTo(-90, 3);
        director.end();
        expect(input.isKeyDown('KeyW')).toBe(false);
        expect(input.isKeyDown('ShiftLeft')).toBe(false);
    });

    it('fights the nearest foe: attacks in reach, and rolls when its windup is most of the way through', async () => {
        const { app, w } = await game();
        const foe = w.spawn();
        w.insert(foe, Transform, { position: { x: 0, y: 0, z: -50 } });
        w.insert(foe, Health, { current: 50, max: 50 });
        w.insert(foe, Hunter, { ...(Hunter as any)._default, attackRange: 110, windup: 0.6, phase: '', phaseTime: 0 });
        const director = new TrailerDirector(app, trailerPlan({ shots: [{ seconds: 5, path: [[0, 5, 10]], look: [0, 0, 0], act: [{ do: 'fight' }] }] }));
        const input = app.getResource(Input) as InputState;
        let attacked = false;
        const original = input.noteKeyDown.bind(input);
        input.noteKeyDown = (code: string) => { if (code === 'KeyJ') attacked = true; original(code); };
        director.act(1 / 30);
        expect(attacked).toBe(true);
        w.update(foe, Hunter, (h: { phase: string; phaseTime: number }) => { h.phase = 'windup'; h.phaseTime = 0.4; });
        director.act(1 / 30);
        expect(input.isKeyDown('ShiftLeft')).toBe(true);
        director.act(1 / 30);
        expect(input.isKeyDown('ShiftLeft')).toBe(false);
        director.end();
    });
});

