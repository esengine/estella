// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { screenOverlayPasses } from '../src/ui/core/screen-overlay';

describe('the screen overlay passes', () => {
    it('is one straight pass of every shown layer with no effect', () => {
        expect(screenOverlayPasses(0xFFFFFFFF, [])).toEqual([{ layers: 0xFFFFFFFF, effect: 0 }]);
    });

    it('draws the layers with no effect first, then each layer through its own material', () => {
        const passes = screenOverlayPasses(0xFFFFFFFF, [{ layer: 2, material: 7 }, { layer: 5, material: 9 }]);
        expect(passes).toEqual([
            { layers: (0xFFFFFFFF & ~((1 << 2) | (1 << 5))) >>> 0, effect: 0 },
            { layers: 1 << 2, effect: 7 },
            { layers: 1 << 5, effect: 9 },
        ]);
    });

    it('draws the effect layers from the lowest layer up, whatever order they were found in', () => {
        const passes = screenOverlayPasses(0xFFFFFFFF, [{ layer: 5, material: 9 }, { layer: 2, material: 7 }]);
        expect(passes.slice(1)).toEqual([{ layers: 1 << 2, effect: 7 }, { layers: 1 << 5, effect: 9 }]);
    });

    it('puts no layer in two passes', () => {
        const passes = screenOverlayPasses(0xFFFFFFFF, [{ layer: 0, material: 3 }, { layer: 31, material: 4 }]);
        let seen = 0;
        for (const pass of passes) {
            expect((seen & pass.layers) >>> 0).toBe(0);
            seen = (seen | pass.layers) >>> 0;
        }
        expect(seen).toBe(0xFFFFFFFF);
    });

    it('leaves out an effect whose layer this frame does not show', () => {
        const shown = (1 << 0) | (1 << 3);
        expect(screenOverlayPasses(shown, [{ layer: 2, material: 7 }, { layer: 3, material: 9 }])).toEqual([
            { layers: 1 << 0, effect: 0 },
            { layers: 1 << 3, effect: 9 },
        ]);
    });
});
