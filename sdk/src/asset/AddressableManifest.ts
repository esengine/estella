// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AddressableAssetType } from '../assetTypes';
import type { ParsedTextureImportSettings } from './textureImportSettings';
import type { SpineCullingRect, SpineManifestContract } from './spineImportSettings';
import { contentHashOf } from './contentHash';
import { resolveMeshGI, type MeshGIRefs } from '../gi/meshGIAssets';
import { assetRefId, localAssetPathWithoutSuffix, normalizeAssetPathSeparators, UUID_REF_PREFIX } from './AssetRegistry';
import { log } from '../util/logger';

interface ManifestRecord {
    group: string;
    key: string;
    asset: AddressableManifestAsset;
    remote: boolean;
}

const warnedNotPackaged = new Set<string>();
let probing = 0;

/**
 * Run `fn` asking about refs that may well not be packaged, without the warning
 * for each one that is not. A video asks whether the cook demuxed an audio track
 * beside it (`<video>.m4a`), and a target that plays the video whole, as the
 * mobile hosts do, has none: said as a missing asset, the question failed every
 * video example's boot on Android and iOS. Synchronous, so the window closes with it.
 */
export function probeRefs<T>(fn: () => T): T {
    probing++;
    try {
        return fn();
    } finally {
        probing--;
    }
}

/** Where the cook writes a streamed world, `WORLD_DIR` in residency/cutWorld (not imported: the asset layer sits below it). */
const COOKED_WORLD_DIR = 'world';

/**
 * A project file the package does not carry, said once and with the reason —
 * otherwise the first anyone hears of it is a 404 from the loader. Only refs
 * that look like files: `builtin:` meshes, URLs and blobs are not the cook's.
 */
function warnNotPackaged(ref: string): void {
    if (probing > 0 || warnedNotPackaged.has(ref) || ref.includes(':') || !/\.[a-z0-9]{2,8}$/i.test(ref)) return;
    // What the cook writes for a streamed world (its cells, manifest and far proxies) is not an asset and is never in the
    // manifest: a world of 144 cells said 1362 times that its own files were missing.
    if (ref.startsWith(`${COOKED_WORLD_DIR}/`)) return;
    warnedNotPackaged.add(ref);
    log.warn('asset', `"${ref}" is not in this package. A build ships what its scenes reference, what the `
        + 'scripts name as a whole path in a string literal, and the folders asset-groups.json marks '
        + 'alwaysInclude — name the file whole in code, or mark its folder alwaysInclude.');
}

export type { AddressableAssetType };

/** Where a texture's small copy is, and how big it and the file are. */
export interface StreamTailInfo {
    path: string;
    /** XXH64 of the preview bytes. Older builds may carry it only in the filename. */
    contentHash?: string;
    size: number;
    width: number;
    height: number;
    fullWidth: number;
    fullHeight: number;
}

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
    /** A small copy of a texture a mesh draws, which texture streaming fetches first (`path` is its build path). */
    streamTail?: StreamTailInfo;
    /**
     * How the texture is sampled and sliced — the runtime half of the `.meta`
     * importer block, parsed at cook time rather than shipped raw: a packaged
     * realm needs filter/wrap/sRGB and the 9-slice border, never the cook's own
     * settings (maxSize, compression format). Absent when the asset is not a
     * texture or its importer says nothing the renderer acts on.
     */
    textureImport?: ParsedTextureImportSettings;
    /**
     * A spine skeleton's culling promise: the rectangle, and the ATLAS it was
     * promised against as this manifest's own KEY, not a build locator.
     *
     * It ships rather than being re-derived, which would honour the promise
     * after a skeleton was re-pointed at another atlas.
     */
    spineImport?: SpineManifestContract;
    /** Active distance field and surface cards by record key. Legacy meshes can discover siblings when this is absent. */
    meshGI?: MeshGIRefs | false;
    /**
     * Present when the export packed this asset with others into one file, which
     * a network build fetches once instead of one request per asset: `path` then
     * names no file of its own, and its bytes are `size` at `offset` in `file`.
     */
    pack?: AssetPackRef;
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: { x: number; y: number; width: number; height: number };
        /** Page pixel size — with atlasFrame, what the runtime derives uv from. */
        atlasPageWidth?: number;
        atlasPageHeight?: number;
    };
}

/** Where a packed asset's bytes sit (see {@link AddressableManifestAsset.pack}). */
export interface AssetPackRef {
    /** The pack, as a path beside the manifest. */
    file: string;
    offset: number;
    size: number;
}

export interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}

export interface AddressableManifest {
    version: '2.0';
    /**
     * Build revision of the assets, their runtime settings and their delivery
     * groups. Older cooks may omit it or cover only the payload hashes.
     */
    revision?: string;
    groups: Record<string, AddressableManifestGroup>;
}

/** The cook and update planner compare the same wire fields, independent of JSON member order. */
export function assetManifestSignature(asset: AddressableManifestAsset, includeLabels = true): string {
    const record = includeLabels ? asset : { ...asset, labels: undefined };
    return JSON.stringify(record, (key, value: unknown) => {
        if (Array.isArray(value)) {
            return key === 'labels' || key === 'compressedFormats' ? [...value].sort() : value;
        }
        if (value === null || typeof value !== 'object') return value;
        const fields = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(fields).sort().map(name => [name, fields[name]]));
    });
}

export function groupManifestSignature(group: AddressableManifestGroup): string {
    return JSON.stringify([normalizeBundleMode(group.bundleMode), [...(group.labels ?? [])].sort()]);
}

/** XXH64 of the build's addressable records, including empty groups. */
export function deriveManifestRevision(manifest: AddressableManifest): string {
    const lines: string[] = [];
    for (const [groupName, group] of Object.entries(manifest.groups)) {
        lines.push(JSON.stringify([groupName, groupManifestSignature(group)]));
        for (const [key, asset] of Object.entries(group.assets)) {
            lines.push(JSON.stringify([groupName, key, assetManifestSignature(asset)]));
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

    private packs_: Map<string, AssetPackRef> | null = null;

    /** The pack holding the asset at build `path`, or null when it has a file of its own. */
    packOf(path: string): AssetPackRef | null {
        if (!this.packs_) {
            this.packs_ = new Map();
            for (const g of Object.values(this.manifest.groups)) {
                for (const a of Object.values(g.assets)) if (a.pack) this.packs_.set(a.path, a.pack);
            }
        }
        return this.packs_.get(path) ?? null;
    }

    /** The build paths each pack holds, by pack file. */
    packMembers(): Map<string, Set<string>> {
        const members = new Map<string, Set<string>>();
        for (const g of Object.values(this.manifest.groups)) {
            for (const a of Object.values(g.assets)) {
                if (!a.pack) continue;
                let set = members.get(a.pack.file);
                if (!set) members.set(a.pack.file, set = new Set());
                set.add(a.path);
            }
        }
        return members;
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
        return ref => this.recordForRef(ref)?.asset.textureImport;
    }

    /** @internal Resolve the pair from the same logical mesh record that produced a renderer's handle. */
    meshGIFor(ref: string): MeshGIRefs | null {
        const mesh = this.recordForRef(ref)?.asset;
        if (mesh?.type !== 'mesh') return null;
        return resolveMeshGI(mesh.address ?? mesh.path, mesh.meshGI, (name, type) => {
            const record = this.recordForRef(name);
            return record?.asset.type === type ? UUID_REF_PREFIX + record.key : undefined;
        });
    }

    /**
     * The culling contract this build ships for a spine PAIR, or undefined.
     *
     * Both refs, because there is no useful answer about a skeleton alone. The
     * atlas is compared as an IDENTITY — `@uuid:…`, a path and an address all
     * agree — so one the contract was not made against inherits nothing.
     */
    spineCullingLookup(): (skeleton: string, atlas: string) => SpineCullingRect | undefined {
        return (skeleton, atlas) => {
            const contract = this.recordForRef(skeleton)?.asset.spineImport;
            return contract && this.recordForRef(atlas)?.key === contract.atlas ? contract.cullingBounds : undefined;
        };
    }

    /** The manifest's build content revision (see {@link deriveManifestRevision}),
     *  or null on a legacy manifest that predates the field. */
    revision(): string | null {
        return this.manifest.revision ?? null;
    }

    /** Labels carried by this manifest's asset records. */
    labelNames(): string[] {
        return [...this.indexes().labels.keys()];
    }

    /** Logical records carrying the label, including records that share a staged file. */
    entriesByLabel(label: string): readonly ManifestRecord[] {
        return [...(this.indexes().labels.get(label)?.values() ?? [])];
    }

    /** Assets carrying the label across groups, deduped by staged path. */
    assetsByLabel(label: string): AddressableManifestAsset[] {
        const paths = new Map<string, AddressableManifestAsset>();
        for (const { asset } of this.entriesByLabel(label)) {
            if (!paths.has(asset.path)) paths.set(asset.path, asset);
        }
        return [...paths.values()];
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

    private index_?: {
        names: Map<string, ManifestRecord>;
        files: Map<string, ManifestRecord>;
        shared: Set<string>;
        labels: Map<string, Map<string, ManifestRecord>>;
    };

    private indexes() {
        if (this.index_) return this.index_;
        const names = new Map<string, ManifestRecord>(), files = new Map<string, ManifestRecord>();
        const shared = new Set<string>();
        const labels = new Map<string, Map<string, ManifestRecord>>();
        for (const [name, group] of Object.entries(this.manifest.groups)) {
            const remote = normalizeBundleMode(group.bundleMode) === 'remote';
            for (const [key, asset] of Object.entries(group.assets)) {
                const record = { group: name, key, asset, remote };
                const logical = assetRefId(key) ?? key;
                for (const label of asset.labels ?? []) {
                    let members = labels.get(label);
                    if (!members) labels.set(label, members = new Map());
                    if (!members.has(logical)) members.set(logical, record);
                }
                if (!names.has(logical)) names.set(logical, record);
                if (!names.has(key)) names.set(key, record);
                if (asset.address) {
                    for (const name of [asset.address, `/${asset.address}`]) if (!names.has(name)) names.set(name, record);
                }
                const first = files.get(asset.path);
                if (!first) files.set(asset.path, record);
                else if (first.key !== key) shared.add(asset.path);
            }
        }
        return this.index_ = { names, files, shared, labels };
    }

    /** @internal A staged file used by several records names the first one in manifest order. */
    recordForRef(ref: string): ManifestRecord | undefined {
        const { names, files } = this.indexes();
        const direct = names.get(ref) ?? files.get(ref);
        if (direct) return direct;
        const portable = normalizeAssetPathSeparators(ref);
        const bare = portable.startsWith('/') ? portable.slice(1) : portable;
        const name = bare.startsWith(UUID_REF_PREFIX) ? bare.slice(UUID_REF_PREFIX.length) : bare;
        const indexed = names.get(name) ?? names.get(assetRefId(bare) ?? bare) ?? files.get(bare);
        if (indexed) return indexed;
        const local = localAssetPathWithoutSuffix(portable);
        if (local === portable) return undefined;
        const file = local.startsWith('/') ? local.slice(1) : local;
        return names.get(file) ?? files.get(file);
    }

    /** @internal Scene and group results need record names when the staged filename alone is ambiguous. */
    sharesFile(path: string): boolean { return this.indexes().shared.has(path); }

    /** Asset by its group-record key (the uuid in editor/WeChat manifests). */
    assetByKey(key: string): AddressableManifestAsset | null {
        return this.indexes().names.get(key)?.asset ?? null;
    }

    /** Asset by its build path. */
    assetByPath(path: string): AddressableManifestAsset | null {
        return this.indexes().files.get(path)?.asset ?? null;
    }

    /**
     * Build path of a `remote`-group asset by ANY of its keys — record key (uuid),
     * address (logical source path, bare and `/`-rooted), or build path — or null
     * when the ref is not a remote-delivered asset. Lets a resolver route scene
     * `@uuid` refs to remote assets through the CDN (so they hot-update with the
     * manifest), while local / lazy assets keep their normal resolution.
     */
    remoteAssetPath(ref: string): string | null {
        const record = this.recordForRef(ref);
        return record?.remote ? record.asset.path : null;
    }

    /**
     * The stable name of the `remote`-group asset a ref names — its address,
     * else the key it is filed under. NOT interchangeable with
     * {@link remoteAssetPath}: a build path is content-addressed, so it names
     * one revision, while this is what every revision agrees on.
     */
    remoteAssetIdentity(ref: string): string | null {
        const record = this.recordForRef(ref);
        return record?.remote ? record.asset.address ?? record.key : null;
    }

    /**
     * Resolve a serialized asset ref (a uuid, an address, or a path) to its
     * build path, falling back to the ref itself. The single manifest→path
     * resolution the shipped runtimes use, and the last word on the name: a
     * build path is whatever the cook staged the file as.
     */
    resolvePath(ref: string): string {
        const entry = this.recordForRef(ref)?.asset;
        if (!entry) warnNotPackaged(ref);
        return entry ? entry.path : ref;
    }
}
