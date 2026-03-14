import type { AssetLoader, LoadContext, FontResult } from '../AssetLoader';
import { requireResourceManager } from '../../resourceManager';
import { getAssetTypeEntry } from '../../assetTypes';
import type { FontHandle } from '../../types';

export class FontAssetLoader implements AssetLoader<FontResult> {
    readonly type = 'font';
    readonly extensions = ['.bmfont', '.fnt'];

    async load(path: string, ctx: LoadContext): Promise<FontResult> {
        const entry = getAssetTypeEntry(path);
        if (entry?.editorType === 'bitmap-font' && entry.contentType === 'json') {
            return this.loadBmfontJson(path, ctx);
        }
        return this.loadFntFile(path, ctx);
    }

    unload(asset: FontResult): void {
        const rm = requireResourceManager();
        rm.releaseBitmapFont(asset.handle);
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
