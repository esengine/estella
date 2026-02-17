import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { GizmoContext } from '../../gizmos';
import { GizmoManager } from '../../gizmos';
import { ColliderOverlay } from '../../gizmos/ColliderOverlay';
import { getSettingsValue } from '../../settings/SettingsRegistry';
import { getEditorInstance } from '../../context/EditorContext';
import type { CameraController } from './CameraController';
import type { GizmoToolbar } from './GizmoToolbar';
import type { MarqueeSelection, BoundsProvider } from './MarqueeSelection';

export interface InputDeps {
    store: EditorStore;
    canvas: HTMLCanvasElement;
    overlayCanvas: HTMLCanvasElement | null;
    camera: CameraController;
    toolbar: GizmoToolbar;
    marquee: MarqueeSelection;
    gizmoManager: GizmoManager;
    colliderOverlay: ColliderOverlay;
    getBounds: BoundsProvider;
    createGizmoContext: (ctx: CanvasRenderingContext2D) => GizmoContext;
    createOverlayContext: () => { ctx: CanvasRenderingContext2D; zoom: number; store: EditorStore } | null;
    requestRender: () => void;
}

export class SceneViewInput {
    private deps_: InputDeps;

    private skipNextClick_ = false;
    private mouseDownX_ = 0;
    private mouseDownY_ = 0;

    private boundOnDocumentMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnDocumentMouseUp_: ((e: MouseEvent) => void) | null = null;

    private boundOnMouseDown_: ((e: MouseEvent) => void) | null = null;
    private boundOnMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnMouseUp_: ((e: MouseEvent) => void) | null = null;
    private boundOnMouseLeave_: ((e: MouseEvent) => void) | null = null;
    private boundOnWheel_: ((e: WheelEvent) => void) | null = null;
    private boundOnCanvasClick_: ((e: MouseEvent) => void) | null = null;

    private keydownHandler_: ((e: KeyboardEvent) => void) | null = null;
    private keyupHandler_: ((e: KeyboardEvent) => void) | null = null;

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

        this.keydownHandler_ = (e: KeyboardEvent) => {
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
                getEditorInstance()?.duplicateSelected();
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
        };
        document.addEventListener('keydown', this.keydownHandler_);

        this.keyupHandler_ = (e: KeyboardEvent) => {
            if (e.key === ' ') {
                camera.spaceDown = false;
                if (!camera.isDragging) {
                    this.deps_.canvas.style.cursor = 'default';
                }
            }
            if (e.key === 'Control' || e.key === 'Meta') {
                toolbar.updateSnapIndicator(false);
            }
        };
        document.addEventListener('keyup', this.keyupHandler_);
    }

    private setupMouse(): void {
        const { canvas } = this.deps_;

        this.boundOnMouseDown_ = this.onMouseDown.bind(this);
        this.boundOnMouseMove_ = this.onMouseMove.bind(this);
        this.boundOnMouseUp_ = this.onMouseUp.bind(this);
        this.boundOnMouseLeave_ = this.onMouseLeave.bind(this);
        this.boundOnWheel_ = (e: WheelEvent) => {
            this.deps_.camera.wheel(e);
            this.deps_.toolbar.updateZoomDisplay(this.deps_.camera.zoom);
        };
        this.boundOnCanvasClick_ = this.onCanvasClick.bind(this);

        canvas.addEventListener('mousedown', this.boundOnMouseDown_);
        canvas.addEventListener('mousemove', this.boundOnMouseMove_);
        canvas.addEventListener('mouseup', this.boundOnMouseUp_);
        canvas.addEventListener('mouseleave', this.boundOnMouseLeave_);
        canvas.addEventListener('wheel', this.boundOnWheel_);
        canvas.addEventListener('click', this.boundOnCanvasClick_);
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
    }

    private onMouseLeave(_e: MouseEvent): void {
        const { camera, gizmoManager, colliderOverlay, marquee } = this.deps_;
        if (camera.isDragging || gizmoManager.isDragging() || colliderOverlay.isDragging() || marquee.active) {
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

    findEntitiesAtPosition(worldX: number, worldY: number): Entity[] {
        const { store, getBounds } = this.deps_;
        const scene = store.scene;
        const result: Entity[] = [];

        for (let i = scene.entities.length - 1; i >= 0; i--) {
            const entity = scene.entities[i];
            if (!store.isEntityVisible(entity.id)) continue;

            const transform = entity.components.find(c => c.type === 'LocalTransform');
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
        const { canvas } = this.deps_;

        if (this.keydownHandler_) {
            document.removeEventListener('keydown', this.keydownHandler_);
            this.keydownHandler_ = null;
        }
        if (this.keyupHandler_) {
            document.removeEventListener('keyup', this.keyupHandler_);
            this.keyupHandler_ = null;
        }

        this.stopDocumentDrag();

        if (this.boundOnMouseDown_) {
            canvas.removeEventListener('mousedown', this.boundOnMouseDown_);
            this.boundOnMouseDown_ = null;
        }
        if (this.boundOnMouseMove_) {
            canvas.removeEventListener('mousemove', this.boundOnMouseMove_);
            this.boundOnMouseMove_ = null;
        }
        if (this.boundOnMouseUp_) {
            canvas.removeEventListener('mouseup', this.boundOnMouseUp_);
            this.boundOnMouseUp_ = null;
        }
        if (this.boundOnMouseLeave_) {
            canvas.removeEventListener('mouseleave', this.boundOnMouseLeave_);
            this.boundOnMouseLeave_ = null;
        }
        if (this.boundOnWheel_) {
            canvas.removeEventListener('wheel', this.boundOnWheel_);
            this.boundOnWheel_ = null;
        }
        if (this.boundOnCanvasClick_) {
            canvas.removeEventListener('click', this.boundOnCanvasClick_);
            this.boundOnCanvasClick_ = null;
        }
    }
}
