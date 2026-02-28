/**
 * @file    AnimClipLoader.ts
 * @brief   .esanim asset loading and parsing
 */

import type { SpriteAnimClip } from './SpriteAnimator';

// =============================================================================
// .esanim File Format
// =============================================================================

export interface AnimClipAssetData {
    version: string;
    type: 'animation-clip';
    fps?: number;
    loop?: boolean;
    frames: { texture: string }[];
}

// =============================================================================
// Parsing
// =============================================================================

const DEFAULT_FPS = 12;

export function extractAnimClipTexturePaths(data: AnimClipAssetData): string[] {
    const paths = new Set<string>();
    for (const frame of data.frames) {
        if (frame.texture) {
            paths.add(frame.texture);
        }
    }
    return Array.from(paths);
}

export function parseAnimClipData(
    clipPath: string,
    data: AnimClipAssetData,
    textureHandles: Map<string, number>,
): SpriteAnimClip {
    return {
        name: clipPath,
        fps: data.fps ?? DEFAULT_FPS,
        loop: data.loop ?? true,
        frames: data.frames.map(f => ({
            texture: textureHandles.get(f.texture) ?? 0,
        })),
    };
}
