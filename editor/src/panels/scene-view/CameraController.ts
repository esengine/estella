import { getSettingsValue } from '../../settings/SettingsRegistry';

export class CameraController {
    panX = 0;
    panY = 0;
    zoom = 1;

    private isDragging_ = false;
    private lastMouseX_ = 0;
    private lastMouseY_ = 0;
    private spaceDown_ = false;
    private canvas_: HTMLCanvasElement;
    private onRender_: () => void;

    constructor(canvas: HTMLCanvasElement, onRender: () => void) {
        this.canvas_ = canvas;
        this.onRender_ = onRender;
    }

    setCanvas(canvas: HTMLCanvasElement): void {
        this.canvas_ = canvas;
    }

    get isDragging(): boolean {
        return this.isDragging_;
    }

    get spaceDown(): boolean {
        return this.spaceDown_;
    }

    set spaceDown(value: boolean) {
        this.spaceDown_ = value;
    }

    reset(): void {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
    }

    startDrag(clientX: number, clientY: number): void {
        this.isDragging_ = true;
        this.lastMouseX_ = clientX;
        this.lastMouseY_ = clientY;
        this.canvas_.style.cursor = 'grabbing';
    }

    drag(clientX: number, clientY: number): boolean {
        if (!this.isDragging_) return false;

        const dx = clientX - this.lastMouseX_;
        const dy = clientY - this.lastMouseY_;

        this.panX += dx / this.zoom;
        this.panY += dy / this.zoom;

        this.lastMouseX_ = clientX;
        this.lastMouseY_ = clientY;
        this.onRender_();
        return true;
    }

    stopDrag(): void {
        this.isDragging_ = false;
        this.canvas_.style.cursor = this.spaceDown_ ? 'grab' : 'default';
    }

    wheel(e: WheelEvent): void {
        e.preventDefault();

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, this.zoom * zoomFactor));

        const rect = this.canvas_.getBoundingClientRect();
        const dpr = window.devicePixelRatio;
        const mouseX = (e.clientX - rect.left) * dpr;
        const mouseY = (e.clientY - rect.top) * dpr;

        const worldX = (mouseX - this.canvas_.width / 2) / this.zoom - this.panX;
        const worldY = (mouseY - this.canvas_.height / 2) / this.zoom - this.panY;

        this.zoom = newZoom;

        this.panX = (mouseX - this.canvas_.width / 2) / this.zoom - worldX;
        this.panY = (mouseY - this.canvas_.height / 2) / this.zoom - worldY;

        this.onRender_();
    }

    zoomIn(): void {
        this.zoom = Math.min(10, this.zoom * 1.1);
        this.onRender_();
    }

    zoomOut(): void {
        this.zoom = Math.max(0.1, this.zoom * 0.9);
        this.onRender_();
    }

    focusOnEntity(worldX: number, worldY: number): void {
        this.panX = -worldX;
        this.panY = worldY;
        this.onRender_();
    }

    screenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number } {
        const rect = this.canvas_.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const x = (clientX - rect.left) * dpr;
        const y = (clientY - rect.top) * dpr;
        const w = this.canvas_.width;
        const h = this.canvas_.height;

        return {
            worldX: (x - w / 2) / this.zoom - this.panX,
            worldY: -(y - h / 2) / this.zoom + this.panY,
        };
    }

    nudgeSelection(
        e: KeyboardEvent,
        store: { selectedEntity: number | null; getEntityData: (id: number) => any; updateProperty: (...args: any[]) => void },
    ): void {
        const entity = store.selectedEntity;
        if (entity === null) return;

        const entityData = store.getEntityData(entity);
        if (!entityData) return;

        const transform = entityData.components.find((c: any) => c.type === 'LocalTransform');
        if (!transform) return;

        const pos = transform.data.position as { x: number; y: number; z: number };
        if (!pos) return;

        const snapOn = e.ctrlKey || e.metaKey;
        const step = snapOn ? (getSettingsValue<number>('scene.gridSize') ?? 50) : 1;

        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = step;
        if (e.key === 'ArrowDown') dy = -step;

        const oldPos = { ...pos };
        const newPos = { x: pos.x + dx, y: pos.y + dy, z: pos.z };

        store.updateProperty(entity, 'LocalTransform', 'position', oldPos, newPos);
        e.preventDefault();
    }

    shouldStartDrag(e: MouseEvent): boolean {
        return e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && this.spaceDown_);
    }
}
