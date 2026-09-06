// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    residencyPlugin.ts
 * @brief   Where residency runs: after everything that MOVES a source, and off
 *          the sources' composed world positions.
 */

import type { App, Plugin } from '../app/app';
import { SceneManager } from '../scene/sceneManager';
import { WorldStreaming, WorldStreamer } from './WorldStreamer';
import type { ResidencySource } from './cells';
import { WorldStreamingSource, type WorldStreamingSourceData } from './components';
import { defineSystem, Schedule, GetWorld } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Transform, type TransformData } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import type { World } from '../ecs/world';

/**
 * Sample every enabled source and hand the whole list to the streamer.
 *
 * A list, not a focus: the streamer unions them. Exported because this is the
 * only place a `Transform` becomes a residency ask, which is what the criterion
 * for "a second source cannot delete the first one's world" has to reach.
 */
export const worldResidencySystem = defineSystem(
    [Res(WorldStreaming), GetWorld()],
    (streamer: WorldStreamer, world: World) => {
        if (streamer.manifest === null) return;
        // A source parented to a rig has no position of its own, and the ask is
        // about where it IS. Composition is a no-op unless something invalidated it.
        world.ensureTransformsComposed();
        const sources: ResidencySource[] = [];
        for (const entity of world.getEntitiesWithComponents([WorldStreamingSource, Transform])) {
            const source = world.get(entity, WorldStreamingSource) as WorldStreamingSourceData;
            if (!source.enabled) continue;
            const transform = world.get(entity, Transform) as TransformData;
            const at = transform.worldPosition ?? transform.position;
            sources.push({
                x: at.x,
                z: at.z ?? 0,
                loadRadius: source.loadRadius,
                unloadRadius: source.unloadRadius,
                prefetchRadius: source.prefetchRadius,
            });
        }
        streamer.update(sources);
    },
    {
        name: 'WorldResidencySystem',
        touches: { reads: ['Transform', 'WorldStreamingSource'] },
    },
);

/**
 * Residency, over the scene manager's primitives.
 *
 * `PostUpdate`: a source's ask is about where it ended this frame, and reading it
 * before movement asks for the world it was in last frame — which at a boundary
 * is the wrong side of it.
 */
export const worldResidencyPlugin: Plugin = {
    name: 'worldResidency',
    profileDomain: 'scene',
    // Residency IS the scene manager's primitives, driven by geometry. Declared
    // so an assembly that wires them in the wrong order fails at build rather
    // than handing the streamer an undefined host.
    dependencies: [SceneManager],
    build(app: App): void {
        app.insertResource(WorldStreaming, new WorldStreamer(app.getResource(SceneManager)));
        app.addSystemToSchedule(Schedule.PostUpdate, worldResidencySystem, { runIf: playModeOnly });
    },
};
