import { loadSceneData, Assets } from 'esengine';
import type { App } from 'esengine';

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
   * and spawn it into the world. Returns the entity count. Refs without a
   * manifest entry (or a failed load) blank to 0 (solid-color sprite).
   */
  async loadInto(app: App, sceneUrl: string, manifestUrl?: string): Promise<number> {
    const res = await fetch(sceneUrl);
    if (!res.ok) throw new Error(`scene fetch failed: ${res.status} ${sceneUrl}`);
    const raw = await res.json();

    const uuidToHandle = await loadTextures(app, raw, manifestUrl);

    const sceneData = mapStrings(raw, (s) =>
      s.startsWith(UUID_PREFIX) ? (uuidToHandle.get(s.slice(UUID_PREFIX.length)) ?? 0) : s,
    ) as SceneDataArg;

    return loadSceneData(app.world, sceneData).size;
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
