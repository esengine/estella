import type { PanelInstance } from '../PanelRegistry';
import type { EditorStore } from '../../store/EditorStore';
import type { EntityData } from '../../types/SceneTypes';
import { DisposableStore } from '../../utils/Disposable';
import { getTilesetForSource, getTilesetForImage, findParentTilemapSource, addTilesetLoadListener, type TilesetInfo } from '../../gizmos/TilesetLoader';
import { icons } from '../../utils/icons';
import { showCreateTilemapDialog } from '../hierarchy/CreateTilemapDialog';

const TILE_RENDER_SIZE = 32;
const SELECTED_COLOR = 'rgba(100, 200, 255, 0.8)';
const HOVER_COLOR = 'rgba(255, 255, 255, 0.3)';
const GRID_COLOR = 'rgba(80, 80, 80, 0.5)';
const BG_COLOR = '#1e1e1e';

type TileBrushTool = 'paint' | 'rect-fill' | 'bucket-fill' | 'eraser' | 'picker';

const TOOL_DEFS: { tool: TileBrushTool; cls: string; label: string; shortcut: string; icon: (s: number) => string }[] = [
    { tool: 'paint', cls: 'es-tile-tool-paint', label: 'Paint', shortcut: 'B', icon: icons.pencil },
    { tool: 'rect-fill', cls: 'es-tile-tool-rect', label: 'Rect Fill', shortcut: 'U', icon: icons.rectFill },
    { tool: 'bucket-fill', cls: 'es-tile-tool-bucket', label: 'Bucket Fill', shortcut: 'G', icon: icons.paintBucket },
    { tool: 'eraser', cls: 'es-tile-tool-eraser', label: 'Eraser', shortcut: 'D', icon: icons.eraser },
    { tool: 'picker', cls: 'es-tile-tool-picker', label: 'Picker', shortcut: 'I', icon: icons.pipette },
];

export class TilePalettePanel implements PanelInstance {
    private container_: HTMLElement;
    private store_: EditorStore;
    private disposables_ = new DisposableStore();
    private canvas_: HTMLCanvasElement | null = null;
    private ctx_: CanvasRenderingContext2D | null = null;
    private statusEl_: HTMLElement | null = null;
    private layerSelect_: HTMLSelectElement | null = null;
    private hoveredTile_ = -1;
    private cachedInfo_: TilesetInfo | null = null;
    private cachedSource_: string | null = null;
    private isReadOnly_ = false;
    private lastSelectedEntityId_ = -1;

    private dragStartTile_ = -1;
    private dragEndTile_ = -1;
    private isDragging_ = false;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.innerHTML = `
            <div class="es-tile-palette">
                <div class="es-tile-palette-toolbar">
                    ${TOOL_DEFS.map(d =>
                        `<button class="es-btn es-btn-icon ${d.cls}" data-tooltip="${d.label} (${d.shortcut})">${d.icon(14)}</button>`
                    ).join('')}
                    <span class="es-tool-separator"></span>
                    <button class="es-btn es-btn-icon es-tile-flip-h" data-tooltip="Flip Horizontal">${icons.flipHorizontal(14)}</button>
                    <button class="es-btn es-btn-icon es-tile-flip-v" data-tooltip="Flip Vertical">${icons.flipVertical(14)}</button>
                </div>
                <div class="es-tile-palette-info">
                    <label>Layer:</label>
                    <select class="es-tile-layer-select es-select"></select>
                    <button class="es-btn es-btn-icon es-tile-layer-add" data-tooltip="Add Layer">+</button>
                    <button class="es-btn es-btn-icon es-tile-layer-del" data-tooltip="Delete Layer">\u2212</button>
                    <button class="es-btn es-btn-icon es-tile-layer-up" data-tooltip="Move Up">\u2191</button>
                    <button class="es-btn es-btn-icon es-tile-layer-down" data-tooltip="Move Down">\u2193</button>
                    <button class="es-btn es-btn-icon es-tile-layer-vis" data-tooltip="Toggle Visibility">${icons.eye(12)}</button>
                    <span class="es-tile-palette-status"></span>
                </div>
                <div class="es-tile-palette-canvas-wrap">
                    <canvas class="es-tile-palette-canvas"></canvas>
                </div>
            </div>`;

        this.canvas_ = this.container_.querySelector('.es-tile-palette-canvas');
        this.ctx_ = this.canvas_?.getContext('2d') ?? null;
        this.statusEl_ = this.container_.querySelector('.es-tile-palette-status');
        this.layerSelect_ = this.container_.querySelector('.es-tile-layer-select');

        this.setupToolbarEvents_();
        this.setupCanvasEvents_();
        this.setupLayerSelect_();

        this.disposables_.add(store.subscribe(() => this.onStoreChange_()));
        this.disposables_.add(addTilesetLoadListener(() => {
            this.lastSelectedEntityId_ = -1;
            this.onStoreChange_();
        }));

        this.onStoreChange_();
    }

    dispose(): void {
        this.disposables_.dispose();
    }

    onShow(): void {
        this.render_();
    }

    private setupToolbarEvents_(): void {
        for (const def of TOOL_DEFS) {
            const btn = this.container_.querySelector(`.${def.cls}`);
            if (!btn) continue;
            const handler = () => {
                this.store_.tileBrushTool = def.tool;
                this.updateToolbarActive_();
            };
            btn.addEventListener('click', handler);
            this.disposables_.add(() => btn.removeEventListener('click', handler));
        }

        const flipH = this.container_.querySelector('.es-tile-flip-h');
        const flipV = this.container_.querySelector('.es-tile-flip-v');

        const onFlipH = () => {
            this.store_.tileBrushFlipH = !this.store_.tileBrushFlipH;
            this.updateToolbarActive_();
        };
        const onFlipV = () => {
            this.store_.tileBrushFlipV = !this.store_.tileBrushFlipV;
            this.updateToolbarActive_();
        };

        flipH?.addEventListener('click', onFlipH);
        flipV?.addEventListener('click', onFlipV);
        this.disposables_.add(() => {
            flipH?.removeEventListener('click', onFlipH);
            flipV?.removeEventListener('click', onFlipV);
        });
    }

    private updateToolbarActive_(): void {
        const tool = this.store_.tileBrushTool;
        for (const def of TOOL_DEFS) {
            this.container_.querySelector(`.${def.cls}`)
                ?.classList.toggle('es-active', tool === def.tool);
        }
        this.container_.querySelector('.es-tile-flip-h')
            ?.classList.toggle('es-active', this.store_.tileBrushFlipH);
        this.container_.querySelector('.es-tile-flip-v')
            ?.classList.toggle('es-active', this.store_.tileBrushFlipV);
    }

    private setupLayerSelect_(): void {
        if (!this.layerSelect_) return;
        const onChange = () => {
            const id = parseInt(this.layerSelect_!.value, 10);
            if (!isNaN(id)) {
                this.store_.selectEntity(id);
            }
        };
        this.layerSelect_.addEventListener('change', onChange);
        this.disposables_.add(() => this.layerSelect_?.removeEventListener('change', onChange));

        const onDblClick = (e: Event) => {
            e.preventDefault();
            this.renameLayer_();
        };
        this.layerSelect_.addEventListener('dblclick', onDblClick);
        this.disposables_.add(() => this.layerSelect_?.removeEventListener('dblclick', onDblClick));

        const addBtn = this.container_.querySelector('.es-tile-layer-add');
        const delBtn = this.container_.querySelector('.es-tile-layer-del');
        const upBtn = this.container_.querySelector('.es-tile-layer-up');
        const downBtn = this.container_.querySelector('.es-tile-layer-down');
        const visBtn = this.container_.querySelector('.es-tile-layer-vis');

        const onAdd = () => this.addLayer_();
        const onDel = () => this.deleteLayer_();
        const onUp = () => this.moveLayer_(-1);
        const onDown = () => this.moveLayer_(1);
        const onVis = () => this.toggleLayerVisibility_();

        addBtn?.addEventListener('click', onAdd);
        delBtn?.addEventListener('click', onDel);
        upBtn?.addEventListener('click', onUp);
        downBtn?.addEventListener('click', onDown);
        visBtn?.addEventListener('click', onVis);
        this.disposables_.add(() => {
            addBtn?.removeEventListener('click', onAdd);
            delBtn?.removeEventListener('click', onDel);
            upBtn?.removeEventListener('click', onUp);
            downBtn?.removeEventListener('click', onDown);
            visBtn?.removeEventListener('click', onVis);
        });
    }

    private getLayerSiblings_(): EntityData[] {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return [];
        const parentId = entityData.parent;
        return this.store_.scene.entities.filter(e =>
            e.parent === parentId && e.components.some(c => c.type === 'TilemapLayer'),
        );
    }

    private getSelectedLayerId_(): number {
        if (!this.layerSelect_) return -1;
        const id = parseInt(this.layerSelect_.value, 10);
        return isNaN(id) ? -1 : id;
    }

    private addLayer_(): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        const siblings = this.getLayerSiblings_();

        if (siblings.length === 0) {
            const parentId = entityData.parent;
            showCreateTilemapDialog(
                { store: this.store_ },
                parentId ?? null,
                { simplified: true },
            );
            return;
        }

        const parentId = entityData.parent;
        let maxLayer = 0;
        let templateData: Record<string, unknown> = {};
        for (const sib of siblings) {
            const comp = sib.components.find(c => c.type === 'TilemapLayer');
            if (comp) {
                const d = comp.data as Record<string, unknown>;
                const layer = d.layer as number ?? 0;
                if (layer > maxLayer) maxLayer = layer;
                templateData = d;
            }
        }

        const newEntity = this.store_.createEntity(`Layer ${siblings.length}`, parentId ?? null);
        this.store_.addComponent(newEntity, 'TilemapLayer', {
            infinite: templateData.infinite ?? true,
            width: templateData.width ?? 0,
            height: templateData.height ?? 0,
            tileWidth: templateData.tileWidth ?? 32,
            tileHeight: templateData.tileHeight ?? 32,
            texture: templateData.texture ?? '',
            tilesetColumns: templateData.tilesetColumns ?? 1,
            layer: maxLayer + 1,
            visible: true,
            opacity: 1,
            tiles: [],
            chunks: {},
        });
        this.store_.selectEntity(newEntity);
    }

    private deleteLayer_(): void {
        const layerId = this.getSelectedLayerId_();
        if (layerId < 0) return;

        if (!confirm('Delete this tilemap layer?')) return;

        this.store_.deleteEntity(layerId);
    }

    private moveLayer_(direction: number): void {
        const layerId = this.getSelectedLayerId_();
        if (layerId < 0) return;

        const siblings = this.getLayerSiblings_();
        siblings.sort((a, b) => {
            const la = (a.components.find(c => c.type === 'TilemapLayer')?.data as Record<string, unknown>)?.layer as number ?? 0;
            const lb = (b.components.find(c => c.type === 'TilemapLayer')?.data as Record<string, unknown>)?.layer as number ?? 0;
            return la - lb;
        });

        const idx = siblings.findIndex(e => e.id === layerId);
        if (idx < 0) return;
        const swapIdx = idx + direction;
        if (swapIdx < 0 || swapIdx >= siblings.length) return;

        const compA = siblings[idx].components.find(c => c.type === 'TilemapLayer');
        const compB = siblings[swapIdx].components.find(c => c.type === 'TilemapLayer');
        if (!compA || !compB) return;

        const layerA = (compA.data as Record<string, unknown>).layer as number ?? 0;
        const layerB = (compB.data as Record<string, unknown>).layer as number ?? 0;

        this.store_.updatePropertyDirect(siblings[idx].id, 'TilemapLayer', 'layer', layerB);
        this.store_.updatePropertyDirect(siblings[swapIdx].id, 'TilemapLayer', 'layer', layerA);
    }

    private renameLayer_(): void {
        const layerId = this.getSelectedLayerId_();
        if (layerId < 0) return;

        const entity = this.store_.getEntityData(layerId);
        if (!entity) return;

        const newName = prompt('Rename layer:', entity.name || '');
        if (newName !== null && newName !== entity.name) {
            this.store_.renameEntity(layerId, newName);
            this.updateLayerDropdown_();
        }
    }

    private toggleLayerVisibility_(): void {
        const layerId = this.getSelectedLayerId_();
        if (layerId < 0) return;

        const entity = this.store_.getEntityData(layerId);
        if (!entity) return;
        const comp = entity.components.find(c => c.type === 'TilemapLayer');
        if (!comp) return;

        const current = (comp.data as Record<string, unknown>).visible as boolean ?? true;
        this.store_.updatePropertyDirect(layerId, 'TilemapLayer', 'visible', !current);
    }

    private updateLayerDropdown_(): void {
        if (!this.layerSelect_) return;

        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) {
            this.layerSelect_.innerHTML = '';
            return;
        }

        const parentId = entityData.parent;
        const siblings = this.store_.scene.entities.filter(e => {
            if (e.parent !== parentId) return false;
            return e.components.some(c => c.type === 'TilemapLayer');
        });

        if (siblings.length === 0 && entityData.components.some(c => c.type === 'TilemapLayer')) {
            siblings.push(entityData);
        }

        const currentValue = this.layerSelect_.value;
        this.layerSelect_.innerHTML = siblings.map(e =>
            `<option value="${e.id}"${e.id === entityData.id ? ' selected' : ''}>${e.name || `Entity ${e.id}`}</option>`
        ).join('');

        if (this.layerSelect_.value !== currentValue) {
            this.layerSelect_.value = String(entityData.id);
        }
    }

    private setupCanvasEvents_(): void {
        if (!this.canvas_) return;

        const onMouseDown = (e: MouseEvent) => {
            if (this.isReadOnly_ || e.button !== 0) return;
            const tileId = this.getTileAtMouse_(e);
            if (tileId <= 0) return;

            this.isDragging_ = true;
            this.dragStartTile_ = tileId;
            this.dragEndTile_ = tileId;

            this.store_.tileBrushStamp = { width: 1, height: 1, tiles: [tileId] };
            this.render_();
        };

        const onMouseMove = (e: MouseEvent) => {
            const tileId = this.getTileAtMouse_(e);

            if (this.isDragging_) {
                if (tileId > 0 && tileId !== this.dragEndTile_) {
                    this.dragEndTile_ = tileId;
                    this.updateStampFromDrag_();
                    this.render_();
                }
                return;
            }

            if (tileId !== this.hoveredTile_) {
                this.hoveredTile_ = tileId;
                this.render_();
            }
        };

        const onMouseUp = () => {
            if (this.isDragging_) {
                this.isDragging_ = false;
                this.updateStampFromDrag_();
                this.render_();
            }
        };

        const onLeave = () => {
            if (this.isDragging_) {
                this.isDragging_ = false;
                this.updateStampFromDrag_();
            }
            if (this.hoveredTile_ !== -1) {
                this.hoveredTile_ = -1;
                this.render_();
            }
        };

        this.canvas_.addEventListener('mousedown', onMouseDown);
        this.canvas_.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        this.canvas_.addEventListener('mouseleave', onLeave);
        this.disposables_.add(() => {
            this.canvas_?.removeEventListener('mousedown', onMouseDown);
            this.canvas_?.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            this.canvas_?.removeEventListener('mouseleave', onLeave);
        });
    }

    private updateStampFromDrag_(): void {
        if (!this.cachedInfo_) return;
        const cols = this.cachedInfo_.tilesetColumns;

        const startIdx = this.dragStartTile_ - 1;
        const endIdx = this.dragEndTile_ - 1;

        const startCol = startIdx % cols;
        const startRow = Math.floor(startIdx / cols);
        const endCol = endIdx % cols;
        const endRow = Math.floor(endIdx / cols);

        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);

        const w = maxCol - minCol + 1;
        const h = maxRow - minRow + 1;
        const tiles: number[] = [];

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                tiles.push(r * cols + c + 1);
            }
        }

        this.store_.tileBrushStamp = { width: w, height: h, tiles };
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

        const newSource = this.resolveSource_(entityData ?? null);

        if (entityId === this.lastSelectedEntityId_ && newSource === this.cachedSource_) {
            this.updateToolbarActive_();
            this.updateStatusText_();
            return;
        }
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

        this.updateLayerDropdown_();
        this.updateToolbarActive_();
        this.render_();
    }

    private resolveSource_(entityData: EntityData | null): string | null {
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

    private updateStatusText_(): void {
        if (!this.statusEl_) return;
        if (this.isReadOnly_) {
            this.statusEl_.textContent = 'Read-only';
        } else if (this.cachedInfo_) {
            const stamp = this.store_.tileBrushStamp;
            let text: string;
            if (stamp.width === 1 && stamp.height === 1) {
                text = `Tile: ${stamp.tiles[0] ?? 0}`;
            } else {
                text = `${stamp.width}\u00D7${stamp.height} stamp`;
            }
            const fh = this.store_.tileBrushFlipH;
            const fv = this.store_.tileBrushFlipV;
            if (fh || fv) {
                text += ` [${fh ? 'H' : ''}${fv ? 'V' : ''}]`;
            }
            this.statusEl_.textContent = text;
        } else {
            this.statusEl_.textContent = '';
        }
    }

    private render_(): void {
        const ctx = this.ctx_;
        if (!this.canvas_ || !ctx) return;

        this.updateStatusText_();

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

        this.drawSelection_(ctx, cols, totalTiles);

        if (this.hoveredTile_ > 0 && this.hoveredTile_ <= totalTiles) {
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

    private drawSelection_(ctx: CanvasRenderingContext2D, cols: number, totalTiles: number): void {
        const stamp = this.store_.tileBrushStamp;

        if (this.isDragging_ && this.dragStartTile_ > 0 && this.dragEndTile_ > 0) {
            const startIdx = this.dragStartTile_ - 1;
            const endIdx = this.dragEndTile_ - 1;
            const minCol = Math.min(startIdx % cols, endIdx % cols);
            const maxCol = Math.max(startIdx % cols, endIdx % cols);
            const minRow = Math.min(Math.floor(startIdx / cols), Math.floor(endIdx / cols));
            const maxRow = Math.max(Math.floor(startIdx / cols), Math.floor(endIdx / cols));

            ctx.strokeStyle = SELECTED_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                minCol * TILE_RENDER_SIZE + 1,
                minRow * TILE_RENDER_SIZE + 1,
                (maxCol - minCol + 1) * TILE_RENDER_SIZE - 2,
                (maxRow - minRow + 1) * TILE_RENDER_SIZE - 2,
            );
            return;
        }

        if (stamp.tiles.length === 0) return;

        if (stamp.width === 1 && stamp.height === 1) {
            const selectedId = stamp.tiles[0];
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
        } else {
            const firstId = stamp.tiles[0];
            if (firstId <= 0) return;
            const fi = firstId - 1;
            const startCol = fi % cols;
            const startRow = Math.floor(fi / cols);

            ctx.strokeStyle = SELECTED_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                startCol * TILE_RENDER_SIZE + 1,
                startRow * TILE_RENDER_SIZE + 1,
                stamp.width * TILE_RENDER_SIZE - 2,
                stamp.height * TILE_RENDER_SIZE - 2,
            );
        }
    }
}
