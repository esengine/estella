// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
    GamepadSnapshot,
    ImageLoadResult,
    PlatformCanvas,
    PlatformImage,
    PlatformSocket,
    PlatformSocketOptions,
    PlatformTextEditor,
} from './types';
import { createWebTextEditor } from './webTextEditor';
import { WebAudioBackend } from '../audio/WebAudioBackend';
import type { PlatformAudioBackend } from '../audio/PlatformAudioBackend';
import { WebVideoBackend } from '../video/WebVideoBackend';
import type { PlatformVideoBackend } from '../video/PlatformVideoBackend';
import { GameSocket } from '../net/GameSocket';
import { createPrimaryPointer } from './primaryPointer';

const WHEEL_LINE_HEIGHT = 16;

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
            const response = await globalThis.fetch(path);
            const ok = response.ok;
            response.body?.cancel();
            return ok;
        } catch {
            return false;
        }
    }

    async loadImagePixels(path: string): Promise<ImageLoadResult> {
        const img = this.createImage();
        await new Promise<void>((resolve, reject) => {
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
        const cv = this.createCanvas(img.width, img.height);
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        return { width: img.width, height: img.height, pixels: new Uint8Array(id.data.buffer) };
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
    createImage(): PlatformImage {
        return new Image();
    }

    /** A hidden textarea: the browser's own field, borrowed for its keyboard
     *  layouts, IME and selection gestures (see platform/webTextEditor.ts). */
    createTextEditor(): PlatformTextEditor | null {
        return createWebTextEditor();
    }

    /** Hand a shipped font to the browser's font stack, which is what Canvas2D
     *  resolves `ctx.font` families against. `document.fonts` is the only route:
     *  a file on disk (or behind `estella://`) is invisible to Canvas2D until a
     *  FontFace for it is added to the document. */
    async registerFont(family: string, bytes: ArrayBuffer): Promise<void> {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
        const face = new FontFace(family, bytes);
        await face.load();
        // `FontFaceSet.add` predates the lib.dom typing we compile against.
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
    }

    createCanvas(width: number, height: number): PlatformCanvas {
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
        const pointer = createPrimaryPointer(callbacks);

        const onTouchStart = (e: Event) => {
            e.preventDefault();
            const te = e as TouchEvent;
            const rect = (el as HTMLElement).getBoundingClientRect();
            for (let i = 0; i < te.changedTouches.length; i++) {
                const touch = te.changedTouches[i];
                pointer.start(touch.identifier, touch.clientX - rect.left, touch.clientY - rect.top);
            }
        };
        const onTouchMove = (e: Event) => {
            e.preventDefault();
            const te = e as TouchEvent;
            const rect = (el as HTMLElement).getBoundingClientRect();
            for (let i = 0; i < te.changedTouches.length; i++) {
                const touch = te.changedTouches[i];
                pointer.move(touch.identifier, touch.clientX - rect.left, touch.clientY - rect.top);
            }
        };
        const onTouchEnd = (e: Event) => {
            e.preventDefault();
            const te = e as TouchEvent;
            for (let i = 0; i < te.changedTouches.length; i++) {
                pointer.end(te.changedTouches[i].identifier);
            }
        };
        const onTouchCancel = (e: Event) => {
            const te = e as TouchEvent;
            for (let i = 0; i < te.changedTouches.length; i++) {
                pointer.cancel(te.changedTouches[i].identifier);
            }
        };
        const onWheel = (e: Event) => {
            const we = e as WheelEvent;
            let dx = we.deltaX;
            let dy = we.deltaY;
            if (we.deltaMode === 1) {
                dx *= WHEEL_LINE_HEIGHT;
                dy *= WHEEL_LINE_HEIGHT;
            } else if (we.deltaMode === 2) {
                dx *= window.innerWidth;
                dy *= window.innerHeight;
            }
            callbacks.onWheel(dx, dy);
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        el.addEventListener('mousemove', onMouseMove);
        el.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        el.addEventListener('touchstart', onTouchStart, { passive: false });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: false });
        el.addEventListener('touchcancel', onTouchCancel);
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
            el.removeEventListener('touchcancel', onTouchCancel);
            el.removeEventListener('wheel', onWheel);
        };
    }

    unbindInputEvents(): void {
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }
    }

    pollGamepads(): GamepadSnapshot[] {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (!nav || typeof nav.getGamepads !== 'function') return [];
        const out: GamepadSnapshot[] = [];
        for (const gp of nav.getGamepads()) {
            if (!gp) continue; // navigator.getGamepads() is a sparse array (null slots)
            out.push({
                index: gp.index,
                connected: gp.connected,
                buttons: gp.buttons.map((b) => b.value),
                axes: gp.axes.slice(),
                mapping: gp.mapping,
            });
        }
        return out;
    }

    createAudioBackend(): PlatformAudioBackend {
        return new WebAudioBackend();
    }

    createVideoBackend(): PlatformVideoBackend {
        return new WebVideoBackend();
    }

    createSocket(options: PlatformSocketOptions): PlatformSocket {
        return new GameSocket(options);
    }

    getStorageItem(key: string): string | null {
        return localStorage.getItem(key);
    }

    setStorageItem(key: string, value: string): void {
        localStorage.setItem(key, value);
    }

    removeStorageItem(key: string): void {
        localStorage.removeItem(key);
    }

    devicePixelRatio(): number {
        return typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    }

    /**
     * Both ways an error reaches the browser with nobody holding it.
     *
     * `error` carries the thrown value on the event; `unhandledrejection`
     * carries the rejection reason, which is the more common one in practice —
     * a promise chain in game code with no `.catch` fails completely silently
     * otherwise. Neither is prevented: this observes, and the browser still
     * logs to the console the way the developer expects.
     */
    onUnhandledError(callback: (error: unknown) => void): () => void {
        if (typeof window === 'undefined') return () => {};
        const onError = (e: ErrorEvent): void => { callback(e.error ?? e.message); };
        const onRejection = (e: PromiseRejectionEvent): void => { callback(e.reason); };
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }

    /**
     * Context loss, without needing to be told which canvas.
     *
     * `webglcontextlost` does not bubble, so a listener on `window` looks like
     * it could not work — but a non-bubbling event still travels the CAPTURE
     * phase down to its target, and `window` is the first stop. One listener
     * therefore sees every canvas on the page, including one the engine did not
     * create, and the plugin needs no canvas handed to it.
     */
    onContextLost(callback: () => void): () => void {
        if (typeof window === 'undefined') return () => {};
        const onLost = (e: Event): void => {
            // Without this the browser's default action is to abandon the context
            // permanently: `webglcontextrestored` never fires, and no amount of
            // recovery code downstream gets a chance to matter.
            e.preventDefault();
            callback();
        };
        window.addEventListener('webglcontextlost', onLost, true);
        return () => window.removeEventListener('webglcontextlost', onLost, true);
    }

    clearStorage(prefix: string): void {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k !== null && k.startsWith(prefix)) {
                toRemove.push(k);
            }
        }
        for (const k of toRemove) {
            localStorage.removeItem(k);
        }
    }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webAdapter = new WebPlatformAdapter();
