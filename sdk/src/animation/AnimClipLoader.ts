/**
 * @file    AnimClipLoader.ts
 * @brief   .esanim asset loading and parsing
 */

import type { SpriteAnimClip, SpriteAnimFrame } from './SpriteAnimator';

// =============================================================================
// .esanim File Format
// =============================================================================

export interface AnimClipFrameData {
    texture: string;
    duration?: number;
    atlasFrame?: {
        x: number;
        y: number;
        width: number;
        height: number;
        pageWidth: number;
        pageHeight: number;
    };
}

export interface AnimClipAssetData {
    version: string;
    type: 'animation-clip';
    fps?: number;
    loop?: boolean;
    frames: AnimClipFrameData[];
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
        frames: data.frames.map(f => {
            const frame: SpriteAnimFrame = {
                texture: textureHandles.get(f.texture) ?? 0,
                duration: f.duration,
            };
            if (f.atlasFrame) {
                const af = f.atlasFrame;
                frame.uvOffset = {
                    x: af.x / af.pageWidth,
                    y: 1.0 - (af.y + af.height) / af.pageHeight,
                };
                frame.uvScale = {
                    x: af.width / af.pageWidth,
                    y: af.height / af.pageHeight,
                };
            }
            return frame;
        }),
    };
}
