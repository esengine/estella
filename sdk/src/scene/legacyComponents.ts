// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    legacyComponents.ts
 * @brief   Component data written by an older engine, brought forward.
 * @details A scene and a prefab hold the same component records, so an upgrade
 *          belongs to neither: one that runs on only one of them leaves the other
 *          handing the engine data it no longer means. Both migrations call
 *          {@link upgradeEntityComponents}, and it is idempotent — data already
 *          current passes through untouched.
 */

import { q } from '../math/quat';
import { lightAimRotation } from '../render/lightAim';
import type { Vec3 } from '../types';

/** The serialized shape of one component: what a `.esscene` and a `.esprefab` both hold. */
export interface UpgradableComponent {
    type: string;
    data: Record<string, unknown>;
}

/** Anything carrying a list of components — a scene entity or a prefab entity. */
export interface UpgradableEntity {
    components: UpgradableComponent[];
}

/**
 * Engine components that no longer exist. A file written before their retirement
 * still names them; keeping them would only make the loader warn and skip.
 */
export const RETIRED_COMPONENT_TYPES: ReadonlySet<string> = new Set(['StateMachine', 'StateVisuals']);

/**
 * Components an engine upgrade renamed, old name to new. A name is the key a file
 * stores a component under, so a rename is a migration: without one the loader
 * reads the old name as a component it has never heard of.
 */
export const RENAMED_COMPONENT_TYPES: ReadonlyMap<string, string> = new Map([
    ['LocalTransform', 'Transform'],
    ['WorldTransform', 'Transform'],
    // The engine's only light and mesh components; their names said 2D while 3D
    // models, PBR, IBL and shadow maps all went through them.
    ['Light2D', 'Light'],
    ['Mesh2D', 'MeshRenderer'],
]);

/** Light kinds that aim: Directional (1) and Spot (3). Point and Ambient never did. */
const AIMED_LIGHT_TYPES = new Set([1, 3]);

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

/**
 * Would {@link upgradeEntityComponents} change this entity? Its pair, so that a
 * caller who must copy before writing can ask first; every rule below is
 * answered here, which is why the two live together.
 */
export function needsComponentUpgrade(entity: UpgradableEntity): boolean {
    return entity.components.some((c) => RETIRED_COMPONENT_TYPES.has(c.type)
        || RENAMED_COMPONENT_TYPES.has(c.type)
        || (c.type === 'UIMask' && typeof c.data['mode'] === 'string')
        || (c.type === 'Light' && ('direction' in c.data || 'directionZ' in c.data)));
}

/**
 * Move a light's aim onto the entity carrying it: `direction`/`directionZ` become
 * the rotation whose forward they are, replacing whatever rotation the file
 * carried — the renderer never read that one, so no frame moves.
 * Point and Ambient do not aim; their fields go and their rotation is left alone.
 */
function upgradeLightAim(entity: UpgradableEntity): boolean {
    const light = entity.components.find((c) => c.type === 'Light');
    if (!light) return false;
    const data = light.data;
    if (!('direction' in data) && !('directionZ' in data)) return false;

    const named = data['direction'] as { x?: unknown; y?: unknown } | undefined;
    const aim: Vec3 = {
        x: Number(named?.x ?? 0),
        y: Number(named?.y ?? 0),
        // The component's own default, for a file that named only the plane's half.
        z: 'directionZ' in data ? Number(data['directionZ']) : -1,
    };
    delete data['direction'];
    delete data['directionZ'];
    if (!AIMED_LIGHT_TYPES.has(Number(data['type'] ?? 0))) return true;

    // An aim of zero in all three named no direction at all, and the engine read
    // that as the one an unrotated light has — the rotation this returns.
    const rotation = lightAimRotation(aim);
    const stored = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    const transform = entity.components.find((c) => c.type === 'Transform');
    if (transform) {
        transform.data['rotation'] = stored;
    } else if (Math.abs(q.dot(rotation, IDENTITY)) < 1 - 1e-9) {
        // No Transform is the identity rotation already, so one is added only for
        // an aim that identity does not give.
        entity.components.unshift({ type: 'Transform', data: { rotation: stored } });
    }
    return true;
}

/** Legacy spellings inside one component. */
function upgradeComponent(component: UpgradableComponent): boolean {
    let changed = false;
    const renamed = RENAMED_COMPONENT_TYPES.get(component.type);
    if (renamed !== undefined) {
        component.type = renamed;
        changed = true;
    }
    if (component.type === 'UIMask') {
        const mask = component.data;
        if (mask['mode'] === 'scissor') { mask['mode'] = 0; changed = true; }
        else if (mask['mode'] === 'stencil') { mask['mode'] = 1; changed = true; }
    }
    return changed;
}

/**
 * Bring one entity's component data forward, in place: drop retired components,
 * normalize legacy spellings, move a light's aim onto its entity. Names of the
 * retired components dropped are added to `retired` when one is given — the
 * editor tells the user which its open upgraded away.
 *
 * @returns true when anything changed.
 */
export function upgradeEntityComponents(entity: UpgradableEntity, retired?: Set<string>): boolean {
    let changed = false;
    const live = entity.components.filter((c) => {
        if (!RETIRED_COMPONENT_TYPES.has(c.type)) return true;
        retired?.add(c.type);
        return false;
    });
    if (live.length !== entity.components.length) {
        entity.components = live;
        changed = true;
    }
    for (const component of entity.components) {
        if (upgradeComponent(component)) changed = true;
    }
    if (upgradeLightAim(entity)) changed = true;
    return changed;
}
