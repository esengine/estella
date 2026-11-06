// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    splinePlugin.ts
 * @brief   The Spline component: a curve through a few points, authored once and read by whatever follows it.
 *
 * @details A `Spline` is data and nothing draws it: a river, a road or a camera rail reads it from the same entity and builds what it needs
 *          (see {@link SplineCurve}). The points are in the entity's own space, so moving or turning the entity moves the whole curve.
 *          The one thing that runs each frame is what follows it: a {@link PathFollower} moves its own entity along the curve of another.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { defineComponent, Transform, type ComponentDef, type TransformData } from '../ecs/component';
import { SplineCurve, type SplinePoint } from './curve';
import { installTerrainBands } from './terrainBand2D';
import { Spline, type SplineData } from './splineComponent';

export { Spline, type SplineData } from './splineComponent';

/** What a {@link PathFollower} does at the end of the curve. */
export const PathMode = { Once: 0, Loop: 1, PingPong: 2 } as const;

/** How a {@link PathFollower} turns to the way it is going. */
export const PathOrient = {
    /** Keeps the rotation it has. */
    None: 0,
    /** Turns about y to face along the curve, +z forward: a 3D walker on the ground. */
    FaceXZ: 1,
    /** Turns about z to face along the curve, +x forward: a 2D sprite. */
    FaceXY: 2,
} as const;

/** The fields of the `PathFollower` component. @experimental */
export interface PathFollowerData {
    /** The entity that holds the `Spline` to follow. */
    spline: number;
    /** World units a second along the curve; negative runs it backwards. */
    speed: number;
    /** How far along the curve it has gone, in world units. Written each frame; set it to start part-way along. */
    distance: number;
    /** {@link PathMode}. */
    mode: number;
    /** {@link PathOrient}. */
    orient: number;
    /** Whether it is moving. A `Once` follower stops itself at the end. */
    playing: boolean;
}

/**
 * Moves its entity along the `Spline` of another: an enemy on a patrol route, a platform on a rail, a camera on a track. It sets the entity's
 * own `position` (and `rotation`, when asked), so a follower sits at the top of the hierarchy. The curve is read through its entity's
 * Transform, so moving, turning or scaling the spline moves the whole route. It advances by the length of the curve, not by its parameter,
 * so it goes at `speed` everywhere on it.
 *
 * @experimental
 */
export const PathFollower: ComponentDef<PathFollowerData> = defineComponent<PathFollowerData>('PathFollower', {
    spline: -1, speed: 4, distance: 0, mode: PathMode.Loop, orient: PathOrient.None, playing: true,
}, {
    entityFields: ['spline'],
    fields: {
        spline: { category: 'Path', tooltip: 'The entity that holds the Spline to follow.' },
        speed: { category: 'Path', tooltip: 'World units a second along the curve. Negative runs it backwards.' },
        distance: { min: 0, category: 'Path', tooltip: 'How far along the curve it has gone, in world units. Set it to start part-way along.' },
        mode: { enum: [{ label: 'Once', value: PathMode.Once }, { label: 'Loop', value: PathMode.Loop }, { label: 'Ping-pong', value: PathMode.PingPong }], category: 'Path', tooltip: 'What it does at the end of the curve: stop, go round again, or turn back.' },
        orient: { enum: [{ label: 'None', value: PathOrient.None }, { label: 'Face along (XZ)', value: PathOrient.FaceXZ }, { label: 'Face along (XY)', value: PathOrient.FaceXY }], category: 'Path', tooltip: 'Whether it turns to face the way it is going: about y for a 3D walker, about z for a 2D sprite.' },
        playing: { category: 'Path', tooltip: 'Whether it is moving. A follower set to Once stops itself at the end.' },
    },
});

/**
 * Where a follower that has gone `travelled` along a curve of `length` stands, and whether a `Once` follower has run out of curve going the way
 * it was going (`forward`).
 */
export function pathPlace(travelled: number, length: number, mode: number, forward = true): { s: number; done: boolean } {
    if (!(length > 0)) return { s: 0, done: mode === PathMode.Once };
    if (mode === PathMode.Loop) return { s: ((travelled % length) + length) % length, done: false };
    if (mode === PathMode.PingPong) {
        const t = ((travelled % (2 * length)) + 2 * length) % (2 * length);
        return { s: t <= length ? t : 2 * length - t, done: false };
    }
    return { s: Math.min(Math.max(travelled, 0), length), done: forward ? travelled >= length : travelled <= 0 };
}

type Quat = { x: number; y: number; z: number; w: number };

function turn(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

export class SplinePlugin implements Plugin {
    name = 'spline';
    private readonly curves_ = new Map<number, { key: string; curve: SplineCurve }>();

    build(app: App): void {
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Res(Time)], (time: TimeData) => this.follow(app, time.delta), { name: 'PathFollowerSystem' }),
            { runIf: playModeOnly });
        installTerrainBands(app);
    }

    private curveOf(app: App, entity: number): { curve: SplineCurve; at: TransformData } | null {
        const world = app.world;
        if (entity < 0 || !world.valid(entity as never)) return null;
        const spline = world.tryGet(entity as never, Spline) as SplineData | null;
        if (!spline || spline.points.length < 2) return null;
        const at = world.tryGet(entity as never, Transform) as TransformData | null;
        if (!at) return null;
        const key = JSON.stringify([spline.points, spline.closed]);
        let held = this.curves_.get(entity);
        if (!held || held.key !== key) {
            held = { key, curve: new SplineCurve(spline.points, spline.closed) };
            this.curves_.set(entity, held);
        }
        return { curve: held.curve, at };
    }

    private follow(app: App, dt: number): void {
        const world = app.world;
        for (const entity of world.getEntitiesWithComponents([PathFollower, Transform])) {
            const f = world.get(entity, PathFollower) as PathFollowerData;
            if (!f.playing) continue;
            const held = this.curveOf(app, f.spline);
            if (!held) continue;
            const { curve, at } = held;
            const sx = at.worldScale.x, sy = at.worldScale.y, sz = at.worldScale.z;
            // Speed is in world units and the curve's length is in its own: a scaled spline is longer in the world.
            const unit = (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3 || 1;
            const length = curve.length * unit;
            const travelled = f.distance + f.speed * dt;
            const placed = pathPlace(travelled, length, f.mode, f.speed >= 0);
            const local = curve.position(placed.s / unit);
            const r = turn(at.worldRotation, local[0] * sx, local[1] * sy, local[2] * sz);
            const t = world.get(entity, Transform) as TransformData;
            t.position.x = r[0] + at.worldPosition.x;
            t.position.y = r[1] + at.worldPosition.y;
            t.position.z = r[2] + at.worldPosition.z;
            if (f.orient !== PathOrient.None) {
                const tan = curve.tangent(placed.s / unit);
                const d = turn(at.worldRotation, tan[0] * sx, tan[1] * sy, tan[2] * sz);
                // Going backwards along the curve faces the other way.
                const dir = f.speed < 0 ? -1 : 1;
                if (f.orient === PathOrient.FaceXZ) {
                    const h = Math.atan2(d[0] * dir, d[2] * dir) / 2;
                    t.rotation.x = 0; t.rotation.y = Math.sin(h); t.rotation.z = 0; t.rotation.w = Math.cos(h);
                } else {
                    const h = Math.atan2(d[1] * dir, d[0] * dir) / 2;
                    t.rotation.x = 0; t.rotation.y = 0; t.rotation.z = Math.sin(h); t.rotation.w = Math.cos(h);
                }
            }
            world.set(entity, Transform, t);
            const ended = f.mode === PathMode.Once && placed.done;
            world.set(entity, PathFollower, { ...f, distance: ended ? placed.s : travelled, playing: !ended });
        }
        // A curve nobody reads any more is let go.
        for (const key of [...this.curves_.keys()]) if (!world.valid(key as never)) this.curves_.delete(key);
    }
}

export const splinePlugin: Plugin = new SplinePlugin();
