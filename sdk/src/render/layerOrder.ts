// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layerOrder.ts
 * @brief   How a sorting layer resolves the draws inside it — the JS mirror of
 *          the engine's `DrawList::layerOrder` (src/esengine/renderer/draw).
 *
 * The renderer decides this from two bitmasks and nothing else. Anything that has
 * to AGREE with what was drawn — the editor's picking, a gizmo that ranks
 * overlapping entities, a future runtime hit-test — has to ask the same question
 * of the same two masks, or it answers about a different image than the one on
 * screen. One rule, mirrored once, rather than each caller's idea of "on top".
 */

/** How one sorting layer resolves the draws inside it. */
export enum LayerOrder {
    /** Submission order, tie-broken by depth: the 2D default. */
    Painter = 0,
    /** World Y within the layer — lower on screen draws on top. */
    YSort = 1,
    /** The depth buffer, from each entity's z — the 2.5D opt-in. */
    Depth = 2,
}

/**
 * The one answer for @p layer, from two masks that are two spellings of the same
 * question. Y-sort is a depth PROJECTED from world Y and depth is the real thing,
 * so a layer declaring both has said two contradictory things: y-sort wins, which
 * is what the engine does, so a project that had it renders as it did. Layers
 * outside 0..31 have no bit and are therefore painter-ordered.
 */
export function layerOrderOf(layer: number, ySortMask: number, depthMask: number): LayerOrder {
    if (!Number.isInteger(layer) || layer < 0 || layer >= 32) return LayerOrder.Painter;
    const bit = 1 << layer;
    if ((ySortMask & bit) !== 0) return LayerOrder.YSort;
    if ((depthMask & bit) !== 0) return LayerOrder.Depth;
    return LayerOrder.Painter;
}

/**
 * How far in FRONT a draw sits within its layer — larger is nearer the viewer,
 * so ranking by this descending is "topmost first".
 *
 * The camera looks down -z, so a larger z is nearer; under y-sort the projected
 * depth is world Y inverted (lower on screen = nearer). Painter layers still
 * answer by z because the engine's sort key tie-breaks on it, and a scene that
 * puts one sprite in front of another with z means it — this is exactly the
 * ordering a person sees.
 */
export function layerFrontness(order: LayerOrder, worldY: number, worldZ: number): number {
    return order === LayerOrder.YSort ? -worldY : worldZ;
}

/** What a draw's place in the frame depends on: its layer, that layer's rule, and
 *  the two world coordinates either rule can be about. */
export interface DrawRank {
    layer: number;
    order: LayerOrder;
    worldY: number;
    worldZ: number;
}

/**
 * Positive when @p a ended up in FRONT of @p b — the order the frame resolved,
 * for anything that has to answer "which of these is on top" outside the renderer.
 *
 * The sorting layer normally decides, because a higher layer is simply painted
 * later. Two DEPTH layers are the exception, and not a special case bolted on: a
 * depth layer resolves per PIXEL, so an opaque draw at a nearer z occludes what a
 * later layer puts over it — that is the whole point of the 2.5D opt-in, and it is
 * what a paired pixel check proves (near sprite in the LOWER layer, still in
 * front). Ranking those two by layer would answer with the sprite that the depth
 * buffer rejected.
 */
export function compareDrawRank(a: DrawRank, b: DrawRank): number {
    if (a.order === LayerOrder.Depth && b.order === LayerOrder.Depth) return a.worldZ - b.worldZ;
    if (a.layer !== b.layer) return a.layer - b.layer;
    return layerFrontness(a.order, a.worldY, a.worldZ) - layerFrontness(b.order, b.worldY, b.worldZ);
}

/** One entity under the pointer, with everything its rank depends on. */
export interface PickCandidate<T> {
    entity: T;
    /** Where the frame put it: layer, that layer's rule, and the world coords it uses. */
    rank: DrawRank;
    /** Position in the World's iteration order: the paint order for equal depth. */
    index: number;
}

/**
 * Candidates ranked topmost-first, the way the RENDERER stacked them — the layer
 * rules via {@link compareDrawRank}, then later-drawn winning ties. Backwards
 * means a click selects what is hidden behind what the person aimed at.
 */
export function rankPickCandidates<T>(candidates: ReadonlyArray<PickCandidate<T>>): T[] {
    return [...candidates]
        .sort((a, b) => compareDrawRank(b.rank, a.rank) || b.index - a.index)
        .map((c) => c.entity);
}
