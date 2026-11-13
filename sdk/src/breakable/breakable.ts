// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    breakable.ts
 * @brief   A thing that breaks: drawn whole until it is struck, and its pieces let go after.
 *
 * Nothing is cut when it breaks. The pieces were cut beforehand (a model's `fracture` step writes them as a prefab,
 * each a mesh about its own middle with a body and a hull), and they fit together into the thing with no gap. Raising
 * `broken` hides the whole, puts the pieces where it stood and throws each one out from where it was struck; lowering
 * it takes the pieces away and shows the whole again, which is the flag contract `AudioSource.playing` keeps: a script,
 * a graph node and the inspector all write the same switch.
 *
 * It needs no physics to swap one for the other. The 3D world, where a game has one, says how a body is pushed
 * ({@link setBodyPusher}); a game without one has pieces that appear in place and stay there, and this file pulls
 * no solver into its bundle.
 */
import type { App, Plugin } from '../app/app';
import type { Entity, Vec3 } from '../types';
import { defineComponent, getComponent, Transform, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { isEditor, isPlayMode } from '../ecs/env';
import { Prefabs, type PrefabServer } from '../prefab/prefabServer';
import { q } from '../math/quat';
import { log } from '../util/logger';
import { defineEvent, EventWriter, type EventDef, type EventWriterInstance } from '../ecs/event';

/** Something broke: which, where it was struck in the world, and how hard (0 when its flag was raised by hand). */
export interface BrokePayload {
    entity: Entity;
    x: number;
    y: number;
    z: number;
    impulse: number;
}

/**
 * Sent the frame a Breakable breaks, for the sound, the dust and the score: read it with `EventReader(Broke)` in a
 * system of your own. Not sent when it is made whole again.
 */
export const Broke: EventDef<BrokePayload> = defineEvent<BrokePayload>('Broke', { entity: 0 as Entity, x: 0, y: 0, z: 0, impulse: 0 });

export interface BreakableData {
    /** The prefab of its pieces, as a model's `fracture` step writes it. */
    pieces: string;
    /** Raise it and the thing breaks; lower it and it is whole again. */
    broken: boolean;
    /** How fast the pieces leave, in world units a second, straight out from `origin`. 0 lets them fall where they are. */
    burst: number;
    /** Where it is struck, from its own origin: the pieces fly away from here. */
    origin: Vec3;
    /** Seconds the pieces last before they are taken away. 0 keeps them. */
    lifetime: number;
    /**
     * A hit at least this hard breaks it: the speed at which the two came together times the mass they met with, in
     * kilograms by world units a second. A 1 kg stone landing at 10 m/s, in a scene of 100 units to the metre, is
     * 1000; a pebble of 50 g at the same speed is 50. A thing that falls meets the floor with its own mass. 0 breaks it
     * only when `broken` is raised. It needs a collider of its own to be hit at all.
     */
    breakImpulse: number;
    enabled: boolean;
}

export const Breakable = defineComponent<BreakableData>('Breakable', {
    pieces: '',
    broken: false,
    burst: 300,
    origin: { x: 0, y: 0, z: 0 },
    lifetime: 0,
    breakImpulse: 0,
    enabled: true,
}, {
    assetFields: [{ field: 'pieces', type: 'prefab' }],
    fields: {
        pieces: { tooltip: 'The prefab of its pieces: a model with a fracture step writes one beside its mesh.' },
        broken: { tooltip: 'Raise to break it, lower to make it whole again.' },
        burst: { min: 0, step: 10, tooltip: 'How fast the pieces leave, in world units a second, out from Origin. 0 lets them fall where they are.' },
        origin: { tooltip: 'Where it is struck, from its own origin: the pieces fly away from here.' },
        lifetime: { min: 0, step: 0.5, tooltip: 'Seconds the pieces last before they are taken away. 0 keeps them.' },
        breakImpulse: { min: 0, step: 50, tooltip: 'A hit at least this hard breaks it: speed times mass, kg by world units a second (1 kg at 10 m/s is 1000 at 100 units to the metre). It needs a collider to be hit. 0 breaks it only when Broken is raised.' },
    },
});

/** Sets a body's velocity, in world units a second; false while the entity has no body yet. */
export type BodyPusher = (entity: Entity, velocity: Vec3) => boolean;
let pusher: BodyPusher | null = null;

/** The 3D world says how a body is pushed, when it has loaded; null when it has gone. */
export function setBodyPusher(push: BodyPusher | null): void {
    pusher = push;
}

type ContactSink = (a: Entity, b: Entity, impulse: number, point: Vec3) => void;
const sinks = new Set<ContactSink>();

/**
 * Two bodies met at `point` with `impulse`, kilograms by world units a second: what a 3D world says after each of its
 * steps, so that a thing struck hard enough breaks without the world knowing anything breaks.
 */
export function reportContact(a: Entity, b: Entity, impulse: number, point: Vec3): void {
    for (const sink of sinks) sink(a, b, impulse, point);
}

interface Broken {
    /** Still waiting for its prefab: nothing is shown as broken until the pieces are there to show. */
    loading: boolean;
    root: Entity | null;
    age: number;
    /** Pieces still to be thrown: a body is made by the world's next step, not by the spawn. */
    throws: { entity: Entity; velocity: Vec3; tries: number }[];
}

/** Which way each piece goes: out from where the thing was struck, and a little up, so a pot does not only fall open. */
export function burstVelocity(piece: Vec3, origin: Vec3, speed: number): Vec3 {
    let [x, y, z] = [piece.x - origin.x, piece.y - origin.y, piece.z - origin.z];
    const far = Math.hypot(x, y, z);
    // A piece that lies where it was struck has no way out of its own: up.
    if (far < 1e-6) [x, y, z] = [0, 1, 0];
    else [x, y, z] = [x / far, y / far + 0.35, z / far];
    const long = Math.hypot(x, y, z);
    return { x: (x / long) * speed, y: (y / long) * speed, z: (z / long) * speed };
}

export class BreakablePlugin implements Plugin {
    name = 'breakable';
    /** Each app this was built into hears hits through its own sink, taken away when that app ends. */
    private readonly sinks_ = new Map<App, ContactSink>();

    cleanup(app?: App): void {
        for (const [owner, sink] of [...this.sinks_]) {
            if (app && owner !== app) continue;
            sinks.delete(sink);
            this.sinks_.delete(owner);
        }
    }

    build(app: App): void {
        const state = new Map<Entity, Broken>();
        const world = app.world;
        const show = (entity: Entity, visible: boolean): void => {
            // The whole is hidden, not removed: it is what comes back, with everything a scene hung on it.
            for (const name of ['MeshRenderer', 'RigidBody3D', 'BoxCollider3D', 'SphereCollider3D', 'CapsuleCollider3D', 'ConvexCollider3D', 'MeshCollider3D']) {
                const def = getComponent(name);
                if (def && world.has(entity, def)) world.update(entity, def, (d: { enabled?: boolean }) => { d.enabled = visible; });
            }
        };
        const mend = (entity: Entity): void => {
            const b = state.get(entity);
            state.delete(entity);
            if (b?.root !== null && b?.root !== undefined && world.valid(b.root)) world.despawn(b.root);
            if (world.valid(entity)) show(entity, true);
        };
        // Its pieces are made ready while it stands whole: a prefab's meshes are files of their own, and loaded only
        // when it breaks they would arrive frames after the blow, with the whole already gone and nothing in its place.
        const warm = new Map<Entity, { pieces: string; release: (() => void) | null; dropped: boolean }>();
        const cool = (entity: Entity): void => {
            const w = warm.get(entity);
            if (!w) return;
            warm.delete(entity);
            w.dropped = true;
            w.release?.();
        };
        const keepWarm = (entity: Entity, pieces: string, prefabs: PrefabServer): void => {
            const had = warm.get(entity);
            if (had?.pieces === pieces) return;
            cool(entity);
            if (!pieces || typeof prefabs.prepare !== 'function') return;
            const w = { pieces, release: null as (() => void) | null, dropped: false };
            warm.set(entity, w);
            prefabs.prepare(pieces).then((held) => {
                if (w.dropped) held.release(); else w.release = () => held.release();
            }, () => { /* breaking says why it cannot, when it is asked to */ });
        };
        // Hits are noted as the world steps and acted on in the update after: the step is no place to spawn pieces.
        const hits: { entity: Entity; impulse: number; point: Vec3 }[] = [];
        const sink: ContactSink = (a, b, impulse, point) => {
            for (const entity of [a, b]) {
                if (!world.valid(entity) || !world.has(entity, Breakable)) continue;
                const data = world.get(entity, Breakable) as BreakableData;
                if (data.enabled && !data.broken && data.breakImpulse > 0 && impulse >= data.breakImpulse) hits.push({ entity, impulse, point });
            }
        };
        sinks.add(sink);
        this.sinks_.set(app, sink);
        const offDespawn = world.onDespawn((entity: Entity) => {
            cool(entity);
            const b = state.get(entity);
            if (!b) return;
            state.delete(entity);
            if (b.root !== null && world.valid(b.root)) world.despawn(b.root);
        });
        void offDespawn;

        // The blow that broke a thing, kept until it breaks, for what the event says.
        const struck = new Map<Entity, { impulse: number; point: Vec3 }>();
        const shatter = (entity: Entity, data: BreakableData, prefabs: PrefabServer, broke: EventWriterInstance<BrokePayload>): void => {
            const blow = struck.get(entity);
            struck.delete(entity);
            const t = world.get(entity, Transform) as TransformData & { worldPosition?: Vec3; worldRotation?: { x: number; y: number; z: number; w: number }; worldScale?: Vec3 };
            const [position, rotation, scale] = [t.worldPosition ?? t.position, t.worldRotation ?? t.rotation, t.worldScale ?? t.scale];
            const from = q.rotate(rotation, { x: data.origin.x * scale.x, y: data.origin.y * scale.y, z: data.origin.z * scale.z });
            const point = blow?.point ?? { x: position.x + from.x, y: position.y + from.y, z: position.z + from.z };
            const b: Broken = { loading: true, root: null, age: 0, throws: [] };
            state.set(entity, b);
            prefabs.instantiate(data.pieces).then((made) => {
                // Mended, removed or switched off while the pieces were loading: they are not wanted.
                if (state.get(entity) !== b || !world.valid(entity)) { if (world.valid(made.root)) world.despawn(made.root); return; }
                const t = world.get(entity, Transform) as TransformData & { worldPosition?: Vec3; worldRotation?: { x: number; y: number; z: number; w: number }; worldScale?: Vec3 };
                const [position, rotation, scale] = [t.worldPosition ?? t.position, t.worldRotation ?? t.rotation, t.worldScale ?? t.scale];
                // Where the whole stood, turned and sized as it was: the pieces are its children and come with it.
                world.update(made.root, Transform, (d: TransformData) => { d.position = { ...position }; d.rotation = { ...rotation }; d.scale = { ...scale }; });
                show(entity, false);
                b.loading = false;
                // Said once the pieces stand in its place: a thing whose pieces could not be loaded did not break.
                broke.send({ entity, x: point.x, y: point.y, z: point.z, impulse: blow?.impulse ?? 0 });
                b.root = made.root;
                if (data.burst > 0) {
                    const from = q.rotate(rotation, { x: data.origin.x * scale.x, y: data.origin.y * scale.y, z: data.origin.z * scale.z });
                    const origin = { x: position.x + from.x, y: position.y + from.y, z: position.z + from.z };
                    const body = getComponent('RigidBody3D');
                    for (const piece of made.entities.values()) {
                        if (piece === made.root || !body || !world.has(piece, body)) continue;
                        const local = (world.get(piece, Transform) as TransformData).position;
                        const turned = q.rotate(rotation, { x: local.x * scale.x, y: local.y * scale.y, z: local.z * scale.z });
                        b.throws.push({ entity: piece, velocity: burstVelocity({ x: position.x + turned.x, y: position.y + turned.y, z: position.z + turned.z }, origin, data.burst), tries: 0 });
                    }
                }
            }).catch((err) => {
                // Whether the prefab could not be read or its pieces could not be placed, the thing is left as it was.
                log.warn('breakable', `cannot break into "${data.pieces}"; the thing stays whole`, err);
                if (b.root !== null && world.valid(b.root)) world.despawn(b.root);
                if (world.valid(entity)) show(entity, true);
                if (state.get(entity) === b) state.delete(entity);
                if (world.valid(entity)) world.update(entity, Breakable, (d: BreakableData) => { d.broken = false; });
            });
        };

        app.addSystemToSchedule(Schedule.Update, defineSystem([Res(Time), EventWriter(Broke)], (time: TimeData, broke: EventWriterInstance<BrokePayload>) => {
            if (isEditor() && !isPlayMode()) {
                // Out of play nothing is broken: what a scene saves is the whole.
                for (const entity of [...state.keys()]) mend(entity);
                for (const entity of [...warm.keys()]) cool(entity);
                return;
            }
            const prefabs = app.hasResource(Prefabs) ? app.getResource(Prefabs) : null;
            // Struck hard enough: it breaks from where it was hit, the hardest hit if there were several.
            if (hits.length) {
                const hardest = new Map<Entity, { impulse: number; point: Vec3 }>();
                for (const h of hits) if ((hardest.get(h.entity)?.impulse ?? -1) < h.impulse) hardest.set(h.entity, h);
                hits.length = 0;
                for (const [entity, h] of hardest) {
                    if (!world.valid(entity) || !world.has(entity, Breakable)) continue;
                    const t = world.get(entity, Transform) as TransformData & { worldPosition?: Vec3; worldRotation?: { x: number; y: number; z: number; w: number }; worldScale?: Vec3 };
                    const [position, rotation, scale] = [t.worldPosition ?? t.position, t.worldRotation ?? t.rotation, t.worldScale ?? t.scale];
                    const local = q.rotate(q.conjugate(rotation), { x: h.point.x - position.x, y: h.point.y - position.y, z: h.point.z - position.z });
                    world.update(entity, Breakable, (d: BreakableData) => {
                        d.origin = { x: local.x / (scale.x || 1), y: local.y / (scale.y || 1), z: local.z / (scale.z || 1) };
                        d.broken = true;
                    });
                    struck.set(entity, h);
                }
            }
            const live = new Set<Entity>();
            for (const entity of world.getEntitiesWithComponents([Breakable])) {
                const data = world.get(entity, Breakable) as BreakableData;
                live.add(entity);
                if (prefabs && data.enabled) keepWarm(entity, data.pieces, prefabs); else cool(entity);
                const b = state.get(entity);
                if (!data.enabled || !data.broken) { if (b) mend(entity); continue; }
                if (!b) { if (data.pieces && prefabs) shatter(entity, data, prefabs, broke); continue; }
                if (b.loading) continue;
                // The world makes a piece's body on its next step; until then there is nothing to throw.
                if (b.throws.length) {
                    b.throws = b.throws.filter((t) => {
                        if (!world.valid(t.entity)) return false;
                        if (pusher?.(t.entity, t.velocity)) return false;
                        return ++t.tries < 30;
                    });
                }
                b.age += time.delta;
                if (data.lifetime > 0 && b.age >= data.lifetime && b.root !== null) {
                    if (world.valid(b.root)) world.despawn(b.root);
                    b.root = null;
                    b.throws = [];
                }
            }
            for (const entity of [...state.keys()]) if (!live.has(entity)) mend(entity);
            for (const entity of [...warm.keys()]) if (!live.has(entity)) cool(entity);
        }, { name: 'BreakableSystem' }));
    }
}

export const breakablePlugin = new BreakablePlugin();
