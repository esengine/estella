// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profileCapture.ts — recorded frames as a portable document.
 */
import {
    buildFrameProfile,
    meanFrameProfile,
    type FrameProfile,
    type ScopeCost,
    type SystemCost,
} from './frameProfile';

/** Bumped when a reader can no longer make sense of an older file. */
export const PROFILE_CAPTURE_VERSION = 1;

/** Where a capture came from. Every field optional: a bare App knows none of it. */
export interface CaptureSource {
    /** 'edit' / 'play' in the editor; a shipped build names its platform. */
    realm?: string;
    engineVersion?: string;
    platform?: string;
    gpu?: string;
    /** Free-form: device model, build id, the scene under test. */
    label?: string;
}

/**
 * One frame, in the terms the profile model reads. Deliberately the same
 * vocabulary a live frame is measured in, so a capture needs no translation
 * and no reader can drift from what the panel shows.
 */
export interface CapturedFrame {
    id: number;
    dtMs: number;
    systems: SystemCost[];
    scopes: ScopeCost[];
    /** Scopes measured inside wasm. */
    nativeScopes?: ScopeCost[];
    /** -1 when no GPU timer answered. */
    gpuMs?: number;
    counters?: Record<string, number>;
    drawCalls?: number;
    triangles?: number;
    entities?: number;
    memory?: { wasmBytes?: number; jsHeapBytes?: number; vramBytes?: number };
    /** Editor-only. Absent from anything a shipped game records. */
    editor?: { ms: number; phases: Record<string, number> };
}

export interface ProfileCapture {
    version: number;
    generatedAt: string;
    source: CaptureSource;
    /** The frame budget the capture was judged against (ms). */
    budgetMs: number;
    frames: CapturedFrame[];
    /** Main-thread long tasks, for correlating a spike the frames cannot explain. */
    longTasks?: Array<{ startMs: number; ms: number; name: string }>;
}

/** What a set of frames came to. The one summary every reader shows. */
export interface CaptureSummary {
    frames: number;
    budgetMs: number;
    fps: number;
    p50: number;
    p95: number;
    p99: number;
    /** Frames over the budget by half again — a visible stutter. */
    longFrames: number;
    worstFrameMs: number;
    worstFrameId: number | null;
    /** The window's cost, per frame. */
    mean: FrameProfile;
    drawCalls: number;
    triangles: number;
    entities: number;
    /** Named counters, averaged per frame. */
    counters: Record<string, number>;
}

/** p-th percentile (0..100) of an unsorted sample; 0 for an empty set. */
export function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
    return s[i];
}

/** Fold one captured frame into its cost tree. */
export function frameProfileOf(frame: CapturedFrame): FrameProfile {
    return buildFrameProfile({
        frameMs: frame.dtMs,
        systems: frame.systems,
        scopes: frame.scopes,
        nativeScopes: frame.nativeScopes,
        gpuMs: frame.gpuMs,
    });
}

function meanOf(frames: readonly CapturedFrame[], pick: (f: CapturedFrame) => number): number {
    if (frames.length === 0) return 0;
    let total = 0;
    for (const f of frames) total += pick(f);
    return total / frames.length;
}

/**
 * Summarize frames the way every reader wants them: the live window an agent
 * asks for, an imported file, and a report a shipped build hands back all go
 * through here, so none of them can compute a different fps from the same frames.
 */
export function summarizeFrames(frames: readonly CapturedFrame[], budgetMs = 1000 / 60): CaptureSummary {
    const dts = frames.map((f) => f.dtMs);
    const p50 = percentile(dts, 50);
    let worst: CapturedFrame | null = null;
    for (const f of frames) if (!worst || f.dtMs > worst.dtMs) worst = f;

    const counters: Record<string, number> = {};
    for (const f of frames) {
        for (const k in f.counters) counters[k] = (counters[k] ?? 0) + f.counters[k];
    }
    if (frames.length > 0) for (const k in counters) counters[k] /= frames.length;

    return {
        frames: frames.length,
        budgetMs,
        fps: p50 > 0 ? Math.round(1000 / p50) : 0,
        p50,
        p95: percentile(dts, 95),
        p99: percentile(dts, 99),
        longFrames: dts.filter((d) => d >= budgetMs * 1.5).length,
        worstFrameMs: worst ? worst.dtMs : 0,
        worstFrameId: worst ? worst.id : null,
        mean: meanFrameProfile(frames.map(frameProfileOf)),
        drawCalls: meanOf(frames, (f) => f.drawCalls ?? 0),
        triangles: meanOf(frames, (f) => f.triangles ?? 0),
        entities: meanOf(frames, (f) => f.entities ?? 0),
        counters,
    };
}

export function summarizeCapture(capture: ProfileCapture): CaptureSummary {
    return summarizeFrames(capture.frames, capture.budgetMs);
}

/**
 * Read a capture from JSON, or say what is wrong with it. Returns a refusal
 * rather than throwing so a UI can show the reason: a file picked by hand is
 * the one input guaranteed to sometimes be the wrong file.
 */
export function parseProfileCapture(text: string): { capture: ProfileCapture } | { error: string } {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return { error: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (typeof raw !== 'object' || raw === null) return { error: 'not a capture (expected an object)' };
    const c = raw as Partial<ProfileCapture>;
    if (typeof c.version !== 'number') return { error: 'not a capture (no version)' };
    if (c.version > PROFILE_CAPTURE_VERSION) {
        return { error: `capture version ${c.version} is newer than this editor reads (${PROFILE_CAPTURE_VERSION})` };
    }
    if (!Array.isArray(c.frames)) return { error: 'not a capture (no frames)' };
    for (const f of c.frames) {
        if (typeof f?.dtMs !== 'number' || !Array.isArray(f?.systems) || !Array.isArray(f?.scopes)) {
            return { error: 'frames are not in the capture format (need dtMs, systems, scopes)' };
        }
    }
    return {
        capture: {
            version: c.version,
            generatedAt: typeof c.generatedAt === 'string' ? c.generatedAt : '',
            source: (c.source ?? {}) as CaptureSource,
            budgetMs: typeof c.budgetMs === 'number' && c.budgetMs > 0 ? c.budgetMs : 1000 / 60,
            frames: c.frames,
            longTasks: Array.isArray(c.longTasks) ? c.longTasks : undefined,
        },
    };
}
