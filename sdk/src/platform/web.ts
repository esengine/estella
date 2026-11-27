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
    PlatformScreenRecorder,
} from './types';
import { createWebTextEditor } from './webTextEditor';
import { surfacePointerFrame } from './webSurface';
import { WebAudioBackend } from '../audio/WebAudioBackend';
import type { PlatformAudioBackend } from '../audio/PlatformAudioBackend';
import { WebVideoBackend } from '../video/WebVideoBackend';
import type { PlatformVideoBackend } from '../video/PlatformVideoBackend';
import { GameSocket } from '../net/GameSocket';
import { cancelPointer, createPrimaryPointer } from './primaryPointer';
import { createWebRecorder, defaultRecordingCanvas } from './webRecorder';
import { WebDevice } from '../device/web';
import { InputBinding, type ListenerScope } from './listeners';
import { cacheEntryName } from './cacheEntryName';
import { imageSizeAtEdge, readCanvasPixels } from './imagePixels';
import { webCacheAvailable, webCacheList, webCacheRead, webCacheRemove, webCacheWrite } from './webCacheStore';
import { fontWeightRange } from './fontWeights';

const WHEEL_LINE_HEIGHT = 16;

/** A dock can move the canvas or any of its containers into another document. */
function followInputDocument(el: HTMLElement, scope: ListenerScope, onAdopt: () => void): void {
    const doc = el.ownerDocument;
    const watchParents = () => {
        changes.disconnect();
        if (el.ownerDocument !== doc) {
            onAdopt();
            return;
        }
        // Only changes to the canvas's ancestry can move it. Normal DOM updates
        // inside other panels do not need to wake the engine's input adapter.
        for (let node = el.parentNode; node; node = node.parentNode ?? (node as ShadowRoot).host) {
            changes.observe(node, { childList: true });
        }
    };
    const changes = new MutationObserver(watchParents);
    scope.add(() => changes.disconnect());
    watchParents();
    // An initially detached canvas can first appear in a different window.
    // Its original document sees no removal in that case.
    if (typeof ResizeObserver === 'function') {
        const size = new ResizeObserver(watchParents);
        scope.add(() => size.disconnect());
        size.observe(el);
    }
    scope.listen(el, 'pointerover', watchParents);
    scope.listen(el, 'focusin', watchParents);
}

// =============================================================================
// Web Platform Adapter
// =============================================================================

/** With no pad known, how many polls pass between looks at the browser: about a second of frames. */
const GAMEPAD_LOOK_EVERY = 60;
const NO_GAMEPADS: GamepadSnapshot[] = [];

class WebPlatformAdapter implements PlatformAdapter {
    private device_: WebDevice | null = null;
    device(): WebDevice { return this.device_ ??= new WebDevice(); }
    readonly name = 'web' as const;
    private readonly inputBinding_ = new InputBinding();
    /** Whether a pad is plugged in as far as the page knows: the last look found one, or the browser announced one since. */
    private padsLive_ = false;
    private stopPadEvents_?: () => void;
    private padPolls_ = 0;
    private recorders_ = new WeakMap<AbortSignal | PlatformCanvas, PlatformScreenRecorder>();

    screenRecorder(canvas: PlatformCanvas | null = defaultRecordingCanvas(), lifetime?: AbortSignal): PlatformScreenRecorder | null {
        if (!canvas || lifetime?.aborted) return null;
        const owner = lifetime ?? canvas;
        const existing = this.recorders_.get(owner);
        if (existing) return existing;
        const recorder = createWebRecorder(canvas, lifetime);
        if (recorder) this.recorders_.set(owner, recorder);
        return recorder;
    }

    hasTouch(): boolean {
        return typeof navigator !== 'undefined'
            && ((navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in globalThis);
    }

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

    async loadImagePixels(path: string, maxEdge = 0): Promise<ImageLoadResult> {
        const img = this.createImage();
        await new Promise<void>((resolve, reject) => {
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
        const { width, height } = imageSizeAtEdge(img.width, img.height, maxEdge);
        const cv = this.createCanvas(width, height);
        const ctx = cv.getContext('2d')!;
        return readCanvasPixels(img, width, height, ctx);
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
    createTextEditor(canvas?: PlatformCanvas): PlatformTextEditor | null {
        return createWebTextEditor(canvas);
    }

    /** Hand a shipped font to the browser's font stack, which is what Canvas2D
     *  resolves `ctx.font` families against. `document.fonts` is the only route:
     *  a file on disk (or behind `estella://`) is invisible to Canvas2D until a
     *  FontFace for it is added to the document. */
    async registerFont(family: string, bytes: ArrayBuffer): Promise<void> {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
        // A variable font covers every weight on its axis: said so, a Text at weight 300 is drawn at 300 and not at the default.
        const weights = fontWeightRange(bytes);
        const face = new FontFace(family, bytes, weights ? { weight: `${weights[0]} ${weights[1]}` } : undefined);
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
        const element = target as HTMLElement | undefined;
        const doc = element?.ownerDocument ?? globalThis.document;
        if (!doc) {
            this.unbindInputEvents();
            return;
        }
        const el = element ?? doc.querySelector('canvas') ?? doc.body;
        const win = doc.defaultView ?? window;

        const heldKeys = new Set<string>();
        const heldButtons = new Set<number>();
        const heldTouches = new Set<number>();
        const onKeyDown = (e: Event) => {
            const key = e as KeyboardEvent;
            const target = key.target as HTMLElement | null;
            // Host forms keep typing/Tab; the engine's own hidden editor still routes Tab.
            if (target?.closest?.('input, textarea, select, button, a[href], [contenteditable]')
                && target.dataset?.estellaTextEditor !== 'true') return;
            if (key.isComposing || key.keyCode === 229) return;
            if ((key.ctrlKey || key.metaKey || key.altKey) && ['Tab', 'Enter', 'Space'].includes(key.code)) return;
            heldKeys.add(key.code);
            if (callbacks.onKeyDown(key.code) === true) key.preventDefault();
        };
        const onKeyUp = (e: Event) => {
            const code = (e as KeyboardEvent).code;
            if (heldKeys.delete(code)) callbacks.onKeyUp(code);
        };
        const onBlur = () => {
            for (const code of heldKeys) callbacks.onKeyUp(code);
            heldKeys.clear();
            for (const button of heldButtons) cancelPointer(callbacks, button);
            heldButtons.clear();
            for (const id of heldTouches) pointer.cancel(id);
            heldTouches.clear();
            callbacks.onInputCancel?.();
        };
        const onVisibilityChange = () => { if (doc.hidden) onBlur(); };
        const onMouseMove = (e: Event) => {
            const mouse = e as MouseEvent;
            if (mouse.target === el || doc.pointerLockElement === el) {
                callbacks.onPointerMove(mouse.offsetX, mouse.offsetY, mouse.movementX, mouse.movementY);
                return;
            }
            const { left, top, scaleX, scaleY } = surfacePointerFrame(el);
            callbacks.onPointerMove((mouse.clientX - left) * scaleX, (mouse.clientY - top) * scaleY, mouse.movementX, mouse.movementY);
        };
        const onOutsideMouseMove = (e: Event) => {
            // The canvas already receives its own moves, including pointer lock.
            if (!heldButtons.size || e.target === el || doc.pointerLockElement === el || e.composedPath().includes(el)) return;
            onMouseMove(e);
        };
        const onMouseDown = (e: Event) => {
            const mouse = e as MouseEvent;
            heldButtons.add(mouse.button);
            if (mouse.target === el || doc.pointerLockElement === el) {
                callbacks.onPointerDown(mouse.button, mouse.offsetX, mouse.offsetY);
                return;
            }
            const { left, top, scaleX, scaleY } = surfacePointerFrame(el);
            callbacks.onPointerDown(mouse.button, (mouse.clientX - left) * scaleX, (mouse.clientY - top) * scaleY);
        };
        const onMouseUp = (e: Event) => {
            const mouse = e as MouseEvent;
            if (!heldButtons.delete(mouse.button)) return;
            if (doc.pointerLockElement === el) {
                callbacks.onPointerUp(mouse.button);
            } else if (mouse.target === el) {
                callbacks.onPointerUp(mouse.button, mouse.offsetX, mouse.offsetY);
            } else {
                const { left, top, scaleX, scaleY } = surfacePointerFrame(el);
                callbacks.onPointerUp(mouse.button, (mouse.clientX - left) * scaleX, (mouse.clientY - top) * scaleY);
            }
        };
        const pointer = createPrimaryPointer(callbacks);

        const forwardTouches = (e: Event, receive: (id: number, x: number, y: number) => void) => {
            e.preventDefault();
            const te = e as TouchEvent;
            const { left, top, scaleX, scaleY } = surfacePointerFrame(el);
            for (let i = 0; i < te.changedTouches.length; i++) {
                const touch = te.changedTouches[i];
                receive(touch.identifier, (touch.clientX - left) * scaleX, (touch.clientY - top) * scaleY);
            }
        };
        const beginTouch = (id: number, x: number, y: number) => {
            heldTouches.add(id);
            pointer.start(id, x, y);
        };
        const endTouch = (id: number, x: number, y: number) => {
            if (heldTouches.delete(id)) pointer.end(id, x, y);
        };
        const onTouchCancel = (e: Event) => {
            const te = e as TouchEvent;
            for (let i = 0; i < te.changedTouches.length; i++) {
                const id = te.changedTouches[i].identifier;
                if (heldTouches.delete(id)) pointer.cancel(id);
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
                dx *= win.innerWidth;
                dy *= win.innerHeight;
            }
            callbacks.onWheel(dx, dy);
        };

        this.inputBinding_.bind(callbacks, scope => {
            scope.add(onBlur);
            scope.add(() => this.resetGamepadPoll_());
            scope.listen(win, 'blur', onBlur);
            scope.listen(doc, 'visibilitychange', onVisibilityChange);
            scope.listen(doc, 'keydown', onKeyDown);
            scope.listen(doc, 'keyup', onKeyUp);
            scope.listen(doc, 'mouseup', onMouseUp, { capture: true });
            // Offscreen surfaces have no DOM coordinates or pointer target.
            if (typeof el.getBoundingClientRect !== 'function') return;
            if (target && el.ownerDocument) {
                followInputDocument(el, scope, () => {
                    if (this.inputBinding_.owner === callbacks) this.bindInputEvents(callbacks, el);
                });
            }
            // Another DOM control may stop bubbling while a canvas drag crosses it.
            scope.listen(doc, 'mousemove', onOutsideMouseMove, { capture: true });
            scope.listen(el, 'mousemove', onMouseMove);
            scope.listen(el, 'mousedown', onMouseDown);
            scope.listen(el, 'touchstart', e => forwardTouches(e, beginTouch), { passive: false });
            scope.listen(el, 'touchmove', e => forwardTouches(e, pointer.move), { passive: false });
            scope.listen(el, 'touchend', e => forwardTouches(e, endTouch), { passive: false });
            scope.listen(el, 'touchcancel', onTouchCancel);
            scope.listen(el, 'wheel', onWheel);
        });
    }

    unbindInputEvents(owner?: InputEventCallbacks): void {
        this.inputBinding_.unbind(owner);
        if (!owner) this.resetGamepadPoll_(); // Also ends a standalone poll subscription.
    }

    private resetGamepadPoll_(): void {
        this.stopPadEvents_?.();
        this.stopPadEvents_ = undefined;
        this.padsLive_ = false;
        this.padPolls_ = 0;
    }

    /**
     * The pads and their state. `navigator.getGamepads()` is one of the slower calls a frame can make, and nearly every
     * frame of nearly every game has no pad to read: with none known, the browser is asked once in GAMEPAD_LOOK_EVERY polls, and at
     * once when it announces one (`gamepadconnected`). A pad it announced before this page listened is found by that look.
     */
    pollGamepads(): GamepadSnapshot[] {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (!nav || typeof nav.getGamepads !== 'function') return NO_GAMEPADS;
        if (!this.stopPadEvents_ && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            const target = window;
            const connected = () => { this.padsLive_ = true; };
            target.addEventListener('gamepadconnected', connected);
            this.stopPadEvents_ = () => target.removeEventListener('gamepadconnected', connected);
        }
        if (!this.padsLive_ && this.padPolls_++ % GAMEPAD_LOOK_EVERY !== 0) return NO_GAMEPADS;
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
        this.padsLive_ = out.length > 0;
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

    // The content cache, in IndexedDB (webCacheStore.ts): what a page makes and would make again each visit, and what a hot
    // update downloads, kept under the cache's own names.
    hasCacheStorage(): boolean { return webCacheAvailable(); }
    canManageCache(): boolean { return webCacheAvailable(); }
    readCacheFile(key: string): Promise<ArrayBuffer | null> { return webCacheRead(cacheEntryName(key)); }
    writeCacheFile(key: string, bytes: ArrayBuffer): Promise<void> { return webCacheWrite(cacheEntryName(key), bytes); }
    listCacheFiles(): Promise<{ name: string; size: number; lastAccess: number }[]> { return webCacheList(); }
    removeCacheFile(name: string): Promise<void> {
        if (!/^[0-9a-f]{16}$/.test(name)) throw Error('invalid cache entry');
        return webCacheRemove(name);
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

    deviceName(): string {
        return typeof navigator !== 'undefined' ? browserDeviceName(navigator.userAgent) : '';
    }

    isHandheld(): boolean {
        return typeof navigator !== 'undefined' && browserIsHandheld(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    }

    deviceQualityInfo(): { memoryGB?: number; cores?: number } {
        if (typeof navigator === 'undefined') return {};
        return { memoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
            cores: navigator.hardwareConcurrency };
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

/** A browser and the system it runs on, from its user agent. Chrome on Android
 *  no longer names the phone's model there, so this is as close as a page gets. */
/** A phone or a tablet, by its browser. An iPad's Safari says it is a Mac by default; only its touch screen tells them apart. */
export function browserIsHandheld(ua: string, touchPoints: number): boolean {
    return /Android|iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

export function browserDeviceName(ua: string): string {
    const system = /Android/.test(ua) ? 'Android'
        : /iPhone/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) ? 'iPad'
        : /Mac OS X/.test(ua) ? 'Mac'
        : /Windows/.test(ua) ? 'Windows'
        : /Linux/.test(ua) ? 'Linux' : '';
    const browser = /Electron\//.test(ua) ? 'Electron'
        : /Edg\//.test(ua) ? 'Edge'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari' : '';
    return [browser, system].filter(Boolean).join(' · ');
}
