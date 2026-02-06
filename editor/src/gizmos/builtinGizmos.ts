import { registerGizmo, type GizmoContext, type GizmoDescriptor } from './GizmoRegistry';
import { icons } from '../utils/icons';
import { quatToEuler, eulerToQuat } from '../math/Transform';

const GIZMO_COLORS = {
    x: '#e74c3c',
    y: '#2ecc71',
    xy: '#f1c40f',
    hover: '#ffffff',
};

const GIZMO_SIZE = 80;
const GIZMO_HANDLE_SIZE = 10;

type DragAxis = 'none' | 'x' | 'y' | 'xy';
type RectHandle = 'none' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';

function getSelectedEntityPosition(gctx: GizmoContext): { x: number; y: number; z: number } | null {
    const entityData = gctx.store.getSelectedEntityData();
    if (!entityData) return null;
    return gctx.getWorldTransform(entityData.id).position;
}

function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
}

function valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function getSizeComponentType(entityData: { components: { type: string; data: any }[] }): 'UIRect' | 'Sprite' | null {
    if (entityData.components.some(c => c.type === 'UIRect')) return 'UIRect';
    if (entityData.components.some(c => c.type === 'Sprite')) return 'Sprite';
    return null;
}

// =============================================================================
// Select Gizmo
// =============================================================================

export function createSelectGizmo(): GizmoDescriptor {
    return {
        id: 'select',
        name: 'Select',
        icon: icons.pointer(14),
        shortcut: 'q',
        order: 0,
        hitTest: () => ({ hit: false }),
        draw: () => {},
    };
}

// =============================================================================
// Move Gizmo
// =============================================================================

interface MoveGizmoDragState {
    startValue: { x: number; y: number; z: number };
    originalValue: { x: number; y: number; z: number };
    startWorldX: number;
    startWorldY: number;
}

export function createMoveGizmo(): GizmoDescriptor {
    let hoveredAxis: DragAxis = 'none';
    let dragAxis: DragAxis = 'none';
    let dragState: MoveGizmoDragState | null = null;

    return {
        id: 'move',
        name: 'Move',
        icon: icons.move(14),
        shortcut: 'w',
        order: 1,

        hitTest(worldX, worldY, gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return { hit: false };

            const gizmoScale = GIZMO_SIZE / gctx.zoom;
            const handleSize = GIZMO_HANDLE_SIZE / gctx.zoom;
            const dx = worldX - pos.x;
            const dy = worldY - pos.y;

            if (Math.abs(dx) < handleSize * 2 && Math.abs(dy) < handleSize * 2) {
                return { hit: true, data: 'xy' as DragAxis };
            }
            if (dx > 0 && dx < gizmoScale && Math.abs(dy) < handleSize) {
                return { hit: true, data: 'x' as DragAxis };
            }
            if (dy > 0 && dy < gizmoScale && Math.abs(dx) < handleSize) {
                return { hit: true, data: 'y' as DragAxis };
            }
            return { hit: false };
        },

        draw(gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = GIZMO_SIZE / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = GIZMO_HANDLE_SIZE / zoom;
            const arrowSize = 8 / zoom;

            ctx.fillStyle = hoveredAxis === 'xy' ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(size - arrowSize, -arrowSize / 2);
            ctx.lineTo(size - arrowSize, arrowSize / 2);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = hoveredAxis === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(-arrowSize / 2, -size + arrowSize);
            ctx.lineTo(arrowSize / 2, -size + arrowSize);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            dragAxis = hitData as DragAxis;
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const value = transform.data.position as { x: number; y: number; z: number };
                dragState = {
                    startValue: { ...value },
                    originalValue: { ...value },
                    startWorldX: worldX,
                    startWorldY: worldY,
                };
            }
        },

        onDrag(worldX, worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            const dx = worldX - dragState.startWorldX;
            const dy = worldY - dragState.startWorldY;

            let newX = dragState.startValue.x;
            let newY = dragState.startValue.y;

            if (dragAxis === 'x' || dragAxis === 'xy') newX += dx;
            if (dragAxis === 'y' || dragAxis === 'xy') newY += dy;

            gctx.store.updatePropertyDirect(entity, 'LocalTransform', 'position', {
                x: newX, y: newY, z: dragState.startValue.z,
            });
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const currentValue = transform.data.position;
                if (currentValue && !valuesEqual(dragState.originalValue, currentValue)) {
                    gctx.store.updateProperty(
                        entity, 'LocalTransform', 'position',
                        { ...dragState.originalValue }, deepClone(currentValue),
                    );
                }
            }
            dragState = null;
            dragAxis = 'none';
        },

        onHover(_worldX, _worldY, hitData, gctx) {
            hoveredAxis = (hitData as DragAxis) ?? 'none';
            gctx.requestRender();
        },

        getCursor(hitData) {
            return hitData ? 'pointer' : 'default';
        },
    };
}

// =============================================================================
// Rotate Gizmo
// =============================================================================

interface RotateGizmoDragState {
    startEuler: { x: number; y: number; z: number };
    originalQuat: { x: number; y: number; z: number; w: number };
    startWorldX: number;
    startWorldY: number;
}

export function createRotateGizmo(): GizmoDescriptor {
    let hovered = false;
    let dragState: RotateGizmoDragState | null = null;

    return {
        id: 'rotate',
        name: 'Rotate',
        icon: icons.rotateCw(14),
        shortcut: 'e',
        order: 2,

        hitTest(worldX, worldY, gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return { hit: false };

            const gizmoScale = GIZMO_SIZE / gctx.zoom;
            const handleSize = GIZMO_HANDLE_SIZE / gctx.zoom;
            const dx = worldX - pos.x;
            const dy = worldY - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (Math.abs(dist - gizmoScale * 0.8) < handleSize * 2) {
                return { hit: true, data: 'xy' };
            }
            return { hit: false };
        },

        draw(gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = GIZMO_SIZE / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = GIZMO_HANDLE_SIZE / zoom;
            const radius = size * 0.8;

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            const quat = transform?.data.rotation as { x: number; y: number; z: number; w: number } ?? { x: 0, y: 0, z: 0, w: 1 };
            const euler = quatToEuler(quat);
            const angleRad = -euler.z * Math.PI / 180;

            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(radius, 0);
            ctx.stroke();

            ctx.strokeStyle = hovered ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.lineWidth = lineWidth * 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = lineWidth * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius);
            ctx.stroke();

            ctx.fillStyle = '#00aaff';
            ctx.beginPath();
            ctx.arc(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius, handleSize, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        },

        onDragStart(worldX, worldY, _hitData, gctx) {
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const quat = transform.data.rotation as { x: number; y: number; z: number; w: number };
                dragState = {
                    startEuler: quatToEuler(quat ?? { x: 0, y: 0, z: 0, w: 1 }),
                    originalQuat: quat ? { ...quat } : { x: 0, y: 0, z: 0, w: 1 },
                    startWorldX: worldX,
                    startWorldY: worldY,
                };
            }
        },

        onDrag(worldX, worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const startAngle = Math.atan2(
                dragState.startWorldY - pos.y,
                dragState.startWorldX - pos.x,
            );
            const currentAngle = Math.atan2(worldY - pos.y, worldX - pos.x);
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);

            const newRotZ = dragState.startEuler.z + deltaAngle;
            const quat = eulerToQuat({ x: 0, y: 0, z: newRotZ });
            gctx.store.updatePropertyDirect(entity, 'LocalTransform', 'rotation', quat);
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const currentValue = transform.data.rotation;
                if (currentValue && !valuesEqual(dragState.originalQuat, currentValue)) {
                    gctx.store.updateProperty(
                        entity, 'LocalTransform', 'rotation',
                        { ...dragState.originalQuat }, deepClone(currentValue),
                    );
                }
            }
            dragState = null;
        },

        onHover(_worldX, _worldY, hitData, gctx) {
            hovered = !!hitData;
            gctx.requestRender();
        },

        getCursor(hitData) {
            return hitData ? 'pointer' : 'default';
        },
    };
}

// =============================================================================
// Scale Gizmo
// =============================================================================

interface ScaleGizmoDragState {
    startValue: { x: number; y: number; z: number };
    originalValue: { x: number; y: number; z: number };
    startWorldX: number;
    startWorldY: number;
}

export function createScaleGizmo(): GizmoDescriptor {
    let hoveredAxis: DragAxis = 'none';
    let dragAxis: DragAxis = 'none';
    let dragState: ScaleGizmoDragState | null = null;

    return {
        id: 'scale',
        name: 'Scale',
        icon: icons.maximize(14),
        shortcut: 'r',
        order: 3,

        hitTest(worldX, worldY, gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return { hit: false };

            const gizmoScale = GIZMO_SIZE / gctx.zoom;
            const handleSize = GIZMO_HANDLE_SIZE / gctx.zoom;
            const dx = worldX - pos.x;
            const dy = worldY - pos.y;

            if (Math.abs(dx) < handleSize * 2 && Math.abs(dy) < handleSize * 2) {
                return { hit: true, data: 'xy' as DragAxis };
            }
            if (dx > 0 && dx < gizmoScale && Math.abs(dy) < handleSize) {
                return { hit: true, data: 'x' as DragAxis };
            }
            if (dy > 0 && dy < gizmoScale && Math.abs(dx) < handleSize) {
                return { hit: true, data: 'y' as DragAxis };
            }
            return { hit: false };
        },

        draw(gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = GIZMO_SIZE / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = GIZMO_HANDLE_SIZE / zoom;

            ctx.fillStyle = hoveredAxis === 'xy' ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.fillRect(size - handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.fillRect(-handleSize, -size - handleSize, handleSize * 2, handleSize * 2);

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            dragAxis = hitData as DragAxis;
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const value = transform.data.scale as { x: number; y: number; z: number };
                dragState = {
                    startValue: { ...value },
                    originalValue: { ...value },
                    startWorldX: worldX,
                    startWorldY: worldY,
                };
            }
        },

        onDrag(worldX, worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            const dx = worldX - dragState.startWorldX;
            const dy = worldY - dragState.startWorldY;
            const scaleFactor = 0.01;

            let newX = dragState.startValue.x;
            let newY = dragState.startValue.y;

            if (dragAxis === 'x' || dragAxis === 'xy') newX += dx * scaleFactor;
            if (dragAxis === 'y' || dragAxis === 'xy') newY += dy * scaleFactor;

            gctx.store.updatePropertyDirect(entity, 'LocalTransform', 'scale', {
                x: Math.max(0.01, newX), y: Math.max(0.01, newY), z: dragState.startValue.z,
            });
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const currentValue = transform.data.scale;
                if (currentValue && !valuesEqual(dragState.originalValue, currentValue)) {
                    gctx.store.updateProperty(
                        entity, 'LocalTransform', 'scale',
                        { ...dragState.originalValue }, deepClone(currentValue),
                    );
                }
            }
            dragState = null;
            dragAxis = 'none';
        },

        onHover(_worldX, _worldY, hitData, gctx) {
            hoveredAxis = (hitData as DragAxis) ?? 'none';
            gctx.requestRender();
        },

        getCursor(hitData) {
            return hitData ? 'pointer' : 'default';
        },
    };
}

// =============================================================================
// Rect Gizmo
// =============================================================================

interface RectGizmoDragState {
    startWorldX: number;
    startWorldY: number;
    startPos: { x: number; y: number };
    startSize: { x: number; y: number };
    originalPos: { x: number; y: number; z: number };
    originalSize: { x: number; y: number };
}

function getRectHandleCursor(handle: RectHandle): string {
    switch (handle) {
        case 'tl': case 'br': return 'nwse-resize';
        case 'tr': case 'bl': return 'nesw-resize';
        case 't': case 'b': return 'ns-resize';
        case 'l': case 'r': return 'ew-resize';
        default: return 'default';
    }
}

export function createRectGizmo(): GizmoDescriptor {
    let hoveredHandle: RectHandle = 'none';
    let activeHandle: RectHandle = 'none';
    let dragState: RectGizmoDragState | null = null;

    function getHandles(gctx: GizmoContext): { x: number; y: number; key: RectHandle }[] | null {
        const entityData = gctx.store.getSelectedEntityData();
        if (!entityData) return null;

        const pos = getSelectedEntityPosition(gctx);
        if (!pos) return null;

        const worldTransform = gctx.getWorldTransform(entityData.id);
        const bounds = gctx.getEntityBounds(entityData);

        const w = bounds.width * Math.abs(worldTransform.scale.x);
        const h = bounds.height * Math.abs(worldTransform.scale.y);
        const halfW = w / 2;
        const halfH = h / 2;

        return [
            { x: -halfW, y: halfH, key: 'tl' },
            { x: halfW, y: halfH, key: 'tr' },
            { x: -halfW, y: -halfH, key: 'bl' },
            { x: halfW, y: -halfH, key: 'br' },
            { x: 0, y: halfH, key: 't' },
            { x: 0, y: -halfH, key: 'b' },
            { x: -halfW, y: 0, key: 'l' },
            { x: halfW, y: 0, key: 'r' },
        ];
    }

    return {
        id: 'rect',
        name: 'Rect',
        icon: icons.rect(14),
        shortcut: 't',
        order: 4,

        hitTest(worldX, worldY, gctx) {
            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) return { hit: false };

            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return { hit: false };

            const worldTransform = gctx.getWorldTransform(entityData.id);
            const bounds = gctx.getEntityBounds(entityData);

            const w = bounds.width * Math.abs(worldTransform.scale.x);
            const h = bounds.height * Math.abs(worldTransform.scale.y);
            const offsetX = (bounds.offsetX ?? 0) * worldTransform.scale.x;
            const offsetY = (bounds.offsetY ?? 0) * worldTransform.scale.y;
            const halfW = w / 2;
            const halfH = h / 2;

            const handleSize = GIZMO_HANDLE_SIZE / gctx.zoom;
            const dx = worldX - pos.x - offsetX;
            const dy = worldY - pos.y - offsetY;

            const handles: { x: number; y: number; key: RectHandle }[] = [
                { x: -halfW, y: halfH, key: 'tl' },
                { x: halfW, y: halfH, key: 'tr' },
                { x: -halfW, y: -halfH, key: 'bl' },
                { x: halfW, y: -halfH, key: 'br' },
                { x: 0, y: halfH, key: 't' },
                { x: 0, y: -halfH, key: 'b' },
                { x: -halfW, y: 0, key: 'l' },
                { x: halfW, y: 0, key: 'r' },
            ];

            for (const handle of handles) {
                if (Math.abs(dx - handle.x) < handleSize * 1.5 &&
                    Math.abs(dy - handle.y) < handleSize * 1.5) {
                    return { hit: true, data: handle.key as RectHandle };
                }
            }
            return { hit: false };
        },

        draw(gctx) {
            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) return;

            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const handleSize = GIZMO_HANDLE_SIZE / zoom;
            const lineWidth = 2 / zoom;

            const worldTransform = gctx.getWorldTransform(entityData.id);
            const bounds = gctx.getEntityBounds(entityData);

            const w = bounds.width * Math.abs(worldTransform.scale.x);
            const h = bounds.height * Math.abs(worldTransform.scale.y);
            const halfW = w / 2;
            const halfH = h / 2;

            ctx.strokeStyle = GIZMO_COLORS.xy;
            ctx.lineWidth = lineWidth;
            ctx.setLineDash([5 / zoom, 5 / zoom]);
            ctx.strokeRect(-halfW, -halfH, w, h);
            ctx.setLineDash([]);

            const handles: { x: number; y: number; key: RectHandle }[] = [
                { x: -halfW, y: -halfH, key: 'tl' },
                { x: halfW, y: -halfH, key: 'tr' },
                { x: -halfW, y: halfH, key: 'bl' },
                { x: halfW, y: halfH, key: 'br' },
                { x: 0, y: -halfH, key: 't' },
                { x: 0, y: halfH, key: 'b' },
                { x: -halfW, y: 0, key: 'l' },
                { x: halfW, y: 0, key: 'r' },
            ];

            for (const handle of handles) {
                const isHovered = hoveredHandle === handle.key;
                const isCorner = ['tl', 'tr', 'bl', 'br'].includes(handle.key);

                ctx.fillStyle = isHovered ? GIZMO_COLORS.hover : (isCorner ? GIZMO_COLORS.xy : GIZMO_COLORS.x);
                ctx.fillRect(handle.x - handleSize, handle.y - handleSize, handleSize * 2, handleSize * 2);

                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1 / zoom;
                ctx.strokeRect(handle.x - handleSize, handle.y - handleSize, handleSize * 2, handleSize * 2);
            }

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            activeHandle = hitData as RectHandle;
            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) return;

            const transform = entityData.components.find(c => c.type === 'LocalTransform');
            const pos = transform?.data.position as { x: number; y: number; z: number } ?? { x: 0, y: 0, z: 0 };

            const sizeType = getSizeComponentType(entityData);
            let size: { x: number; y: number };
            if (sizeType) {
                const comp = entityData.components.find(c => c.type === sizeType);
                size = comp?.data.size as { x: number; y: number } ?? { x: 50, y: 50 };
            } else {
                const bounds = gctx.getEntityBounds(entityData);
                size = { x: bounds.width, y: bounds.height };
            }

            dragState = {
                startWorldX: worldX,
                startWorldY: worldY,
                startPos: { x: pos.x, y: pos.y },
                startSize: { x: size.x, y: size.y },
                originalPos: { ...pos },
                originalSize: { x: size.x, y: size.y },
            };
        },

        onDrag(worldX, worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) return;

            const dx = worldX - dragState.startWorldX;
            const dy = worldY - dragState.startWorldY;

            let newWidth = dragState.startSize.x;
            let newHeight = dragState.startSize.y;
            let newPosX = dragState.startPos.x;
            let newPosY = dragState.startPos.y;

            switch (activeHandle) {
                case 'r': newWidth += dx; newPosX += dx / 2; break;
                case 'l': newWidth -= dx; newPosX += dx / 2; break;
                case 't': newHeight += dy; newPosY += dy / 2; break;
                case 'b': newHeight -= dy; newPosY += dy / 2; break;
                case 'tr': newWidth += dx; newHeight += dy; newPosX += dx / 2; newPosY += dy / 2; break;
                case 'tl': newWidth -= dx; newHeight += dy; newPosX += dx / 2; newPosY += dy / 2; break;
                case 'br': newWidth += dx; newHeight -= dy; newPosX += dx / 2; newPosY += dy / 2; break;
                case 'bl': newWidth -= dx; newHeight -= dy; newPosX += dx / 2; newPosY += dy / 2; break;
            }

            newWidth = Math.max(1, newWidth);
            newHeight = Math.max(1, newHeight);

            const sizeType = getSizeComponentType(entityData);
            if (sizeType) {
                gctx.store.updatePropertyDirect(entity, sizeType, 'size', { x: newWidth, y: newHeight });
            }

            const transform = entityData.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const pos = transform.data.position as { x: number; y: number; z: number };
                gctx.store.updatePropertyDirect(entity, 'LocalTransform', 'position', {
                    x: newPosX, y: newPosY, z: pos?.z ?? 0,
                });
            }

            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) { dragState = null; return; }

            const sizeType = getSizeComponentType(entityData);
            if (sizeType) {
                const comp = entityData.components.find(c => c.type === sizeType)!;
                const currentSize = comp.data.size as { x: number; y: number };
                if (currentSize && !valuesEqual(dragState.originalSize, currentSize)) {
                    gctx.store.updateProperty(
                        entity, sizeType, 'size',
                        { ...dragState.originalSize }, { ...currentSize },
                    );
                }
            }

            const transform = entityData.components.find(c => c.type === 'LocalTransform');
            if (transform) {
                const currentPos = transform.data.position as { x: number; y: number; z: number };
                if (currentPos && !valuesEqual(dragState.originalPos, currentPos)) {
                    gctx.store.updateProperty(
                        entity, 'LocalTransform', 'position',
                        { ...dragState.originalPos }, { ...currentPos },
                    );
                }
            }

            dragState = null;
            activeHandle = 'none';
        },

        onHover(_worldX, _worldY, hitData, gctx) {
            hoveredHandle = (hitData as RectHandle) ?? 'none';
            gctx.requestRender();
        },

        getCursor(hitData) {
            return getRectHandleCursor((hitData as RectHandle) ?? 'none');
        },
    };
}

// =============================================================================
// Registration
// =============================================================================

export function registerBuiltinGizmos(): void {
    registerGizmo(createSelectGizmo());
    registerGizmo(createMoveGizmo());
    registerGizmo(createRotateGizmo());
    registerGizmo(createScaleGizmo());
    registerGizmo(createRectGizmo());
}
