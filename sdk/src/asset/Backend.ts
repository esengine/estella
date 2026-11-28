// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { platformFetch, platformReadFile, platformReadTextFile, platformReadCacheFile } from '../platform';

/** Encode an indexed filename for a URL while preserving directories. */
export function encodeAssetFilePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

function isRemoteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

/**
 * Content cache first: hot update wrote its verified, content-addressed (immutable)
 * assets to the platform's disk store keyed by this url, so they load offline and
 * skip the CDN. Only remote urls are ever written, so anything else just fetches.
 */
async function fetchUrlBinary(url: string, path: string): Promise<ArrayBuffer> {
    if (isRemoteUrl(url)) {
        const cached = await platformReadCacheFile(url);
        if (cached) return cached;
    }
    // A mini-game's request answers text unless told otherwise, and bytes re-encoded
    // from text are not the image: every hot-updated asset failed its hash there.
    const response = await platformFetch(url, { responseType: 'arraybuffer' });
    if (!response.ok) throw new Error(`Failed to fetch '${path}': ${response.status} ${response.statusText}`);
    return response.arrayBuffer();
}

async function fetchUrlText(url: string, path: string): Promise<string> {
    const response = await platformFetch(url);
    if (!response.ok) throw new Error(`Failed to fetch '${path}': ${response.status} ${response.statusText}`);
    return response.text();
}

export interface Backend {
    fetchBinary(path: string): Promise<ArrayBuffer>;
    fetchText(path: string): Promise<string>;
    resolveUrl(path: string): string;
    /** Wait for a packaged file before handing its URL to a decoder that performs its own I/O. */
    prepareFile?(path: string): Promise<void> | undefined;
    setBaseUrl?(url: string, isLocalFile?: (path: string) => boolean): void;
}

export interface HttpBackendOptions {
    baseUrl: string;
}

export class HttpBackend implements Backend {
    private baseUrl_: string;
    private isLocalFile_?: (path: string) => boolean;

    constructor(options: HttpBackendOptions) {
        this.baseUrl_ = options.baseUrl.replace(/\/+$/, '');
    }

    async fetchBinary(path: string): Promise<ArrayBuffer> {
        return fetchUrlBinary(this.resolveUrl(path), path);
    }

    async fetchText(path: string): Promise<string> {
        return fetchUrlText(this.resolveUrl(path), path);
    }

    resolveUrl(path: string): string {
        if (this.baseUrl_ && /[%?#]/.test(path) && !path.includes('://')) {
            const file = path.replace(/^\//, '');
            if (this.isLocalFile_?.(file)) return `${this.baseUrl_}/${encodeAssetFilePath(file)}`;
        }
        if (path.startsWith('/') || path.includes('://')) {
            return path;
        }
        return this.baseUrl_ ? `${this.baseUrl_}/${path}` : path;
    }

    setBaseUrl(url: string, isLocalFile?: (path: string) => boolean): void {
        this.baseUrl_ = url.replace(/\/+$/, '');
        this.isLocalFile_ = isLocalFile;
    }
}

/**
 * Reads assets from the platform filesystem (WeChat `wx.getFileSystemManager`).
 * Paths are already resolved build paths (the runtime's `resolveRef` maps
 * uuid→build path before fetch), so `resolveUrl` is identity — there is no URL,
 * the path IS the file location.
 */
export class FileSystemBackend implements Backend {
    // Its own files are in the package; a hot update's manifest and assets are on a CDN.
    async fetchBinary(path: string): Promise<ArrayBuffer> {
        return isRemoteUrl(path) ? fetchUrlBinary(path, path) : platformReadFile(path);
    }

    async fetchText(path: string): Promise<string> {
        return isRemoteUrl(path) ? fetchUrlText(path, path) : platformReadTextFile(path);
    }

    resolveUrl(path: string): string {
        return path;
    }
}

export class EmbeddedBackend implements Backend {
    private assets_: Map<string, string>;

    constructor(assets: Record<string, string>) {
        this.assets_ = new Map();
        for (const [path, content] of Object.entries(assets)) {
            if (content.startsWith('data:')) {
                this.assets_.set(path, content);
            } else {
                // Hosts can inline authored documents as plain text. Give them a URL
                // that every reader can reopen, including empty and non-ASCII text.
                let binary = '';
                for (const byte of new TextEncoder().encode(content)) binary += String.fromCharCode(byte);
                this.assets_.set(path, 'data:text/plain;charset=utf-8;base64,' + btoa(binary));
            }
        }
    }

    async fetchBinary(path: string): Promise<ArrayBuffer> {
        const dataUrl = this.getDataUrl(path);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async fetchText(path: string): Promise<string> {
        const dataUrl = this.getDataUrl(path);
        if (dataUrl.startsWith('data:') && dataUrl.includes(';base64,')) {
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        }
        return dataUrl;
    }

    resolveUrl(path: string): string {
        return this.assets_.get(path) ?? path;
    }

    has(path: string): boolean {
        return this.assets_.has(path);
    }

    private getDataUrl(path: string): string {
        // Accept an already-resolved data: URL, not only a map key. The asset loader
        // fetches typed text/binary through `fetchText(resolveUrl(ref))` — idempotent
        // for HttpBackend (resolveUrl of an absolute URL is a no-op). Here resolveUrl
        // has already returned the data URL, so a second lookup keyed by that URL
        // would miss and throw. Pass a data: URL straight through so resolve-then-fetch
        // is idempotent for the embedded backend too (this is what broke embedded
        // tilemap/material/tileset loading in playable builds).
        if (path.startsWith('data:')) return path;
        const dataUrl = this.assets_.get(path);
        if (!dataUrl) {
            throw new Error(`EmbeddedBackend: asset not found: ${path}`);
        }
        return dataUrl;
    }
}
