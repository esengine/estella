// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { loadSceneData, Assets } from 'esengine';
import type { App, SceneData } from 'esengine';
import { SceneModel } from './SceneModel';
import { AssetBinding } from './AssetBinding';
import { EditorHistory } from './EditorHistory';
import { PerfMonitor } from './PerfMonitor';
import { loadEditorSpine } from './spineLoad';
import { loadEditorDragonBones } from './dragonBonesLoad';

type SceneDataArg = Parameters<typeof loadSceneData>[1];

const UUID_PREFIX = '@uuid:';

export const SceneLoader = {
  /**
   * Fetch an `.esscene` (SceneData JSON) and load it through the engine's own
   * asset system — the ONE asset-resolution path. A uuid→url
   * manifest feeds the ref resolver; `Assets.preloadSceneAssets` loads every
   * referenced type (not just textures), and a resolved copy builds the World.
   * The raw scene (with `@uuid:` refs + components/fields the World drops) is
   * adopted as the editor model (the source of truth). Returns the entity count.
   *
   * This is the dev-fallback / automation transport (a manifest of absolute
   * URLs); the editor's project transport (estella:// + .meta) lives in
   * ProjectStore. Both now go through the same engine `Assets` loader.
   *
   * Model-authoritative: SceneModel.adopt emits `reset`;
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
      // The realm's own binding, the same one the project transport installs:
      // resolving a ref is not this door's business to define, and defining it
      // here is how this path came to resolve textures and nothing else.
      AssetBinding.adopt(result);
      AssetBinding.install();
    }

    const map = PerfMonitor.measure('scene.load', () => loadSceneData(app.world, resolved as SceneDataArg));
    // Both skeletal runtimes render through side modules, loaded separately from
    // Assets. Refs are the scene's own paths or @uuid:. BOTH, because the project
    // transport binds both and one door short is a difference nothing declares.
    const toUrl = (ref: string) =>
      ref.startsWith(UUID_PREFIX) ? (uuidToUrl.get(ref.slice(UUID_PREFIX.length)) ?? ref) : ref;
    await loadEditorSpine(app, raw, map as Map<number, number>, toUrl);
    await loadEditorDragonBones(app, raw, map as Map<number, number>, toUrl);
    EditorHistory.clearScene();
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
