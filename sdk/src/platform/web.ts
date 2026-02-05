/**
 * @file    web.ts
 * @brief   Web platform adapter implementation
 */

import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
} from './types';

// =============================================================================
// Web Platform Adapter
// =============================================================================

class WebPlatformAdapter implements PlatformAdapter {
    readonly name = 'web' as const;

    async fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
        const response = await globalThis.fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body,
        });

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            json: <T>() => response.json() as Promise<T>,
            text: () => response.text(),
            arrayBuffer: () => response.arrayBuffer(),
        };
    }

    async readFile(path: string): Promise<ArrayBuffer> {
        const response = await this.fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to read file: ${path} (${response.status})`);
        }
        return response.arrayBuffer();
    }

    async readTextFile(path: string): Promise<string> {
        const response = await this.fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to read file: ${path} (${response.status})`);
        }
        return response.text();
    }

    async fileExists(path: string): Promise<boolean> {
        try {
            const response = await globalThis.fetch(path, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }

    async instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult> {
        let buffer: ArrayBuffer;

        if (typeof pathOrBuffer === 'string') {
            buffer = await this.readFile(pathOrBuffer);
        } else {
            buffer = pathOrBuffer;
        }

        const result = await WebAssembly.instantiate(buffer, imports);

        return {
            instance: result.instance,
            module: result.module,
        };
    }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webAdapter = new WebPlatformAdapter();
