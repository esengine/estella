/**
 * @file    BuildCache.ts
 * @brief   Incremental build cache for file change detection
 */

// =============================================================================
// Types
// =============================================================================

export interface FileHash {
    path: string;
    hash: string;
    lastModified: number;
    size: number;
}

export interface BuildCacheData {
    version: string;
    configId: string;
    timestamp: number;
    files: Record<string, FileHash>;
    compiledScripts?: string;
    compiledScriptsHash?: string;
}

export interface FileChangeResult {
    added: string[];
    modified: string[];
    removed: string[];
    unchanged: string[];
}

// =============================================================================
// Constants
// =============================================================================

const CACHE_VERSION = '1.0';
const CACHE_DIR = '.esengine/build-cache';

// =============================================================================
// Hash Utilities
// =============================================================================

async function computeHash(content: string | Uint8Array): Promise<string> {
    const data = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeFileHash(fs: NativeFileSystem, filePath: string): Promise<FileHash | null> {
    try {
        const content = await fs.readFile(filePath);
        const stats = await fs.stat(filePath);
        const hash = await computeHash(content);

        return {
            path: filePath,
            hash,
            lastModified: stats.mtimeMs,
            size: stats.size,
        };
    } catch {
        return null;
    }
}

// =============================================================================
// BuildCache Class
// =============================================================================

export class BuildCache {
    private projectDir_: string;
    private fs_: NativeFileSystem | null;

    constructor(projectDir: string) {
        this.projectDir_ = projectDir;
        this.fs_ = window.__esengine_fs ?? null;
    }

    private getFs(): NativeFileSystem {
        if (!this.fs_) {
            throw new Error('Native file system not available');
        }
        return this.fs_;
    }

    private getCachePath(configId: string): string {
        return `${this.projectDir_}/${CACHE_DIR}/${configId}.json`;
    }

    private getCacheDir(): string {
        return `${this.projectDir_}/${CACHE_DIR}`;
    }

    async loadCache(configId: string): Promise<BuildCacheData | null> {
        if (!this.fs_) return null;

        const cachePath = this.getCachePath(configId);

        try {
            const content = await this.fs_.readFile(cachePath);
            const decoder = new TextDecoder();
            const jsonStr = decoder.decode(content);
            const data = JSON.parse(jsonStr) as BuildCacheData;

            if (data.version !== CACHE_VERSION) {
                return null;
            }

            return data;
        } catch {
            return null;
        }
    }

    async saveCache(data: BuildCacheData): Promise<void> {
        const fs = this.getFs();
        const cacheDir = this.getCacheDir();
        const cachePath = this.getCachePath(data.configId);

        try {
            await fs.mkdir(cacheDir, { recursive: true });
        } catch {
            // Directory may already exist
        }

        const jsonStr = JSON.stringify(data, null, 2);
        const encoder = new TextEncoder();
        await fs.writeFile(cachePath, encoder.encode(jsonStr));
    }

    async invalidateCache(configId: string): Promise<void> {
        if (!this.fs_) return;

        const cachePath = this.getCachePath(configId);

        try {
            await this.fs_.unlink(cachePath);
        } catch {
            // Cache may not exist
        }
    }

    async getChangedFiles(
        currentFiles: string[],
        cached: BuildCacheData | null
    ): Promise<FileChangeResult> {
        const result: FileChangeResult = {
            added: [],
            modified: [],
            removed: [],
            unchanged: [],
        };

        if (!cached) {
            result.added = [...currentFiles];
            return result;
        }

        if (!this.fs_) {
            result.added = [...currentFiles];
            return result;
        }

        const cachedPaths = new Set(Object.keys(cached.files));
        const currentPaths = new Set(currentFiles);

        for (const filePath of currentFiles) {
            if (!cachedPaths.has(filePath)) {
                result.added.push(filePath);
            } else {
                const cachedFile = cached.files[filePath];
                const currentHash = await computeFileHash(this.fs_, filePath);

                if (!currentHash) {
                    result.removed.push(filePath);
                } else if (currentHash.hash !== cachedFile.hash) {
                    result.modified.push(filePath);
                } else {
                    result.unchanged.push(filePath);
                }
            }
        }

        for (const cachedPath of cachedPaths) {
            if (!currentPaths.has(cachedPath)) {
                result.removed.push(cachedPath);
            }
        }

        return result;
    }

    async computeFilesHash(filePaths: string[]): Promise<Record<string, FileHash>> {
        const result: Record<string, FileHash> = {};

        if (!this.fs_) return result;

        const fs = this.fs_;
        const promises = filePaths.map(async (filePath) => {
            const hash = await computeFileHash(fs, filePath);
            if (hash) {
                result[filePath] = hash;
            }
        });

        await Promise.all(promises);
        return result;
    }

    async createCacheData(
        configId: string,
        filePaths: string[],
        compiledScripts?: string
    ): Promise<BuildCacheData> {
        const files = await this.computeFilesHash(filePaths);
        const compiledScriptsHash = compiledScripts
            ? await computeHash(compiledScripts)
            : undefined;

        return {
            version: CACHE_VERSION,
            configId,
            timestamp: Date.now(),
            files,
            compiledScripts,
            compiledScriptsHash,
        };
    }

    hasChanges(changes: FileChangeResult): boolean {
        return changes.added.length > 0 ||
               changes.modified.length > 0 ||
               changes.removed.length > 0;
    }

    async clearAllCaches(): Promise<void> {
        if (!this.fs_) return;

        const cacheDir = this.getCacheDir();

        try {
            const entries = await this.fs_.readdir(cacheDir);
            for (const entry of entries) {
                if (entry.endsWith('.json')) {
                    await this.fs_.unlink(`${cacheDir}/${entry}`);
                }
            }
        } catch {
            // Cache directory may not exist
        }
    }
}

export { computeHash };
