import type { Entity } from 'esengine';
import { Dialog } from '../../ui/dialog/Dialog';
import { showAssetPicker } from '../../ui/asset-picker';
import { getAssetLibrary } from '../../asset/AssetLibrary';
import { loadImageFromPath } from '../../gizmos/TilesetLoader';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import { getNavigationService } from '../../services';
import type { EditorStore } from '../../store/EditorStore';

const DEFAULT_TILE_SIZE = 32;
const DEFAULT_MAP_WIDTH = 20;
const DEFAULT_MAP_HEIGHT = 15;

interface TilemapConfig {
    textureUuid: string;
    tileWidth: number;
    tileHeight: number;
    tilesetColumns: number;
    mapWidth: number;
    mapHeight: number;
    infinite: boolean;
}

export interface CreateTilemapOptions {
    simplified?: boolean;
}

export async function showCreateTilemapDialog(
    state: { store: EditorStore },
    parent: Entity | null,
    options?: CreateTilemapOptions,
): Promise<Entity | null> {
    const simplified = options?.simplified ?? false;
    const config: TilemapConfig = {
        textureUuid: '',
        tileWidth: DEFAULT_TILE_SIZE,
        tileHeight: DEFAULT_TILE_SIZE,
        tilesetColumns: 1,
        mapWidth: DEFAULT_MAP_WIDTH,
        mapHeight: DEFAULT_MAP_HEIGHT,
        infinite: simplified,
    };

    let loadedImage: HTMLImageElement | null = null;
    let previewCanvas: HTMLCanvasElement | null = null;
    let columnsInput: HTMLInputElement | null = null;

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    content.innerHTML = `
        <div class="es-dialog-field">
            <label class="es-dialog-label">Tileset Image</label>
            <div style="display:flex;gap:4px;align-items:center;">
                <input type="text" class="es-dialog-input es-tilemap-image-name" readonly placeholder="Select image..." style="flex:1;">
                <button class="es-btn es-tilemap-browse-btn" style="min-width:60px;">Browse</button>
            </div>
        </div>
        <div class="es-dialog-field" style="display:flex;gap:12px;">
            <div style="flex:1;">
                <label class="es-dialog-label">Tile Width</label>
                <input type="number" class="es-dialog-input es-tilemap-tw" value="${DEFAULT_TILE_SIZE}" min="1" max="512" step="1">
            </div>
            <div style="flex:1;">
                <label class="es-dialog-label">Tile Height</label>
                <input type="number" class="es-dialog-input es-tilemap-th" value="${DEFAULT_TILE_SIZE}" min="1" max="512" step="1">
            </div>
            <div style="flex:1;">
                <label class="es-dialog-label">Columns</label>
                <input type="number" class="es-dialog-input es-tilemap-cols" value="1" min="1" max="256" step="1">
            </div>
        </div>
        <div class="es-dialog-field" style="${simplified ? 'display:none;' : ''}">
            <label class="es-dialog-label">Map Type</label>
            <select class="es-dialog-input es-tilemap-map-type" style="width:100%;">
                <option value="fixed"${simplified ? '' : ' selected'}>Fixed Size</option>
                <option value="infinite"${simplified ? ' selected' : ''}>Infinite</option>
            </select>
        </div>
        <div class="es-dialog-field es-tilemap-size-row" style="display:${simplified ? 'none' : 'flex'};gap:12px;">
            <div style="flex:1;">
                <label class="es-dialog-label">Map Width (tiles)</label>
                <input type="number" class="es-dialog-input es-tilemap-mw" value="${DEFAULT_MAP_WIDTH}" min="1" max="1000" step="1">
            </div>
            <div style="flex:1;">
                <label class="es-dialog-label">Map Height (tiles)</label>
                <input type="number" class="es-dialog-input es-tilemap-mh" value="${DEFAULT_MAP_HEIGHT}" min="1" max="1000" step="1">
            </div>
        </div>
        <div class="es-dialog-field">
            <label class="es-dialog-label">Preview</label>
            <div class="es-tilemap-preview-wrap" style="height:120px;overflow:auto;background:#1a1a1a;border:1px solid var(--border-color, #333);border-radius:4px;display:flex;align-items:center;justify-content:center;">
                <canvas class="es-tilemap-preview-canvas" style="display:none;"></canvas>
                <span class="es-tilemap-preview-placeholder" style="color:#666;font-size:12px;">Select a tileset image to preview</span>
            </div>
        </div>`;

    const imageNameInput = content.querySelector('.es-tilemap-image-name') as HTMLInputElement;
    const browseBtn = content.querySelector('.es-tilemap-browse-btn') as HTMLButtonElement;
    const twInput = content.querySelector('.es-tilemap-tw') as HTMLInputElement;
    const thInput = content.querySelector('.es-tilemap-th') as HTMLInputElement;
    columnsInput = content.querySelector('.es-tilemap-cols') as HTMLInputElement;
    const mwInput = content.querySelector('.es-tilemap-mw') as HTMLInputElement;
    const mhInput = content.querySelector('.es-tilemap-mh') as HTMLInputElement;
    previewCanvas = content.querySelector('.es-tilemap-preview-canvas') as HTMLCanvasElement;
    const placeholder = content.querySelector('.es-tilemap-preview-placeholder') as HTMLElement;

    function updateColumns(): void {
        if (loadedImage && config.tileWidth > 0) {
            config.tilesetColumns = Math.max(1, Math.floor(loadedImage.naturalWidth / config.tileWidth));
            if (columnsInput) columnsInput.value = String(config.tilesetColumns);
        }
    }

    function renderPreview(): void {
        if (!previewCanvas || !loadedImage) return;
        const ctx = previewCanvas.getContext('2d');
        if (!ctx) return;

        previewCanvas.style.display = 'block';
        placeholder.style.display = 'none';

        const w = loadedImage.naturalWidth;
        const h = loadedImage.naturalHeight;
        const scale = Math.min(1, 300 / w);
        previewCanvas.width = Math.floor(w * scale);
        previewCanvas.height = Math.floor(h * scale);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(loadedImage, 0, 0, previewCanvas.width, previewCanvas.height);

        if (config.tileWidth > 0 && config.tileHeight > 0) {
            ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
            ctx.lineWidth = 1;
            const tw = config.tileWidth * scale;
            const th = config.tileHeight * scale;
            for (let x = tw; x < previewCanvas.width; x += tw) {
                ctx.beginPath();
                ctx.moveTo(Math.floor(x) + 0.5, 0);
                ctx.lineTo(Math.floor(x) + 0.5, previewCanvas.height);
                ctx.stroke();
            }
            for (let y = th; y < previewCanvas.height; y += th) {
                ctx.beginPath();
                ctx.moveTo(0, Math.floor(y) + 0.5);
                ctx.lineTo(previewCanvas.width, Math.floor(y) + 0.5);
                ctx.stroke();
            }
        }
    }

    browseBtn.addEventListener('click', async () => {
        const result = await showAssetPicker({
            title: 'Select Tileset Image',
            allowedTypes: ['image'],
            extensions: ['png', 'jpg', 'jpeg', 'webp'],
        });
        if (!result) return;

        config.textureUuid = result.uuid ?? '';
        imageNameInput.value = result.name;
        dialog.setButtonEnabled(0, !!config.textureUuid);

        loadedImage = await loadImageFromPath(result.relativePath);
        updateColumns();
        renderPreview();
    });

    twInput.addEventListener('input', () => {
        config.tileWidth = Math.max(1, parseInt(twInput.value) || DEFAULT_TILE_SIZE);
        updateColumns();
        renderPreview();
    });
    thInput.addEventListener('input', () => {
        config.tileHeight = Math.max(1, parseInt(thInput.value) || DEFAULT_TILE_SIZE);
        renderPreview();
    });
    columnsInput.addEventListener('input', () => {
        config.tilesetColumns = Math.max(1, parseInt(columnsInput!.value) || 1);
    });
    mwInput.addEventListener('input', () => {
        config.mapWidth = Math.max(1, parseInt(mwInput.value) || DEFAULT_MAP_WIDTH);
    });
    mhInput.addEventListener('input', () => {
        config.mapHeight = Math.max(1, parseInt(mhInput.value) || DEFAULT_MAP_HEIGHT);
    });

    const mapTypeSelect = content.querySelector('.es-tilemap-map-type') as HTMLSelectElement;
    const sizeRow = content.querySelector('.es-tilemap-size-row') as HTMLElement;
    mapTypeSelect.addEventListener('change', () => {
        config.infinite = mapTypeSelect.value === 'infinite';
        sizeRow.style.display = config.infinite ? 'none' : 'flex';
    });

    const dialog = new Dialog({
        title: 'New Tilemap Layer',
        content,
        width: 420,
        buttons: [
            { label: 'Create', role: 'confirm', primary: true, disabled: true },
            { label: 'Cancel', role: 'cancel' },
        ],
    });

    const result = await dialog.open();
    if (result.action !== 'confirm' || !config.textureUuid) return null;

    const entity = state.store.createEntity('TilemapLayer', parent);
    const transformData = getInitialComponentData('Transform');
    state.store.addComponent(entity, 'Transform', transformData);

    const layerData = getInitialComponentData('TilemapLayer');
    if (config.infinite) {
        state.store.addComponent(entity, 'TilemapLayer', {
            ...layerData,
            texture: config.textureUuid,
            tileWidth: config.tileWidth,
            tileHeight: config.tileHeight,
            tilesetColumns: config.tilesetColumns,
            infinite: true,
            width: 0,
            height: 0,
            tiles: [],
            chunks: {},
        });
    } else {
        const tiles = new Array(config.mapWidth * config.mapHeight).fill(0);
        state.store.addComponent(entity, 'TilemapLayer', {
            ...layerData,
            texture: config.textureUuid,
            tileWidth: config.tileWidth,
            tileHeight: config.tileHeight,
            tilesetColumns: config.tilesetColumns,
            width: config.mapWidth,
            height: config.mapHeight,
            tiles,
        });
    }

    state.store.selectEntity(entity);
    state.store.requestGizmo('tile-brush');
    getNavigationService().showPanel('tile-palette');
    return entity;
}
