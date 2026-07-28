// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { SpinePlugin, loadSpineSceneEntities } from 'esengine/spine';
import type { App, SceneData } from 'esengine';
import { editorSkeletalSource } from './skeletalSource';

/**
 * Bind every SpineAnimation entity's skeleton/atlas/textures into the app's
 * SpineManager so spine renders in the editor viewport. The World already holds
 * the SpineAnimation components (loadSceneData ran); this loads the runtime
 * assets + spawns the per-entity spine instances through the SAME shared loader
 * the builder runtime uses. No-op when the app has no
 * spine provider/manager or the scene has no spine entities.
 */
export async function loadEditorSpine(
  app: App,
  sceneData: SceneData,
  entityMap: Map<number, number>,
  toUrl: (ref: string) => string,
  resolvePath: (ref: string) => string = (ref) => ref,
): Promise<void> {
  const spineManager = app.getPlugin(SpinePlugin)?.spineManager;
  const module = app.wasmModule;
  const registry = app.world.getCppRegistry();
  if (!spineManager || !module || !registry) return;

  try {
    await loadSpineSceneEntities({
      module,
      source: editorSkeletalSource(toUrl, resolvePath, 'spine'),
      spineManager,
      sceneData,
      entityMap: entityMap as Map<number, number>,
      registry,
    });
  } catch (err) {
    console.warn('[engine] spine scene load failed', err);
  }
}
