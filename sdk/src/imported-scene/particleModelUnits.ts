// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, ParticleEmitter, Transform } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Vec3 } from '../types';

/** Imported world-space particles: geometry follows Transform, lengths and forces use model units here. */
export const ParticleModelUnits = defineComponent('ParticleModelUnits', {
    startSizeMin: 1, startSizeMax: 1, endSizeMin: 1, endSizeMax: 1,
    speedMin: 0, speedMax: 0, gravity: { x: 0, y: 0, z: 0 } as Vec3,
});
export class ParticleModelUnitState {
    private snapshots = new Map<number, readonly number[]>();
    update(world: World): void {
        const live = new Set<number>();
        for (const entity of world.queryEntities([ParticleModelUnits, ParticleEmitter, Transform])) {
            live.add(entity);
            const s = world.get(entity, Transform).worldScale;
            const scale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
            const units = world.get(entity, ParticleModelUnits);
            const snapshot = [scale, units.startSizeMin, units.startSizeMax, units.endSizeMin, units.endSizeMax,
                units.speedMin, units.speedMax, units.gravity.x, units.gravity.y, units.gravity.z];
            const previous = this.snapshots.get(entity);
            if (previous && snapshot.every((v, i) => v === previous[i])) continue;
            this.snapshots.set(entity, snapshot);
            const emitter = world.get(entity, ParticleEmitter);
            for (const key of ['startSizeMin', 'startSizeMax', 'endSizeMin', 'endSizeMax', 'speedMin', 'speedMax'] as const)
                emitter[key] = units[key] * scale;
            emitter.gravity = { x: units.gravity.x * scale, y: units.gravity.y * scale, z: units.gravity.z * scale };
            world.set(entity, ParticleEmitter, emitter);
        }
        for (const entity of this.snapshots.keys()) if (!live.has(entity)) this.snapshots.delete(entity);
    }
}
