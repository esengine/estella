import { loadSceneData, Assets } from 'esengine';
import type { App, SceneData } from 'esengine';
import { SceneModel } from './SceneModel';
import { Reconciler } from './Reconciler';
import { EditorHistory } from './EditorHistory';

type SceneDataArg = Parameters<typeof loadSceneData>[1];

// Minimal structural view of the engine Assets resource we use.
interface AssetsLike {
  loadTexture(ref: string): Promise<{ handle: number }>;
}

const UUID_PREFIX = '@uuid:';

// Walk every string in the SceneData; `fn` may return a replacement value.
function mapStrings(value: unknown, fn: (s: string) => unknown): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapStrings(v, fn);
    }
    return out;
  }
  return value;
}

function collectUuids(sceneData: unknown): Set<string> {
  const uuids = new Set<string>();
  mapStrings(sceneData, (s) => {
    if (s.startsWith(UUID_PREFIX)) uuids.add(s.slice(UUID_PREFIX.length));
    return s;
  });
  return uuids;
}

export const SceneLoader = {
  /**
   * Fetch an `.esscene` (SceneData JSON), resolve its `@uuid:` texture refs to
   * live texture handles via the engine Assets system + a uuid→url manifest,
   * spawn it into the world, and adopt the RAW scene as the editor model (the
   * source of truth). Returns the entity count. Refs without a manifest entry
   * (or a failed load) blank to 0 (solid-color sprite).
   *
   * Model-authoritative (REARCH_EDITOR_MODEL.md): the World is built directly
   * here (the bulk projection), and the raw scene — with `@uuid:` refs + any
   * components/fields the World drops — becomes the model. SceneModel.adopt
   * emits `reset`; the Reconciler ignores it (the World is already built), while
   * SceneStore bumps and panels re-read from the model.
   */
  async loadInto(app: App, sceneUrl: string, manifestUrl?: string): Promise<number> {
    const res = await fetch(sceneUrl);
    if (!res.ok) throw new Error(`scene fetch failed: ${res.status} ${sceneUrl}`);
    const raw = (await res.json()) as SceneData;

    const uuidToHandle = await loadTextures(app, raw, manifestUrl);

    const sceneData = mapStrings(raw, (s) =>
      s.startsWith(UUID_PREFIX) ? (uuidToHandle.get(s.slice(UUID_PREFIX.length)) ?? 0) : s,
    ) as SceneDataArg;

    const map = loadSceneData(app.world, sceneData);
    EditorHistory.clear();
    Reconciler.setAssetResolver((uuid) => uuidToHandle.get(uuid) ?? 0);
    SceneModel.adopt(raw, map as Map<number, number>);
    return map.size;
  },
};

async function loadTextures(
  app: App,
  sceneData: unknown,
  manifestUrl?: string,
): Promise<Map<string, number>> {
  const handles = new Map<string, number>();
  if (!manifestUrl) return handles;

  let manifest: Record<string, string>;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) return handles;
    manifest = await res.json();
  } catch {
    return handles;
  }

  const assets = app.getResource(Assets) as unknown as AssetsLike | undefined;
  if (!assets) return handles;

  for (const uuid of collectUuids(sceneData)) {
    const url = manifest[uuid];
    if (!url) continue;
    try {
      const { handle } = await assets.loadTexture(url);
      handles.set(uuid, handle);
    } catch (err) {
      console.warn('[engine] texture load failed', url, err);
    }
  }
  return handles;
}
