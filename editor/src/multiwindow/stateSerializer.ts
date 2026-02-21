import type { EditorStore } from '../store/EditorStore';
import type { SerializedEditorState } from './protocol';

export function serializeEditorState(store: EditorStore): SerializedEditorState {
    return {
        scene: store.scene,
        selectedEntities: Array.from(store.selectedEntities),
        selectedAsset: store.selectedAsset,
        isDirty: store.isDirty,
        filePath: store.filePath,
        canUndo: store.canUndo,
        canRedo: store.canRedo,
        isEditingPrefab: store.isEditingPrefab,
        prefabEditingPath: store.prefabEditingPath,
        sceneVersion: store.sceneVersion,
    };
}
