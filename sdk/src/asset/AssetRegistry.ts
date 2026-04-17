/**
 * @file    AssetRegistry.ts
 * @brief   Maps stable asset UUIDs to file paths + importer settings.
 *
 * Scene / prefab JSON stores asset references as `"@uuid:<uuid-v4>"` strings.
 * At load time the registry answers "which path does this UUID point to?" so
 * the loader can fetch the bytes. Renaming a file on disk therefore never
 * breaks a ref — the UUID (baked into the `.meta` sidecar) stays stable;
 * only the path moves, and the registry is rebuilt from the new filesystem
 * layout on next scan.
 *
 * The registry itself is pure data — it has no I/O. Populate it from an
 * `AssetManifest` (produced at build time or scanned by a host-side tool)
 * via `loadManifest()` / `addEntries()`. The asset system consults it
 * through `resolveRef()` / `uuidToPath()`.
 */

/** Prefix that distinguishes a UUID ref from a raw path in serialized data. */
export const UUID_REF_PREFIX = '@uuid:';

/** UUID v4 regex — 8-4-4-4-12 lowercase hex. Generators use crypto.randomUUID(). */
export const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One row in the registry: the UUID, its current path on disk, the asset
 * type (`"texture"`, `"audio"`, ...) and the free-form importer settings
 * parsed out of the `.meta` sidecar.
 */
export interface AssetEntry {
    uuid: string;
    path: string;
    type: string;
    importer?: Record<string, unknown>;
}

/**
 * Runtime-shipped manifest format. The build step (or editor host) scans
 * every `.meta` file in the project and emits this shape; the SDK loads
 * it once at startup to populate the registry.
 */
export interface AssetManifest {
    version: '1.0';
    entries: AssetEntry[];
}

/** True if `ref` is a `"@uuid:xxxxxxxx-xxxx-..."` string. */
export function isUuidRef(ref: unknown): ref is string {
    return typeof ref === 'string'
        && ref.startsWith(UUID_REF_PREFIX)
        && UUID_V4_REGEX.test(ref.slice(UUID_REF_PREFIX.length));
}

/** Extract the UUID out of a `"@uuid:..."` string, or null if not a ref. */
export function extractUuid(ref: unknown): string | null {
    if (!isUuidRef(ref)) return null;
    return (ref as string).slice(UUID_REF_PREFIX.length).toLowerCase();
}

/** Build a `"@uuid:..."` serialized ref. Validates the UUID shape. */
export function makeUuidRef(uuid: string): string {
    if (!UUID_V4_REGEX.test(uuid)) {
        throw new Error(`makeUuidRef: invalid UUID "${uuid}"`);
    }
    return UUID_REF_PREFIX + uuid.toLowerCase();
}

export class AssetRegistry {
    private byUuid_ = new Map<string, AssetEntry>();
    private byPath_ = new Map<string, AssetEntry>();

    /** Number of registered assets. */
    get size(): number {
        return this.byUuid_.size;
    }

    /**
     * Register a single entry. If an entry with the same UUID already
     * exists the newer one replaces it (typical use: the host scanned
     * the filesystem again after a rename).
     *
     * Throws if the entry is malformed (missing uuid / path, or UUID
     * shape wrong). Prefer a noisy failure at load time over silent
     * miss-resolutions later.
     */
    addEntry(entry: AssetEntry): void {
        if (!entry || typeof entry !== 'object') {
            throw new Error('AssetRegistry.addEntry: entry must be an object');
        }
        if (!UUID_V4_REGEX.test(entry.uuid)) {
            throw new Error(
                `AssetRegistry.addEntry: invalid uuid "${entry.uuid}" for path "${entry.path}"`,
            );
        }
        if (typeof entry.path !== 'string' || entry.path.length === 0) {
            throw new Error(
                `AssetRegistry.addEntry: missing path for uuid "${entry.uuid}"`,
            );
        }

        const uuid = entry.uuid.toLowerCase();
        const normalized: AssetEntry = {
            uuid,
            path: entry.path,
            type: entry.type,
            importer: entry.importer,
        };

        // If this UUID existed under a different path, drop the stale path mapping.
        const prior = this.byUuid_.get(uuid);
        if (prior && prior.path !== normalized.path) {
            this.byPath_.delete(prior.path);
        }

        this.byUuid_.set(uuid, normalized);
        this.byPath_.set(normalized.path, normalized);
    }

    /**
     * Register many entries. Invalid entries throw immediately and leave
     * prior valid ones in place (no transactional rollback — caller
     * should sanitize the manifest before handing it over).
     */
    addEntries(entries: readonly AssetEntry[]): void {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }

    /** Load a manifest produced by the build/scan tool. */
    loadManifest(manifest: AssetManifest): void {
        if (manifest.version !== '1.0') {
            throw new Error(
                `AssetRegistry.loadManifest: unsupported version "${manifest.version}"`,
            );
        }
        this.addEntries(manifest.entries);
    }

    /** Remove a single entry by UUID. Returns true if it was present. */
    removeByUuid(uuid: string): boolean {
        const key = uuid.toLowerCase();
        const entry = this.byUuid_.get(key);
        if (!entry) return false;
        this.byUuid_.delete(key);
        this.byPath_.delete(entry.path);
        return true;
    }

    /** Full lookup by UUID. Returns null if unknown. */
    resolveUuid(uuid: string): AssetEntry | null {
        return this.byUuid_.get(uuid.toLowerCase()) ?? null;
    }

    /** Convenience: just the path for a UUID, or null. */
    uuidToPath(uuid: string): string | null {
        return this.byUuid_.get(uuid.toLowerCase())?.path ?? null;
    }

    /** Reverse lookup: which UUID is bound to this path, if any. */
    pathToUuid(path: string): string | null {
        return this.byPath_.get(path)?.uuid ?? null;
    }

    /** Reverse lookup with full entry. */
    getEntryByPath(path: string): AssetEntry | null {
        return this.byPath_.get(path) ?? null;
    }

    /** All entries of a given `.meta` type (`"texture"`, `"audio"`, ...). */
    getAllByType(type: string): AssetEntry[] {
        const out: AssetEntry[] = [];
        for (const entry of this.byUuid_.values()) {
            if (entry.type === type) out.push(entry);
        }
        return out;
    }

    /**
     * Resolve any serialized asset ref to an on-disk path:
     *   - `"@uuid:xxxxxxxx-..."`  → lookup UUID; returns path or null
     *   - plain string            → returned as-is (treated as legacy path)
     *
     * This is the function the asset loader should call before hitting
     * the filesystem. During the migration window, scenes / prefabs
     * carry a mix of UUID refs and legacy paths; this handles both.
     */
    resolveRef(ref: string): string | null {
        const uuid = extractUuid(ref);
        if (uuid !== null) {
            return this.uuidToPath(uuid);
        }
        return ref;
    }

    /** Iterate all entries. Stable across consecutive calls with no mutations. */
    entries(): AssetEntry[] {
        return Array.from(this.byUuid_.values());
    }

    /** Drop everything. Mainly for tests. */
    clear(): void {
        this.byUuid_.clear();
        this.byPath_.clear();
    }
}
