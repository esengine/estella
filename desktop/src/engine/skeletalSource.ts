// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skeletalSource.ts
 * @brief The asset source the editor's skeletal loaders fetch over.
 *
 * Skeleton and atlas come over fetch as text/bytes; the atlas image is decoded to
 * RGBA via the shared `decodeImagePixels` (the same path the play realm uses —
 * robust across the editor's http/app:// origins). `toUrl` maps an asset ref to a
 * fetchable URL, applied uniformly on fetch. `resolvePath` maps a `@uuid:` ref to
 * its project path, which is how each loader derives its atlas's image paths (a
 * raw uuid ref has no directory) — the job the runtime Catalog does in play.
 *
 * One factory for both runtimes: what differs between Spine and DragonBones is
 * how the atlas names its images, not how the editor reaches a file.
 */
import { decodeImagePixels } from 'esengine';
import type { RuntimeAssetSource } from 'esengine/spine';

export function editorSkeletalSource(
  toUrl: (ref: string) => string,
  resolvePath: (ref: string) => string,
  /** Names the runtime in fetch errors, so a failure says which loader wanted it. */
  label: string,
): RuntimeAssetSource {
  const fetchOk = async (ref: string, kind: string): Promise<Response> => {
    const r = await fetch(toUrl(ref));
    if (!r.ok) throw new Error(`${label} ${kind} ${r.status}: ${ref}`);
    return r;
  };
  return {
    resolveRef: (ref) => resolvePath(ref),
    backend: {
      resolveUrl: (ref) => toUrl(ref),
      fetchText: async (ref) => (await fetchOk(ref, 'asset')).text(),
      fetchBinary: async (ref) => (await fetchOk(ref, 'asset')).arrayBuffer(),
    },
    decodePixels: async (ref) => decodeImagePixels(await (await fetchOk(ref, 'texture')).blob()),
  };
}
