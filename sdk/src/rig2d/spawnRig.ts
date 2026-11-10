// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spawnRig.ts
 * @brief   A rig's bones and skin as entities in a running world, for characters a game makes in code. The editor writes the same shape into a scene.
 */
import { getComponent, MeshRenderer, Transform } from '../ecs/component';
import { PREFAB_FORMAT_VERSION } from '../prefab/migrate';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Bone2D } from './rig2dPlugin';
import { rigBoneId, type RigSource } from './rigSource';

/** @experimental */
export interface SpawnedRig {
    /** Carries the MeshRenderer, the MeshSkin and, when the rig has deforms, the MeshMorph. */
    root: Entity;
    /** By bone index, which is the order the mesh's joints are in. */
    bones: Entity[];
}

/** `mesh` is the rig baked and loaded; `texture` is its image. Each bone is named as in the rig, so a clip reaches it by path. @experimental */
export function spawnRig(world: World, rig: RigSource, opts: { mesh: number; texture: number; layer?: number; x?: number; y?: number; z?: number }): SpawnedRig {
    const root = world.spawn('Rig');
    world.insert(root, Transform, { position: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 } });
    const bones: Entity[] = [];
    rig.bones.forEach((bone, i) => {
        const entity = world.spawn(bone.name), half = bone.rotation / 2;
        world.insert(entity, Transform, {
            position: { x: bone.x, y: bone.y, z: 0 },
            rotation: { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) },
        });
        world.insert(entity, Bone2D, { length: bone.length });
        world.setParent(entity, bone.parent >= 0 ? bones[bone.parent]! : root);
        bones[i] = entity;
    });
    world.insert(root, MeshRenderer, { mesh: opts.mesh, texture: opts.texture, layer: opts.layer ?? 0, opaque: false, enabled: true });
    world.insert(root, getComponent('MeshSkin')!, { joints: bones });
    if (rig.deforms.length > 0) world.insert(root, getComponent('MeshMorph')!, { weights: rig.deforms.map(() => 0) });
    return { root, bones };
}

/**
 * A rig as a prefab, which is how it reaches a scene: saving again changes every instance, and what a scene adds to one (an IK2D, a clip) stays.
 * `mesh` and `texture` are asset refs. Same shape as {@link spawnRig}.
 * @experimental
 */
export function rigPrefab(rig: RigSource, name: string, mesh: string, texture: string): { version: string; name: string; rootEntityId: string; entities: Record<string, unknown>[] } {
    // By id, not index: what a scene added to a bone's entity has to stay on that bone when the rig's list is reordered.
    const idOf = (i: number): string => rigBoneId(rig.bones, i);
    const children = (parent: number): string[] => rig.bones.flatMap((b, i) => (b.parent === parent ? [idOf(i)] : []));
    const entities: Record<string, unknown>[] = [{
        prefabEntityId: 'root', name, parent: null, children: children(-1), visible: true,
        components: [
            { type: 'Transform', data: {} },
            { type: 'MeshRenderer', data: { mesh, texture, opaque: false } },
            { type: 'MeshSkin', data: { joints: rig.bones.map((_, i) => idOf(i)) } },
            ...(rig.deforms.length > 0 ? [{ type: 'MeshMorph', data: { weights: rig.deforms.map(() => 0) } }] : []),
        ],
    }];
    rig.bones.forEach((bone, i) => {
        const half = bone.rotation / 2;
        entities.push({
            prefabEntityId: idOf(i), name: bone.name, parent: bone.parent >= 0 ? idOf(bone.parent) : 'root', children: children(i), visible: true,
            components: [
                { type: 'Transform', data: { position: { x: bone.x, y: bone.y, z: 0 }, rotation: { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) } } },
                { type: 'Bone2D', data: { length: bone.length } },
            ],
        });
    });
    return { version: PREFAB_FORMAT_VERSION, name, rootEntityId: 'root', entities };
}
