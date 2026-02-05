import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import * as logger from './logger.js';

export async function hashFile(filePath) {
    try {
        const content = await readFile(filePath);
        return createHash('md5').update(content).digest('hex');
    } catch {
        return null;
    }
}

export async function hashFiles(filePaths) {
    const hash = createHash('md5');
    const sortedPaths = [...filePaths].sort();

    for (const filePath of sortedPaths) {
        try {
            const content = await readFile(filePath);
            hash.update(filePath);
            hash.update(content);
        } catch {
            hash.update(filePath);
            hash.update('MISSING');
        }
    }

    return hash.digest('hex');
}

export async function hashDirectory(dirPath, pattern = null) {
    const files = await getFilesRecursive(dirPath, pattern);
    return hashFiles(files);
}

async function getFilesRecursive(dirPath, pattern = null) {
    const files = [];

    async function walk(dir) {
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile()) {
                    if (!pattern || matchPattern(entry.name, pattern)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch {
            // Directory doesn't exist or isn't accessible
        }
    }

    await walk(dirPath);
    return files;
}

function matchPattern(filename, pattern) {
    if (pattern instanceof RegExp) {
        return pattern.test(filename);
    }
    if (typeof pattern === 'string') {
        if (pattern.startsWith('*.')) {
            return filename.endsWith(pattern.slice(1));
        }
        return filename === pattern;
    }
    return true;
}

export class HashCache {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.cacheFile = path.join(cacheDir, 'hashes.json');
        this.cache = {};
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;

        try {
            const content = await readFile(this.cacheFile, 'utf-8');
            this.cache = JSON.parse(content);
            logger.debug(`Loaded cache with ${Object.keys(this.cache).length} entries`);
        } catch {
            this.cache = {};
            logger.debug('No existing cache found, starting fresh');
        }
        this.loaded = true;
    }

    async save() {
        try {
            await mkdir(this.cacheDir, { recursive: true });
            await writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
            logger.debug('Cache saved');
        } catch (err) {
            logger.warn(`Failed to save cache: ${err.message}`);
        }
    }

    get(key) {
        return this.cache[key];
    }

    set(key, value) {
        this.cache[key] = value;
    }

    has(key) {
        return key in this.cache;
    }

    async isChanged(key, currentHash) {
        await this.load();
        const cachedHash = this.get(key);
        return cachedHash !== currentHash;
    }

    async updateIfChanged(key, currentHash) {
        const changed = await this.isChanged(key, currentHash);
        if (changed) {
            this.set(key, currentHash);
        }
        return changed;
    }
}
