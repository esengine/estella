// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureStreaming.ts
 * @brief   Holds each mesh texture at the size its views need, within the quality level's budget.
 *
 * @details The renderer says, for every texture a scene view drew a mesh with, how many texels across it needs for a texel to be about
 *          a pixel there (MeshPlugin, read through `renderer_takeTextureWants`). Four times a second this turns that into a size per
 *          texture — the next power of two above the need, never below `minEdge` nor above the file — and moves the textures that are
 *          the wrong size: decoded again from their file at the new size and put behind the same handle, so every material and
 *          renderer holding the handle sees it at once. A texture grows as soon as it is needed bigger and shrinks only after it has
 *          been needed smaller for a while, so a camera passing by does not make it go back and forth.
 *
 *          What it streams: textures decoded from a file that only meshes draw. A texture a sprite, a UI element, a tilemap, a particle
 *          or a trail also draws is left at its size, since nothing measures what those need. What it saves is GPU memory; a texture is
 *          still read and decoded whole from its file the first time, so it saves neither the download nor the decode. A KTX2 file
 *          is cut at a level and not decoded again.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { getComponent } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { engineApi } from '../ecs/bridge/engineApi';
import { getTextureDimensions } from '../wasm/resourceManager';
import { platformNow } from '../platform';
import { Quality } from './qualityRuntime';

/** What the streamer keeps of one texture. @experimental */
export interface StreamedTexture {
    handle: number;
    /** The file's own size. */
    fullWidth: number;
    fullHeight: number;
    /** The longer side it is held at now. */
    edge: number;
    /** The most texels across a view asked for lately; 0 when none has drawn it for `unseenAfter`. */
    wanted: number;
    /** When a view last drew it, ms. */
    seenAt: number;
    /** Since when the size it should be has been smaller than the one it is, ms; -1 when it has not. */
    smallerSince: number;
}

/** @experimental */
export interface TextureStreamingOptions {
    /** No texture is held smaller than this on its longer side. */
    minEdge: number;
    /** The bytes the streamed textures may hold together; 0 is no cap. */
    budgetBytes: number;
    /** How long a texture must be needed smaller before it shrinks, ms. */
    shrinkAfter: number;
    /** How long a texture no view draws keeps the size it was needed at, ms; then it goes to `minEdge`. */
    unseenAfter: number;
}

/** @experimental */
export const TEXTURE_STREAMING_DEFAULTS: TextureStreamingOptions = { minEdge: 64, budgetBytes: 0, shrinkAfter: 3000, unseenAfter: 5000 };

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** The longer side a texture should be held at: the next power of two above what is wanted, between `minEdge` and the file. @experimental */
export function streamTargetEdge(fullEdge: number, wanted: number, minEdge: number): number {
    if (!(wanted > 0)) return Math.min(fullEdge, minEdge);
    return Math.min(fullEdge, Math.max(minEdge, nextPow2(wanted)));
}

/** The bytes a texture held at `edge` on its longer side takes, with its chain, at four bytes a texel. @experimental */
export function streamedBytes(fullWidth: number, fullHeight: number, edge: number): number {
    const k = Math.min(1, edge / Math.max(fullWidth, fullHeight));
    const w = Math.max(1, Math.round(fullWidth * k)), h = Math.max(1, Math.round(fullHeight * k));
    return Math.round(w * h * 4 * 4 / 3);
}

/** A size to move a texture to. @experimental */
export interface StreamMove {
    handle: number;
    edge: number;
}

/**
 * What to move now: every texture whose size should change, the growing ones first and the most starved of those first, then the
 * shrinking ones. With a budget, the sizes are first brought within it by halving the largest, so a scene that needs more than the
 * budget is drawn a level softer rather than over it. Writes `smallerSince` on the entries it judges.
 *
 * @experimental
 */
export function planStreaming(entries: readonly StreamedTexture[], now: number, options: TextureStreamingOptions): StreamMove[] {
    const target = new Map<number, number>();
    for (const e of entries) {
        const wanted = now - e.seenAt > options.unseenAfter ? 0 : e.wanted;
        target.set(e.handle, streamTargetEdge(Math.max(e.fullWidth, e.fullHeight), wanted, options.minEdge));
    }
    if (options.budgetBytes > 0) {
        let total = 0;
        for (const e of entries) total += streamedBytes(e.fullWidth, e.fullHeight, target.get(e.handle)!);
        while (total > options.budgetBytes) {
            let worst: StreamedTexture | null = null, worstBytes = 0;
            for (const e of entries) {
                const edge = target.get(e.handle)!;
                if (edge <= options.minEdge) continue;
                const b = streamedBytes(e.fullWidth, e.fullHeight, edge);
                if (b > worstBytes) { worst = e; worstBytes = b; }
            }
            if (!worst) break;
            const halved = Math.max(options.minEdge, target.get(worst.handle)! / 2);
            total += streamedBytes(worst.fullWidth, worst.fullHeight, halved) - worstBytes;
            target.set(worst.handle, halved);
        }
    }
    const grow: Array<StreamMove & { starved: number }> = [];
    const shrink: StreamMove[] = [];
    for (const e of entries) {
        const edge = target.get(e.handle)!;
        if (edge > e.edge) {
            e.smallerSince = -1;
            grow.push({ handle: e.handle, edge, starved: edge / e.edge });
        } else if (edge < e.edge) {
            if (e.smallerSince < 0) e.smallerSince = now;
            if (now - e.smallerSince >= options.shrinkAfter) shrink.push({ handle: e.handle, edge });
        } else {
            e.smallerSince = -1;
        }
    }
    grow.sort((a, b) => b.starved - a.starved);
    return [...grow.map(({ handle, edge }) => ({ handle, edge })), ...shrink];
}

/** What streaming is doing, for a profiler and a check. @experimental */
export class TextureStreaming {
    readonly textures = new Map<number, StreamedTexture>();
    /** Textures something other than a mesh draws, left at their size. */
    readonly held = new Set<number>();
    /** Textures that came back larger than asked (a host that cannot cut a file at a level): left alone from then on. */
    readonly refused = new Set<number>();
    moves = 0;
    failures = 0;
    inFlight = 0;
    enabled = false;

    /** The bytes the streamed textures take now, and would at their files' sizes. */
    bytes(): { now: number; full: number } {
        let now = 0, full = 0;
        for (const t of this.textures.values()) {
            now += streamedBytes(t.fullWidth, t.fullHeight, t.edge);
            full += streamedBytes(t.fullWidth, t.fullHeight, Math.max(t.fullWidth, t.fullHeight));
        }
        return { now, full };
    }
}

/** @experimental */
export const TextureStreamingRes = defineResource<TextureStreaming>(new TextureStreaming(), 'TextureStreaming');

/** Components whose `texture` field draws a texture no view measures the need of. */
const UNMEASURED = ['Sprite', 'UIVisual', 'TilemapLayer', 'ParticleEmitter', 'TrailRenderer', 'SpriteMask'];

/** @experimental */
export class TextureStreamingPlugin implements Plugin {
    name = 'textureStreaming';

    build(app: App): void {
        const state = new TextureStreaming();
        app.insertResource(TextureStreamingRes, state);
        const world = app.world;
        let last = 0, lastHeld = -Infinity;
        const MAX_IN_FLIGHT = 2;

        const parse = (raw: string): Map<number, number> => {
            const out = new Map<number, number>();
            if (!raw) return out;
            for (const pair of raw.split(',')) {
                const cut = pair.indexOf(':');
                if (cut > 0) out.set(Number(pair.slice(0, cut)), Number(pair.slice(cut + 1)));
            }
            return out;
        };

        const refreshHeld = (): void => {
            state.held.clear();
            for (const name of UNMEASURED) {
                const def = getComponent(name);
                if (!def) continue;
                for (const e of world.getEntitiesWithComponents([def])) {
                    const t = (world.get(e, def) as { texture?: number }).texture;
                    if (typeof t === 'number' && t > 0) state.held.add(t);
                }
            }
        };

        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => {
            const quality = app.hasResource(Quality) ? app.getResource(Quality) : null;
            const profile = quality?.profile;
            state.enabled = !!profile?.textureStreaming;
            const api = engineApi(app);
            if (!state.enabled || !api?.renderer_takeTextureWants || !app.hasResource(Assets)) return;
            const now = platformNow();
            if (now - last < 250) return;
            last = now;
            if (now - lastHeld > 2000) { refreshHeld(); lastHeld = now; }

            const assets = app.getResource(Assets);
            for (const [handle, side] of parse(api.renderer_takeTextureWants())) {
                if (state.held.has(handle)) { state.textures.delete(handle); continue; }
                if (state.refused.has(handle)) continue;
                let entry = state.textures.get(handle);
                if (!entry) {
                    if (!assets.textureResizable(handle)) continue;
                    const size = getTextureDimensions(handle);
                    if (!size || size.width <= 0 || size.height <= 0) continue;
                    entry = { handle, fullWidth: size.width, fullHeight: size.height, edge: Math.max(size.width, size.height), wanted: 0, seenAt: now, smallerSince: -1 };
                    state.textures.set(handle, entry);
                }
                entry.wanted = entry.seenAt === now ? Math.max(entry.wanted, side) : side;
                entry.seenAt = now;
            }
            for (const handle of state.held) state.textures.delete(handle);

            const options: TextureStreamingOptions = {
                ...TEXTURE_STREAMING_DEFAULTS,
                budgetBytes: Math.max(0, profile!.textureStreamingBudget) * 1024 * 1024,
            };
            for (const move of planStreaming([...state.textures.values()], now, options)) {
                if (state.inFlight >= MAX_IN_FLIGHT) break;
                const entry = state.textures.get(move.handle)!;
                const full = Math.max(entry.fullWidth, entry.fullHeight);
                state.inFlight++;
                const was = entry.edge;
                entry.edge = move.edge;  // claimed now, so the next pass does not ask again while this one decodes
                void assets.resizeTexture(move.handle, move.edge >= full ? 0 : move.edge).then((size) => {
                    if (size && Math.max(size.width, size.height) > move.edge && move.edge < full) {
                        // It could not be made that small, and asking again would decode it again for nothing.
                        entry.edge = Math.max(size.width, size.height);
                        state.refused.add(move.handle);
                        state.textures.delete(move.handle);
                    } else if (size) { entry.edge = Math.max(size.width, size.height); state.moves++; }
                    else { entry.edge = was; state.failures++; state.textures.delete(move.handle); }
                }, () => { entry.edge = was; state.failures++; state.textures.delete(move.handle); })
                    .finally(() => { state.inFlight--; });
            }
        }, { name: 'TextureStreamingSystem' }), { runIf: playModeOnly });
    }
}

/** @experimental */
export const textureStreamingPlugin: Plugin = new TextureStreamingPlugin();
