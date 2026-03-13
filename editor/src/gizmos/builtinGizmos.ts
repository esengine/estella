import type { GizmoContext, GizmoDescriptor } from './GizmoRegistry';
import type { PluginRegistrar } from '../container';
import { GIZMO } from '../container/tokens';
import { icons } from '../utils/icons';
import { createTileBrushGizmo } from './TileBrushGizmo';
import { quatToEuler, eulerToQuat } from '../math/Transform';
import { getSettingsValue } from '../settings/SettingsRegistry';
import { getSizeProvider } from '../utils/sceneQueries';

function getGizmoColors() {
    return {
        x: getSettingsValue<string>('scene.gizmoColorX') ?? '#e74c3c',
        y: getSettingsValue<string>('scene.gizmoColorY') ?? '#2ecc71',
        xy: getSettingsValue<string>('scene.gizmoColorXY') ?? '#f1c40f',
        hover: getSettingsValue<string>('scene.gizmoColorHover') ?? '#ffffff',
        selection: getSettingsValue<string>('scene.selectionColor') ?? '#00aaff',
        handleStroke: '#000',
        refLine: 'rgba(100, 100, 100, 0.5)',
    };
}

function getGizmoSize(): number {
    return getSettingsValue<number>('scene.gizmoSize') ?? 80;
}

function getGizmoHandleSize(): number {
    return getSettingsValue<number>('scene.gizmoHandleSize') ?? 10;
}

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


function hitTestEntityBounds(worldX: number, worldY: number, gctx: GizmoContext): boolean {
    const entityData = gctx.store.getSelectedEntityData();
    if (!entityData) return false;
    const pos = getSelectedEntityPosition(gctx);
    if (!pos) return false;
    const worldTransform = gctx.getWorldTransform(entityData.id);
    const bounds = gctx.getEntityBounds(entityData);
    const w = bounds.width * Math.abs(worldTransform.scale.x);
    const h = bounds.height * Math.abs(worldTransform.scale.y);
    const offsetX = (bounds.offsetX ?? 0) * worldTransform.scale.x;
    const offsetY = (bounds.offsetY ?? 0) * worldTransform.scale.y;
    const dx = worldX - pos.x - offsetX;
    const dy = worldY - pos.y - offsetY;
    return Math.abs(dx) < w / 2 && Math.abs(dy) < h / 2;
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
    originalOffsetMin?: { x: number; y: number };
    originalOffsetMax?: { x: number; y: number };
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

            const gizmoScale = getGizmoSize() / gctx.zoom;
            const handleSize = getGizmoHandleSize() / gctx.zoom;
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
            if (hitTestEntityBounds(worldX, worldY, gctx)) {
                return { hit: true, data: 'xy' as DragAxis };
            }
            return { hit: false };
        },

        draw(gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const colors = getGizmoColors();
            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = getGizmoSize() / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = getGizmoHandleSize() / zoom;
            const arrowSize = 8 / zoom;

            ctx.fillStyle = hoveredAxis === 'xy' ? colors.hover : colors.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'x' ? colors.hover : colors.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'x' ? colors.hover : colors.x;
            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(size - arrowSize, -arrowSize / 2);
            ctx.lineTo(size - arrowSize, arrowSize / 2);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = hoveredAxis === 'y' ? colors.hover : colors.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'y' ? colors.hover : colors.y;
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(-arrowSize / 2, -size + arrowSize);
            ctx.lineTo(arrowSize / 2, -size + arrowSize);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            gctx.setGizmoActive(true);
            dragAxis = hitData as DragAxis;
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
            if (transform) {
                const value = transform.data.position as { x: number; y: number; z: number };
                const state: MoveGizmoDragState = {
                    startValue: { ...value },
                    originalValue: { ...value },
                    startWorldX: worldX,
                    startWorldY: worldY,
                };
                const uiRect = entityData?.components.find(c => c.type === 'UIRect');
                if (uiRect) {
                    const oMin = uiRect.data.offsetMin as { x: number; y: number };
                    const oMax = uiRect.data.offsetMax as { x: number; y: number };
                    state.originalOffsetMin = { ...oMin };
                    state.originalOffsetMax = { ...oMax };
                }
                dragState = state;
            }
        },

        onDrag(worldX, worldY, _hitData, gctx, event) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            let dx = worldX - dragState.startWorldX;
            let dy = worldY - dragState.startWorldY;

            if (dragAxis === 'x') dy = 0;
            if (dragAxis === 'y') dx = 0;

            const snapActive = event && (event.ctrlKey || event.metaKey);

            if (dragState.originalOffsetMin && dragState.originalOffsetMax) {
                let newMinX = dragState.originalOffsetMin.x + dx;
                let newMinY = dragState.originalOffsetMin.y + dy;
                let newMaxX = dragState.originalOffsetMax.x + dx;
                let newMaxY = dragState.originalOffsetMax.y + dy;
                if (snapActive) {
                    const gridSize = getSettingsValue<number>('scene.gridSize') ?? 50;
                    const snapDx = Math.round((dragState.originalOffsetMin.x + dx) / gridSize) * gridSize - dragState.originalOffsetMin.x;
                    const snapDy = Math.round((dragState.originalOffsetMin.y + dy) / gridSize) * gridSize - dragState.originalOffsetMin.y;
                    newMinX = dragState.originalOffsetMin.x + snapDx;
                    newMinY = dragState.originalOffsetMin.y + snapDy;
                    newMaxX = dragState.originalOffsetMax.x + snapDx;
                    newMaxY = dragState.originalOffsetMax.y + snapDy;
                }
                gctx.store.updatePropertyDirect(entity, 'UIRect', 'offsetMin', { x: newMinX, y: newMinY });
                gctx.store.updatePropertyDirect(entity, 'UIRect', 'offsetMax', { x: newMaxX, y: newMaxY });
            } else {
                let newX = dragState.startValue.x + dx;
                let newY = dragState.startValue.y + dy;
                if (snapActive) {
                    const gridSize = getSettingsValue<number>('scene.gridSize') ?? 50;
                    newX = Math.round(newX / gridSize) * gridSize;
                    newY = Math.round(newY / gridSize) * gridSize;
                }
                gctx.store.updatePropertyDirect(entity, 'Transform', 'position', {
                    x: newX, y: newY, z: dragState.startValue.z,
                });
            }
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            if (dragState.originalOffsetMin && dragState.originalOffsetMax) {
                const uiRect = entityData?.components.find(c => c.type === 'UIRect');
                if (uiRect) {
                    const curMin = uiRect.data.offsetMin as { x: number; y: number };
                    const curMax = uiRect.data.offsetMax as { x: number; y: number };
                    if (!valuesEqual(dragState.originalOffsetMin, curMin) || !valuesEqual(dragState.originalOffsetMax, curMax)) {
                        gctx.store.updateBatchProperties(entity, [
                            { componentType: 'UIRect', property: 'offsetMin', oldValue: { ...dragState.originalOffsetMin }, newValue: { ...curMin } },
                            { componentType: 'UIRect', property: 'offsetMax', oldValue: { ...dragState.originalOffsetMax }, newValue: { ...curMax } },
                        ], 'Move UIRect');
                    }
                }
            } else {
                const transform = entityData?.components.find(c => c.type === 'Transform');
                if (transform) {
                    const currentPos = transform.data.position;
                    if (currentPos && !valuesEqual(dragState.originalValue, currentPos)) {
                        gctx.store.updateProperty(
                            entity, 'Transform', 'position',
                            { ...dragState.originalValue }, deepClone(currentPos),
                        );
                    }
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
            const axis = hitData as DragAxis | null;
            if (axis === 'xy') return 'move';
            if (axis === 'x') return 'ew-resize';
            if (axis === 'y') return 'ns-resize';
            return 'default';
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
    entityPos: { x: number; y: number };
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

            const gizmoScale = getGizmoSize() / gctx.zoom;
            const handleSize = getGizmoHandleSize() / gctx.zoom;
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

            const colors = getGizmoColors();
            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = getGizmoSize() / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = getGizmoHandleSize() / zoom;
            const radius = size * 0.8;

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
            const quat = transform?.data.rotation as { x: number; y: number; z: number; w: number } ?? { x: 0, y: 0, z: 0, w: 1 };
            const euler = quatToEuler(quat);
            const angleRad = -euler.z * Math.PI / 180;

            ctx.strokeStyle = colors.refLine;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(radius, 0);
            ctx.stroke();

            ctx.strokeStyle = hovered ? colors.hover : colors.xy;
            ctx.lineWidth = lineWidth * 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = colors.selection;
            ctx.lineWidth = lineWidth * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius);
            ctx.stroke();

            ctx.fillStyle = colors.selection;
            ctx.beginPath();
            ctx.arc(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius, handleSize, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        },

        onDragStart(worldX, worldY, _hitData, gctx) {
            gctx.setGizmoActive(true);
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
            if (transform) {
                const quat = transform.data.rotation as { x: number; y: number; z: number; w: number };
                const pos = getSelectedEntityPosition(gctx);
                dragState = {
                    startEuler: quatToEuler(quat ?? { x: 0, y: 0, z: 0, w: 1 }),
                    originalQuat: quat ? { ...quat } : { x: 0, y: 0, z: 0, w: 1 },
                    startWorldX: worldX,
                    startWorldY: worldY,
                    entityPos: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
                };
            }
        },

        onDrag(worldX, worldY, _hitData, gctx, event) {
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) return;

            const pos = dragState.entityPos;

            const startAngle = Math.atan2(
                dragState.startWorldY - pos.y,
                dragState.startWorldX - pos.x,
            );
            const currentAngle = Math.atan2(worldY - pos.y, worldX - pos.x);
            let deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);

            if (event?.shiftKey) {
                deltaAngle = Math.round(deltaAngle / 15) * 15;
            }

            const newRotZ = dragState.startEuler.z + deltaAngle;
            const quat = eulerToQuat({ x: 0, y: 0, z: newRotZ });
            gctx.store.updatePropertyDirect(entity, 'Transform', 'rotation', quat);
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
            if (transform) {
                const currentValue = transform.data.rotation;
                if (currentValue && !valuesEqual(dragState.originalQuat, currentValue)) {
                    gctx.store.updateProperty(
                        entity, 'Transform', 'rotation',
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
            return hitData ? 'grab' : 'default';
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

            const gizmoScale = getGizmoSize() / gctx.zoom;
            const handleSize = getGizmoHandleSize() / gctx.zoom;
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
            if (hitTestEntityBounds(worldX, worldY, gctx)) {
                return { hit: true, data: 'xy' as DragAxis };
            }
            return { hit: false };
        },

        draw(gctx) {
            const pos = getSelectedEntityPosition(gctx);
            if (!pos) return;

            const colors = getGizmoColors();
            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const size = getGizmoSize() / zoom;
            const lineWidth = 2 / zoom;
            const handleSize = getGizmoHandleSize() / zoom;

            ctx.fillStyle = hoveredAxis === 'xy' ? colors.hover : colors.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'x' ? colors.hover : colors.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'x' ? colors.hover : colors.x;
            ctx.fillRect(size - handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = hoveredAxis === 'y' ? colors.hover : colors.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = hoveredAxis === 'y' ? colors.hover : colors.y;
            ctx.fillRect(-handleSize, -size - handleSize, handleSize * 2, handleSize * 2);

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            gctx.setGizmoActive(true);
            dragAxis = hitData as DragAxis;
            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
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

            gctx.store.updatePropertyDirect(entity, 'Transform', 'scale', {
                x: Math.max(0.01, newX), y: Math.max(0.01, newY), z: dragState.startValue.z,
            });
            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'Transform');
            if (transform) {
                const currentValue = transform.data.scale;
                if (currentValue && !valuesEqual(dragState.originalValue, currentValue)) {
                    gctx.store.updateProperty(
                        entity, 'Transform', 'scale',
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
            const axis = hitData as DragAxis | null;
            if (axis === 'xy') return 'nwse-resize';
            if (axis === 'x') return 'ew-resize';
            if (axis === 'y') return 'ns-resize';
            return 'default';
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
    originalOffsetMin?: { x: number; y: number };
    originalOffsetMax?: { x: number; y: number };
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

            const handleSize = getGizmoHandleSize() / gctx.zoom;
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

            const colors = getGizmoColors();
            const { ctx, zoom } = gctx;
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            const handleSize = getGizmoHandleSize() / zoom;
            const lineWidth = 2 / zoom;

            const worldTransform = gctx.getWorldTransform(entityData.id);
            const bounds = gctx.getEntityBounds(entityData);

            const w = bounds.width * Math.abs(worldTransform.scale.x);
            const h = bounds.height * Math.abs(worldTransform.scale.y);
            const halfW = w / 2;
            const halfH = h / 2;

            ctx.strokeStyle = colors.xy;
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

                ctx.fillStyle = isHovered ? colors.hover : (isCorner ? colors.xy : colors.x);
                ctx.fillRect(handle.x - handleSize, handle.y - handleSize, handleSize * 2, handleSize * 2);

                ctx.strokeStyle = colors.handleStroke;
                ctx.lineWidth = 1 / zoom;
                ctx.strokeRect(handle.x - handleSize, handle.y - handleSize, handleSize * 2, handleSize * 2);
            }

            ctx.restore();
        },

        onDragStart(worldX, worldY, hitData, gctx) {
            gctx.setGizmoActive(true);
            activeHandle = hitData as RectHandle;
            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) return;

            const transform = entityData.components.find(c => c.type === 'Transform');
            const pos = transform?.data.position as { x: number; y: number; z: number } ?? { x: 0, y: 0, z: 0 };

            const sizeType = getSizeProvider(entityData);
            let size: { x: number; y: number };
            if (sizeType) {
                const comp = entityData.components.find(c => c.type === sizeType);
                size = comp?.data.size as { x: number; y: number } ?? { x: 50, y: 50 };
            } else {
                const bounds = gctx.getEntityBounds(entityData);
                size = { x: bounds.width, y: bounds.height };
            }

            const state: RectGizmoDragState = {
                startWorldX: worldX,
                startWorldY: worldY,
                startPos: { x: pos.x, y: pos.y },
                startSize: { x: size.x, y: size.y },
                originalPos: { ...pos },
                originalSize: { x: size.x, y: size.y },
            };
            const uiRect = entityData.components.find(c => c.type === 'UIRect');
            if (uiRect) {
                const oMin = uiRect.data.offsetMin as { x: number; y: number };
                const oMax = uiRect.data.offsetMax as { x: number; y: number };
                state.originalOffsetMin = { ...oMin };
                state.originalOffsetMax = { ...oMax };
            }
            dragState = state;
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

            const sizeType = getSizeProvider(entityData);
            if (sizeType) {
                gctx.store.updatePropertyDirect(entity, sizeType, 'size', { x: newWidth, y: newHeight });
            }

            const transform = entityData.components.find(c => c.type === 'Transform');
            if (transform) {
                const pos = transform.data.position as { x: number; y: number; z: number };
                gctx.store.updatePropertyDirect(entity, 'Transform', 'position', {
                    x: newPosX, y: newPosY, z: pos?.z ?? 0,
                });
            }

            gctx.requestRender();
        },

        onDragEnd(_worldX, _worldY, _hitData, gctx) {
            gctx.setGizmoActive(false);
            const entity = gctx.store.selectedEntity;
            if (entity === null || !dragState) { dragState = null; return; }

            const entityData = gctx.store.getSelectedEntityData();
            if (!entityData) { dragState = null; return; }

            const changes: { componentType: string; property: string; oldValue: unknown; newValue: unknown }[] = [];

            const sizeType = getSizeProvider(entityData);
            if (sizeType) {
                const comp = entityData.components.find(c => c.type === sizeType)!;
                const currentSize = comp.data.size as { x: number; y: number };
                if (currentSize && !valuesEqual(dragState.originalSize, currentSize)) {
                    changes.push({ componentType: sizeType, property: 'size', oldValue: { ...dragState.originalSize }, newValue: { ...currentSize } });
                }
            }

            if (dragState.originalOffsetMin && dragState.originalOffsetMax) {
                const uiRect = entityData.components.find(c => c.type === 'UIRect');
                if (uiRect) {
                    const curMin = uiRect.data.offsetMin as { x: number; y: number };
                    const curMax = uiRect.data.offsetMax as { x: number; y: number };
                    if (!valuesEqual(dragState.originalOffsetMin, curMin)) {
                        changes.push({ componentType: 'UIRect', property: 'offsetMin', oldValue: { ...dragState.originalOffsetMin }, newValue: { ...curMin } });
                    }
                    if (!valuesEqual(dragState.originalOffsetMax, curMax)) {
                        changes.push({ componentType: 'UIRect', property: 'offsetMax', oldValue: { ...dragState.originalOffsetMax }, newValue: { ...curMax } });
                    }
                }
            } else {
                const transform = entityData.components.find(c => c.type === 'Transform');
                if (transform) {
                    const currentPos = transform.data.position as { x: number; y: number; z: number };
                    if (currentPos && !valuesEqual(dragState.originalPos, currentPos)) {
                        changes.push({ componentType: 'Transform', property: 'position', oldValue: { ...dragState.originalPos }, newValue: { ...currentPos } });
                    }
                }
            }

            if (changes.length > 0) {
                gctx.store.updateBatchProperties(entity, changes, 'Resize rect');
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

export function registerBuiltinGizmos(registrar: PluginRegistrar): void {
    const registerGizmo = (d: GizmoDescriptor) => registrar.provide(GIZMO, d.id, d);
    registerGizmo(createSelectGizmo());
    registerGizmo(createMoveGizmo());
    registerGizmo(createRotateGizmo());
    registerGizmo(createScaleGizmo());
    registerGizmo(createRectGizmo());
    registerGizmo(createTileBrushGizmo());
}
