// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file  support.ts — what a build that ships 3D physics tells the core about
 *         it. A call, not a file's side effect — see spine/support.ts. */
import { setSceneOptionals } from '../runtime/sceneOptionals';
import { Physics3DPlugin as Physics3DPluginCtor } from './Physics3DPlugin';

export function registerPhysics3DSupport(): void {
    setSceneOptionals({
        physics3d: {
            installed: (app) => !!app.getPlugin(Physics3DPluginCtor),
            install: (app, module) =>
                app.addPlugin(new Physics3DPluginCtor('', {}, () => Promise.resolve(module))),
        },
    });
}
