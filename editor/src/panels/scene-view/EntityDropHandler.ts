import type { EditorStore } from '../../store/EditorStore';
import { getDefaultComponentData, getInitialComponentData } from '../../schemas/ComponentSchemas';
import { getGlobalPathResolver } from '../../asset';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';

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

            if (assetData.type !== 'image') return;

            const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
            this.createSpriteFromDrop(assetData, worldX, worldY);
        });
    }

    private createSpriteFromDrop(
        asset: { type: string; path: string; name: string },
        worldX: number,
        worldY: number,
    ): void {
        const baseName = asset.name.replace(/\.[^.]+$/, '');
        const newEntity = this.store_.createEntity(baseName);

        const transformData = getInitialComponentData('LocalTransform');
        transformData.position = { x: worldX, y: worldY, z: 0 };
        this.store_.addComponent(newEntity, 'LocalTransform', transformData);

        const relativePath = getGlobalPathResolver().toRelativePath(asset.path);
        this.store_.addComponent(newEntity, 'Sprite', {
            ...getInitialComponentData('Sprite'),
            texture: relativePath,
        });

        this.loadImageSize(asset.path).then(size => {
            if (size) {
                const defaultSize = getDefaultComponentData('Sprite').size;
                this.store_.updateProperty(newEntity, 'Sprite', 'size', defaultSize, size);
            }
        });
    }

    private loadImageSize(absolutePath: string): Promise<{ x: number; y: number } | null> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
            img.onerror = () => resolve(null);
            img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
        });
    }
}
