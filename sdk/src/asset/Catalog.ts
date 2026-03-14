export interface AtlasFrameInfo {
    atlas: string;
    frame: { x: number; y: number; w: number; h: number };
    uvOffset: [number, number];
    uvScale: [number, number];
}

export interface CatalogEntry {
    type: string;
    atlas?: string;
    frame?: { x: number; y: number; w: number; h: number };
    uv?: { offset: [number, number]; scale: [number, number] };
    deps?: string[];
    buildPath?: string;
}

export interface CatalogData {
    version: number;
    entries: Record<string, CatalogEntry>;
    addresses?: Record<string, string>;
    labels?: Record<string, string[]>;
}

export class Catalog {
    private entries_: Map<string, CatalogEntry>;
    private addresses_: Map<string, string>;
    private labels_: Map<string, string[]>;

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
        };
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
