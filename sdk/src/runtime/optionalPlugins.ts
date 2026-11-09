// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  optionalPlugins.ts — everything optional, for an entry that wants all of it.
 *
 * Each subsystem's support is a function, and this calls every one. It used to be
 * a list of `import '../spine'` lines reached by `import './runtime/optionalPlugins'`,
 * which reads as "importing this ships them" and is not what a bundler sees: a
 * bare side-effect import survives only where every layer has been told the file
 * is impure, and no layer had been. The code shipped and the registrations never
 * ran — the editor's play realm loaded a scene with 3D physics and no solver.
 *
 * An entry calling this ships them all; a lean entry calls the ones its project
 * uses and carries no more — measured on examples/hello-world, that is none.
 */
import { VideoPlayer } from '../video/VideoAPI';
import { setSceneOptionals } from './sceneOptionals';
import { registerSpineSupport } from '../spine/spineSupport';
import { registerDragonBonesSupport } from '../dragonbones/dragonBonesSupport';
import { registerPhysics2DSupport } from '../physics/physicsSupport';
import { registerPhysics3DSupport } from '../physics3d/physics3dSupport';
import { registerTilemapSupport } from '../tilemap/tilemapSupport';
import { registerBasicEffectSources } from '../postprocess/sources/basic';
import { registerAtmosphereEffectSources } from '../postprocess/sources/atmosphere';
import { registerLightingEffectSources } from '../postprocess/sources/lighting';
import { registerTimelineSupport } from '../timeline/timelineSupport';
import { registerTerrainSupport } from '../terrain/terrainSupport';
import { registerFoliageSupport } from '../foliage/foliageSupport';
import { registerWorldGenSupport } from '../worldgen/worldgenSupport';
import { registerWaterSupport } from '../water/waterSupport';
import { registerSplineSupport } from '../spline/splineSupport';
import { registerVoxelSupport } from '../voxel/voxelSupport';
import { registerRig2DSupport } from '../rig2d/rig2dSupport';
import { registerImportedSceneSupport } from '../imported-scene/importedSceneSupport';
import { registerCharacterShaders } from '../character/characterSupport';
import { registerScriptGraphSupport } from '../logic/logicSupport';
import { registerAiSupport } from '../ai/aiSupport';
import { registerReplicationSupport } from '../net/replication/replicationSupport';
import { registerGameplaySupport } from '../gameplay/gameplaySupport';
import { registerDebugChannelSupport } from '../debug-channel/debugChannelSupport';

export function installOptionalPlugins(): void {
    registerSpineSupport();
    registerDragonBonesSupport();
    registerPhysics2DSupport();
    registerPhysics3DSupport();
    registerTilemapSupport();
    registerTimelineSupport();
    registerBasicEffectSources();
    registerAtmosphereEffectSources();
    registerLightingEffectSources();
    registerTerrainSupport();
    registerFoliageSupport();
    registerWorldGenSupport();
    registerWaterSupport();
    registerSplineSupport();
    registerVoxelSupport();
    registerRig2DSupport();
    registerImportedSceneSupport();
    registerCharacterShaders();
    registerScriptGraphSupport();
    registerAiSupport();
    registerReplicationSupport();
    registerGameplaySupport();
    registerDebugChannelSupport();
    // Video has no subpath of its own to be installed from, so it registers here.
    setSceneOptionals({
        video: {
            setRefResolver: (app, resolve) => {
                if (!app.hasResource(VideoPlayer)) return false;
                app.getResource(VideoPlayer).setRefResolver(resolve);
                return true;
            },
        },
    });
}
