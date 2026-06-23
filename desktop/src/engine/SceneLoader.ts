// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { loadSceneData, Assets } from 'esengine';
import type { App, SceneData } from 'esengine';
import { SceneModel } from './SceneModel';
import { Reconciler } from './Reconciler';
import { EditorHistory } from './EditorHistory';
import { loadEditorSpine } from './spineLoad';

type SceneDataArg = Parameters<typeof loadSceneData>[1];

const UUID_PREFIX = '@uuid:';

export const SceneLoader = {
  /**
   * Fetch an `.esscene` (SceneData JSON) and load it through the engine's own
   * asset system — the ONE asset-resolution path (REARCH_ASSETS.md). A uuid→url
   * manifest feeds the ref resolver; `Assets.preloadSceneAssets` loads every
   * referenced type (not just textures), and a resolved copy builds the World.
   * The raw scene (with `@uuid:` refs + components/fields the World drops) is
   * adopted as the editor model (the source of truth). Returns the entity count.
   *
   * This is the dev-fallback / automation transport (a manifest of absolute
   * URLs); the editor's project transport (estella:// + .meta) lives in
   * ProjectStore. Both now go through the same engine `Assets` loader.
   *
   * Model-authoritative (REARCH_EDITOR_MODEL.md): SceneModel.adopt emits `reset`;
   * the Reconciler ignores it (the World is already built here) while SceneStore
   * bumps and panels re-read from the model.
   */
  async loadInto(app: App, sceneUrl: string, manifestUrl?: string): Promise<number> {
    const res = await fetch(sceneUrl);
    if (!res.ok) throw new Error(`scene fetch failed: ${res.status} ${sceneUrl}`);
    const raw = (await res.json()) as SceneData;

    const uuidToUrl = await fetchManifest(manifestUrl);
    const assets = app.getResource(Assets);
    let resolved: SceneData = raw;
    if (assets) {
      assets.baseUrl = ''; // manifest URLs are absolute / root-relative
      assets.setAssetRefResolver((ref) =>
        ref.startsWith(UUID_PREFIX) ? (uuidToUrl.get(ref.slice(UUID_PREFIX.length)) ?? null) : ref,
      );
      const result = await assets.preloadSceneAssets(raw);
      resolved = JSON.parse(JSON.stringify(raw)) as SceneData; // resolveSceneAssetPaths mutates
      assets.resolveSceneAssetPaths(resolved, result);
      // Incremental recreate (duplicate / undo) re-resolves textures from the
      // engine's live cache (just loaded above).
      Reconciler.setAssetResolver((uuid) => assets.getTexture(UUID_PREFIX + uuid)?.handle ?? 0);
    }

    const map = loadSceneData(app.world, resolved as SceneDataArg);
    // Spine renders through its side modules, loaded separately from Assets (skel
    // /atlas/textures + per-entity instances). Refs are the scene's own paths or
    // @uuid: (resolved via the manifest).
    await loadEditorSpine(app, raw, map as Map<number, number>, (ref) =>
      ref.startsWith(UUID_PREFIX) ? (uuidToUrl.get(ref.slice(UUID_PREFIX.length)) ?? ref) : ref,
    );
    EditorHistory.clear();
    SceneModel.adopt(raw, map as Map<number, number>);
    return map.size;
  },
};

/** Fetch a uuid→url asset manifest (the dev/automation transport). Empty if absent. */
async function fetchManifest(manifestUrl?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!manifestUrl) return out;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) return out;
    const json = (await res.json()) as Record<string, string>;
    for (const [uuid, url] of Object.entries(json)) out.set(uuid, url);
  } catch {
    // no manifest — refs blank to 0
  }
  return out;
}
