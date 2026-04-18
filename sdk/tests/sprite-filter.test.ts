/**
 * @file    sprite-filter.test.ts
 * @brief   SpriteFilter creates outline/glow/drop-shadow materials with
 *          the expected uniforms seeded on Material.create/setUniform.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const materialCalls: Array<
    | { kind: 'createShader' }
    | { kind: 'create'; shader: number }
    | { kind: 'setUniform'; material: number; name: string; value: unknown }
> = [];

let nextShaderId = 100;
let nextMaterialId = 1000;

vi.mock('../src/material', () => {
    return {
        Material: {
            createShader: vi.fn(() => {
                materialCalls.push({ kind: 'createShader' });
                return nextShaderId++;
            }),
            create: vi.fn((opts: { shader: number }) => {
                materialCalls.push({ kind: 'create', shader: opts.shader });
                return nextMaterialId++;
            }),
            setUniform: vi.fn((material: number, name: string, value: unknown) => {
                materialCalls.push({ kind: 'setUniform', material, name, value });
            }),
        },
    };
});

import { SpriteFilter } from '../src/spriteFilter';

beforeEach(() => {
    materialCalls.length = 0;
});

describe('SpriteFilter.createOutline', () => {
    it('creates a material with a freshly compiled shader, color/width/texelSize uniforms', () => {
        const handle = SpriteFilter.createOutline({
            color: { r: 1, g: 0.5, b: 0.25, a: 0.8 },
            width: 3,
            texelSize: { x: 1 / 256, y: 1 / 256 },
        });

        expect(typeof handle).toBe('number');
        expect(materialCalls.some(c => c.kind === 'createShader')).toBe(true);
        expect(materialCalls.some(c => c.kind === 'create')).toBe(true);

        const setUniforms = materialCalls.filter(
            (c): c is { kind: 'setUniform'; material: number; name: string; value: unknown } =>
                c.kind === 'setUniform',
        );
        const byName = new Map(setUniforms.map(c => [c.name, c.value]));
        expect(byName.get('u_outlineColor')).toEqual([1, 0.5, 0.25, 0.8]);
        expect(byName.get('u_outlineWidth')).toBe(3);
        expect(byName.get('u_texelSize')).toEqual([1 / 256, 1 / 256]);
    });

    it('falls back to documented defaults when options are omitted', () => {
        SpriteFilter.createOutline();
        const byName = new Map(
            materialCalls
                .filter((c): c is { kind: 'setUniform'; material: number; name: string; value: unknown } =>
                    c.kind === 'setUniform',
                )
                .map(c => [c.name, c.value]),
        );
        expect(byName.get('u_outlineColor')).toEqual([1, 1, 1, 1]);
        expect(byName.get('u_outlineWidth')).toBe(1.0);
    });
});

describe('SpriteFilter.createGlow', () => {
    it('uses warm default color and wider outline', () => {
        SpriteFilter.createGlow();
        const byName = new Map(
            materialCalls
                .filter((c): c is { kind: 'setUniform'; material: number; name: string; value: unknown } =>
                    c.kind === 'setUniform',
                )
                .map(c => [c.name, c.value]),
        );
        const color = byName.get('u_outlineColor') as number[];
        expect(color[0]).toBeCloseTo(1);
        expect(color[1]).toBeCloseTo(0.8);
        expect(color[2]).toBeCloseTo(0.2);
        expect(byName.get('u_outlineWidth')).toBe(2.0);
    });
});

describe('SpriteFilter.createDropShadow', () => {
    it('seeds shadow color, offset, blur, texelSize', () => {
        SpriteFilter.createDropShadow({
            color: { r: 0, g: 0, b: 0, a: 0.4 },
            offsetX: 5,
            offsetY: -2,
            blur: 4,
        });
        const byName = new Map(
            materialCalls
                .filter((c): c is { kind: 'setUniform'; material: number; name: string; value: unknown } =>
                    c.kind === 'setUniform',
                )
                .map(c => [c.name, c.value]),
        );
        expect(byName.get('u_shadowColor')).toEqual([0, 0, 0, 0.4]);
        expect(byName.get('u_shadowOffset')).toEqual([5, -2]);
        expect(byName.get('u_shadowBlur')).toBe(4);
        expect(byName.has('u_texelSize')).toBe(true);
    });
});

describe('SpriteFilter mutator helpers', () => {
    it('setOutlineColor forwards to Material.setUniform', () => {
        SpriteFilter.setOutlineColor(42, { r: 1, g: 0, b: 0, a: 1 });
        expect(materialCalls).toContainEqual({
            kind: 'setUniform',
            material: 42,
            name: 'u_outlineColor',
            value: [1, 0, 0, 1],
        });
    });

    it('setOutlineWidth forwards', () => {
        SpriteFilter.setOutlineWidth(42, 7);
        expect(materialCalls).toContainEqual({
            kind: 'setUniform',
            material: 42,
            name: 'u_outlineWidth',
            value: 7,
        });
    });

    it('setShadowOffset forwards (x, y)', () => {
        SpriteFilter.setShadowOffset(42, 3, -1);
        expect(materialCalls).toContainEqual({
            kind: 'setUniform',
            material: 42,
            name: 'u_shadowOffset',
            value: [3, -1],
        });
    });

    it('setShadowBlur forwards', () => {
        SpriteFilter.setShadowBlur(42, 2.5);
        expect(materialCalls).toContainEqual({
            kind: 'setUniform',
            material: 42,
            name: 'u_shadowBlur',
            value: 2.5,
        });
    });
});
