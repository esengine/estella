import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorContainer, setEditorContainer } from '../../container/EditorContainer';
import {
    resetAssetTypeRegistry,
    registerBuiltinAssetTypes,
    getAssetTypeDescriptor,
    getDroppableTypes,
    getInspectorRenderer,
} from '../../asset/AssetTypeRegistry';

setEditorContainer(new EditorContainer());

describe('AssetTypeRegistry behavior dispatch', () => {
    beforeEach(() => {
        resetAssetTypeRegistry();
        registerBuiltinAssetTypes();
    });

    describe('inspector renderer registration', () => {
        it('image has an inspector renderer', () => {
            expect(getInspectorRenderer('image')).not.toBeNull();
        });

        it('script has an inspector renderer', () => {
            expect(getInspectorRenderer('script')).not.toBeNull();
        });

        it('scene has an inspector renderer', () => {
            expect(getInspectorRenderer('scene')).not.toBeNull();
        });

        it('material has an inspector renderer', () => {
            expect(getInspectorRenderer('material')).not.toBeNull();
        });

        it('font has an inspector renderer', () => {
            expect(getInspectorRenderer('font')).not.toBeNull();
        });

        it('folder has an inspector renderer', () => {
            expect(getInspectorRenderer('folder')).not.toBeNull();
        });

        it('animclip has an inspector renderer', () => {
            expect(getInspectorRenderer('animclip')).not.toBeNull();
        });

        it('file has an inspector renderer (generic fallback)', () => {
            expect(getInspectorRenderer('file')).not.toBeNull();
        });
    });

    describe('drop to scene', () => {
        it('image has onDropToScene', () => {
            const desc = getAssetTypeDescriptor('image');
            expect(desc?.onDropToScene).toBeDefined();
        });

        it('animclip has onDropToScene', () => {
            const desc = getAssetTypeDescriptor('animclip');
            expect(desc?.onDropToScene).toBeDefined();
        });

        it('non-droppable types do not have onDropToScene', () => {
            const nonDroppable = ['material', 'shader', 'font', 'scene', 'script', 'json', 'folder', 'file'];
            for (const t of nonDroppable) {
                const desc = getAssetTypeDescriptor(t);
                expect(desc?.onDropToScene).toBeUndefined();
            }
        });
    });

    describe('create entity from asset', () => {
        it('image has onCreateEntity', () => {
            expect(getAssetTypeDescriptor('image')?.onCreateEntity).toBeDefined();
        });

        it('animclip has onCreateEntity', () => {
            expect(getAssetTypeDescriptor('animclip')?.onCreateEntity).toBeDefined();
        });

        it('prefab has onCreateEntity', () => {
            expect(getAssetTypeDescriptor('prefab')?.onCreateEntity).toBeDefined();
        });

        it('spine has onCreateEntity', () => {
            expect(getAssetTypeDescriptor('spine')?.onCreateEntity).toBeDefined();
        });
    });

    describe('droppable types set', () => {
        it('matches descriptors with droppable=true', () => {
            const droppable = getDroppableTypes();
            expect(droppable.size).toBeGreaterThan(0);
            for (const t of droppable) {
                expect(getAssetTypeDescriptor(t)?.droppable).toBe(true);
            }
        });
    });
});
