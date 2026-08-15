// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Thumbnails for assets an icon cannot describe — a mesh, a material.
 *        Both are drawn by the engine through the path the viewport uses, so
 *        the two differ by one call and share everything after it. Rendered on
 *        demand, once per path, and dropped when the file changes.
 */
import { Material, renderMeshPreview } from 'esengine';
import { EngineHost } from '@/engine/EngineHost';
import { AssetBinding } from '@/engine/AssetBinding';
import { AssetRegistry } from './AssetRegistry';
import { fsRefresh } from './fsRefresh';

/** Square edge, in device pixels. A grid tile is ~96 CSS px; this survives a 2x screen. */
const SIZE = 192;

/** Types this can draw. Anything else keeps its icon, which is the honest answer. */
const DRAWABLE = new Set(['mesh', 'material']);

export function canRenderThumbnail(type: string): boolean {
  return DRAWABLE.has(type);
}

type Entry = { url: string | null; rev: number };

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

/** The disk's own version is the cache's: a re-imported mesh must not keep the
 *  picture of the file it replaced, and there is no second thing to bump. */
const revisionNow = (): number => fsRefresh.get();

export function subscribeThumbnails(fn: () => void): () => void {
  listeners.add(fn);
  const offDisk = fsRefresh.subscribe(fn);
  return () => {
    listeners.delete(fn);
    offDisk();
  };
}

/** A canvas the ImageData is put through — toDataURL is the only way to an <img>. */
function toDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function render(path: string, type: string): Promise<ImageData | null> {
  if (type === 'mesh') {
    const handle = await AssetBinding.meshHandle(path);
    return handle ? renderMeshPreview(EngineHost.world?.getWasmModule(), handle, SIZE, SIZE) : null;
  }
  const handle = AssetBinding.materialHandle(path);
  return handle ? Material.renderPreview(handle, SIZE, SIZE) : null;
}

/**
 * The thumbnail for @p path, or null while one is being drawn (and forever, for
 * an asset that cannot be). Callers re-read after {@link subscribeThumbnails}
 * fires; the render is started once per path and shared by every tile asking.
 */
export function thumbnailFor(path: string): string | null {
  const hit = cache.get(path);
  if (hit && hit.rev === revisionNow()) return hit.url;
  if (pending.has(path)) return null;

  const type = AssetRegistry.assetTypeAt(path);
  if (!canRenderThumbnail(type) || EngineHost.getSnapshot().status !== 'ready') return null;

  const at = revisionNow();
  const job = render(path, type)
    .then((image) => (image ? toDataUrl(image) : null))
    .catch(() => null)
    .then((url) => {
      pending.delete(path);
      // A render that finished after an invalidation describes a file that is
      // no longer there; drop it rather than caching a stale picture.
      if (at === revisionNow()) {
        cache.set(path, { url, rev: at });
        for (const fn of listeners) fn();
      }
      return url;
    });
  pending.set(path, job);
  return null;
}
