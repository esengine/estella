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
    private inputCleanup_: (() => void) | null = null;

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
    createImage(): HTMLImageElement {
        return new Image();
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
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }

        const el = (target as HTMLElement) ?? document.querySelector('canvas') ?? document.body;

        const onKeyDown = (e: Event) => callbacks.onKeyDown((e as KeyboardEvent).code);
        const onKeyUp = (e: Event) => callbacks.onKeyUp((e as KeyboardEvent).code);
        const onMouseMove = (e: Event) => {
            const me = e as MouseEvent;
            callbacks.onPointerMove(me.offsetX, me.offsetY);
        };
        const onMouseDown = (e: Event) => {
            const me = e as MouseEvent;
            callbacks.onPointerDown(me.button, me.offsetX, me.offsetY);
        };
        const onMouseUp = (e: Event) => {
            callbacks.onPointerUp((e as MouseEvent).button);
        };
        const onTouchStart = (e: Event) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (el as HTMLElement).getBoundingClientRect();
                callbacks.onPointerDown(0, touch.clientX - rect.left, touch.clientY - rect.top);
            }
        };
        const onTouchMove = (e: Event) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (el as HTMLElement).getBoundingClientRect();
                callbacks.onPointerMove(touch.clientX - rect.left, touch.clientY - rect.top);
            }
        };
        const onTouchEnd = () => {
            callbacks.onPointerUp(0);
        };
        const onWheel = (e: Event) => {
            const we = e as WheelEvent;
            callbacks.onWheel(we.deltaX, we.deltaY);
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        el.addEventListener('mousemove', onMouseMove);
        el.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        el.addEventListener('touchstart', onTouchStart);
        el.addEventListener('touchmove', onTouchMove);
        el.addEventListener('touchend', onTouchEnd);
        el.addEventListener('wheel', onWheel);

        this.inputCleanup_ = () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            el.removeEventListener('mousemove', onMouseMove);
            el.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mouseup', onMouseUp);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('wheel', onWheel);
        };
    }

    unbindInputEvents(): void {
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }
    }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webAdapter = new WebPlatformAdapter();
