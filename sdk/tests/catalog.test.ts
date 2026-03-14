import { describe, it, expect } from 'vitest';
import { Catalog, type CatalogData } from '../src/asset/Catalog';

const testData: CatalogData = {
    version: 1,
    entries: {
        'sprites/hero.png': {
            type: 'texture',
            atlas: 'atlas_0.png',
            frame: { x: 100, y: 50, w: 64, h: 64 },
            uv: { offset: [0.049, 0.024], scale: [0.031, 0.031] },
        },
        'sprites/bg.png': {
            type: 'texture',
        },
        'characters/hero.skel': {
            type: 'spine',
            deps: ['characters/hero.atlas'],
        },
        'materials/glow.esmaterial': {
            type: 'material',
            buildPath: 'materials/glow.json',
        },
    },
    addresses: {
        'player_icon': 'sprites/hero.png',
        'glow_mat': 'materials/glow.esmaterial',
    },
    labels: {
        'ui-icons': ['sprites/hero.png', 'sprites/bg.png'],
    },
};

describe('Catalog', () => {
    const catalog = Catalog.fromJson(testData);

    describe('resolve', () => {
        it('resolves address to path', () => {
            expect(catalog.resolve('player_icon')).toBe('sprites/hero.png');
            expect(catalog.resolve('glow_mat')).toBe('materials/glow.esmaterial');
        });

        it('resolves known path to itself', () => {
            expect(catalog.resolve('sprites/bg.png')).toBe('sprites/bg.png');
        });

        it('returns unknown ref as-is', () => {
            expect(catalog.resolve('unknown/path.png')).toBe('unknown/path.png');
        });
    });

    describe('getAtlasFrame', () => {
        it('returns atlas info for packed texture', () => {
            const frame = catalog.getAtlasFrame('sprites/hero.png');
            expect(frame).toEqual({
                atlas: 'atlas_0.png',
                frame: { x: 100, y: 50, w: 64, h: 64 },
                uvOffset: [0.049, 0.024],
                uvScale: [0.031, 0.031],
            });
        });

        it('returns null for non-atlas texture', () => {
            expect(catalog.getAtlasFrame('sprites/bg.png')).toBeNull();
        });

        it('returns null for unknown path', () => {
            expect(catalog.getAtlasFrame('unknown.png')).toBeNull();
        });
    });

    describe('getBuildPath', () => {
        it('returns mapped build path', () => {
            expect(catalog.getBuildPath('materials/glow.esmaterial')).toBe('materials/glow.json');
        });

        it('returns original path when no mapping', () => {
            expect(catalog.getBuildPath('sprites/bg.png')).toBe('sprites/bg.png');
            expect(catalog.getBuildPath('unknown.png')).toBe('unknown.png');
        });
    });

    describe('getDeps', () => {
        it('returns dependencies', () => {
            expect(catalog.getDeps('characters/hero.skel')).toEqual(['characters/hero.atlas']);
        });

        it('returns empty array for no deps', () => {
            expect(catalog.getDeps('sprites/bg.png')).toEqual([]);
            expect(catalog.getDeps('unknown.png')).toEqual([]);
        });
    });

    describe('getByLabel', () => {
        it('returns paths for label', () => {
            expect(catalog.getByLabel('ui-icons')).toEqual(['sprites/hero.png', 'sprites/bg.png']);
        });

        it('returns empty array for unknown label', () => {
            expect(catalog.getByLabel('unknown')).toEqual([]);
        });
    });

    describe('empty catalog', () => {
        const empty = Catalog.empty();

        it('isEmpty is true', () => {
            expect(empty.isEmpty).toBe(true);
        });

        it('resolve returns ref as-is', () => {
            expect(empty.resolve('any/path.png')).toBe('any/path.png');
        });

        it('getAtlasFrame returns null', () => {
            expect(empty.getAtlasFrame('any.png')).toBeNull();
        });

        it('getDeps returns empty', () => {
            expect(empty.getDeps('any.skel')).toEqual([]);
        });
    });
});
