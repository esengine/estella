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

/**
 * Index settings by EVERY spelling a scene may name the asset with — its uuid
 * bare and `@uuid:`-prefixed, its authored path with and without a leading
 * slash, and the staged path a content-addressed cook renamed it to.
 *
 * One asset, several names, and which name a component carries is the project's
 * choice: the meta-driven pipeline writes `@uuid:`, hand-authored and ported
 * scenes hold paths. A lookup that indexes only one of them works on whichever
 * projects happen to use that spelling and silently drops the settings for the
 * rest — so the spelling fan-out is done ONCE, here, rather than guessed at by
 * each realm's asset source.
 */
export function indexTextureImportSettings(
    assets: Iterable<{
        uuid?: string;
        path?: string;
        address?: string;
        settings: ParsedTextureImportSettings | undefined;
    }>,
): (ref: string) => ParsedTextureImportSettings | undefined {
    const byRef = new Map<string, ParsedTextureImportSettings>();
    for (const { uuid, path, address, settings } of assets) {
        if (!settings) continue;
        for (const spelling of [uuid, uuid && `@uuid:${uuid}`, path, address]) {
            if (!spelling) continue;
            byRef.set(spelling, settings);
            if (!spelling.startsWith('/')) byRef.set(`/${spelling}`, settings);
        }
    }
    return byRef.size > 0 ? (ref) => byRef.get(ref) : () => undefined;
}
