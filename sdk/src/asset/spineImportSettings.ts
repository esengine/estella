// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset/spineImportSettings.ts
 * @brief   The `.meta` importer block → a spine asset's culling contract.
 *
 * One parser, because there is one source: the importer block the asset
 * inspector edits and the cook copies into the ship manifest.
 *
 * A contract is a rectangle AND the atlas it was promised against, and the type
 * says so rather than leaving them two optional fields. A spine asset is a
 * PAIR — an atlas decides how its regions were trimmed and so what geometry the
 * attachments end up with — so a rectangle with no atlas beside it is a promise
 * about nothing in particular. Recording the atlas at authoring time is also
 * what makes the promise stop applying when somebody re-points the skeleton at
 * a different one, which is the direction this has to fail in.
 */

/** A rectangle in the skeleton's own space, as the `.meta` stores it. */
export interface SpineCullingRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** What an author promised, and what they promised it about. */
export interface SpineCullingContract {
    bounds: SpineCullingRect;
    /** The atlas ref the promise was recorded against. */
    atlas: string;
}

function readBounds(raw: unknown): SpineCullingRect | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const b = raw as Record<string, unknown>;
    const n = (v: unknown): number | null =>
        (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const x = n(b.x);
    const y = n(b.y);
    const width = n(b.width);
    const height = n(b.height);
    if (x === null || y === null || width === null || height === null) return undefined;
    // A rectangle of no area promises that nothing is drawn, which is a promise
    // nobody means to make; an incomplete block is not a contract either.
    if (width <= 0 || height <= 0) return undefined;
    return { x, y, width, height };
}

/**
 * Parse an importer block; undefined when it carries no contract.
 *
 * Both halves or neither: a fresh `.meta` carries every declared setting's
 * default, so the state "no contract" is a zero-area rectangle and an empty
 * atlas rather than absent keys — and half a contract is not one.
 */
export function spineCullingContractFrom(
    importer: Record<string, unknown> | undefined | null,
): SpineCullingContract | undefined {
    if (!importer) return undefined;
    const bounds = readBounds(importer.cullingBounds);
    const atlas = typeof importer.cullingAtlas === 'string' ? importer.cullingAtlas.trim() : '';
    return bounds && atlas ? { bounds, atlas } : undefined;
}

/** What the manifest ships for a skeleton: the rectangle, and the atlas as this
 *  build's own asset key. */
export interface SpineManifestContract {
    cullingBounds: SpineCullingRect;
    atlas: string;
}

/**
 * One skeleton's `.meta` → the manifest entry, or undefined. ONE function for
 * every writer, because two is how "works in Play, not in the build" is born.
 *
 * `keyOfRef` turns the recorded atlas into this build's key; a contract naming
 * an atlas this build does not ship is dropped.
 */
export function spineManifestContractFrom(
    importer: Record<string, unknown> | undefined | null,
    keyOfRef: (ref: string) => string | undefined,
): SpineManifestContract | undefined {
    const contract = spineCullingContractFrom(importer);
    if (!contract) return undefined;
    const atlas = keyOfRef(contract.atlas);
    return atlas ? { cullingBounds: contract.bounds, atlas } : undefined;
}
