import type { PanelInstance } from '../PanelRegistry';
import type { EditorStore } from '../../store/EditorStore';
import { DisposableStore } from '../../utils/Disposable';
import { getTilesetForSource, getTilesetForImage, findParentTilemapSource, addTilesetLoadListener, type TilesetInfo } from '../../gizmos/TilesetLoader';
import { icons } from '../../utils/icons';

const TILE_RENDER_SIZE = 32;
const SELECTED_COLOR = 'rgba(100, 200, 255, 0.8)';
const HOVER_COLOR = 'rgba(255, 255, 255, 0.3)';
const GRID_COLOR = 'rgba(80, 80, 80, 0.5)';
const BG_COLOR = '#1e1e1e';

export class TilePalettePanel implements PanelInstance {
    private container_: HTMLElement;
    private store_: EditorStore;
    private disposables_ = new DisposableStore();
    private canvas_: HTMLCanvasElement | null = null;
    private ctx_: CanvasRenderingContext2D | null = null;
    private statusEl_: HTMLElement | null = null;
    private hoveredTile_ = -1;
    private cachedInfo_: TilesetInfo | null = null;
    private cachedSource_: string | null = null;
    private isReadOnly_ = false;
    private lastSelectedEntityId_ = -1;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.innerHTML = `
            <div class="es-tile-palette" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
                <div class="es-tile-palette-toolbar" style="display:flex;gap:4px;padding:4px;border-bottom:1px solid var(--border-color, #333);align-items:center;">
                    <button class="es-btn es-btn-icon es-tile-tool-paint es-active" data-tooltip="Paint (B)" style="min-width:24px;height:24px;">${icons.pencil(12)}</button>
                    <button class="es-btn es-btn-icon es-tile-tool-erase" data-tooltip="Erase (Shift)" style="min-width:24px;height:24px;">${icons.trash(12)}</button>
                    <span class="es-tile-palette-status" style="margin-left:auto;font-size:11px;color:#888;"></span>
                </div>
                <div class="es-tile-palette-canvas-wrap" style="flex:1;overflow-y:auto;position:relative;">
                    <canvas class="es-tile-palette-canvas" style="display:block;"></canvas>
                </div>
            </div>`;

        this.canvas_ = this.container_.querySelector('.es-tile-palette-canvas');
        this.ctx_ = this.canvas_?.getContext('2d') ?? null;
        this.statusEl_ = this.container_.querySelector('.es-tile-palette-status');

        this.setupToolbarEvents_();
        this.setupCanvasEvents_();

        this.disposables_.add(store.subscribe(() => this.onStoreChange_()));
        this.disposables_.add(addTilesetLoadListener(() => this.render_()));

        this.onStoreChange_();
    }

    dispose(): void {
        this.disposables_.dispose();
    }

    onShow(): void {
        this.render_();
    }

    private setupToolbarEvents_(): void {
        const paintBtn = this.container_.querySelector('.es-tile-tool-paint');
        const eraseBtn = this.container_.querySelector('.es-tile-tool-erase');

        const onPaint = () => {
            this.store_.tileBrushMode = 'paint';
            this.updateToolbarActive_();
        };
        const onErase = () => {
            this.store_.tileBrushMode = 'erase';
            this.updateToolbarActive_();
        };

        paintBtn?.addEventListener('click', onPaint);
        eraseBtn?.addEventListener('click', onErase);
        this.disposables_.add(() => {
            paintBtn?.removeEventListener('click', onPaint);
            eraseBtn?.removeEventListener('click', onErase);
        });
    }

    private updateToolbarActive_(): void {
        const mode = this.store_.tileBrushMode;
        this.container_.querySelector('.es-tile-tool-paint')
            ?.classList.toggle('es-active', mode === 'paint');
        this.container_.querySelector('.es-tile-tool-erase')
            ?.classList.toggle('es-active', mode === 'erase');
    }

    private setupCanvasEvents_(): void {
        if (!this.canvas_) return;

        const onClick = (e: MouseEvent) => {
            if (this.isReadOnly_) return;
            const tileId = this.getTileAtMouse_(e);
            if (tileId > 0) {
                this.store_.tileBrushSelectedTileId = tileId;
                this.render_();
            }
        };
        const onMove = (e: MouseEvent) => {
            const tileId = this.getTileAtMouse_(e);
            if (tileId !== this.hoveredTile_) {
                this.hoveredTile_ = tileId;
                this.render_();
            }
        };
        const onLeave = () => {
            if (this.hoveredTile_ !== -1) {
                this.hoveredTile_ = -1;
                this.render_();
            }
        };

        this.canvas_.addEventListener('click', onClick);
        this.canvas_.addEventListener('mousemove', onMove);
        this.canvas_.addEventListener('mouseleave', onLeave);
        this.disposables_.add(() => {
            this.canvas_?.removeEventListener('click', onClick);
            this.canvas_?.removeEventListener('mousemove', onMove);
            this.canvas_?.removeEventListener('mouseleave', onLeave);
        });
    }

    private getTileAtMouse_(e: MouseEvent): number {
        if (!this.canvas_ || !this.cachedInfo_) return -1;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const cols = this.cachedInfo_.tilesetColumns;
        const col = Math.floor(x / TILE_RENDER_SIZE);
        const row = Math.floor(y / TILE_RENDER_SIZE);

        if (col < 0 || col >= cols) return -1;

        const totalTiles = this.getTotalTiles_();
        const totalRows = Math.ceil(totalTiles / cols);
        if (row < 0 || row >= totalRows) return -1;

        const index = row * cols + col;
        if (index >= totalTiles) return -1;

        return index + 1;
    }

    private getTotalTiles_(): number {
        if (!this.cachedInfo_?.tilesetImage) return 0;
        const img = this.cachedInfo_.tilesetImage;
        const cols = this.cachedInfo_.tilesetColumns;
        const rows = Math.floor(img.naturalHeight / this.cachedInfo_.tileHeight);
        return cols * rows;
    }

    private onStoreChange_(): void {
        const entityData = this.store_.getSelectedEntityData();
        const entityId = entityData?.id ?? -1;

        const newSource = this.resolveSource_(entityData);

        if (entityId === this.lastSelectedEntityId_ && newSource === this.cachedSource_) return;
        this.lastSelectedEntityId_ = entityId;

        this.isReadOnly_ = false;
        this.cachedSource_ = newSource;
        this.cachedInfo_ = null;

        if (entityData && newSource) {
            const tilemapComp = entityData.components.find(c => c.type === 'Tilemap');
            if (tilemapComp) {
                const source = (tilemapComp.data as Record<string, unknown>).source as string ?? '';
                if (source) {
                    this.cachedInfo_ = getTilesetForSource(source);
                    this.isReadOnly_ = true;
                }
            }

            const layerComp = entityData.components.find(c => c.type === 'TilemapLayer');
            if (layerComp && !this.cachedInfo_) {
                const parentSource = findParentTilemapSource(this.store_.scene.entities, entityData.id);
                if (parentSource) {
                    this.cachedInfo_ = getTilesetForSource(parentSource);
                } else {
                    const layerData = layerComp.data as Record<string, unknown>;
                    const textureUuid = layerData.texture as string ?? '';
                    if (textureUuid && typeof textureUuid === 'string') {
                        const tw = layerData.tileWidth as number ?? 32;
                        const th = layerData.tileHeight as number ?? 32;
                        const cols = layerData.tilesetColumns as number ?? 1;
                        this.cachedInfo_ = getTilesetForImage(textureUuid, tw, th, cols);
                    }
                }
            }
        }

        this.render_();
    }

    private resolveSource_(entityData: { id: number; components: { type: string; data: unknown }[] } | null): string | null {
        if (!entityData) return null;

        const tilemapComp = entityData.components.find(c => c.type === 'Tilemap');
        if (tilemapComp) {
            const source = (tilemapComp.data as Record<string, unknown>).source as string ?? '';
            if (source) return source;
        }

        const layerComp = entityData.components.find(c => c.type === 'TilemapLayer');
        if (layerComp) {
            const parentSource = findParentTilemapSource(this.store_.scene.entities, entityData.id);
            if (parentSource) return parentSource;

            const layerData = layerComp.data as Record<string, unknown>;
            const textureUuid = layerData.texture as string ?? '';
            const tw = layerData.tileWidth as number ?? 32;
            const th = layerData.tileHeight as number ?? 32;
            const cols = layerData.tilesetColumns as number ?? 1;
            if (textureUuid && typeof textureUuid === 'string') {
                return `img:${textureUuid}:${tw}:${th}:${cols}`;
            }
        }

        return null;
    }

    private render_(): void {
        const ctx = this.ctx_;
        if (!this.canvas_ || !ctx) return;

        if (this.statusEl_) {
            if (this.isReadOnly_) {
                this.statusEl_.textContent = 'Read-only (external source)';
            } else if (this.cachedInfo_) {
                this.statusEl_.textContent = `Tile: ${this.store_.tileBrushSelectedTileId}`;
            } else {
                this.statusEl_.textContent = 'No tilemap selected';
            }
        }

        if (!this.cachedInfo_?.tilesetImage) {
            this.canvas_.width = this.canvas_.parentElement?.clientWidth ?? 200;
            this.canvas_.height = 100;
            ctx.fillStyle = BG_COLOR;
            ctx.fillRect(0, 0, this.canvas_.width, this.canvas_.height);
            ctx.fillStyle = '#666';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            const msg = this.cachedSource_ ? 'Loading tileset...' : 'Select a Tilemap entity';
            ctx.fillText(msg, this.canvas_.width / 2, 50);
            return;
        }

        const info = this.cachedInfo_;
        const img = info.tilesetImage!;
        const cols = info.tilesetColumns;
        const totalTiles = this.getTotalTiles_();
        const totalRows = Math.ceil(totalTiles / cols);

        const canvasWidth = cols * TILE_RENDER_SIZE;
        const canvasHeight = totalRows * TILE_RENDER_SIZE;

        this.canvas_.width = canvasWidth;
        this.canvas_.height = canvasHeight;
        this.canvas_.style.width = `${canvasWidth}px`;
        this.canvas_.style.height = `${canvasHeight}px`;

        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.imageSmoothingEnabled = false;

        for (let row = 0; row < totalRows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                if (index >= totalTiles) break;

                const sx = col * info.tileWidth;
                const sy = row * info.tileHeight;
                const dx = col * TILE_RENDER_SIZE;
                const dy = row * TILE_RENDER_SIZE;

                ctx.drawImage(
                    img,
                    sx, sy, info.tileWidth, info.tileHeight,
                    dx, dy, TILE_RENDER_SIZE, TILE_RENDER_SIZE,
                );
            }
        }

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        for (let x = 0; x <= cols; x++) {
            ctx.beginPath();
            ctx.moveTo(x * TILE_RENDER_SIZE + 0.5, 0);
            ctx.lineTo(x * TILE_RENDER_SIZE + 0.5, canvasHeight);
            ctx.stroke();
        }
        for (let y = 0; y <= totalRows; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * TILE_RENDER_SIZE + 0.5);
            ctx.lineTo(canvasWidth, y * TILE_RENDER_SIZE + 0.5);
            ctx.stroke();
        }

        const selectedId = this.store_.tileBrushSelectedTileId;
        if (selectedId > 0 && selectedId <= totalTiles) {
            const si = selectedId - 1;
            const sc = si % cols;
            const sr = Math.floor(si / cols);
            ctx.strokeStyle = SELECTED_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                sc * TILE_RENDER_SIZE + 1,
                sr * TILE_RENDER_SIZE + 1,
                TILE_RENDER_SIZE - 2,
                TILE_RENDER_SIZE - 2,
            );
        }

        if (this.hoveredTile_ > 0 && this.hoveredTile_ <= totalTiles &&
            this.hoveredTile_ !== selectedId) {
            const hi = this.hoveredTile_ - 1;
            const hc = hi % cols;
            const hr = Math.floor(hi / cols);
            ctx.fillStyle = HOVER_COLOR;
            ctx.fillRect(
                hc * TILE_RENDER_SIZE,
                hr * TILE_RENDER_SIZE,
                TILE_RENDER_SIZE,
                TILE_RENDER_SIZE,
            );
        }
    }
}
