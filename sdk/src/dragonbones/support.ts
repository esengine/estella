// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file  support.ts — what a build that ships DragonBones tells the core about
 *         it. A call, not a file's side effect — see spine/support.ts. */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { setSceneOptionals } from '../runtime/sceneOptionals';
import { DragonBonesPlugin as DragonBonesPluginCtor } from './DragonBonesPlugin';
import { loadDragonBonesAssets, applyDragonBonesEntities } from './loadDragonBonesScene';

export function registerDragonBonesSupport(): void {
    addEntryPlugin(() => new DragonBonesPluginCtor());
    setSceneOptionals({
        dragonBones: {
            acquire: async (app) => (await app.getPlugin(DragonBonesPluginCtor)?.acquire()) ?? null,
            load: loadDragonBonesAssets,
            apply: applyDragonBonesEntities,
        },
    });
}
