// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, FontResult } from '../AssetLoader';
import { resolveDocumentRef } from '../documentRef';
import { bitmapFontMetricsField, type BitmapFontDocument } from '../bitmapFontDocument';
import { requireResourceManager } from '../../wasm/resourceManager';
import { getAssetTypeEntry } from '../../assetTypes';
import { getPlatform } from '../../platform/base';
import {
    freshProjectFontFamily, projectFontFamily, registerProjectFontEra, releaseProjectFontEra,
} from '../../ui/text/font-registry';
import { parseBmFont, registerBitmapFont, unregisterBitmapFont } from '../../ui/text/bitmap-font';
import { log } from '../../util/logger';
import type { FontHandle } from '../../types';

export class FontAssetLoader implements AssetLoader<FontResult> {
    readonly type = 'font';
    readonly bindsTextures = true;
    readonly extensions = ['.bmfont', '.fnt', '.ttf', '.otf', '.woff', '.woff2'];

    async load(path: string, ctx: LoadContext): Promise<FontResult> {
        // Two genuinely different things share the `font` asset type: a bitmap
        // font is a pre-baked page + metrics (a C++ resource, drawn by
        // BitmapText), an outline font is a file the platform's text stack
        // rasterizes on demand (used by Text). They diverge here and nowhere else.
        const document = ctx.sourceAddressOf?.(path) ?? path;
        const file = ctx.catalog.getBuildPath(path);
        const staged = getAssetTypeEntry(path);
        const entry = staged?.editorType === 'font' || staged?.editorType === 'bitmap-font' ? staged : getAssetTypeEntry(document);
        if (entry?.editorType === 'font') return this.loadOutlineFont(document, file, ctx);
        const text = await ctx.loadText(file);
        if (entry?.editorType === 'bitmap-font' && entry.contentType === 'json') {
            const json = JSON.parse(text) as BitmapFontDocument | null;
            const metrics = json?.[bitmapFontMetricsField(json)];
            if (typeof metrics !== 'string' || !metrics) throw new Error(`Invalid bmfont asset: no fnt file specified in ${document}`);
            const ref = resolveDocumentRef(document, metrics);
            const content = ctx.readSource ? await ctx.readSource(ref) : await ctx.loadText(ctx.catalog.getBuildPath(ref));
            return this.loadFntFile(ctx.sourceAddressOf?.(ref) ?? ref, content, ctx);
        }
        return this.loadFntFile(document, text, ctx);
    }

    unload(asset: FontResult): void {
        // A project font has no C++ resource — only a registration and a name.
        if (asset.family !== undefined || asset.path !== undefined || projectFontFamily(asset.handle) !== null) {
            releaseProjectFontEra(asset.handle);
            return;
        }
        unregisterBitmapFont(asset.handle);
        const rm = requireResourceManager();
        rm.releaseBitmapFont(asset.handle);
    }

    /**
     * Hand the file to the platform's text stack under a minted family name, so
     * `Text` can name a shipped font exactly as it names a system one. A host
     * with no `registerFont` (a headless realm) still resolves and returns a
     * handle — the family simply will not rasterize, and Text falls back.
     */
    private async loadOutlineFont(path: string, file: string, ctx: LoadContext): Promise<FontResult> {
        const bytes = await ctx.loadBinary(file);
        const family = freshProjectFontFamily(path);
        await getPlatform().registerFont?.(family, bytes);
        return { handle: registerProjectFontEra(path, family) as FontHandle, family, path };
    }

    private async loadFntFile(path: string, fntContent: string, ctx: LoadContext): Promise<FontResult> {
        const pageMatch = fntContent.match(/file="([^"]+)"/);
        if (!pageMatch) {
            throw new Error(`No page texture found in .fnt file: ${path}`);
        }

        const texPath = resolveDocumentRef(path, pageMatch[1]);

        const texResult = (await ctx.acquireTexture(texPath, false, 'imported')).value;
        const rm = requireResourceManager();
        const handle = rm.loadBitmapFont(
            fntContent, texResult.handle, texResult.width, texResult.height,
        ) as FontHandle;
        if (!handle) throw new Error(`The engine rejected the bitmap font in ${path}`);

        // The same font serves `Text`, which draws it from the page texture with this table — `BitmapText` keeps using the
        // C++ resource above. A font the parser cannot read still loads for BitmapText; Text just will not find it.
        try {
            // the batch binds a page by GL texture id, as it does for the glyph atlas's own pages
            registerBitmapFont(handle, parseBmFont(fntContent), rm.getTextureGLId(texResult.handle));
        } catch (err) {
            log.warn('text', `${path}: not usable by Text as a bitmap font — ${err instanceof Error ? err.message : String(err)}`);
        }

        return { handle };
    }
}
