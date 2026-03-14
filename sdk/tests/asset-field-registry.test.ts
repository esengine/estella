import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerAssetFields,
    registerCompoundAssetFields,
    getAssetFields,
    getCompoundAssetFields,
    getAllRegisteredComponents,
    clearAssetFieldRegistry,
    initBuiltinAssetFields,
} from '../src/asset/AssetFieldRegistry';

describe('AssetFieldRegistry', () => {
    beforeEach(() => {
        clearAssetFieldRegistry();
    });

    it('registers and retrieves single fields', () => {
        registerAssetFields('Sprite', [
            { field: 'texture', type: 'texture' },
            { field: 'material', type: 'material' },
        ]);

        const fields = getAssetFields('Sprite');
        expect(fields).toHaveLength(2);
        expect(fields[0]).toEqual({ field: 'texture', type: 'texture' });
        expect(fields[1]).toEqual({ field: 'material', type: 'material' });
    });

    it('registers and retrieves compound fields', () => {
        registerCompoundAssetFields('SpineAnimation', {
            type: 'spine',
            fields: { skeleton: 'skeletonPath', atlas: 'atlasPath' },
        });

        const compounds = getCompoundAssetFields('SpineAnimation');
        expect(compounds).toHaveLength(1);
        expect(compounds[0].type).toBe('spine');
        expect(compounds[0].fields).toEqual({ skeleton: 'skeletonPath', atlas: 'atlasPath' });
    });

    it('returns empty arrays for unregistered components', () => {
        expect(getAssetFields('Unknown')).toEqual([]);
        expect(getCompoundAssetFields('Unknown')).toEqual([]);
    });

    it('lists all registered components', () => {
        registerAssetFields('Sprite', [{ field: 'texture', type: 'texture' }]);
        registerAssetFields('Image', [{ field: 'texture', type: 'texture' }]);

        const components = getAllRegisteredComponents();
        expect(components).toContain('Sprite');
        expect(components).toContain('Image');
    });

    it('initBuiltinAssetFields registers all known components', () => {
        initBuiltinAssetFields();

        const components = getAllRegisteredComponents();
        expect(components).toContain('Sprite');
        expect(components).toContain('SpineAnimation');
        expect(components).toContain('BitmapText');
        expect(components).toContain('Image');
        expect(components).toContain('UIRenderer');
        expect(components).toContain('SpriteAnimator');
        expect(components).toContain('AudioSource');
        expect(components).toContain('ParticleEmitter');
        expect(components).toContain('Tilemap');
        expect(components).toContain('TilemapLayer');
        expect(components).toContain('TimelinePlayer');

        const spineCompounds = getCompoundAssetFields('SpineAnimation');
        expect(spineCompounds).toHaveLength(1);
        expect(spineCompounds[0].type).toBe('spine');

        const spineSingleFields = getAssetFields('SpineAnimation');
        expect(spineSingleFields).toEqual([{ field: 'material', type: 'material' }]);
    });

    it('can register both fields and compounds for same component', () => {
        registerAssetFields('MyComponent', [{ field: 'texture', type: 'texture' }]);
        registerCompoundAssetFields('MyComponent', {
            type: 'custom',
            fields: { a: 'fieldA', b: 'fieldB' },
        });

        expect(getAssetFields('MyComponent')).toHaveLength(1);
        expect(getCompoundAssetFields('MyComponent')).toHaveLength(1);
    });
});
