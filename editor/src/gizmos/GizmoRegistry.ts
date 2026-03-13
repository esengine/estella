import type { EditorStore } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';
import type { TransformValue } from '../math/Transform';
import { getEditorContainer } from '../container';
import { GIZMO } from '../container/tokens';

export interface GizmoContext {
    store: EditorStore;
    ctx: CanvasRenderingContext2D;
    zoom: number;
    screenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number };
    getWorldTransform(entityId: number): TransformValue;
    getEntityBounds(entityData: EntityData): { width: number; height: number; offsetX?: number; offsetY?: number };
    requestRender(): void;
    setGizmoActive(active: boolean): void;
}

export interface GizmoDescriptor {
    id: string;
    name: string;
    icon: string;
    shortcut?: string;
    order?: number;

    hitTest(worldX: number, worldY: number, ctx: GizmoContext): { hit: boolean; data?: unknown };
    draw(ctx: GizmoContext): void;
    onDragStart?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext, event?: MouseEvent): void;
    onDrag?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext, event?: MouseEvent): void;
    onDragEnd?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    onHover?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    getCursor?(hitData: unknown): string;
    isApplicable?(ctx: GizmoContext): boolean;
    onKeyDown?(key: string, ctx: GizmoContext): boolean;
}

export function registerGizmo(descriptor: GizmoDescriptor): void {
    getEditorContainer().provide(GIZMO, descriptor.id, descriptor);
}

export function getGizmo(id: string): GizmoDescriptor | undefined {
    return getEditorContainer().get(GIZMO, id);
}

export function getAllGizmos(): GizmoDescriptor[] {
    return getEditorContainer().getOrdered(GIZMO);
}
