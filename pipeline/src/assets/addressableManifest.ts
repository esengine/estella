// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Shared cook → AddressableManifest (v2.0) builder.
 *
 *        Reads the flat `assets.manifest.json` a cook emits and produces the
 *        AddressableManifest (groups + bundle modes + content-addressed paths +
 *        a build `revision`) the runtime's `Assets.setManifest` / `loadGroup` /
 *        hot-update consume. ONE builder for EVERY target — web, desktop, and
 *        mini-game all get the same addressable model, so `loadGroup` and hot-
 *        update are platform-uniform (historically only the mini-game export
 *        emitted a v2.0 manifest; web/desktop shipped only the flat v1.0 one).
 *
 *        Pure Node (fs). `deriveManifestRevision` is imported from the SDK source
 *        — the SAME hash the runtime reads back — so build and runtime agree by
 *        construction (mirrors how the cook imports `contentHashHex`).
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { deriveManifestRevision, type AddressableManifest } from '../../../sdk/src/asset/AddressableManifest';
import { addressableKeys, addressableRecord } from './addressableRecord';
import type { FlatCookEntry } from './cookAssets';

export { addrType, LOADER_TYPE_OF_META_TYPE, UNLOADED_META_TYPES, UNLOADED_TYPE } from './addressableRecord';

/** A group's bundleMode from its assets' cooked `groupMode`, with the legacy
 *  fallback (an entry without groupMode): `main` → local, else lazy subpackage. */
export function bundleModeFor(groupName: string, groupMode: string | undefined): string {
  if (groupMode === 'local' || groupMode === 'lazy' || groupMode === 'remote') return groupMode;
  return groupName === 'main' ? 'local' : 'lazy';
}

/**
 * Build the AddressableManifest (as a pretty JSON string) from a cook output
 * dir's flat `assets.manifest.json`. Each asset carries its `contentHash` + `size`
 * so the runtime dedupes by content and treats `<hash>.<ext>` as a permanently-
 * cacheable url; a top-level `revision` (hash-of-hashes) is the fast hot-update
 * gate. `size` falls back to stat() only for a legacy cook that omitted it.
 */
export async function buildAddressableManifest(absOut: string): Promise<string> {
  const flat = JSON.parse(await readFile(path.join(absOut, 'assets.manifest.json'), 'utf8')) as { entries: FlatCookEntry[] };
  const groups: AddressableManifest['groups'] = {};
  const keys = addressableKeys(flat.entries);
  for (const e of flat.entries) {
    let size = e.size ?? 0;
    if (e.size == null) {
      try {
        size = (await stat(path.join(absOut, e.path))).size;
      } catch { /* missing → 0 */ }
    }
    const groupName = e.group ?? 'main';
    const group = (groups[groupName] ??= {
      bundleMode: bundleModeFor(groupName, e.groupMode), labels: [], assets: {},
    });
    const entry = addressableRecord(e, size, keys);
    if (e.contentHash) entry.contentHash = e.contentHash;
    // Which GPU formats the texture was encoded for. The runtime reads this off
    // the addressable manifest — the flat one it came from is a build-time
    // intermediate that no longer ships.
    if (e.compressedFormats?.length) entry.compressedFormats = e.compressedFormats;
    if (e.streamTail) entry.streamTail = e.streamTail;
    if (e.pack) entry.pack = e.pack;
    if (e.atlas) {
      entry.metadata = {
        atlasPage: e.atlas.page, atlasFrame: e.atlas.frame,
        atlasPageWidth: e.atlas.pageWidth, atlasPageHeight: e.atlas.pageHeight,
      };
    }
    group.assets[e.uuid.toLowerCase()] = entry;
  }
  // Always emit a main group so the runtime's main package exists even if every
  // asset landed in a subpackage / remote group.
  groups.main ??= { bundleMode: 'local', labels: [], assets: {} };
  const manifest: AddressableManifest = { version: '2.0', groups };
  manifest.revision = deriveManifestRevision(manifest);
  return JSON.stringify(manifest, null, 2) + '\n';
}
