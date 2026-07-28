// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DragonBonesPlugin, loadDragonBonesSceneEntities } from 'esengine/dragonbones';
import type { DragonBonesManager } from 'esengine/dragonbones';
import type { App, SceneData } from 'esengine';
import { editorSkeletalSource } from './skeletalSource';

/**
 * Bind every DragonBonesAnimation entity's armature into the app's
 * DragonBonesManager so it renders in the editor viewport, through the SAME
 * shared loader the builder runtime uses.
 *
 * The manager is acquired here rather than read: the plugin fetches its wasm on
 * first ask, so an editor session that never opens a scene with an armature in it
 * never loads the module — and one that does, waits for it exactly once.
 */
export async function loadEditorDragonBones(
  app: App,
  sceneData: SceneData,
  entityMap: Map<number, number>,
  toUrl: (ref: string) => string,
  resolvePath: (ref: string) => string = (ref) => ref,
): Promise<void> {
  const module = app.wasmModule;
  if (!module) return;

  try {
    const manager = await app.getPlugin(DragonBonesPlugin)?.acquire();
    if (!manager) return;
    await loadDragonBonesSceneEntities({
      module,
      source: editorSkeletalSource(toUrl, resolvePath, 'dragonbones'),
      manager,
      sceneData,
      entityMap,
    });
  } catch (err) {
    console.warn('[engine] DragonBones scene load failed', err);
  }
}

/** The viewport's manager, or null when nothing has asked for one yet. */
export function editorDragonBonesManager(app: App | null): DragonBonesManager | null {
  return app?.getPlugin(DragonBonesPlugin)?.manager ?? null;
}
