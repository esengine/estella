import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerAssetType,
    getAssetTypeDescriptor,
    getAllAssetTypes,
    getDroppableTypes,
    getDisplayType,
    getAssetTypeIcon,
    getAssetTypeDisplayName,
    getInspectorRenderer,
    resetAssetTypeRegistry,
    registerBuiltinAssetTypes,
    type AssetTypeDescriptor,
} from '../../asset/AssetTypeRegistry';

describe('AssetTypeRegistry', () => {
    beforeEach(() => {
        resetAssetTypeRegistry();
    });

    describe('registerAssetType', () => {
        it('registers a new asset type', () => {
            const desc: AssetTypeDescriptor = {
                editorType: 'texture',
                displayType: 'image',
                displayName: 'Image',
                icon: (size) => `<svg size="${size}"/>`,
                eventCategory: 'texture',
                droppable: true,
                inspectorRenderer: null,
                createMenuEntry: null,
            };
            registerAssetType('image', desc);
            expect(getAssetTypeDescriptor('image')).toBe(desc);
        });

        it('throws when registering duplicate displayType', () => {
            const desc: AssetTypeDescriptor = {
                editorType: 'texture',
                displayType: 'image',
                displayName: 'Image',
                icon: (size) => `<svg/>`,
                eventCategory: null,
                droppable: false,
                inspectorRenderer: null,
                createMenuEntry: null,
            };
            registerAssetType('image', desc);
            expect(() => registerAssetType('image', desc)).toThrow();
        });
    });

    describe('getAssetTypeDescriptor', () => {
        it('returns undefined for unregistered type', () => {
            expect(getAssetTypeDescriptor('nonexistent')).toBeUndefined();
        });
    });

    describe('getAllAssetTypes', () => {
        it('returns all registered displayTypes', () => {
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });
            registerAssetType('material', {
                editorType: 'material', displayType: 'material', displayName: 'Material',
                icon: () => '', eventCategory: 'material', droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            const types = getAllAssetTypes();
            expect(types).toContain('image');
            expect(types).toContain('material');
            expect(types.length).toBe(2);
        });
    });

    describe('getDroppableTypes', () => {
        it('returns only droppable types', () => {
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: () => '', eventCategory: null, droppable: true,
                inspectorRenderer: null, createMenuEntry: null,
            });
            registerAssetType('material', {
                editorType: 'material', displayType: 'material', displayName: 'Material',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            const droppable = getDroppableTypes();
            expect(droppable.has('image')).toBe(true);
            expect(droppable.has('material')).toBe(false);
        });
    });

    describe('getDisplayType', () => {
        it('maps editorType to displayType', () => {
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            expect(getDisplayType('texture')).toBe('image');
        });

        it('returns the editorType as-is when unknown', () => {
            expect(getDisplayType('unknown-type')).toBe('unknown-type');
        });
    });

    describe('getAssetTypeIcon', () => {
        it('returns the icon function result', () => {
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: (size) => `<icon-${size}>`, eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            expect(getAssetTypeIcon('image', 32)).toBe('<icon-32>');
        });

        it('returns a fallback icon for unknown types', () => {
            const icon = getAssetTypeIcon('nonexistent', 16);
            expect(typeof icon).toBe('string');
            expect(icon.length).toBeGreaterThan(0);
        });
    });

    describe('getAssetTypeDisplayName', () => {
        it('returns the display name', () => {
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            expect(getAssetTypeDisplayName('image')).toBe('Image');
        });

        it('returns capitalized type for unknown', () => {
            expect(getAssetTypeDisplayName('unknown')).toBe('File');
        });
    });

    describe('getInspectorRenderer', () => {
        it('returns the inspector renderer', () => {
            const renderer = async () => {};
            registerAssetType('image', {
                editorType: 'texture', displayType: 'image', displayName: 'Image',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: renderer, createMenuEntry: null,
            });

            expect(getInspectorRenderer('image')).toBe(renderer);
        });

        it('returns null for type with no renderer', () => {
            registerAssetType('folder', {
                editorType: 'folder', displayType: 'folder', displayName: 'Folder',
                icon: () => '', eventCategory: null, droppable: false,
                inspectorRenderer: null, createMenuEntry: null,
            });

            expect(getInspectorRenderer('folder')).toBeNull();
        });

        it('returns null for unregistered type', () => {
            expect(getInspectorRenderer('nonexistent')).toBeNull();
        });
    });

    describe('registerBuiltinAssetTypes', () => {
        beforeEach(() => {
            registerBuiltinAssetTypes();
        });

        it('registers all expected display types', () => {
            const types = getAllAssetTypes();
            const expected = [
                'image', 'material', 'shader', 'font', 'spine',
                'animclip', 'scene', 'prefab', 'audio', 'script',
                'json', 'folder', 'file',
            ];
            for (const t of expected) {
                expect(types).toContain(t);
            }
        });

        it('maps editor types to display types', () => {
            expect(getDisplayType('texture')).toBe('image');
            expect(getDisplayType('material')).toBe('material');
            expect(getDisplayType('shader')).toBe('shader');
            expect(getDisplayType('bitmap-font')).toBe('font');
            expect(getDisplayType('spine-atlas')).toBe('spine');
            expect(getDisplayType('spine-skeleton')).toBe('spine');
            expect(getDisplayType('anim-clip')).toBe('animclip');
            expect(getDisplayType('scene')).toBe('scene');
            expect(getDisplayType('prefab')).toBe('prefab');
            expect(getDisplayType('audio')).toBe('audio');
        });

        it('marks image and animclip as droppable', () => {
            const droppable = getDroppableTypes();
            expect(droppable.has('image')).toBe(true);
            expect(droppable.has('animclip')).toBe(true);
            expect(droppable.has('material')).toBe(false);
            expect(droppable.has('script')).toBe(false);
        });

        it('provides icons for all builtin types', () => {
            const types = getAllAssetTypes();
            for (const t of types) {
                const icon = getAssetTypeIcon(t, 16);
                expect(typeof icon).toBe('string');
                expect(icon.length).toBeGreaterThan(0);
            }
        });

        it('provides display names for all builtin types', () => {
            const expected: Record<string, string> = {
                image: 'Image',
                material: 'Material',
                shader: 'Shader',
                font: 'BitmapFont',
                spine: 'Spine',
                animclip: 'Animation Clip',
                scene: 'Scene',
                prefab: 'Prefab',
                audio: 'Audio',
                script: 'Script',
                json: 'JSON',
                folder: 'Folder',
                file: 'File',
            };
            for (const [type, name] of Object.entries(expected)) {
                expect(getAssetTypeDisplayName(type)).toBe(name);
            }
        });

        it('sets event categories for applicable types', () => {
            expect(getAssetTypeDescriptor('material')?.eventCategory).toBe('material');
            expect(getAssetTypeDescriptor('image')?.eventCategory).toBe('texture');
            expect(getAssetTypeDescriptor('shader')?.eventCategory).toBe('shader');
            expect(getAssetTypeDescriptor('spine')?.eventCategory).toBe('spine');
            expect(getAssetTypeDescriptor('animclip')?.eventCategory).toBe('anim-clip');
            expect(getAssetTypeDescriptor('script')?.eventCategory).toBeNull();
            expect(getAssetTypeDescriptor('folder')?.eventCategory).toBeNull();
        });

        it('handles spine with two editor types mapping to same display type', () => {
            expect(getDisplayType('spine-atlas')).toBe('spine');
            expect(getDisplayType('spine-skeleton')).toBe('spine');
        });
    });
});
