import type { EditorStore } from '../../store/EditorStore';
import { getDefaultComponentData, getInitialComponentData } from '../../schemas/ComponentSchemas';
import { getGlobalPathResolver } from '../../asset';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';

const DROPPABLE_TYPES = new Set(['image', 'animclip']);

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

            if (!DROPPABLE_TYPES.has(assetData.type)) return;

            const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);

            if (assetData.type === 'animclip') {
                this.createAnimatorFromDrop(assetData, worldX, worldY);
            } else {
                this.createSpriteFromDrop(assetData, worldX, worldY);
            }
        });
    }

    private createSpriteFromDrop(
        asset: { type: string; path: string; name: string },
        worldX: number,
        worldY: number,
    ): void {
        const baseName = asset.name.replace(/\.[^.]+$/, '');
        const newEntity = this.store_.createEntity(baseName);

        const transformData = getInitialComponentData('Transform');
        transformData.position = { x: worldX, y: worldY, z: 0 };
        this.store_.addComponent(newEntity, 'Transform', transformData);

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

    private createAnimatorFromDrop(
        asset: { type: string; path: string; name: string },
        worldX: number,
        worldY: number,
    ): void {
        const baseName = asset.name.replace(/\.[^.]+$/, '');
        const newEntity = this.store_.createEntity(baseName);

        const transformData = getInitialComponentData('Transform');
        transformData.position = { x: worldX, y: worldY, z: 0 };
        this.store_.addComponent(newEntity, 'Transform', transformData);

        this.store_.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));

        const relativePath = getGlobalPathResolver().toRelativePath(asset.path);
        this.store_.addComponent(newEntity, 'SpriteAnimator', {
            ...getInitialComponentData('SpriteAnimator'),
            clip: relativePath,
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
