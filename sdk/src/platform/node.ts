// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    node.ts
 * @brief   Node platform adapter — the authoritative-server host. The same
 *          engine wasm + SDK gameplay code runs headless: filesystem-first
 *          asset access (http(s) URLs still fetch), sockets over the global
 *          WebSocket (Node ≥ 22), silent audio, no DOM. Anything that
 *          fundamentally needs a render host (image decode, canvas) fails
 *          loud rather than pretending.
 */
import { readFile as fsReadFile, access } from 'node:fs/promises';
import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
    InputEventCallbacks,
    ImageLoadResult,
    PlatformSocket,
    PlatformSocketOptions,
} from './types';
import type { PlatformAudioBackend } from '../audio/PlatformAudioBackend';
import { NullAudioBackend } from '../audio/NullAudioBackend';
import { GameSocket } from '../net/GameSocket';

function isUrl(path: string): boolean {
    return /^https?:\/\//.test(path);
}

class NodePlatformAdapter implements PlatformAdapter {
    readonly name = 'node' as const;
    private readonly storage_ = new Map<string, string>();

    async fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
        if (!isUrl(url)) {
            // Local project files resolve through the filesystem so a server
            // can point straight at a cooked build directory.
            const buffer = await this.readFile(url);
            const text = () => Promise.resolve(new TextDecoder().decode(buffer));
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: {},
                json: async <T>() => JSON.parse(await text()) as T,
                text,
                arrayBuffer: () => Promise.resolve(buffer),
            };
        }
        const response = await globalThis.fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body,
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
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
        if (isUrl(path)) {
            const res = await this.fetch(path);
            if (!res.ok) throw new Error(`Failed to read file: ${path} (${res.status})`);
            return res.arrayBuffer();
        }
        const buf = await fsReadFile(path);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }

    async readTextFile(path: string): Promise<string> {
        return new TextDecoder().decode(await this.readFile(path));
    }

    async fileExists(path: string): Promise<boolean> {
        if (isUrl(path)) {
            try {
                const res = await globalThis.fetch(path, { method: 'HEAD' });
                return res.ok;
            } catch {
                return false;
            }
        }
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    async loadImagePixels(_path: string): Promise<ImageLoadResult> {
        throw new Error(
            '[node] image decode needs a render host — a headless server must not load textures ' +
            '(load gameplay data only, or run a renderer-equipped host)');
    }

    async instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports,
    ): Promise<WasmInstantiateResult> {
        const buffer = typeof pathOrBuffer === 'string' ? await this.readFile(pathOrBuffer) : pathOrBuffer;
        const { instance, module } = await WebAssembly.instantiate(buffer, imports);
        return { instance, module };
    }

    createCanvas(_width: number, _height: number): HTMLCanvasElement {
        throw new Error('[node] no canvas on a headless host');
    }

    createImage(): HTMLImageElement {
        throw new Error('[node] no DOM images on a headless host');
    }

    now(): number {
        return performance.now();
    }

    bindInputEvents(_callbacks: InputEventCallbacks): void {
        // No local input device — player input arrives over the network.
    }

    createAudioBackend(): PlatformAudioBackend {
        return new NullAudioBackend();
    }

    createSocket(options: PlatformSocketOptions): PlatformSocket {
        // Node ≥ 22 ships a spec-compliant global WebSocket client.
        return new GameSocket(options);
    }

    devicePixelRatio(): number {
        return 1;
    }

    getStorageItem(key: string): string | null {
        return this.storage_.get(key) ?? null;
    }

    setStorageItem(key: string, value: string): void {
        this.storage_.set(key, value);
    }

    removeStorageItem(key: string): void {
        this.storage_.delete(key);
    }

    clearStorage(prefix: string): void {
        for (const k of [...this.storage_.keys()]) {
            if (k.startsWith(prefix)) this.storage_.delete(k);
        }
    }
}

export const nodeAdapter = new NodePlatformAdapter();
