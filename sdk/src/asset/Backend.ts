import { platformFetch, platformReadFile, platformReadTextFile } from '../platform';

export interface Backend {
    fetchBinary(path: string): Promise<ArrayBuffer>;
    fetchText(path: string): Promise<string>;
    resolveUrl(path: string): string;
}

export interface HttpBackendOptions {
    baseUrl: string;
}

export class HttpBackend implements Backend {
    private baseUrl_: string;

    constructor(options: HttpBackendOptions) {
        this.baseUrl_ = options.baseUrl.replace(/\/+$/, '');
    }

    async fetchBinary(path: string): Promise<ArrayBuffer> {
        const url = this.resolveUrl(path);
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch '${path}': ${response.status} ${response.statusText}`);
        }
        return response.arrayBuffer();
    }

    async fetchText(path: string): Promise<string> {
        const url = this.resolveUrl(path);
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch '${path}': ${response.status} ${response.statusText}`);
        }
        return response.text();
    }

    resolveUrl(path: string): string {
        if (path.startsWith('/') || path.includes('://')) {
            return path;
        }
        return `${this.baseUrl_}/${path}`;
    }
}

export class EmbeddedBackend implements Backend {
    private assets_: Map<string, string>;

    constructor(assets: Record<string, string>) {
        this.assets_ = new Map(Object.entries(assets));
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
        const dataUrl = this.assets_.get(path);
        if (!dataUrl) {
            throw new Error(`EmbeddedBackend: asset not found: ${path}`);
        }
        return dataUrl;
    }
}
