// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, ParticleEmitter, Transform } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';

/** Imported world-space particles: geometry follows Transform, lengths and forces use model units here. */
export const ParticleModelUnits = defineComponent('ParticleModelUnits', {
    startSizeMin: 1, startSizeMax: 1, endSizeMin: 1, endSizeMax: 1,
    speedMin: 0, speedMax: 0, gravity: { x: 0, y: 0, z: 0 } as Vec3,
});

const EMITTER_COMPONENTS = [ParticleModelUnits, ParticleEmitter, Transform];
const MODEL_LENGTHS = ['startSizeMin', 'startSizeMax', 'endSizeMin', 'endSizeMax', 'speedMin', 'speedMax'] as const;

export class ParticleModelUnitState {
    private readonly snapshots = new Map<Entity, readonly number[]>();
    private lifetime: symbol | null = null;
    private structure = -1;
    private transform = -1;
    private units = -1;

    constructor(private readonly world: World) {}

    update(): void {
        const { world } = this;
        const lifetime = world.entityLifetime;
        const structure = world.getWorldVersion();
        const transform = world.transformEpoch();
        const unitsRevision = world.mutationRevision(ParticleModelUnits, 'write');
        if (lifetime === this.lifetime && structure === this.structure
            && transform >= 0 && transform === this.transform && unitsRevision === this.units) return;
        if (lifetime !== this.lifetime) this.snapshots.clear();

        const emitters = world.queryEntities(EMITTER_COMPONENTS);
        if (emitters.length) {
            world.enableIncarnationTracking(ParticleEmitter);
            world.ensureTransformsComposed();
        }
        const live = new Set<Entity>();
        for (const entity of emitters) {
            live.add(entity);
            const s = world.get(entity, Transform).worldScale;
            const scale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
            const units = world.get(entity, ParticleModelUnits);
            const incarnation = world.getComponentIncarnation(entity, ParticleEmitter);
            const snapshot = [incarnation, scale, units.startSizeMin, units.startSizeMax, units.endSizeMin, units.endSizeMax,
                units.speedMin, units.speedMax, units.gravity.x, units.gravity.y, units.gravity.z];
            const previous = this.snapshots.get(entity);
            if (previous && snapshot.every((v, i) => v === previous[i])) continue;
            const emitter = world.get(entity, ParticleEmitter);
            for (const key of MODEL_LENGTHS) emitter[key] = units[key] * scale;
            emitter.gravity = { x: units.gravity.x * scale, y: units.gravity.y * scale, z: units.gravity.z * scale };
            writeProjection(world, entity, ParticleEmitter, emitter);
            this.snapshots.set(entity, snapshot);
        }
        for (const entity of this.snapshots.keys()) if (!live.has(entity)) this.snapshots.delete(entity);
        // Keep the input checkpoint from before projections, so observer writes
        // made while applying one emitter are picked up on the following update.
        this.lifetime = lifetime;
        this.structure = structure;
        this.transform = transform;
        this.units = unitsRevision;
    }
}
