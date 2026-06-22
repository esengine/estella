import { SpinePlugin, loadSpineSceneEntities } from 'esengine/spine';
import type { RuntimeAssetProvider } from 'esengine/spine';
import type { App, SceneData } from 'esengine';

/**
 * Fetch-backed asset provider for spine in the editor: skeleton/atlas come over
 * fetch as text/bytes; the atlas PNG is decoded to RGBA via createImageBitmap →
 * canvas → getImageData (the same path the play realm uses — robust across the
 * editor's http/app:// origins). `toUrl` maps an asset ref to a fetchable URL.
 */
class EditorSpineProvider implements RuntimeAssetProvider {
  constructor(private readonly toUrl: (ref: string) => string) {}

  resolvePath(ref: string): string {
    return this.toUrl(ref);
  }

  async readText(ref: string): Promise<string> {
    const r = await fetch(this.toUrl(ref));
    if (!r.ok) throw new Error(`spine asset ${r.status}: ${ref}`);
    return r.text();
  }

  async readBinary(ref: string): Promise<Uint8Array> {
    const r = await fetch(this.toUrl(ref));
    if (!r.ok) throw new Error(`spine asset ${r.status}: ${ref}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const r = await fetch(this.toUrl(ref));
    if (!r.ok) throw new Error(`spine texture ${r.status}: ${ref}`);
    const bitmap = await createImageBitmap(await r.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable for spine texture decode');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(data.data.buffer) };
  }
}

/**
 * Bind every SpineAnimation entity's skeleton/atlas/textures into the app's
 * SpineManager so spine renders in the editor viewport. The World already holds
 * the SpineAnimation components (loadSceneData ran); this loads the runtime
 * assets + spawns the per-entity spine instances through the SAME shared loader
 * the builder runtime uses (REARCH_SPINE single-impl). No-op when the app has no
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
      provider: new EditorSpineProvider(toUrl),
      spineManager,
      sceneData,
      entityMap: entityMap as Map<number, number>,
      registry,
    });
  } catch (err) {
    console.warn('[engine] spine scene load failed', err);
  }
}
