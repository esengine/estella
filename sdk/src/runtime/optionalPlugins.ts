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
import { registerScriptGraphSupport } from '../logic/logicSupport';
import { registerAiSupport } from '../ai/aiSupport';

export function installOptionalPlugins(): void {
    registerSpineSupport();
    registerDragonBonesSupport();
    registerPhysics2DSupport();
    registerPhysics3DSupport();
    registerTilemapSupport();
    registerScriptGraphSupport();
    registerAiSupport();
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
