import { describe, it, expect, beforeEach } from 'vitest';
import {
    resetAssetTypeRegistry,
    registerBuiltinAssetTypes,
    getAssetTypeIcon,
    getAssetTypeDisplayName,
    getDisplayType,
} from '../../asset/AssetTypeRegistry';
import { getAssetIcon, getAssetType } from '../../panels/content-browser/ContentBrowserTypes';

describe('ContentBrowserTypes delegates to Registry', () => {
    beforeEach(() => {
        resetAssetTypeRegistry();
        registerBuiltinAssetTypes();
    });

    it('getAssetIcon returns registry icon for all known types', () => {
        const types = ['folder', 'prefab', 'scene', 'script', 'image', 'audio', 'json', 'material', 'shader', 'spine', 'font', 'animclip'] as const;
        for (const t of types) {
            const icon = getAssetIcon(t, 32);
            const registryIcon = getAssetTypeIcon(t, 32);
            expect(icon).toBe(registryIcon);
        }
    });

    it('getAssetIcon returns fallback for unknown type', () => {
        const icon = getAssetIcon('unknown-type' as any, 32);
        expect(typeof icon).toBe('string');
        expect(icon.length).toBeGreaterThan(0);
    });
});

describe('AssetTypeRegistry display helpers', () => {
    beforeEach(() => {
        resetAssetTypeRegistry();
        registerBuiltinAssetTypes();
    });

    it('getAssetTypeIcon returns icon for all known types', () => {
        const types = ['image', 'script', 'scene', 'audio', 'json', 'material', 'shader', 'font', 'folder', 'animclip'] as const;
        for (const t of types) {
            const icon = getAssetTypeIcon(t, 16);
            expect(typeof icon).toBe('string');
            expect(icon.length).toBeGreaterThan(0);
        }
    });

    it('getAssetTypeDisplayName returns correct display name', () => {
        const expected: Record<string, string> = {
            image: 'Image',
            script: 'Script',
            scene: 'Scene',
            audio: 'Audio',
            json: 'JSON',
            material: 'Material',
            shader: 'Shader',
            font: 'BitmapFont',
            folder: 'Folder',
            animclip: 'Animation Clip',
        };
        for (const [type, name] of Object.entries(expected)) {
            expect(getAssetTypeDisplayName(type)).toBe(name);
        }
    });

    it('getAssetTypeDisplayName returns File for unknown type', () => {
        expect(getAssetTypeDisplayName('unknown')).toBe('File');
    });
});
