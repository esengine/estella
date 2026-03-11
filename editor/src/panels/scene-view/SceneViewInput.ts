import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { GizmoContext } from '../../gizmos';
import { GizmoManager } from '../../gizmos';
import { ColliderOverlay } from '../../gizmos/ColliderOverlay';
import { PivotOverlay } from '../../gizmos/PivotOverlay';
import { getSettingsValue } from '../../settings/SettingsRegistry';
import { getClipboardService } from '../../services';
import type { CameraController } from './CameraController';
import type { GizmoToolbar } from './GizmoToolbar';
import type { MarqueeSelection, BoundsProvider } from './MarqueeSelection';
import { DisposableStore } from '../../utils/Disposable';

export interface InputDeps {
    store: EditorStore;
    canvas: HTMLCanvasElement;
    overlayCanvas: HTMLCanvasElement | null;
    camera: CameraController;
    toolbar: GizmoToolbar;
    marquee: MarqueeSelection;
    gizmoManager: GizmoManager;
    colliderOverlay: ColliderOverlay;
    pivotOverlay: PivotOverlay;
    getBounds: BoundsProvider;
    createGizmoContext: (ctx: CanvasRenderingContext2D) => GizmoContext;
    createOverlayContext: () => { ctx: CanvasRenderingContext2D; zoom: number; store: EditorStore } | null;
    requestRender: () => void;
}

export class SceneViewInput {
    private deps_: InputDeps;
    private disposables_ = new DisposableStore();

    private skipNextClick_ = false;
    private mouseDownX_ = 0;
    private mouseDownY_ = 0;

    private boundOnDocumentMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnDocumentMouseUp_: ((e: MouseEvent) => void) | null = null;

    constructor(deps: InputDeps) {
        this.deps_ = deps;
    }

    setup(): void {
        const { canvas, camera } = this.deps_;

        const resetBtn = canvas.closest('.es-sceneview-panel')?.querySelector('[data-action="reset-view"]');
        resetBtn?.addEventListener('click', () => {
            camera.reset();
            this.deps_.toolbar.updateZoomDisplay(camera.zoom);
            this.deps_.requestRender();
        });

        this.setupKeyboard();
        this.setupMouse();
    }

    private setupKeyboard(): void {
        const { camera, toolbar, store } = this.deps_;

        this.disposables_.addListener(document, 'keydown', (ev) => {
            const e = ev as KeyboardEvent;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === ' ' && !camera.spaceDown) {
                camera.spaceDown = true;
                if (!camera.isDragging) {
                    this.deps_.canvas.style.cursor = 'grab';
                }
                e.preventDefault();
                return;
            }

            if (toolbar.handleKeyShortcut(e.key)) return;

            if (e.key === 'f' || e.key === 'F') {
                const entity = store.selectedEntity;
                if (entity !== null) {
                    const worldTransform = store.getWorldTransform(entity as number);
                    camera.focusOnEntity(worldTransform.position.x, worldTransform.position.y);
                    toolbar.updateZoomDisplay(camera.zoom);
                }
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (store.selectedEntities.size > 0) {
                    store.deleteSelectedEntities();
                }
                return;
            }

            if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                getClipboardService().duplicateSelected();
                return;
            }

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                camera.nudgeSelection(e, store as any);
                return;
            }

            if (e.key === '+' || e.key === '=') {
                camera.zoomIn();
                toolbar.updateZoomDisplay(camera.zoom);
                return;
            }

            if (e.key === '-') {
                camera.zoomOut();
                toolbar.updateZoomDisplay(camera.zoom);
                return;
            }

            if (e.key === 'Control' || e.key === 'Meta') {
                toolbar.updateSnapIndicator(true);
            }
        });

        this.disposables_.addListener(document, 'keyup', (ev) => {
            const e = ev as KeyboardEvent;
            if (e.key === ' ') {
                camera.spaceDown = false;
                if (!camera.isDragging) {
                    this.deps_.canvas.style.cursor = 'default';
                }
            }
            if (e.key === 'Control' || e.key === 'Meta') {
                toolbar.updateSnapIndicator(false);
            }
        });
    }

    private setupMouse(): void {
        const { canvas } = this.deps_;

        this.disposables_.addListener(canvas, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
        this.disposables_.addListener(canvas, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
        this.disposables_.addListener(canvas, 'mouseup', (e) => this.onMouseUp(e as MouseEvent));
        this.disposables_.addListener(canvas, 'mouseleave', (e) => this.onMouseLeave(e as MouseEvent));
        this.disposables_.addListener(canvas, 'wheel', (e) => {
            this.deps_.camera.wheel(e as WheelEvent);
            this.deps_.toolbar.updateZoomDisplay(this.deps_.camera.zoom);
        });
        this.disposables_.addListener(canvas, 'click', (e) => this.onCanvasClick(e as MouseEvent));
        this.disposables_.addListener(canvas, 'dblclick', (e) => this.onDblClick(e as MouseEvent));
        this.disposables_.addListener(canvas, 'contextmenu', (e) => this.onContextMenu(e as MouseEvent));
    }

    private onMouseDown(e: MouseEvent): void {
        const { camera, store, gizmoManager, colliderOverlay, marquee } = this.deps_;

        if (camera.shouldStartDrag(e)) {
            camera.startDrag(e.clientX, e.clientY);
            this.startDocumentDrag();
            return;
        }

        if (e.button !== 0) return;

        this.mouseDownX_ = e.clientX;
        this.mouseDownY_ = e.clientY;

        const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
        const hasSelection = store.selectedEntities.size > 0;

        if (gizmoManager.getActiveId() !== 'select' && hasSelection) {
            this.updateGizmoContext();
            if (gizmoManager.onMouseDown(worldX, worldY)) {
                this.startDocumentDrag();
                return;
            }
        }

        if (getSettingsValue<boolean>('scene.showColliders') && hasSelection) {
            const octx = this.deps_.createOverlayContext();
            if (octx && colliderOverlay.onDragStart(worldX, worldY, octx)) {
                this.startDocumentDrag();
                return;
            }
        }

        if (hasSelection) {
            const octx = this.deps_.createOverlayContext();
            if (octx && this.deps_.pivotOverlay.onDragStart(worldX, worldY, octx)) {
                this.startDocumentDrag();
                return;
            }
        }

        if (gizmoManager.getActiveId() === 'select') {
            const hits = this.findEntitiesAtPosition(worldX, worldY);
            if (hits.length === 0) {
                marquee.start(worldX, worldY);
                this.startDocumentDrag();
                return;
            }
        }
    }

    private onMouseMove(e: MouseEvent): void {
        const { camera, store, gizmoManager, colliderOverlay, marquee } = this.deps_;
        const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);

        if (camera.drag(e.clientX, e.clientY)) return;

        if (marquee.active) {
            marquee.update(worldX, worldY);
            this.deps_.requestRender();
            return;
        }

        if (gizmoManager.isDragging()) {
            this.updateGizmoContext();
            gizmoManager.onMouseMove(worldX, worldY, e);
            return;
        }

        if (colliderOverlay.isDragging()) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                colliderOverlay.onDrag(worldX, worldY, octx);
                this.deps_.requestRender();
            }
            return;
        }

        if (this.deps_.pivotOverlay.isDragging()) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                this.deps_.pivotOverlay.onDrag(worldX, worldY, octx);
                this.deps_.requestRender();
            }
            return;
        }

        const hasSelection = store.selectedEntities.size > 0;

        if (gizmoManager.getActiveId() !== 'select' && hasSelection) {
            this.updateGizmoContext();
            gizmoManager.onMouseMove(worldX, worldY, e);
            this.deps_.canvas.style.cursor = gizmoManager.getCursor();
        }

        if (getSettingsValue<boolean>('scene.showColliders') && hasSelection) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                colliderOverlay.hitTest(worldX, worldY, octx);
                const colliderCursor = colliderOverlay.getCursor();
                if (colliderCursor) {
                    this.deps_.canvas.style.cursor = colliderCursor;
                }
            }
        }

        if (hasSelection) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                this.deps_.pivotOverlay.hitTest(worldX, worldY, octx);
                const pivotCursor = this.deps_.pivotOverlay.getCursor();
                if (pivotCursor) {
                    this.deps_.canvas.style.cursor = pivotCursor;
                }
            }
        }
    }

    private onMouseUp(e: MouseEvent): void {
        const { camera, gizmoManager, colliderOverlay, marquee } = this.deps_;

        const dx = e.clientX - this.mouseDownX_;
        const dy = e.clientY - this.mouseDownY_;
        const didMove = dx * dx + dy * dy > 9;

        if (camera.isDragging) {
            camera.stopDrag();
            this.skipNextClick_ = true;
        }

        if (marquee.active) {
            const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
            marquee.update(worldX, worldY);
            marquee.finish(this.deps_.store, this.deps_.getBounds, e.ctrlKey || e.metaKey);
            this.skipNextClick_ = true;
            this.deps_.requestRender();
        }

        if (gizmoManager.isDragging()) {
            const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
            this.updateGizmoContext();
            gizmoManager.onMouseUp(worldX, worldY);
            this.skipNextClick_ = didMove;
        }

        if (colliderOverlay.isDragging()) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                colliderOverlay.onDragEnd(octx);
            }
            this.skipNextClick_ = didMove;
        }

        if (this.deps_.pivotOverlay.isDragging()) {
            const octx = this.deps_.createOverlayContext();
            if (octx) {
                this.deps_.pivotOverlay.onDragEnd(octx);
            }
            this.skipNextClick_ = didMove;
        }
    }

    private onMouseLeave(_e: MouseEvent): void {
        const { camera, gizmoManager, colliderOverlay, marquee } = this.deps_;
        if (camera.isDragging || gizmoManager.isDragging() || colliderOverlay.isDragging() || this.deps_.pivotOverlay.isDragging() || marquee.active) {
            return;
        }
        gizmoManager.resetHover();
        this.deps_.requestRender();
    }

    private onCanvasClick(e: MouseEvent): void {
        if (this.skipNextClick_) {
            this.skipNextClick_ = false;
            return;
        }

        const { camera, store, gizmoManager } = this.deps_;

        if (camera.isDragging || gizmoManager.isDragging()) return;

        const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
        const hasSelection = store.selectedEntities.size > 0;

        if (gizmoManager.getActiveId() !== 'select' && hasSelection) {
            this.updateGizmoContext();
            const result = gizmoManager.hitTest(worldX, worldY);
            if (result.hit) return;
        }

        const hits = this.findEntitiesAtPosition(worldX, worldY);
        if (hits.length === 0) {
            store.selectEntity(null);
            return;
        }

        const current = store.selectedEntity;
        const idx = current !== null ? hits.indexOf(current as Entity) : -1;
        const next = idx >= 0 ? hits[(idx + 1) % hits.length] : hits[0];
        store.selectEntity(next);
    }

    private onDblClick(e: MouseEvent): void {
        if (!getSettingsValue<boolean>('scene.showColliders')) return;

        const { camera, colliderOverlay } = this.deps_;
        const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
        const octx = this.deps_.createOverlayContext();
        if (octx && colliderOverlay.onDoubleClick(worldX, worldY, octx)) {
            this.deps_.requestRender();
        }
    }

    private onContextMenu(e: MouseEvent): void {
        if (!getSettingsValue<boolean>('scene.showColliders')) return;

        const { camera, colliderOverlay } = this.deps_;
        const { worldX, worldY } = camera.screenToWorld(e.clientX, e.clientY);
        const octx = this.deps_.createOverlayContext();
        if (!octx) return;

        const items = colliderOverlay.getContextMenuItems(worldX, worldY, octx);
        if (items.length === 0) return;

        e.preventDefault();
        const menu = document.createElement('div');
        menu.className = 'es-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.zIndex = '9999';

        for (const item of items) {
            const menuItem = document.createElement('div');
            menuItem.className = 'es-context-menu-item';
            menuItem.textContent = item.label;
            menuItem.addEventListener('click', () => {
                item.action();
                menu.remove();
                this.deps_.requestRender();
            });
            menu.appendChild(menuItem);
        }

        document.body.appendChild(menu);
        const dismiss = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', dismiss);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
    }

    findEntitiesAtPosition(worldX: number, worldY: number): Entity[] {
        const { store, getBounds } = this.deps_;
        const scene = store.scene;
        const result: Entity[] = [];

        for (let i = scene.entities.length - 1; i >= 0; i--) {
            const entity = scene.entities[i];
            if (!store.isEntityVisible(entity.id)) continue;

            const transform = entity.components.find(c => c.type === 'Transform');
            if (!transform) continue;

            const worldTransform = store.getWorldTransform(entity.id);
            const pos = worldTransform.position;
            const scale = worldTransform.scale;

            const bounds = getBounds(entity);
            const w = bounds.width * Math.abs(scale.x);
            const h = bounds.height * Math.abs(scale.y);
            const offsetX = (bounds.offsetX ?? 0) * scale.x;
            const offsetY = (bounds.offsetY ?? 0) * scale.y;

            const centerX = pos.x + offsetX;
            const centerY = pos.y + offsetY;
            const halfW = w / 2;
            const halfH = h / 2;

            if (
                worldX >= centerX - halfW &&
                worldX <= centerX + halfW &&
                worldY >= centerY - halfH &&
                worldY <= centerY + halfH
            ) {
                result.push(entity.id as Entity);
            }
        }

        return result;
    }

    private updateGizmoContext(): void {
        const ctx = (this.deps_.overlayCanvas ?? this.deps_.canvas).getContext('2d');
        if (ctx) {
            this.deps_.gizmoManager.setContext(this.deps_.createGizmoContext(ctx));
        }
    }

    private startDocumentDrag(): void {
        this.boundOnDocumentMouseMove_ = (e: MouseEvent) => this.onMouseMove(e);
        this.boundOnDocumentMouseUp_ = (e: MouseEvent) => {
            this.onMouseUp(e);
            this.stopDocumentDrag();
        };
        document.addEventListener('mousemove', this.boundOnDocumentMouseMove_);
        document.addEventListener('mouseup', this.boundOnDocumentMouseUp_);
    }

    private stopDocumentDrag(): void {
        if (this.boundOnDocumentMouseMove_) {
            document.removeEventListener('mousemove', this.boundOnDocumentMouseMove_);
            this.boundOnDocumentMouseMove_ = null;
        }
        if (this.boundOnDocumentMouseUp_) {
            document.removeEventListener('mouseup', this.boundOnDocumentMouseUp_);
            this.boundOnDocumentMouseUp_ = null;
        }
    }

    dispose(): void {
        this.stopDocumentDrag();
        this.disposables_.dispose();
    }
}
