// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  optionalPlugins.ts — the entry-point side of the optional subsystems.
 *
 * Importing this file IS the decision to ship Spine and DragonBones: it is the
 * only place that reaches them from the runtime, so a build that leaves it out
 * leaves their code out too. A mini-game inlines the SDK, and measured on
 * examples/hello-world these two are 110KB of a package using neither.
 *
 * Every entry point imports it for its side effect. One that deliberately does
 * not is a lean entry, and `check-entries-install-options` is what keeps the
 * difference from being an accident.
 */
import { SpinePlugin } from '../spine';
import { DragonBonesPlugin } from '../dragonbones';
import { loadSpineAssets, applySpineEntities } from '../spine/loadSpineScene';
import {
    loadDragonBonesAssets, applyDragonBonesEntities,
} from '../dragonbones/loadDragonBonesScene';
import { setEntryPlugins } from './entryPlugins';
import { Physics2DPlugin } from '../physics/Physics2DPlugin';
import { Physics3DPlugin } from '../physics3d/Physics3DPlugin';
import { VideoPlayer } from '../video/VideoAPI';
import { setSceneOptionals } from './sceneOptionals';

setEntryPlugins(() => [new SpinePlugin(), new DragonBonesPlugin()]);

// The scene-load half: the loader reaches these only when a scene actually holds
// a skeleton, so shipping them was always about bytes rather than behaviour.
setSceneOptionals({
    spine: {
        manager: (app) => app.getPlugin(SpinePlugin)?.spineManager ?? null,
        load: loadSpineAssets,
        apply: applySpineEntities,
    },
    dragonBones: {
        acquire: async (app) => (await app.getPlugin(DragonBonesPlugin)?.acquire()) ?? null,
        load: loadDragonBonesAssets,
        apply: applyDragonBonesEntities,
    },
    physics: {
        installed: (app) => !!app.getPlugin(Physics2DPlugin),
        install: (app, config, module) =>
            app.addPlugin(new Physics2DPlugin('', config, () => Promise.resolve(module))),
    },
    physics3d: {
        installed: (app) => !!app.getPlugin(Physics3DPlugin),
        install: (app, module) =>
            app.addPlugin(new Physics3DPlugin('', {}, () => Promise.resolve(module))),
    },
    video: {
        setRefResolver: (app, resolve) => {
            if (!app.hasResource(VideoPlayer)) return false;
            app.getResource(VideoPlayer).setRefResolver(resolve);
            return true;
        },
    },
});
