// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { SpinePlugin, loadSpineSceneEntities } from 'esengine/spine';
import type { RuntimeAssetSource } from 'esengine/spine';
import { decodeImagePixels, type App, type SceneData } from 'esengine';

/**
 * Fetch-backed asset source for spine in the editor: skeleton/atlas come over
 * fetch as text/bytes; the atlas PNG is decoded to RGBA via the shared
 * `decodeImagePixels` (the same path the play realm uses — robust across the
 * editor's http/app:// origins). `toUrl` maps an asset ref to a fetchable URL,
 * applied uniformly on fetch (so `resolveRef` stays identity).
 */
function editorSpineSource(toUrl: (ref: string) => string): RuntimeAssetSource {
  const fetchOk = async (ref: string, kind: string): Promise<Response> => {
    const r = await fetch(toUrl(ref));
    if (!r.ok) throw new Error(`spine ${kind} ${r.status}: ${ref}`);
    return r;
  };
  return {
    backend: {
      resolveUrl: (ref) => toUrl(ref),
      fetchText: async (ref) => (await fetchOk(ref, 'asset')).text(),
      fetchBinary: async (ref) => (await fetchOk(ref, 'asset')).arrayBuffer(),
    },
    decodePixels: async (ref) => decodeImagePixels(await (await fetchOk(ref, 'texture')).blob()),
  };
}

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
): Promise<void> {
  const spineManager = app.getPlugin(SpinePlugin)?.spineManager;
  const module = app.wasmModule;
  const registry = app.world.getCppRegistry();
  if (!spineManager || !module || !registry) return;

  try {
    await loadSpineSceneEntities({
      module,
      source: editorSpineSource(toUrl),
      spineManager,
      sceneData,
      entityMap: entityMap as Map<number, number>,
      registry,
    });
  } catch (err) {
    console.warn('[engine] spine scene load failed', err);
  }
}
