// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AddressableAssetType } from '../assetTypes';
import { indexTextureImportSettings, type ParsedTextureImportSettings } from './textureImportSettings';
import { contentHashOf } from './contentHash';

export type { AddressableAssetType };

export interface AddressableManifestAsset {
    path: string;
    address?: string;
    type: AddressableAssetType;
    size: number;
    labels: string[];
    /**
     * Content hash of the built bytes (XXH64, see contentHash.ts), the asset's
     * *physical* identity.
     * Populated by the import pipeline. Lets the runtime dedupe by content and
     * treat `<contentHash>.<ext>` as an immutable, permanently-cacheable URL
     * (changing a file yields a new hash → a new URL, never a stale cache).
     */
    contentHash?: string;
    /** GPU compressed formats this asset was encoded for (e.g. ['astc-4x4','etc2-rgba8']). */
    compressedFormats?: string[];
    /**
     * How the texture is sampled and sliced — the runtime half of the `.meta`
     * importer block, parsed at cook time rather than shipped raw: a packaged
     * realm needs filter/wrap/sRGB and the 9-slice border, never the cook's own
     * settings (maxSize, compression format). Absent when the asset is not a
     * texture or its importer says nothing the renderer acts on.
     */
    textureImport?: ParsedTextureImportSettings;
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: { x: number; y: number; width: number; height: number };
        /** Page pixel size — with atlasFrame, what the runtime derives uv from. */
        atlasPageWidth?: number;
        atlasPageHeight?: number;
    };
}

export interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}

export interface AddressableManifest {
    version: '2.0';
    /**
     * Build content revision — a stable hash over every asset's `contentHash`
     * (see {@link deriveManifestRevision}). Two builds share a revision iff they
     * ship byte-identical content under the same addressable keys, so a
     * changed / added / removed asset flips it. It is the fast gate for "is there
     * an update?"; the per-asset `contentHash` diff stays authoritative on WHAT
     * changed. Optional — absent on legacy manifests, where the diff falls back
     * to comparing contentHashes (or build paths) directly.
     */
    revision?: string;
    groups: Record<string, AddressableManifestGroup>;
}

/**
 * Stable content revision of a manifest: XXH64 over every asset's sorted
 * `<group>\t<key>\t<contentHash>` line. Deterministic and order-independent, so
 * two cooks of identical content produce the same string and any content / set
 * change flips it. A BUILD-TIME helper (rides {@link contentHashOf}'s
 * `TextEncoder`); the runtime reads the emitted `revision` field and never
 * recomputes it.
 */
export function deriveManifestRevision(manifest: AddressableManifest): string {
    const lines: string[] = [];
    for (const [groupName, group] of Object.entries(manifest.groups)) {
        for (const [key, asset] of Object.entries(group.assets)) {
            lines.push(`${groupName}\t${key}\t${asset.contentHash ?? ''}`);
        }
    }
    lines.sort();
    return contentHashOf(lines.join('\n'));
}

/**
 * Delivery mode for an addressable group — the single typed source of truth for
 * what was historically a bare `bundleMode: string` scattered across the cook /
 * export / runtime sides.
 * - `local`  — ships in the main package, loaded eagerly (current default; the
 *              value `exportWeChat` emits today).
 * - `lazy`   — ships in a subpackage (e.g. a WeChat 分包), loaded on demand.
 * - `remote` — fetched from a remote / CDN URL on demand.
 */
export type BundleMode = 'local' | 'lazy' | 'remote';

export const BUNDLE_MODES: readonly BundleMode[] = ['local', 'lazy', 'remote'];

/**
 * Normalize a wire `bundleMode` string to a known {@link BundleMode}. Unknown /
 * missing values map to `local` — the safe default: treated as part of the main
 * package so the asset is always present.
 */
export function normalizeBundleMode(mode: string | undefined | null): BundleMode {
    return mode != null && (BUNDLE_MODES as readonly string[]).includes(mode)
        ? (mode as BundleMode)
        : 'local';
}

/**
 * Queryable view over an {@link AddressableManifest}. The manifest JSON is the
 * wire format; this is the **runtime single source of truth** for group / label
 * / bundle-mode questions, so loaders and exporters never re-walk `groups` by
 * hand and never re-interpret the bare `bundleMode` string.
 */
export class ManifestModel {
    private constructor(private readonly manifest: AddressableManifest) {}

    static fromJson(manifest: AddressableManifest): ManifestModel {
        return new ManifestModel(manifest);
    }

    static empty(): ManifestModel {
        return new ManifestModel({ version: '2.0', groups: {} });
    }

    /** All group names, in manifest order. */
    groupNames(): string[] {
        return Object.keys(this.manifest.groups);
    }

    group(name: string): AddressableManifestGroup | null {
        return this.manifest.groups[name] ?? null;
    }

    /** Typed delivery mode of a group (unknown group → `local`). */
    bundleMode(name: string): BundleMode {
        return normalizeBundleMode(this.manifest.groups[name]?.bundleMode);
    }

    /** Group names whose delivery mode equals `mode`. */
    groupsByMode(mode: BundleMode): string[] {
        return this.groupNames().filter((n) => this.bundleMode(n) === mode);
    }

    /** Assets in a group (empty for an unknown group). */
    assetsInGroup(name: string): AddressableManifestAsset[] {
        const g = this.manifest.groups[name];
        return g ? Object.values(g.assets) : [];
    }

    /** Asset paths in a group. */
    assetPathsInGroup(name: string): string[] {
        return this.assetsInGroup(name).map((a) => a.path);
    }

    /** Every asset across all groups. */
    allAssets(): AddressableManifestAsset[] {
        const out: AddressableManifestAsset[] = [];
        for (const g of Object.values(this.manifest.groups)) {
            out.push(...Object.values(g.assets));
        }
        return out;
    }

    /** Every asset carrying its owning group name and record key — the iteration
     *  the hot-update diff walks (allAssets() drops both). */
    entries(): Array<{ group: string; key: string; asset: AddressableManifestAsset }> {
        const out: Array<{ group: string; key: string; asset: AddressableManifestAsset }> = [];
        for (const [group, g] of Object.entries(this.manifest.groups)) {
            for (const [key, asset] of Object.entries(g.assets)) {
                out.push({ group, key, asset });
            }
        }
        return out;
    }

    /**
     * Per-ref texture import settings for every asset that carries them — what a
     * packaged realm answers `RuntimeAssetSource.textureImportSettings` with, so
     * a shipped game samples and 9-slices exactly as the editor did.
     */
    textureImportLookup(): (ref: string) => ParsedTextureImportSettings | undefined {
        return indexTextureImportSettings(
            this.entries().map(({ key, asset }) => ({
                uuid: key,
                path: asset.path,
                address: asset.address,
                settings: asset.textureImport,
            })),
        );
    }

    /** The manifest's build content revision (see {@link deriveManifestRevision}),
     *  or null on a legacy manifest that predates the field. */
    revision(): string | null {
        return this.manifest.revision ?? null;
    }

    /** Assets carrying `label` across all groups, deduped by path. */
    assetsByLabel(label: string): AddressableManifestAsset[] {
        const seen = new Set<string>();
        const out: AddressableManifestAsset[] = [];
        for (const a of this.allAssets()) {
            if (a.labels.includes(label) && !seen.has(a.path)) {
                seen.add(a.path);
                out.push(a);
            }
        }
        return out;
    }

    /** Find an asset by its path or its address (null if absent). */
    findAsset(pathOrAddress: string): AddressableManifestAsset | null {
        for (const a of this.allAssets()) {
            if (a.path === pathOrAddress || a.address === pathOrAddress) return a;
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Resolution (uuid/address key → asset → build path)
    // -------------------------------------------------------------------------

    private keyIndex_: Map<string, AddressableManifestAsset> | null = null;
    private pathIndex_: Map<string, AddressableManifestAsset> | null = null;
    private remoteIndex_: Map<string, string> | null = null;

    private indexes(): { byKey: Map<string, AddressableManifestAsset>; byPath: Map<string, AddressableManifestAsset> } {
        if (!this.keyIndex_ || !this.pathIndex_) {
            const byKey = new Map<string, AddressableManifestAsset>();
            const byPath = new Map<string, AddressableManifestAsset>();
            for (const g of Object.values(this.manifest.groups)) {
                for (const [key, asset] of Object.entries(g.assets)) {
                    // First write wins, mirroring the historical hand-built index
                    // (a uuid/path appearing in two groups keeps its first entry).
                    if (!byKey.has(key)) byKey.set(key, asset);
                    if (!byPath.has(asset.path)) byPath.set(asset.path, asset);
                    // The address (the asset's LOGICAL source path, kept when
                    // content-addressed staging renames the physical file) is a
                    // resolvable key too — path-style refs name it. Both the
                    // bare and the "/"-rooted spellings the cook may emit.
                    if (asset.address) {
                        if (!byKey.has(asset.address)) byKey.set(asset.address, asset);
                        const rooted = `/${asset.address}`;
                        if (!byKey.has(rooted)) byKey.set(rooted, asset);
                    }
                }
            }
            this.keyIndex_ = byKey;
            this.pathIndex_ = byPath;
        }
        return { byKey: this.keyIndex_, byPath: this.pathIndex_ };
    }

    /** Asset by its group-record key (the uuid in editor/WeChat manifests). */
    assetByKey(key: string): AddressableManifestAsset | null {
        return this.indexes().byKey.get(key) ?? null;
    }

    /** Asset by its build path. */
    assetByPath(path: string): AddressableManifestAsset | null {
        return this.indexes().byPath.get(path) ?? null;
    }

    /**
     * Build path of a `remote`-group asset by ANY of its keys — record key (uuid),
     * address (logical source path, bare and `/`-rooted), or build path — or null
     * when the ref is not a remote-delivered asset. Lets a resolver route scene
     * `@uuid` refs to remote assets through the CDN (so they hot-update with the
     * manifest), while local / lazy assets keep their normal resolution.
     */
    remoteAssetPath(ref: string): string | null {
        if (!this.remoteIndex_) {
            const idx = new Map<string, string>();
            for (const group of Object.values(this.manifest.groups)) {
                if (normalizeBundleMode(group.bundleMode) !== 'remote') continue;
                for (const [key, asset] of Object.entries(group.assets)) {
                    idx.set(key, asset.path);
                    idx.set(asset.path, asset.path);
                    if (asset.address) {
                        idx.set(asset.address, asset.path);
                        idx.set(`/${asset.address}`, asset.path);
                    }
                }
            }
            this.remoteIndex_ = idx;
        }
        return this.remoteIndex_.get(ref) ?? null;
    }

    /**
     * Resolve a serialized asset ref (a uuid, an address, or a path) to its
     * build path. `normalize` maps a ref to its expected build path (e.g.
     * `toBuildPath`); it is applied before the lookups and is the fallback when
     * nothing matches. This is the single manifest→path resolution used by the
     * shipped runtimes — callers never re-walk `groups` to build their own.
     */
    resolvePath(ref: string, normalize: (ref: string) => string = (s) => s): string {
        const { byKey, byPath } = this.indexes();
        const resolved = normalize(ref);
        const entry =
            byKey.get(ref) ?? byKey.get(resolved) ?? byPath.get(resolved) ?? byPath.get(ref);
        return entry ? entry.path : resolved;
    }
}
