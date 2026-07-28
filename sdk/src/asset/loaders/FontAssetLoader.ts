// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, FontResult } from '../AssetLoader';
import { requireResourceManager } from '../../wasm/resourceManager';
import { getAssetTypeEntry } from '../../assetTypes';
import { getPlatform } from '../../platform/base';
import {
    familyNameFor, projectFontFamily, registerProjectFont, unregisterProjectFont,
} from '../../ui/text/font-registry';
import type { FontHandle } from '../../types';

/** Outline fonts — rasterized per glyph by the text stack, not pre-baked pages. */
const OUTLINE_RE = /\.(ttf|otf|woff2?)$/i;

export class FontAssetLoader implements AssetLoader<FontResult> {
    readonly type = 'font';
    readonly extensions = ['.bmfont', '.fnt', '.ttf', '.otf', '.woff', '.woff2'];

    async load(path: string, ctx: LoadContext): Promise<FontResult> {
        // Two genuinely different things share the `font` asset type: a bitmap
        // font is a pre-baked page + metrics (a C++ resource, drawn by
        // BitmapText), an outline font is a file the platform's text stack
        // rasterizes on demand (used by Text). They diverge here and nowhere else.
        if (OUTLINE_RE.test(path)) return this.loadOutlineFont(path, ctx);
        const entry = getAssetTypeEntry(path);
        if (entry?.editorType === 'bitmap-font' && entry.contentType === 'json') {
            return this.loadBmfontJson(path, ctx);
        }
        return this.loadFntFile(path, ctx);
    }

    unload(asset: FontResult): void {
        // A project font has no C++ resource — only a registration and a name.
        if (projectFontFamily(asset.handle) !== null) {
            unregisterProjectFont(asset.path ?? '');
            return;
        }
        const rm = requireResourceManager();
        rm.releaseBitmapFont(asset.handle);
    }

    /**
     * Hand the file to the platform's text stack under a minted family name, so
     * `Text` can name a shipped font exactly as it names a system one. A host
     * with no `registerFont` (a headless realm) still resolves and returns a
     * handle — the family simply will not rasterize, and Text falls back.
     */
    private async loadOutlineFont(path: string, ctx: LoadContext): Promise<FontResult> {
        const family = familyNameFor(path);
        const bytes = await ctx.loadBinary(ctx.catalog.getBuildPath(path));
        await getPlatform().registerFont?.(family, bytes);
        return { handle: registerProjectFont(path, family) as FontHandle, family, path };
    }

    private async loadBmfontJson(path: string, ctx: LoadContext): Promise<FontResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const json = JSON.parse(text) as {
            type: string;
            fntFile?: string;
            generatedFnt?: string;
        };

        const fntFile = json.type === 'label-atlas' ? json.generatedFnt : json.fntFile;
        if (!fntFile) {
            throw new Error(`Invalid bmfont asset: no fnt file specified in ${path}`);
        }

        const dir = path.substring(0, path.lastIndexOf('/'));
        const fntPath = dir ? `${dir}/${fntFile}` : fntFile;
        return this.loadFntFile(fntPath, ctx);
    }

    private async loadFntFile(path: string, ctx: LoadContext): Promise<FontResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const fntContent = await ctx.loadText(buildPath);
        const pageMatch = fntContent.match(/file="([^"]+)"/);
        if (!pageMatch) {
            throw new Error(`No page texture found in .fnt file: ${path}`);
        }

        const texName = pageMatch[1];
        const dir = path.substring(0, path.lastIndexOf('/'));
        const texPath = dir ? `${dir}/${texName}` : texName;

        const texResult = await ctx.loadTexture(texPath, false);
        const rm = requireResourceManager();
        const handle = rm.loadBitmapFont(
            fntContent, texResult.handle, texResult.width, texResult.height,
        ) as FontHandle;

        return { handle };
    }
}
