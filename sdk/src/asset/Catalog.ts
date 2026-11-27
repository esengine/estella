// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ManifestModel, StreamTailInfo } from './AddressableManifest';
import { assetRefId, localAssetPathWithoutSuffix, normalizeAssetPathSeparators, UUID_REF_PREFIX } from './AssetRegistry';
import { findDocumentAsset, resolveDocumentRef } from './documentRef';
import { uvRectFromPixels, type UvRect } from '../render/uvRect';

export interface AtlasFrameInfo {
    atlas: string;
    frame: { x: number; y: number; w: number; h: number };
    uvOffset: [number, number];
    uvScale: [number, number];
    trim?: { sourceW: number; sourceH: number; offsetX: number; offsetY: number };
}

/** Place an authored sprite, sheet cell or crop inside its packed image. */
export function atlasFrameUv(frame: AtlasFrameInfo, inner?: Partial<UvRect>): UvRect {
    const [x, y] = frame.uvOffset;
    const [w, h] = frame.uvScale;
    return {
        uvOffset: { x: x + (inner?.uvOffset?.x ?? 0) * w, y: y + (inner?.uvOffset?.y ?? 0) * h },
        uvScale: { x: (inner?.uvScale?.x ?? 1) * w, y: (inner?.uvScale?.y ?? 1) * h },
    };
}

export interface CatalogEntry {
    type: string;
    atlas?: string;
    frame?: { x: number; y: number; w: number; h: number };
    uv?: { offset: [number, number]; scale: [number, number] };
    trim?: { sourceW: number; sourceH: number; offsetX: number; offsetY: number };
    deps?: string[];
    buildPath?: string;
    /** A small copy of the texture that texture streaming fetches first. */
    streamTail?: StreamTailInfo;
}

export interface CatalogData {
    version: number;
    entries: Record<string, CatalogEntry>;
    addresses?: Record<string, string>;
    labels?: Record<string, string[]>;
}

/** The atlas record a cook/export manifest carries for a packed texture. */
export interface CookedAtlasInfo {
    page?: number;
    frame: { x: number; y: number; width: number; height: number };
    pageWidth: number;
    pageHeight: number;
}

/**
 * Derive a CatalogEntry's atlas fields from a cook-manifest atlas record.
 * Frame pixels are image-space (y from the page TOP); uv is emitted for
 * flipY-uploaded textures (v origin = image bottom), matching the
 * Sprite/UIVisual `uvOffset`/`uvScale` convention. `pagePath` is the page's
 * fetch identity — the same string every frame of the page shares, so texture
 * loading can collapse them onto one GPU texture.
 */
export function atlasCatalogFields(
    atlas: CookedAtlasInfo,
    pagePath: string,
): Pick<CatalogEntry, 'atlas' | 'frame' | 'uv'> {
    const { frame, pageWidth, pageHeight } = atlas;
    const { uvOffset, uvScale } = uvRectFromPixels(frame, pageWidth, pageHeight);
    return {
        atlas: pagePath,
        frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
        uv: {
            offset: [uvOffset.x, uvOffset.y],
            scale: [uvScale.x, uvScale.y],
        },
    };
}

export class Catalog {
    private entries_: Map<string, CatalogEntry>;
    private addresses_: Map<string, string>;
    private labels_: Map<string, string[]>;
    /** Built on first ask; a pack has thousands of entries and most callers never ask. */
    private addressByBuildPath_: Map<string, string> | null = null;

    private constructor(
        entries: Map<string, CatalogEntry>,
        addresses: Map<string, string>,
        labels: Map<string, string[]>,
        private readonly manifest_: ManifestModel | null = null,
    ) {
        this.entries_ = entries;
        this.addresses_ = addresses;
        this.labels_ = labels;
    }

    static fromJson(data: CatalogData): Catalog {
        const entries = new Map(Object.entries(data.entries));
        const addresses = new Map(Object.entries(data.addresses ?? {}));
        const labels = new Map(Object.entries(data.labels ?? {}));
        return new Catalog(entries, addresses, labels);
    }

    static empty(): Catalog {
        return new Catalog(new Map(), new Map(), new Map());
    }

    /** @internal Keep explicit catalog tags and use the active manifest for packaged membership. */
    withManifestLabels(model: ManifestModel | null): Catalog {
        return model === this.manifest_ ? this : new Catalog(this.entries_, this.addresses_, this.labels_, model);
    }

    resolve(ref: string): string {
        const addressPath = this.addresses_.get(ref);
        if (addressPath) return addressPath;
        if (this.entries_.has(ref)) return ref;
        return ref;
    }

    getEntry(path: string): CatalogEntry | null {
        const entry = this.entries_.get(path);
        if (entry) return entry;
        const asset = this.manifest_?.recordForRef(path)?.asset;
        return asset?.labels?.length ? { type: asset.type, buildPath: asset.path } : null;
    }

    /** A record's declared type, including uncategorized assets and address aliases. */
    assetTypeOf(ref: string): string | undefined {
        const key = this.resolve(ref);
        return this.entries_.get(key)?.type ?? this.manifest_?.recordForRef(key)?.asset.type;
    }

    /** @internal Resolve authored file references in the same order as the cook's dependency scan. */
    resolveDocumentRef(document: string, ref: string): string {
        if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/')) return ref;
        const known = findDocumentAsset(document, ref, path => {
            const address = this.resolve(path);
            return address !== path || this.entries_.has(path) || this.manifest_?.recordForRef(path) ? address : undefined;
        });
        // Without an index an explicit relative path names a sibling. Keep legacy unqualified refs for the host's resolver.
        return known ?? (ref.startsWith('./') || ref.startsWith('../') ? resolveDocumentRef(document, ref) : ref);
    }

    getAtlasFrame(path: string): AtlasFrameInfo | null {
        // A frame is keyed by its `@uuid:` spelling; a scene or clip may name the
        // same asset by its bare uuid, in either case.
        const uuid = assetRefId(path);
        let entry = (uuid ? this.entries_.get(UUID_REF_PREFIX + uuid) : undefined) ?? this.entries_.get(path);
        if (!entry) {
            const local = localAssetPathWithoutSuffix(path);
            if (local !== path) entry = this.entries_.get(normalizeAssetPathSeparators(local));
        }
        if (!entry?.atlas || !entry.frame || !entry.uv) return null;
        return {
            atlas: entry.atlas,
            frame: entry.frame,
            uvOffset: entry.uv.offset,
            uvScale: entry.uv.scale,
            trim: entry.trim,
        };
    }

    /**
     * The authored logical address a staged path came from, or null. A document
     * that names a SIBLING — a spine atlas page, a font page — resolves it against
     * where the document was AUTHORED, and content-addressed staging renames every
     * asset to a hash under one flat directory, which loses that.
     */
    addressOf(path: string): string | null {
        if (!this.addressByBuildPath_) {
            const byBuild = new Map<string, string>();
            for (const [key, entry] of this.entries_) {
                // `@uuid:` and the "/"-rooted spelling are alternative keys for the
                // same asset; the bare address is the authored one.
                if (key.startsWith('@uuid:') || key.startsWith('/')) continue;
                const built = entry.buildPath;
                if (built && built !== key && !byBuild.has(built)) byBuild.set(built, key);
            }
            this.addressByBuildPath_ = byBuild;
        }
        return this.addressByBuildPath_.get(path) ?? null;
    }

    /** The small copy of a texture streaming fetches first, or null when the build shipped none. */
    getStreamTail(path: string): StreamTailInfo | null {
        return this.entries_.get(path)?.streamTail ?? null;
    }

    getBuildPath(path: string): string {
        const entry = this.getEntry(path);
        return entry?.buildPath ?? path;
    }

    getDeps(path: string): string[] {
        const entry = this.entries_.get(path);
        return entry?.deps ?? [];
    }

    getByLabel(label: string): string[] {
        const legacy = this.labels_.get(label) ?? [];
        const model = this.manifest_;
        if (!model) return legacy;
        const members = new Map<string, string>();
        for (const { key, asset } of model.entriesByLabel(label)) {
            const path = asset.address ?? asset.path;
            members.set(key, model.recordForRef(path)?.key === key ? path : `${UUID_REF_PREFIX}${key}`);
        }
        for (const ref of legacy) {
            const key = model.recordForRef(ref)?.key ?? ref;
            if (!members.has(key)) members.set(key, ref);
        }
        return [...members.values()];
    }

    getAllLabels(): string[] {
        return [...new Set([...this.labels_.keys(), ...(this.manifest_?.labelNames() ?? [])])];
    }

    hasEntry(path: string): boolean {
        return this.getEntry(path) !== null;
    }

    hasAddress(address: string): boolean {
        return this.addresses_.has(address);
    }

    get isEmpty(): boolean {
        return this.entries_.size === 0 && !this.manifest_?.labelNames().length;
    }
}
