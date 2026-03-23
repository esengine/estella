import { describe, it, expect } from 'vitest';
import { Catalog, type CatalogData, type AtlasFrameInfo } from '../src/asset/Catalog';

describe('Atlas trim support', () => {
    it('should return trim info from catalog entry', () => {
        const data: CatalogData = {
            version: 1,
            entries: {
                'sprite.png': {
                    type: 'texture',
                    atlas: 'atlas_0.png',
                    frame: { x: 10, y: 20, w: 50, h: 40 },
                    uv: { offset: [0.01, 0.02], scale: [0.05, 0.04] },
                    trim: { sourceW: 64, sourceH: 64, offsetX: 7, offsetY: 12 },
                },
            },
        };
        const catalog = Catalog.fromJson(data);
        const info = catalog.getAtlasFrame('sprite.png');

        expect(info).not.toBeNull();
        expect(info!.trim).toBeDefined();
        expect(info!.trim!.sourceW).toBe(64);
        expect(info!.trim!.sourceH).toBe(64);
        expect(info!.trim!.offsetX).toBe(7);
        expect(info!.trim!.offsetY).toBe(12);
    });

    it('should return null trim when no trim data', () => {
        const data: CatalogData = {
            version: 1,
            entries: {
                'notrimmed.png': {
                    type: 'texture',
                    atlas: 'atlas_0.png',
                    frame: { x: 0, y: 0, w: 100, h: 100 },
                    uv: { offset: [0, 0], scale: [0.1, 0.1] },
                },
            },
        };
        const catalog = Catalog.fromJson(data);
        const info = catalog.getAtlasFrame('notrimmed.png');

        expect(info).not.toBeNull();
        expect(info!.trim).toBeUndefined();
    });

    it('should preserve frame dimensions (trimmed size)', () => {
        const data: CatalogData = {
            version: 1,
            entries: {
                'trimmed.png': {
                    type: 'texture',
                    atlas: 'atlas_0.png',
                    frame: { x: 5, y: 5, w: 30, h: 20 },
                    uv: { offset: [0.005, 0.005], scale: [0.03, 0.02] },
                    trim: { sourceW: 50, sourceH: 40, offsetX: 10, offsetY: 10 },
                },
            },
        };
        const catalog = Catalog.fromJson(data);
        const info = catalog.getAtlasFrame('trimmed.png');

        expect(info!.frame.w).toBe(30); // trimmed width
        expect(info!.trim!.sourceW).toBe(50); // original width
    });
});
