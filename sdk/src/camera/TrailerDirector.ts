// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TrailerDirector.ts
 * @brief   A trailer of the real game: shots a camera of its own flies through, and a stand-in player that walks, runs
 *          and fights, both on the game clock.
 *
 * @details Each shot is a few seconds: where the eye goes (points it passes through, eased; held still with one), what it
 *          looks at (a place, or an entity and a lift above it), and its field of view. The eye can ride along with an
 *          entity, the points then being offsets from it. The view is the director's own camera, put live through the
 *          camera director as a timeline would, so the game's cameras go on doing what they do and a hit still shakes
 *          the picture.
 *
 *          The stand-in plays through the same input the player would: it holds the keys a ThirdPersonController or a
 *          PlatformerController2D reads, turns the game's own camera so "forward" is where it wants to go, attacks the
 *          nearest foe and rolls when a Hunter's windup is most of the way through. What the game does with that is the
 *          game's: nothing is moved by hand.
 *
 *          The camera is placed in PostUpdate at the game time of the frame, so it moves as smoothly as the game does;
 *          the stand-in decides once per call of `act`, before the frame it is for.
 */

import type { App } from '../app/app';
import { getComponent, Transform, Camera, type TransformData } from '../ecs/component';
import type { CameraData } from '../ecs/component.generated';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Input, inputEventCallbacks } from '../input/input';
import { CameraDirector, setTimelineShot } from './CameraDirector';
import type { Entity } from '../types';
import type { World } from '../ecs/world';

type V3 = [number, number, number];

/** A place: a point in the world, or an entity (`"player"` for the one the stand-in plays) and a lift off it. @experimental */
export type TrailerPlace = V3 | { entity: number | 'player'; offset?: V3 };

/** What the stand-in does over part of a shot. @experimental */
export interface TrailerAct {
    /** Seconds into the shot it starts, and stops (default: the end of the shot). */
    at?: number;
    until?: number;
    /** `walk_to` a ground point ([x, z]; a 2D game reads x), `fight` the nearest foe, or `idle`. */
    do: 'walk_to' | 'fight' | 'idle';
    to?: [number, number];
    sprint?: boolean;
    /** How near counts as there, world units. */
    stop?: number;
}

/** One shot of a trailer. @experimental */
export interface TrailerShot {
    seconds: number;
    /** Where the eye is over the shot: the points it passes through, in order. One point holds still. */
    path: V3[];
    /** The points are offsets from this entity (or the player), so the eye rides along with it. */
    follow?: number | 'player';
    /** What it looks at. */
    look: TrailerPlace;
    /** Vertical field of view, degrees: one, or from and to over the shot. */
    fov?: number | [number, number];
    /** Ease in and out of the move (default) or go at one speed. */
    ease?: boolean;
    /**
     * Keep the eye in front of anything solid between it and what it looks at (default), as a game camera does; false
     * lets it pass through, for a shot meant to fly through a wall.
     */
    clear?: boolean;
    act?: TrailerAct[];
}

export interface TrailerPlan {
    shots: TrailerShot[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isV3 = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(finite);

/** @p raw checked as a plan. Throws, naming the shot and field, on what cannot be filmed. @experimental */
export function trailerPlan(raw: unknown): TrailerPlan {
    const shots = (raw as { shots?: unknown })?.shots ?? raw;
    if (!Array.isArray(shots) || shots.length === 0) throw new Error('a trailer is `shots`: [{ seconds, path, look, ... }, ...]');
    return {
        shots: shots.map((s, i) => {
            const shot = s as TrailerShot;
            const where = `shots[${i}]`;
            if (!shot || typeof shot !== 'object') throw new Error(`${where} is not a shot`);
            if (!(finite(shot.seconds) && shot.seconds > 0)) throw new Error(`${where}.seconds is how long it lasts, above 0`);
            if (!Array.isArray(shot.path) || shot.path.length === 0 || !shot.path.every(isV3)) throw new Error(`${where}.path is the eye's points, [[x, y, z], ...], at least one`);
            const look = shot.look as TrailerPlace;
            if (!(isV3(look) || (look && typeof look === 'object' && (finite((look as { entity: unknown }).entity) || (look as { entity: unknown }).entity === 'player')))) {
                throw new Error(`${where}.look is a point [x, y, z] or { entity, offset? } (entity "player" for the player)`);
            }
            if (shot.fov !== undefined && !(finite(shot.fov) || (Array.isArray(shot.fov) && shot.fov.length === 2 && shot.fov.every(finite)))) {
                throw new Error(`${where}.fov is degrees, or [from, to]`);
            }
            for (const [k, act] of (shot.act ?? []).entries()) {
                if (!act || !['walk_to', 'fight', 'idle'].includes(act.do)) throw new Error(`${where}.act[${k}].do is walk_to, fight or idle`);
                if (act.do === 'walk_to' && !(Array.isArray(act.to) && act.to.length === 2 && act.to.every(finite))) throw new Error(`${where}.act[${k}].to is the ground point [x, z] to walk to`);
            }
            return shot;
        }),
    };
}

/** The shot at @p t seconds into the trailer, and how far into it; the last shot holds at its end. @experimental */
export function shotAt(plan: TrailerPlan, t: number): { index: number; local: number } {
    let start = 0;
    for (let i = 0; i < plan.shots.length; i++) {
        const seconds = plan.shots[i]!.seconds;
        if (t < start + seconds || i === plan.shots.length - 1) return { index: i, local: Math.min(seconds, Math.max(0, t - start)) };
        start += seconds;
    }
    return { index: 0, local: 0 };
}

export function trailerSeconds(plan: TrailerPlan): number {
    return plan.shots.reduce((sum, s) => sum + s.seconds, 0);
}

/** A point along @p points at @p u (0..1), through every point (Catmull-Rom). */
export function pathPoint(points: readonly V3[], u: number): V3 {
    if (points.length === 1) return [...points[0]!] as V3;
    const span = Math.min(points.length - 1.0000001, Math.max(0, u) * (points.length - 1));
    const i = Math.floor(span), f = span - i;
    const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[Math.min(points.length - 1, i + 1)]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
    return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]!) + (-p0[k]! + p2[k]!) * f + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * f * f
        + (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * f * f * f)) as V3;
}

/** A turn that points -Z from nowhere along @p from → @p to, with the horizon level. @experimental */
export function lookRotation(from: V3, to: V3): { x: number; y: number; z: number; w: number } {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const ground = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, ground);
    const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
    // Yaw about up, then pitch about the turned right axis.
    return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** Who the stand-in plays: the first ThirdPersonController, else the first PlatformerController2D. */
export function trailerPlayer(world: World): Entity | null {
    for (const name of ['ThirdPersonController', 'PlatformerController2D']) {
        const def = getComponent(name);
        if (!def) continue;
        const [first] = world.getEntitiesWithComponents([def]);
        if (first !== undefined) return first;
    }
    return null;
}

function placeOf(world: World, place: TrailerPlace, player: Entity | null): V3 | null {
    if (Array.isArray(place)) return place;
    const entity = place.entity === 'player' ? player : place.entity as Entity;
    if (entity === null || !world.valid(entity) || !world.has(entity, Transform)) return null;
    world.ensureTransformsComposed?.();
    const t = world.get(entity, Transform) as TransformData;
    const p = t.worldPosition ?? t.position;
    const o = place.offset ?? [0, 0, 0];
    return [p.x + o[0], p.y + o[1], p.z + o[2]];
}

/** Where the eye is, what it looks at and its field of view, @p local seconds into @p shot. Null when what it names is gone. @experimental */
export function shotPose(world: World, shot: TrailerShot, local: number, player: Entity | null): { eye: V3; look: V3; fov: number | null } | null {
    const raw = Math.min(1, Math.max(0, local / shot.seconds));
    const u = shot.ease === false ? raw : raw * raw * (3 - 2 * raw);
    let eye = pathPoint(shot.path, u);
    if (shot.follow !== undefined) {
        const anchor = placeOf(world, { entity: shot.follow }, player);
        if (!anchor) return null;
        eye = [anchor[0] + eye[0], anchor[1] + eye[1], anchor[2] + eye[2]];
    }
    const look = placeOf(world, shot.look, player);
    if (!look) return null;
    const fov = shot.fov === undefined ? null : Array.isArray(shot.fov) ? shot.fov[0] + (shot.fov[1] - shot.fov[0]) * u : shot.fov;
    return { eye, look, fov };
}

/** What a 3D physics world answers a swept sphere with, as the Physics3D resource does; null when nothing is in the way. */
interface SphereCaster {
    sphereCast(origin: { x: number; y: number; z: number }, radius: number, delta: { x: number; y: number; z: number }, layers: number): { entity: number; fraction: number } | null;
}

/**
 * @p eye drawn in toward @p look until nothing solid stands between, the probe a sphere of @p radius so the eye stops
 * short of a wall. What it looks at is not in the way of looking at it. @experimental
 */
export function clearEye(eye: V3, look: V3, physics: SphereCaster | null, radius: number, lookedAt: number | null): V3 {
    if (!physics) return eye;
    const delta = { x: eye[0] - look[0], y: eye[1] - look[1], z: eye[2] - look[2] };
    const hit = physics.sphereCast({ x: look[0], y: look[1], z: look[2] }, radius, delta, 0);
    // A probe that starts inside something (a point looked at on the ground) has met nothing between: it is not a wall.
    if (!hit || hit.entity === lookedAt || hit.fraction >= 1 || hit.fraction <= 1e-4) return eye;
    const f = Math.max(0, hit.fraction);
    return [look[0] + delta.x * f, look[1] + delta.y * f, look[2] + delta.z * f];
}

/** The keys the stand-in plays with: the same the controllers read. */
const KEY = { forward: 'KeyW', right: 'KeyD', left: 'KeyA', dodge: 'ShiftLeft', attack: 'KeyJ', jump: 'Space' } as const;
/** Owner of the camera director's timeline shot, apart from any timeline entity. */
const OWNER = -7071;

/** One trailer being filmed on an App: begin it, give the stand-in its turn before each frame, end it. @experimental */
export class TrailerDirector {
    private readonly camera_: Entity;
    private readonly player_: Entity | null;
    private readonly keys_ = new Map<string, boolean>();
    private readonly press_: ReturnType<typeof inputEventCallbacks>;
    private time_ = 0;
    private attackWait_ = 0;
    private dodgeUp_ = false;
    /** The foe whose windup it has already rolled from, while that windup lasts: one roll a swing. */
    private dodged_: Entity | null = null;
    private ended_ = false;
    /** The trailer on each App, for the one system that places its camera. */
    private static readonly live_ = new WeakMap<App, TrailerDirector>();
    private static readonly installed_ = new WeakSet<App>();

    private gameNear_ = 0;

    constructor(private readonly app_: App, readonly plan: TrailerPlan) {
        const world = app_.world;
        this.player_ = trailerPlayer(world);
        this.press_ = inputEventCallbacks(app_.getResource(Input));
        // A camera of its own, lensed like the game's main one so its far plane suits the world.
        const lens = this.gameLens_();
        this.gameNear_ = lens.nearPlane ?? 0;
        this.camera_ = world.spawn();
        world.insert(this.camera_, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(this.camera_, Camera, { ...lens, isActive: true, priority: -1_000_000 });
        TrailerDirector.live_.set(app_, this);
        if (!TrailerDirector.installed_.has(app_)) {
            TrailerDirector.installed_.add(app_);
            app_.addSystemToSchedule(Schedule.PostUpdate, defineSystem([Res(Time)], (time: TimeData) => {
                TrailerDirector.live_.get(app_)?.place_(time.delta);
            }, { name: 'TrailerCameraSystem' }));
        }
        this.place_(0);
    }

    get camera(): Entity { return this.camera_; }

    /** Seconds of game time since it began. */
    get time(): number { return this.time_; }

    private gameLens_(): Partial<CameraData> {
        const world = this.app_.world;
        let best: CameraData | null = null;
        for (const e of world.getEntitiesWithComponents([Camera])) {
            const c = world.get(e, Camera) as CameraData;
            if (c.isActive && (!best || c.priority > best.priority)) best = c;
        }
        return best ? { projectionType: best.projectionType, fov: best.fov, nearPlane: best.nearPlane, farPlane: best.farPlane, orthoSize: best.orthoSize, cullingMask: best.cullingMask } : {};
    }

    /** Put the eye where the shot says at the game time reached, and make it the view. */
    private place_(dt: number): void {
        if (this.ended_) return;
        this.time_ += dt;
        const world = this.app_.world;
        const { index, local } = shotAt(this.plan, this.time_);
        const shot = this.plan.shots[index]!;
        const pose = shotPose(world, shot, local, this.player_);
        if (pose && shot.clear !== false) {
            const physics = (this.app_.getResourceByName('Physics3D') ?? null) as SphereCaster | null;
            const looked = Array.isArray(shot.look) ? null : shot.look.entity === 'player' ? this.player_ : shot.look.entity;
            const span = Math.hypot(pose.eye[0] - pose.look[0], pose.eye[1] - pose.look[1], pose.eye[2] - pose.look[2]);
            pose.eye = clearEye(pose.eye, pose.look, physics, Math.min(span * 0.05, (this.gameNear_ || 1) * 3), looked);
        }
        if (pose && world.valid(this.camera_)) {
            world.update(this.camera_, Transform, (t: TransformData) => {
                t.position = { x: pose.eye[0], y: pose.eye[1], z: pose.eye[2] };
                t.rotation = lookRotation(pose.eye, pose.look);
            });
            if (pose.fov !== null) world.update(this.camera_, Camera, (c: CameraData) => { c.fov = pose.fov!; });
        }
        if (this.app_.hasResource(CameraDirector)) setTimelineShot(this.app_, OWNER, { from: null, to: this.camera_, weight: 1, curve: 0 });
    }

    private hold_(code: string, down: boolean): void {
        if ((this.keys_.get(code) ?? false) === down) return;
        this.keys_.set(code, down);
        if (down) this.press_.onKeyDown(code);
        else this.press_.onKeyUp(code);
    }

    /** The stand-in's turn, for the frame about to be stepped by @p dt: which keys it holds. */
    act(dt: number): void {
        if (this.ended_) return;
        const world = this.app_.world;
        // A tap of the dodge key is down one frame and up the next.
        if (this.dodgeUp_) { this.hold_(KEY.dodge, false); this.dodgeUp_ = false; }
        const { index, local } = shotAt(this.plan, this.time_);
        const acts = (this.plan.shots[index]!.act ?? []).filter((a) => local >= (a.at ?? 0) && local < (a.until ?? Infinity));
        const act = acts[acts.length - 1];
        const player = this.player_;
        let forward = false, right = false, left = false, sprint = false;
        this.attackWait_ = Math.max(0, this.attackWait_ - dt);
        if (act && player !== null && world.valid(player) && world.has(player, Transform)) {
            const here = (world.get(player, Transform) as TransformData).position;
            const twoD = this.is2D_(player);
            const steer = (x: number, z: number, stop: number): boolean => {
                const dx = x - here.x, dz = z - here.z;
                if (twoD) {
                    if (Math.abs(dx) <= stop) return false;
                    if (dx > 0) right = true; else left = true;
                    return true;
                }
                if (Math.hypot(dx, dz) <= stop) return false;
                this.aim_(Math.atan2(-dx, -dz) * 180 / Math.PI);
                forward = true;
                return true;
            };
            if (act.do === 'walk_to' && act.to) {
                if (steer(act.to[0], act.to[1], act.stop ?? 40)) sprint = !!act.sprint;
            } else if (act.do === 'fight') {
                const foe = this.nearestFoe_(here);
                if (foe) {
                    const at = (world.get(foe.entity, Transform) as TransformData).position;
                    const reach = foe.reach;
                    if (!steer(at.x, at.z, reach)) {
                        if (!twoD) this.aim_(Math.atan2(-(at.x - here.x), -(at.z - here.z)) * 180 / Math.PI);
                        if (this.dodged_ !== null && this.dodged_ !== foe.entity) this.dodged_ = null;
                        if (!foe.winding) this.dodged_ = null;
                        if (foe.threat && this.dodged_ === null) { this.hold_(KEY.dodge, true); this.dodgeUp_ = true; this.dodged_ = foe.entity; }
                        else if (this.attackWait_ <= 0) { this.press_.onKeyDown(KEY.attack); this.press_.onKeyUp(KEY.attack); this.attackWait_ = 0.45; }
                    }
                }
            }
        }
        this.hold_(KEY.forward, forward);
        this.hold_(KEY.right, right);
        this.hold_(KEY.left, left);
        if (!this.dodgeUp_) this.hold_(KEY.dodge, sprint);
    }

    private is2D_(player: Entity): boolean {
        const def = getComponent('PlatformerController2D');
        return !!def && this.app_.world.has(player, def);
    }

    /** Turn the game's own camera so the controller's "forward" is @p yaw degrees. */
    private aim_(yaw: number): void {
        const def = getComponent('ThirdPersonCamera');
        if (!def) return;
        const world = this.app_.world;
        for (const e of world.getEntitiesWithComponents([def])) world.update(e, def, (c: { yaw: number }) => { c.yaw = yaw; });
    }

    /** The nearest living foe, how near the stand-in must be to hit it, and whether its windup is most of the way through. */
    private nearestFoe_(here: { x: number; y: number; z: number }): { entity: Entity; reach: number; threat: boolean; winding: boolean } | null {
        const world = this.app_.world;
        const hunter = getComponent('Hunter'), health = getComponent('Health');
        if (!hunter) return null;
        let best: { entity: Entity; reach: number; threat: boolean; winding: boolean } | null = null, near = Infinity;
        for (const e of world.getEntitiesWithComponents([hunter, Transform])) {
            if (health && world.has(e, health) && (world.get(e, health) as { current: number }).current <= 0) continue;
            const p = (world.get(e, Transform) as TransformData).position;
            const d = Math.hypot(p.x - here.x, p.z - here.z);
            if (d >= near) continue;
            const h = world.get(e, hunter) as { attackRange: number; windup?: number; phase?: string; phaseTime?: number };
            const windup = h.windup && h.windup > 0 ? h.windup : 0.5;
            near = d;
            best = { entity: e, reach: Math.max(40, h.attackRange * 0.9), threat: h.phase === 'windup' && (h.phaseTime ?? 0) >= windup * 0.55, winding: h.phase === 'windup' };
        }
        return best;
    }

    /** Let go of every key, give the view back and take its camera away. */
    end(): void {
        if (this.ended_) return;
        for (const code of [...this.keys_.keys()]) this.hold_(code, false);
        if (this.app_.hasResource(CameraDirector)) setTimelineShot(this.app_, OWNER, null);
        if (this.app_.world.valid(this.camera_)) this.app_.world.despawn(this.camera_);
        TrailerDirector.live_.delete(this.app_);
        this.ended_ = true;
    }
}
