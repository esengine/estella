// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  atlasPages.ts — the single source of truth for a Spine `.atlas`'s page
 *        image names. A spine atlas is a text manifest whose page headers name an
 *        image file (`spineboy.png`) at column 0, each followed by indented
 *        `key: value` property lines. Those page images are the atlas's texture
 *        DEPENDENCIES — resolved relative to the atlas file.
 *
 *        Every consumer reads pages through here so the cook's dependency scan
 *        (which decides what ships), the runtime {@link SpineAssetLoader}, and the
 *        scene loader ({@link loadSpineAssets}) agree by construction — a texture
 *        the loader will request is exactly one the cook embedded. Kept a
 *        dependency-free leaf so the Node-side cook can import it too.
 */

/** Parse a spine `.atlas`'s page image filenames (relative to the atlas file). */
export function parseSpineAtlasPages(content: string): string[] {
    const pages: string[] = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.includes(':') && (/\.png$/i.test(trimmed) || /\.jpg$/i.test(trimmed))) {
            pages.push(trimmed);
        }
    }
    return pages;
}
