import type { EditorStore } from '../../store/EditorStore';
import { getDroppableTypes, getAssetTypeDescriptor } from '../../asset/AssetTypeRegistry';

export class EntityDropHandler {
    private store_: EditorStore;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    setupListeners(
        canvas: HTMLCanvasElement,
        screenToWorld: (clientX: number, clientY: number) => { worldX: number; worldY: number },
    ): void {
        canvas.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            if (!Array.from(types).includes('application/esengine-asset')) return;
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const assetDataStr = e.dataTransfer?.getData('application/esengine-asset');
            if (!assetDataStr) return;

            let assetData: { type: string; path: string; name: string };
            try {
                assetData = JSON.parse(assetDataStr);
            } catch {
                return;
            }

            if (!getDroppableTypes().has(assetData.type)) return;

            const descriptor = getAssetTypeDescriptor(assetData.type);
            if (!descriptor?.onDropToScene) return;

            const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
            descriptor.onDropToScene(this.store_, assetData, worldX, worldY);
        });
    }
}
