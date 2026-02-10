/**
 * @file    web.ts
 * @brief   Web platform adapter implementation
 */

import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
    InputEventCallbacks,
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
    createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
        let canvas: HTMLCanvasElement | OffscreenCanvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(width, height);
        } else {
            canvas = document.createElement('canvas');
        }
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    now(): number {
        return performance.now();
    }

    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void {
        const el = (target as HTMLElement) ?? document.querySelector('canvas') ?? document.body;

        document.addEventListener('keydown', (e) => callbacks.onKeyDown(e.code));
        document.addEventListener('keyup', (e) => callbacks.onKeyUp(e.code));

        el.addEventListener('mousemove', (e) => {
            const me = e as MouseEvent;
            callbacks.onPointerMove(me.offsetX, me.offsetY);
        });
        el.addEventListener('mousedown', (e) => {
            const me = e as MouseEvent;
            callbacks.onPointerDown(me.button, me.offsetX, me.offsetY);
        });
        el.addEventListener('mouseup', (e) => {
            callbacks.onPointerUp((e as MouseEvent).button);
        });

        el.addEventListener('touchstart', (e) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (el as HTMLElement).getBoundingClientRect();
                callbacks.onPointerDown(0, touch.clientX - rect.left, touch.clientY - rect.top);
            }
        });
        el.addEventListener('touchmove', (e) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (el as HTMLElement).getBoundingClientRect();
                callbacks.onPointerMove(touch.clientX - rect.left, touch.clientY - rect.top);
            }
        });
        el.addEventListener('touchend', () => {
            callbacks.onPointerUp(0);
        });

        el.addEventListener('wheel', (e) => {
            const we = e as WheelEvent;
            callbacks.onWheel(we.deltaX, we.deltaY);
        });
    }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webAdapter = new WebPlatformAdapter();
