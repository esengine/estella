import { describe, it, expect } from 'vitest';

/**
 * Test the scale mode logic directly without WASM dependencies.
 * Mirrors computeEffectiveOrthoSize from CameraPlugin.ts.
 */

const ScaleMode = {
    FixedWidth: 0,
    FixedHeight: 1,
    Expand: 2,
    Shrink: 3,
    Match: 4,
    ShowAll: 5,
    NoBorder: 6,
} as const;

function computeEffectiveOrthoSize(
    baseOrthoSize: number,
    designAspect: number,
    actualAspect: number,
    scaleMode: number,
    matchWidthOrHeight: number,
): number {
    const orthoForWidth = baseOrthoSize * designAspect / actualAspect;
    const orthoForHeight = baseOrthoSize;

    switch (scaleMode) {
        case ScaleMode.FixedWidth: return orthoForWidth;
        case ScaleMode.FixedHeight: return orthoForHeight;
        case ScaleMode.Expand: return Math.max(orthoForWidth, orthoForHeight);
        case ScaleMode.Shrink: return Math.min(orthoForWidth, orthoForHeight);
        case ScaleMode.Match: {
            const t = matchWidthOrHeight;
            return Math.pow(orthoForWidth, 1 - t) * Math.pow(orthoForHeight, t);
        }
        case ScaleMode.ShowAll: return Math.max(orthoForWidth, orthoForHeight);
        case ScaleMode.NoBorder: return Math.min(orthoForWidth, orthoForHeight);
        default: return orthoForHeight;
    }
}

describe('Screen Scale Modes', () => {
    // Design: 1920x1080 (16:9), orthoSize = 540 (half height)
    const designW = 1920, designH = 1080;
    const baseOrtho = designH / 2; // 540
    const designAspect = designW / designH; // ~1.778

    describe('ShowAll (letterbox)', () => {
        it('on wider screen (18:9) should show all content with side bars', () => {
            const actualAspect = 18 / 9; // 2.0
            const ortho = computeEffectiveOrthoSize(baseOrtho, designAspect, actualAspect, ScaleMode.ShowAll, 0);
            // orthoForWidth = 540 * (16/9) / (18/9) = 540 * 0.889 = 480
            // orthoForHeight = 540
            // ShowAll = max(480, 540) = 540 (height-limited, side bars)
            expect(ortho).toBeCloseTo(540, 0);
        });

        it('on taller screen (9:16) should show all content with top/bottom bars', () => {
            const actualAspect = 9 / 16; // 0.5625
            const ortho = computeEffectiveOrthoSize(baseOrtho, designAspect, actualAspect, ScaleMode.ShowAll, 0);
            // orthoForWidth = 540 * 1.778 / 0.5625 = 1706.7
            // orthoForHeight = 540
            // ShowAll = max(1706.7, 540) = 1706.7 (width-limited, top/bottom bars)
            expect(ortho).toBeGreaterThan(540);
        });

        it('on exact design aspect should equal baseOrtho', () => {
            const ortho = computeEffectiveOrthoSize(baseOrtho, designAspect, designAspect, ScaleMode.ShowAll, 0);
            expect(ortho).toBeCloseTo(540, 0);
        });
    });

    describe('NoBorder (crop)', () => {
        it('on wider screen should crop sides (smaller ortho)', () => {
            const actualAspect = 18 / 9;
            const ortho = computeEffectiveOrthoSize(baseOrtho, designAspect, actualAspect, ScaleMode.NoBorder, 0);
            // NoBorder = min(480, 540) = 480
            expect(ortho).toBeCloseTo(480, 0);
        });

        it('on taller screen should crop top/bottom', () => {
            const actualAspect = 9 / 16;
            const ortho = computeEffectiveOrthoSize(baseOrtho, designAspect, actualAspect, ScaleMode.NoBorder, 0);
            // NoBorder = min(1706.7, 540) = 540
            expect(ortho).toBeCloseTo(540, 0);
        });
    });
});
