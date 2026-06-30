// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AddressableAssetType } from '../assetTypes';

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
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: { x: number; y: number; width: number; height: number };
    };
}

export interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}

export interface AddressableManifest {
    version: '2.0';
    groups: Record<string, AddressableManifestGroup>;
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
