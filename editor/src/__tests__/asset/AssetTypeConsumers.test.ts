import { describe, it, expect, beforeEach } from 'vitest';
import {
    resetAssetTypeRegistry,
    registerBuiltinAssetTypes,
    getAssetTypeIcon,
    getAssetTypeDisplayName,
    getDisplayType,
} from '../../asset/AssetTypeRegistry';
import { getAssetIcon, getAssetType } from '../../panels/content-browser/ContentBrowserTypes';
import { getAssetIcon as getInspectorIcon, getAssetTypeName } from '../../panels/inspector/InspectorHelpers';

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

describe('InspectorHelpers delegates to Registry', () => {
    beforeEach(() => {
        resetAssetTypeRegistry();
        registerBuiltinAssetTypes();
    });

    it('getAssetIcon returns registry icon', () => {
        const types = ['image', 'script', 'scene', 'audio', 'json', 'material', 'shader', 'font', 'folder', 'animclip'] as const;
        for (const t of types) {
            const icon = getInspectorIcon(t, 16);
            const registryIcon = getAssetTypeIcon(t, 16);
            expect(icon).toBe(registryIcon);
        }
    });

    it('getAssetTypeName returns registry display name', () => {
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
            expect(getAssetTypeName(type)).toBe(name);
        }
    });

    it('getAssetTypeName returns File for unknown type', () => {
        expect(getAssetTypeName('unknown')).toBe('File');
    });
});
