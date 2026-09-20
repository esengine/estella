// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  optionalPlugins.ts — everything optional, for an entry that wants all of it.
 *
 * Each subsystem installs itself when its own subpath is imported, so this file
 * is only the list. An entry importing it ships them all; a lean entry imports
 * the ones its project uses and carries no more — measured on
 * examples/hello-world, that is none of them.
 */
import '../spine';
import '../dragonbones';
import '../physics';
import '../physics3d';
import { VideoPlayer } from '../video/VideoAPI';
import { setSceneOptionals } from './sceneOptionals';

// Video has no subpath of its own to be installed from, so it installs here.
setSceneOptionals({
    video: {
        setRefResolver: (app, resolve) => {
            if (!app.hasResource(VideoPlayer)) return false;
            app.getResource(VideoPlayer).setRefResolver(resolve);
            return true;
        },
    },
});
