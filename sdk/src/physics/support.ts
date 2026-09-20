// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file  support.ts — what a build that ships 2D physics tells the core about
 *         it. A call, not a file's side effect — see spine/support.ts.
 *
 *         No entry plugin: the scene load builds it with the world config the
 *         project declared. */
import { setSceneOptionals } from '../runtime/sceneOptionals';
import { Physics2DPlugin as Physics2DPluginCtor } from './Physics2DPlugin';

export function registerPhysics2DSupport(): void {
    setSceneOptionals({
        physics: {
            installed: (app) => !!app.getPlugin(Physics2DPluginCtor),
            install: (app, config, module) =>
                app.addPlugin(new Physics2DPluginCtor('', config, () => Promise.resolve(module))),
        },
    });
}
