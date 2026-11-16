import { describe, expect, it } from 'vitest';
import { TIER_SIZE, bakeTierOf, bakesAtLoad, modelProductPaths } from '../src/modeling/loadBakeFile';

describe('what a package leaves for the game to bake', () => {
    it('names a model source\'s products beside it', () => {
        expect(modelProductPaths('assets/models/frigate.esmodel')).toEqual({
            mesh: 'assets/models/frigate.esmesh', normal: 'assets/models/frigate_normal.png', color: 'assets/models/frigate_color.png',
            surface: 'assets/models/frigate_surface.png', emissive: 'assets/models/frigate_emissive.png', occlusion: 'assets/models/frigate_occlusion.png',
        });
    });

    it('bakes at load any source with no step the loader cannot run', () => {
        const steps = [{ op: 'box' }, { op: 'decimate' }];
        expect(bakesAtLoad({ steps, normalBake: { size: 1024 } })).toBe(true);
        expect(bakesAtLoad({ steps })).toBe(true);
        expect(bakesAtLoad({ normalBake: { size: 1024 } })).toBe(false);
        expect(bakesAtLoad({ steps: [...steps, { op: 'boolean' }], normalBake: { size: 1024 } })).toBe(false);
        expect(bakesAtLoad({ steps: [{ op: 'group', steps: [{ op: 'fracture' }] }], normalBake: { size: 1024 } })).toBe(false);
    });

    it('sizes the maps by the device', () => {
        expect(bakeTierOf({ mobile: false, memoryGB: 8, cores: 12 })).toBe('desktop');
        expect(bakeTierOf({ mobile: true, memoryGB: 8, cores: 8 })).toBe('high');
        expect(bakeTierOf({ mobile: true, memoryGB: 4, cores: 8 })).toBe('mid');
        expect(bakeTierOf({ mobile: true, memoryGB: 2, cores: 4 })).toBe('low');
        expect(TIER_SIZE.desktop).toBe(4096);
        expect(TIER_SIZE.high).toBe(2048);
        expect(TIER_SIZE.mid).toBe(1024);
        expect(TIER_SIZE.low).toBe(512);
    });
});
