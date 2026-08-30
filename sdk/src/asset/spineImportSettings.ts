// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset/spineImportSettings.ts
 * @brief   The `.meta` importer block → a spine asset's culling contract.
 *
 * One parser, because there is one source: the importer block the asset
 * inspector edits and the cook copies into the ship manifest. What it carries
 * is a PROMISE — no pose of this skeleton leaves this rectangle — so what is
 * stored is the rectangle and nothing about where it came from. Whether a scan
 * proposed it is the editor's business; the runtime only needs to know whether
 * somebody made the promise.
 */

/** The rectangle a spine asset promises to stay inside, in skeleton space. */
export interface ParsedSpineImportSettings {
    cullingBounds?: { x: number; y: number; width: number; height: number };
}

function readBounds(raw: unknown): ParsedSpineImportSettings['cullingBounds'] {
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

/** Parse an importer block; undefined when it carries no contract. */
export function spineImportSettingsFrom(
    importer: Record<string, unknown> | undefined | null,
): ParsedSpineImportSettings | undefined {
    if (!importer) return undefined;
    const cullingBounds = readBounds(importer.cullingBounds);
    return cullingBounds ? { cullingBounds } : undefined;
}
