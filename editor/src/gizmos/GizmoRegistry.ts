import type { EditorStore } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';
import type { Transform } from '../math/Transform';

export interface GizmoContext {
    store: EditorStore;
    ctx: CanvasRenderingContext2D;
    zoom: number;
    screenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number };
    getWorldTransform(entityId: number): Transform;
    getEntityBounds(entityData: EntityData): { width: number; height: number; offsetX?: number; offsetY?: number };
    requestRender(): void;
}

export interface GizmoDescriptor {
    id: string;
    name: string;
    icon: string;
    shortcut?: string;
    order?: number;

    hitTest(worldX: number, worldY: number, ctx: GizmoContext): { hit: boolean; data?: unknown };
    draw(ctx: GizmoContext): void;
    onDragStart?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    onDrag?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    onDragEnd?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    onHover?(worldX: number, worldY: number, hitData: unknown, ctx: GizmoContext): void;
    getCursor?(hitData: unknown): string;
}

const gizmos = new Map<string, GizmoDescriptor>();
const builtinGizmoIds = new Set<string>();

export function registerGizmo(descriptor: GizmoDescriptor): void {
    gizmos.set(descriptor.id, descriptor);
}

export function lockBuiltinGizmos(): void {
    for (const id of gizmos.keys()) builtinGizmoIds.add(id);
}

export function clearExtensionGizmos(): void {
    for (const id of gizmos.keys()) {
        if (!builtinGizmoIds.has(id)) gizmos.delete(id);
    }
}

export function getGizmo(id: string): GizmoDescriptor | undefined {
    return gizmos.get(id);
}

export function getAllGizmos(): GizmoDescriptor[] {
    return Array.from(gizmos.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
