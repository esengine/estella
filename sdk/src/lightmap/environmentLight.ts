// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    environmentLight.ts
 * @brief   Which Ambient light is a scene's environment.
 *
 * @details The frame decides this in RenderFrame.cpp: the first active Light that is
 *          enabled, has intensity, is Ambient and names an environment the registry
 *          holds. A bake has to take the same light's sky, and an editor has to say
 *          which light that is and why the others lose — three readers of one rule,
 *          so the document-side reading is this one function, beside `bakeLightOf`
 *          which fills defaults the same way. The C++ rule is the authority; this
 *          mirrors it over a scene document, so a change to one is a change to both.
 */

import { COMPONENT_META } from './metaAccess';
import { LightType } from '../wasm/wasm.generated';

/** The slice of a scene entity this reads. */
export interface EnvironmentLightEntity {
    id: number;
    name: string;
    parent?: number | null;
    /** Absent is visible. */
    visible?: boolean;
    components: ReadonlyArray<{ type: string; data: Record<string, unknown> }>;
}

/** Why the frame passes over an Ambient light, or null when it is in play. */
export type AmbientSkip = 'hidden' | 'disabled' | 'no-intensity';

/** One Ambient light, as the scene document states it with the component's defaults filled in. */
export interface SceneAmbientLight {
    entityId: number;
    name: string;
    skipped: AmbientSkip | null;
    /** The environment it names, as written, or null when it names none. */
    environment: string | null;
    /** It names one the project does not hold. */
    environmentMissing: boolean;
    drawEnvironment: boolean;
    /** Degrees about +Y. */
    rotation: number;
    intensity: number;
}

function field<T>(authored: Record<string, unknown>, defaults: Record<string, unknown> | undefined, key: string, fallback: T): T {
    const own = authored[key];
    if (own !== undefined) return own as T;
    const base = defaults?.[key];
    return (base !== undefined ? base : fallback) as T;
}

/**
 * Every Ambient light in a scene, in document order.
 *
 * @param exists Whether the project holds the asset a light names. The frame cannot
 *        use an environment it cannot load, and it moves on to the next light.
 */
export function sceneAmbientLights(entities: readonly EnvironmentLightEntity[],
                                   exists: (ref: string) => boolean): SceneAmbientLight[] {
    return readSceneLights(entities, exists).ambient;
}

/** Match the runtime's inherited Disabled state for entities present after scene loading. */
function sceneLightActivity(entities: readonly EnvironmentLightEntity[]) {
    let loaded: Map<number, EnvironmentLightEntity> | undefined;
    const active = new Map<number, boolean>();
    const pending: number[] = [];
    return (entity: EnvironmentLightEntity): boolean => {
        pending.length = 0;
        let current: EnvironmentLightEntity | undefined = entity;
        let enabled = true;
        while (current) {
            const known = active.get(current.id);
            if (known !== undefined) { enabled = known; break; }
            pending.push(current.id);
            // A repeated entry is a cycle; the loader would reject the hierarchy.
            active.set(current.id, false);
            if (current.components.some(c => c.type === 'Disabled')) { enabled = false; break; }
            if (current.parent == null) break;
            if (!loaded) {
                loaded = new Map();
                for (const row of entities) if (row.visible !== false) loaded.set(row.id, row);
            }
            current = loaded.get(current.parent);
        }
        for (const id of pending) active.set(id, enabled);
        return enabled;
    };
}

/** Read the light eligibility used by both the environment selector and the studio preview report. */
export function readSceneLights(entities: readonly EnvironmentLightEntity[], exists: (ref: string) => boolean) {
    const defaults = COMPONENT_META['Light']?.defaults as Record<string, unknown> | undefined;
    const editorDefaults = COMPONENT_META['Light']?.editorDefaults as Record<string, unknown> | undefined;
    const base = { ...defaults, ...editorDefaults };
    const isActive = sceneLightActivity(entities);
    const ambient: SceneAmbientLight[] = [];
    let direct = 0;
    let total = 0;
    for (const entity of entities) {
        for (const component of entity.components) {
            if (component.type !== 'Light') continue;
            total++;
            const intensity = field<number>(component.data, base, 'intensity', 1);
            const skipped: AmbientSkip | null =
                entity.visible === false ? 'hidden'
                    : !isActive(entity) || field<boolean>(component.data, base, 'enabled', true) === false ? 'disabled'
                        : !(intensity > 0 && Number.isFinite(intensity)) ? 'no-intensity' : null;
            if (field<number>(component.data, base, 'type', 0) !== LightType.Ambient) {
                if (!skipped) direct++;
                continue;
            }
            const named = field<unknown>(component.data, base, 'environment', '');
            const ref = typeof named === 'string' && named !== '' ? named : null;
            const rotation = field<number>(component.data, base, 'environmentRotation', 0);
            ambient.push({
                entityId: entity.id,
                name: entity.name,
                skipped,
                environment: ref,
                environmentMissing: ref !== null && !exists(ref),
                drawEnvironment: field<boolean>(component.data, base, 'drawEnvironment', false) === true,
                rotation: Number.isFinite(rotation) ? rotation : 0,
                intensity: Number.isFinite(intensity) ? intensity : 1,
            });
        }
    }
    return { ambient, direct, total };
}

/** An Ambient light the frame could take the environment from. */
export function carriesEnvironment(light: SceneAmbientLight): boolean {
    return light.skipped === null && light.environment !== null && !light.environmentMissing;
}

/**
 * The light whose environment the frame uses, and the lights that name one but lose to it.
 * Nothing is removed from the scene to settle it: a shadowed light is kept, and said so.
 */
export function sceneEnvironment(lights: readonly SceneAmbientLight[]):
    { effective: SceneAmbientLight | null; shadowed: SceneAmbientLight[] } {
    const live = lights.filter(carriesEnvironment);
    return { effective: live[0] ?? null, shadowed: live.slice(1) };
}
