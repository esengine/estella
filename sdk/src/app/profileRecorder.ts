// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profileRecorder.ts — a shipped game recording its own frames.
 */
import type { App, Plugin } from './app';
import { Renderer } from '../render/renderer';
import {
    PROFILE_CAPTURE_VERSION,
    type CaptureSource,
    type CapturedFrame,
    type ProfileCapture,
} from './profileCapture';
import type { ScopeCost } from './frameProfile';

export interface ProfileRecorderOptions {
    /** Frames kept before the oldest is dropped. 1800 is ~30s at 60Hz. */
    maxFrames?: number;
    /** The budget a reader judges the capture against. Defaults to 60Hz. */
    budgetMs?: number;
    /** Device, build, scene — whatever makes a capture identifiable later. */
    source?: CaptureSource;
}

const DEFAULT_MAX_FRAMES = 1800;

/** Chrome only; 0 where the runtime does not expose its heap. */
function jsHeapBytes(): number {
    if (typeof performance === 'undefined') return 0;
    return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
}

function parseScopes(json: string | undefined): Record<string, number> {
    if (!json) return {};
    try {
        return JSON.parse(json) as Record<string, number>;
    } catch {
        return {};
    }
}

function nativeScopesOf(json: string | undefined): ScopeCost[] {
    const raw = parseScopes(json);
    const out: ScopeCost[] = [];
    for (const name in raw) out.push({ name, ms: raw[name], system: '', remainder: 'work' });
    return out;
}

/**
 * Records frames into a capture the game can hand anywhere. Measures nothing of
 * its own, so a capture cannot disagree with the profiler panel; and chooses no
 * destination — `take()` returns an object, the engine opens no socket.
 */
export class ProfileRecorder {
    private readonly app_: App;
    private readonly options_: ProfileRecorderOptions;
    private readonly frames_: CapturedFrame[] = [];
    private recording_ = false;
    private detach_: (() => void) | null = null;
    private seq_ = 0;

    constructor(app: App, options: ProfileRecorderOptions = {}) {
        this.app_ = app;
        this.options_ = options;
    }

    get recording(): boolean {
        return this.recording_;
    }

    get frameCount(): number {
        return this.frames_.length;
    }

    /**
     * Begin recording, turning on the instrumentation it reads — both sides of
     * it, since the C++ scopes are behind their own switch and a capture missing
     * them looks like an engine that costs nothing rather than one not measured.
     */
    start(): void {
        if (this.recording_) return;
        this.frames_.length = 0;
        this.seq_ = 0;
        this.app_.enableStats();
        this.app_.wasmModule?.engine_setCpuProfiling?.(true);
        this.recording_ = true;
        this.detach_ = this.app_.onFrameEnd((dtMs) => this.capture_(dtMs));
    }

    /** Stop recording and put the engine's own profiling back down. */
    stop(): void {
        if (!this.recording_) return;
        this.recording_ = false;
        this.detach_?.();
        this.detach_ = null;
        this.app_.wasmModule?.engine_setCpuProfiling?.(false);
    }

    /** Throw away what has been recorded, keeping the recorder running. */
    clear(): void {
        this.frames_.length = 0;
    }

    /**
     * The capture so far. Recording may continue; the frames are copied out, so
     * the returned document does not change under a reader.
     */
    take(): ProfileCapture {
        return {
            version: PROFILE_CAPTURE_VERSION,
            generatedAt: new Date().toISOString(),
            source: this.options_.source ?? {},
            budgetMs: this.options_.budgetMs ?? 1000 / 60,
            frames: this.frames_.slice(),
        };
    }

    private capture_(dtMs: number): void {
        const costs = this.app_.getFrameCosts();
        if (!costs) return;
        const m = this.app_.wasmModule;
        const render = Renderer.getStats();
        const frame: CapturedFrame = {
            id: this.seq_++,
            dtMs,
            systems: costs.systems,
            scopes: costs.scopes,
            nativeScopes: nativeScopesOf(m?.engine_getCpuScopes?.()),
            gpuMs: m?.renderer_getGpuTimeMs?.() ?? -1,
            counters: parseScopes(m?.engine_getCounters?.()),
            drawCalls: render.drawCalls,
            triangles: render.triangles,
            entities: this.app_.getEntityCount(),
            memory: {
                wasmBytes: m?.HEAPU8?.byteLength ?? 0,
                jsHeapBytes: jsHeapBytes(),
                vramBytes: m?.renderer_getTextureBytes?.() ?? 0,
            },
        };
        this.frames_.push(frame);
        const cap = this.options_.maxFrames ?? DEFAULT_MAX_FRAMES;
        if (this.frames_.length > cap) this.frames_.shift();
    }
}

/**
 * Installs a {@link ProfileRecorder} and hands it to the game. Recording is NOT
 * started: a shipped build pays for the instrumentation only from the moment
 * something asks it to.
 */
export class ProfileRecorderPlugin implements Plugin {
    readonly name = 'profileRecorder';
    readonly profileDomain = 'diagnostics';
    private recorder_: ProfileRecorder | null = null;

    constructor(
        private readonly options_: ProfileRecorderOptions = {},
        private readonly onReady_?: (recorder: ProfileRecorder) => void,
    ) {}

    /** The recorder, once the plugin has been built into an App. */
    get recorder(): ProfileRecorder | null {
        return this.recorder_;
    }

    build(app: App): void {
        this.recorder_ = new ProfileRecorder(app, this.options_);
        this.onReady_?.(this.recorder_);
    }

    cleanup(): void {
        this.recorder_?.stop();
        this.recorder_ = null;
    }
}
