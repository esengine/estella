/**
 * @file    texture-params.test.ts
 * @brief   textureParams helpers delegate to Renderer.setTextureParams
 *          with the right min/mag/wrap combinations.
 */
import { describe, expect, it, vi } from 'vitest';

const rendererCalls: Array<{
    textureId: number;
    minFilter: number;
    magFilter: number;
    wrapS: number;
    wrapT: number;
}> = [];

vi.mock('../src/renderer', () => ({
    Renderer: {
        setTextureParams: vi.fn((
            textureId: number,
            minFilter: number,
            magFilter: number,
            wrapS: number,
            wrapT: number,
        ) => {
            rendererCalls.push({ textureId, minFilter, magFilter, wrapS, wrapT });
        }),
    },
}));

import {
    TextureFilter,
    TextureWrap,
    setTextureFilter,
    setTextureWrap,
    setTextureParams,
} from '../src/textureParams';

describe('textureParams enums', () => {
    it('maps Nearest/Linear to 0/1', () => {
        expect(TextureFilter.Nearest).toBe(0);
        expect(TextureFilter.Linear).toBe(1);
    });

    it('maps wrap modes: Repeat=0, ClampToEdge=1, MirroredRepeat=2', () => {
        expect(TextureWrap.Repeat).toBe(0);
        expect(TextureWrap.ClampToEdge).toBe(1);
        expect(TextureWrap.MirroredRepeat).toBe(2);
    });
});

describe('setTextureFilter', () => {
    it('uses the given filter for both min and mag and ClampToEdge for both wraps', () => {
        rendererCalls.length = 0;
        setTextureFilter(7, TextureFilter.Nearest);
        expect(rendererCalls).toEqual([{
            textureId: 7,
            minFilter: TextureFilter.Nearest,
            magFilter: TextureFilter.Nearest,
            wrapS: TextureWrap.ClampToEdge,
            wrapT: TextureWrap.ClampToEdge,
        }]);
    });
});

describe('setTextureWrap', () => {
    it('uses Linear for both filters and the given wrap for both axes', () => {
        rendererCalls.length = 0;
        setTextureWrap(11, TextureWrap.MirroredRepeat);
        expect(rendererCalls).toEqual([{
            textureId: 11,
            minFilter: TextureFilter.Linear,
            magFilter: TextureFilter.Linear,
            wrapS: TextureWrap.MirroredRepeat,
            wrapT: TextureWrap.MirroredRepeat,
        }]);
    });
});

describe('setTextureParams', () => {
    it('passes every argument through verbatim', () => {
        rendererCalls.length = 0;
        setTextureParams(99, TextureFilter.Nearest, TextureFilter.Linear,
            TextureWrap.Repeat, TextureWrap.MirroredRepeat);
        expect(rendererCalls).toEqual([{
            textureId: 99,
            minFilter: TextureFilter.Nearest,
            magFilter: TextureFilter.Linear,
            wrapS: TextureWrap.Repeat,
            wrapT: TextureWrap.MirroredRepeat,
        }]);
    });
});
