/**
 * @file    SpineAtlasParser.ts
 * @brief   Shared Spine atlas texture name extraction
 */

const TEXTURE_EXT_PATTERN = /\.(png|jpg|jpeg)$/i;

export function parseAtlasTextures(atlasContent: string): string[] {
    const textures: string[] = [];
    for (const rawLine of atlasContent.split('\n')) {
        const line = rawLine.trim();
        if (line && line.indexOf(':') === -1 && TEXTURE_EXT_PATTERN.test(line)) {
            textures.push(line);
        }
    }
    return textures;
}
