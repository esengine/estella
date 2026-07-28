// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    adapter.ts
 * @brief   The mini-game platform adapter family.
 *
 * ONE implementation of `PlatformAdapter` shared by every mini-game vendor. It
 * reads `profile.global` for the shared capabilities (canvas, fs, fetch, image,
 * input, storage, subpackage, memory-warning, DPR, language) and delegates the
 * genuine per-vendor divergences (WASM, audio, video, sockets) to the profile.
 *
 * Adding a vendor = one `MiniGameProfile`, not a parallel adapter.
 */

import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
    InputEventCallbacks,
    ImageLoadResult,
    PlatformCanvas,
    PlatformImage,
    PlatformSocket,
    PlatformSocketOptions,
} from '../types';
import type { PlatformAudioBackend } from '../../audio/PlatformAudioBackend';
import type { PlatformVideoBackend, VideoBackendContext } from '../../video/PlatformVideoBackend';
import { toBuildPath } from '../../assetTypes';
import { log } from '../../util/logger';
import type { MiniGameGlobal, MiniGameProfile, MiniGameCanvas, MiniGameFileSystemManager, MiniGameTouchEvent } from './api';
import { createPrimaryPointer } from '../primaryPointer';
import { mgReadFileSync, mgReadTextFileSync, mgFileExistsSync } from './fs';
import { mgLoadImagePixels } from './image';
import { mgFetch } from './fetch';
import { MiniGameAudioBackend } from '../../audio/MiniGameAudioBackend';
import { MiniGameSocket } from '../../net/MiniGameSocket';
import { WasmVideoBackend } from '../../video/WasmVideoBackend';

export class MiniGamePlatformAdapter implements PlatformAdapter {
    readonly name: PlatformAdapter['name'];
    /** Every vendor built on this adapter answers `isMiniGame()` — no name list. */
    readonly family = 'minigame' as const;

    private readonly profile_: MiniGameProfile;
    private readonly g_: MiniGameGlobal;
    private fs_: MiniGameFileSystemManager | null = null;
    private inputCleanup_: (() => void) | null = null;

    constructor(profile: MiniGameProfile) {
        this.profile_ = profile;
        this.g_ = profile.global;
        this.name = profile.id;
    }

    private fs(): MiniGameFileSystemManager {
        if (!this.fs_) this.fs_ = this.g_.getFileSystemManager();
        return this.fs_;
    }

    async fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
        return mgFetch(this.g_, url, options);
    }

    async readFile(path: string): Promise<ArrayBuffer> {
        return mgReadFileSync(this.fs(), toBuildPath(path), this.profile_.hostLabel);
    }

    async readTextFile(path: string): Promise<string> {
        return mgReadTextFileSync(this.fs(), toBuildPath(path), this.profile_.hostLabel);
    }

    async fileExists(path: string): Promise<boolean> {
        return mgFileExistsSync(this.fs(), toBuildPath(path));
    }

    async loadImagePixels(path: string): Promise<ImageLoadResult> {
        return mgLoadImagePixels(this.g_, path);
    }

    async instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports,
    ): Promise<WasmInstantiateResult> {
        if (this.profile_.instantiateWasm) return this.profile_.instantiateWasm(pathOrBuffer, imports);
        // Family default: standard WebAssembly over the packaged filesystem. A
        // path is read through the host fs first — mini-game packages ship the
        // binary as a file, and there is no `fetch` to stream it from.
        const bytes = typeof pathOrBuffer === 'string' ? await this.readFile(pathOrBuffer) : pathOrBuffer;
        return WebAssembly.instantiate(bytes, imports);
    }

    createImage(): PlatformImage {
        // MiniGameImage is structurally assignable to PlatformImage (crossOrigin is
        // optional, its handlers fit the neutral optional-arg shape) — no cast.
        return this.g_.createImage();
    }

    /** Download an on-demand subpackage so its files become readable. */
    loadSubpackage(name: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const load = this.g_.loadSubpackage;
            if (!load) {
                resolve();
                return;
            }
            load.call(this.g_, {
                name,
                success: () => resolve(),
                fail: (err: unknown) =>
                    reject(new Error(`loadSubpackage("${name}") failed: ${JSON.stringify(err)}`)),
                complete: () => {},
            });
        });
    }

    onMemoryWarning(callback: () => void): () => void {
        const on = this.g_.onMemoryWarning;
        const off = this.g_.offMemoryWarning;
        if (!on) return () => {};
        const listener = () => callback();
        on.call(this.g_, listener);
        return () => off?.call(this.g_, listener);
    }

    createCanvas(width: number, height: number): PlatformCanvas {
        // One honest cast: MiniGameCanvas.getContext returns `unknown`, so it is not
        // structurally assignable to PlatformCanvas's typed 2D getContext.
        const canvas = this.g_.createCanvas() as unknown as PlatformCanvas;
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    /**
     * The ON-SCREEN canvas, sized to the device viewport.
     *
     * Distinct from {@link createCanvas}, which makes offscreen 2D surfaces for
     * image decode and glyph rasterization: on every mini-game host the FIRST
     * `createCanvas()` of the process returns the display canvas, and the render
     * surface is the GL context taken from it. The runtime calls this once at
     * boot, before anything else touches createCanvas.
     */
    createScreenCanvas(): MiniGameCanvas {
        const canvas = this.g_.createCanvas();
        const info = this.g_.getSystemInfoSync();
        const dpr = info.pixelRatio ?? 1;
        // Left at the host's own default when the info is incomplete — a 0×0
        // surface would be worse than the host's guess.
        if (info.windowWidth) canvas.width = info.windowWidth * dpr;
        if (info.windowHeight) canvas.height = info.windowHeight * dpr;
        return canvas;
    }

    now(): number {
        return Date.now();
    }

    bindInputEvents(callbacks: InputEventCallbacks, _target?: unknown): void {
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }

        const g = this.g_;

        const onKeyDown = (res: { code: string }) => callbacks.onKeyDown(res.code);
        const onKeyUp = (res: { code: string }) => callbacks.onKeyUp(res.code);

        const hasKeyboard = typeof g.onKeyDown === 'function';
        if (hasKeyboard) {
            g.onKeyDown?.(onKeyDown);
            g.onKeyUp?.(onKeyUp);
        }

        const pointer = createPrimaryPointer(callbacks);

        const onTouchStart = (res: MiniGameTouchEvent) => {
            for (const touch of res.changedTouches) pointer.start(touch.identifier, touch.clientX, touch.clientY);
        };
        const onTouchMove = (res: MiniGameTouchEvent) => {
            for (const touch of res.changedTouches) pointer.move(touch.identifier, touch.clientX, touch.clientY);
        };
        const onTouchEnd = (res: MiniGameTouchEvent) => {
            for (const touch of res.changedTouches) pointer.end(touch.identifier);
        };
        const onTouchCancel = (res: MiniGameTouchEvent) => {
            for (const touch of res.changedTouches) pointer.cancel(touch.identifier);
        };

        g.onTouchStart(onTouchStart);
        g.onTouchMove(onTouchMove);
        g.onTouchEnd(onTouchEnd);
        g.onTouchCancel?.(onTouchCancel);

        this.inputCleanup_ = () => {
            if (hasKeyboard) {
                g.offKeyDown?.(onKeyDown);
                g.offKeyUp?.(onKeyUp);
            }
            g.offTouchStart(onTouchStart);
            g.offTouchMove(onTouchMove);
            g.offTouchEnd(onTouchEnd);
            g.offTouchCancel?.(onTouchCancel);
        };
    }

    unbindInputEvents(): void {
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }
    }

    createAudioBackend(): PlatformAudioBackend {
        return this.profile_.createAudioBackend?.() ?? new MiniGameAudioBackend(this.g_, this.profile_.hostLabel);
    }

    createVideoBackend(ctx: VideoBackendContext): PlatformVideoBackend {
        // The engine-owned wasm decoder is the family default on every vendor:
        // host video decoders are absent on desktop clients and unreliable on
        // phones (per-device staging, null frames, no playhead), so the
        // deterministic single path wins even where one exists.
        return this.profile_.createVideoBackend?.(ctx) ?? new WasmVideoBackend(ctx);
    }

    createSocket(options: PlatformSocketOptions): PlatformSocket {
        return this.profile_.createSocket?.(options) ?? new MiniGameSocket(options, this.g_);
    }

    getStorageItem(key: string): string | null {
        try {
            const value = this.g_.getStorageSync(key);
            return typeof value === 'string' ? value : null;
        } catch {
            return null;
        }
    }

    setStorageItem(key: string, value: string): void {
        try {
            this.g_.setStorageSync(key, value);
        } catch (e) {
            log.warn(this.profile_.id, 'setStorageSync failed', e);
        }
    }

    removeStorageItem(key: string): void {
        try {
            this.g_.removeStorageSync(key);
        } catch (e) {
            log.warn(this.profile_.id, 'removeStorageSync failed', e);
        }
    }

    devicePixelRatio(): number {
        try {
            return this.g_.getSystemInfoSync?.()?.pixelRatio ?? 1;
        } catch {
            return 1;
        }
    }

    language(): string {
        try {
            // Hosts report 'zh_CN'-style tags; platformLanguage() normalizes underscores.
            return this.g_.getSystemInfoSync?.()?.language ?? 'en';
        } catch {
            return 'en';
        }
    }

    clearStorage(prefix: string): void {
        try {
            const { keys } = this.g_.getStorageInfoSync();
            for (const k of keys) {
                if (k.startsWith(prefix)) {
                    this.g_.removeStorageSync(k);
                }
            }
        } catch (e) {
            log.warn(this.profile_.id, 'clearStorage failed', e);
        }
    }
}
