// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset/textureImportSettings.ts
 * @brief   The `.meta` importer block → {@link TextureImportSettings}.
 *
 * One parser, because there is one source: the importer block the asset
 * inspector edits, which the cook copies verbatim into the ship manifest. The
 * editor reads it from its own asset database and the runtime from the
 * AssetRegistry, but they must agree on what it MEANS — a second reader is how
 * "works in the editor, not in the build" gets born.
 */

/** Import-time texture settings, as the loader consumes them. */
export interface ParsedTextureImportSettings {
    filter?: 'linear' | 'nearest';
    wrap?: 'repeat' | 'clamp' | 'mirror';
    srgb?: boolean;
    sliceBorder?: { left: number; right: number; top: number; bottom: number };
}

/**
 * A 9-slice border, or undefined when the block slices nothing. All-zero is the
 * "not 9-sliced" default and must NOT be stamped onto the texture: doing so
 * would clear a border another consumer authored.
 */
function readSliceBorder(raw: unknown): ParsedTextureImportSettings['sliceBorder'] {
    if (!raw || typeof raw !== 'object') return undefined;
    const b = raw as Record<string, unknown>;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    const border = { left: n(b.left), right: n(b.right), top: n(b.top), bottom: n(b.bottom) };
    return border.left || border.right || border.top || border.bottom ? border : undefined;
}

/** Parse an importer block; undefined when it carries nothing the loader needs. */
export function textureImportSettingsFrom(
    importer: Record<string, unknown> | undefined | null,
): ParsedTextureImportSettings | undefined {
    if (!importer) return undefined;
    const filter = importer.filterMode === 'nearest' || importer.filterMode === 'linear'
        ? importer.filterMode
        : undefined;
    const wrap = importer.wrapMode === 'repeat' || importer.wrapMode === 'clamp' || importer.wrapMode === 'mirror'
        ? importer.wrapMode
        : undefined;
    const srgb = typeof importer.sRGB === 'boolean' ? importer.sRGB : undefined;
    const sliceBorder = readSliceBorder(importer.sliceBorder);
    return filter || wrap || srgb !== undefined || sliceBorder
        ? { filter, wrap, srgb, sliceBorder }
        : undefined;
}
