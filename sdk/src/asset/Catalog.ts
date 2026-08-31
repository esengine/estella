// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface AtlasFrameInfo {
    atlas: string;
    frame: { x: number; y: number; w: number; h: number };
    uvOffset: [number, number];
    uvScale: [number, number];
    trim?: { sourceW: number; sourceH: number; offsetX: number; offsetY: number };
}

export interface CatalogEntry {
    type: string;
    atlas?: string;
    frame?: { x: number; y: number; w: number; h: number };
    uv?: { offset: [number, number]; scale: [number, number] };
    trim?: { sourceW: number; sourceH: number; offsetX: number; offsetY: number };
    deps?: string[];
    buildPath?: string;
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
    return {
        atlas: pagePath,
        frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
        uv: {
            offset: [frame.x / pageWidth, 1 - (frame.y + frame.height) / pageHeight],
            scale: [frame.width / pageWidth, frame.height / pageHeight],
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

    resolve(ref: string): string {
        const addressPath = this.addresses_.get(ref);
        if (addressPath) return addressPath;
        if (this.entries_.has(ref)) return ref;
        return ref;
    }

    getEntry(path: string): CatalogEntry | null {
        return this.entries_.get(path) ?? null;
    }

    getAtlasFrame(path: string): AtlasFrameInfo | null {
        const entry = this.entries_.get(path);
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

    getBuildPath(path: string): string {
        const entry = this.entries_.get(path);
        return entry?.buildPath ?? path;
    }

    getDeps(path: string): string[] {
        const entry = this.entries_.get(path);
        return entry?.deps ?? [];
    }

    getByLabel(label: string): string[] {
        return this.labels_.get(label) ?? [];
    }

    getAllLabels(): string[] {
        return Array.from(this.labels_.keys());
    }

    hasEntry(path: string): boolean {
        return this.entries_.has(path);
    }

    hasAddress(address: string): boolean {
        return this.addresses_.has(address);
    }

    get isEmpty(): boolean {
        return this.entries_.size === 0;
    }
}
