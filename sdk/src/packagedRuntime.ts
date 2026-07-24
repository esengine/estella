// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    packagedRuntime.ts
 * @brief   The asset assembly every PACKAGED realm shares — a WeChat mini-game,
 *          a native app: realms that ship cooked content beside the runtime and
 *          read it off the device rather than over HTTP.
 * @details The addressable manifest is the single source: it resolves a ref to a
 *          staged path, and its atlas metadata builds the catalog the loaders
 *          consult for their inner text refs (a material's shader). Everything
 *          here is DOM-free and transport-free — the platform layer decides how
 *          the bytes arrive, so the same code serves both realms.
 */

import { toBuildPath } from './assetTypes';
import { platformReadTextFile } from './platform';
import { ManifestModel, type AddressableManifest } from './asset/AddressableManifest';
import { Catalog, atlasCatalogFields, type CatalogEntry } from './asset/Catalog';

/** The packaged realm's resolved asset index — manifest, catalog, resolution. */
export interface PackagedAssetIndex {
    manifest: AddressableManifest;
    model: ManifestModel;
    /** Logical → staged mapping for the loaders' inner refs; absent when the
     *  build stages assets under their logical paths (nothing to remap). */
    catalog?: Catalog;
    /** Resolve any ref spelling (`@uuid:`, logical, "/"-rooted) to a staged path. */
    resolvePath(ref: string): string;
    /** Every staged asset path — content-driven discovery (locale tables). */
    assetPaths(): string[];
}

/**
 * Build the catalog from an addressable manifest. Content-addressed packs rename
 * physical files, so assets carrying an `address` (their logical source path) get
 * a catalog buildPath. Atlas-packed frames additionally register frame/uv, keyed
 * by every ref spelling a scene can use.
 */
export function catalogFromManifest(manifest: AddressableManifest): Catalog | undefined {
    const entries: Record<string, CatalogEntry> = {};
    for (const group of Object.values(manifest.groups)) {
        for (const [uuid, asset] of Object.entries(group.assets)) {
            const md = asset.metadata;
            const atlasFields = md?.atlasFrame && md.atlasPageWidth && md.atlasPageHeight
                ? atlasCatalogFields(
                    { page: md.atlasPage, frame: md.atlasFrame, pageWidth: md.atlasPageWidth, pageHeight: md.atlasPageHeight },
                    asset.path,
                )
                : null;
            if (atlasFields) {
                entries[`@uuid:${uuid}`] = { type: asset.type, buildPath: asset.path, ...atlasFields };
            }
            if (!asset.address || asset.address === asset.path) continue;
            entries[asset.address] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}) };
            entries[`/${asset.address}`] = { type: asset.type, buildPath: asset.path, ...(atlasFields ?? {}) };
        }
    }
    return Object.keys(entries).length > 0 ? Catalog.fromJson({ version: 1, entries }) : undefined;
}

/** Read + index the packaged addressable manifest through the platform's reader. */
export async function loadPackagedAssetIndex(
    manifestPath = 'asset-manifest.json',
): Promise<PackagedAssetIndex> {
    const manifest = JSON.parse(await platformReadTextFile(manifestPath)) as AddressableManifest;
    return indexPackagedManifest(manifest);
}

/** {@link loadPackagedAssetIndex} over an already-parsed manifest. */
export function indexPackagedManifest(manifest: AddressableManifest): PackagedAssetIndex {
    const model = ManifestModel.fromJson(manifest);
    return {
        manifest,
        model,
        catalog: catalogFromManifest(manifest),
        resolvePath: (ref) => model.resolvePath(ref, toBuildPath),
        assetPaths: () => model.allAssets().map((a) => a.path),
    };
}
