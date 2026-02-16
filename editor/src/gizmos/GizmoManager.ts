import type { GizmoContext, GizmoDescriptor } from './GizmoRegistry';
import { getGizmo, getAllGizmos } from './GizmoRegistry';

export class GizmoManager {
    private activeId_ = 'move';
    private dragState_: { descriptor: GizmoDescriptor; data: unknown; startWorldX: number; startWorldY: number } | null = null;
    private hoveredData_: unknown = null;
    private context_: GizmoContext | null = null;

    setContext(context: GizmoContext): void {
        this.context_ = context;
    }

    setActive(id: string): void {
        this.activeId_ = id;
    }

    getActiveId(): string {
        return this.activeId_;
    }

    getActive(): GizmoDescriptor | null {
        return getGizmo(this.activeId_) ?? null;
    }

    getAllGizmos(): GizmoDescriptor[] {
        return getAllGizmos();
    }

    isDragging(): boolean {
        return this.dragState_ !== null;
    }

    hitTest(worldX: number, worldY: number): { hit: boolean; data?: unknown } {
        const gizmo = this.getActive();
        if (!gizmo || !this.context_) return { hit: false };
        return gizmo.hitTest(worldX, worldY, this.context_);
    }

    draw(): void {
        const gizmo = this.getActive();
        if (!gizmo || !this.context_) return;
        gizmo.draw(this.context_);
    }

    onMouseDown(worldX: number, worldY: number): boolean {
        const gizmo = this.getActive();
        if (!gizmo || !this.context_) return false;

        const result = gizmo.hitTest(worldX, worldY, this.context_);
        if (!result.hit) return false;

        this.dragState_ = {
            descriptor: gizmo,
            data: result.data,
            startWorldX: worldX,
            startWorldY: worldY,
        };

        gizmo.onDragStart?.(worldX, worldY, result.data, this.context_);
        return true;
    }

    onMouseMove(worldX: number, worldY: number, event?: MouseEvent): void {
        if (!this.context_) return;

        if (this.dragState_) {
            this.dragState_.descriptor.onDrag?.(worldX, worldY, this.dragState_.data, this.context_, event);
            return;
        }

        const gizmo = this.getActive();
        if (!gizmo) return;

        const result = gizmo.hitTest(worldX, worldY, this.context_);
        const newData = result.hit ? result.data : null;

        if (newData !== this.hoveredData_) {
            this.hoveredData_ = newData;
            gizmo.onHover?.(worldX, worldY, newData, this.context_);
        }
    }

    onMouseUp(worldX: number, worldY: number): void {
        if (!this.dragState_ || !this.context_) return;

        this.dragState_.descriptor.onDragEnd?.(worldX, worldY, this.dragState_.data, this.context_);
        this.dragState_ = null;
    }

    getCursor(): string {
        const gizmo = this.getActive();
        if (!gizmo?.getCursor) return 'default';
        return gizmo.getCursor(this.hoveredData_);
    }

    resetHover(): void {
        this.hoveredData_ = null;
    }
}
