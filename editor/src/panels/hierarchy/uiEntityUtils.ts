import type { Entity } from 'esengine';
import { getDefaultComponentData, getInitialComponentData } from '../../schemas/ComponentSchemas';
import type { EditorStore } from '../../store/EditorStore';

export interface CanvasOverrides {
    designResolution?: { x: number; y: number };
    pixelsPerUnit?: number;
    scaleMode?: number;
    matchWidthOrHeight?: number;
    backgroundColor?: { r: number; g: number; b: number; a: number };
}

export type ComponentEntry = { type: string; data: Record<string, unknown> };

export function createCanvasComponentData(
    overrides?: CanvasOverrides,
): ComponentEntry[] {
    const canvasData = { ...getDefaultComponentData('Canvas'), ...overrides };
    return [
        { type: 'Transform', data: getDefaultComponentData('Transform') },
        { type: 'UIRect', data: getDefaultComponentData('UIRect') },
        { type: 'Canvas', data: canvasData },
    ];
}

export function createCanvasComponents(
    overrides?: CanvasOverrides,
): ComponentEntry[] {
    const canvasData = { ...getInitialComponentData('Canvas'), ...overrides };
    return [
        { type: 'Transform', data: getInitialComponentData('Transform') },
        { type: 'UIRect', data: getInitialComponentData('UIRect') },
        { type: 'Canvas', data: canvasData },
    ];
}

export function ensureCanvasEntity(store: EditorStore): Entity {
    for (const entity of store.scene.entities) {
        if (entity.components.some(c => c.type === 'Canvas')) {
            return entity.id as Entity;
        }
    }
    const canvas = store.createEntity('Canvas', null);
    for (const comp of createCanvasComponents()) {
        store.addComponent(canvas, comp.type, comp.data);
    }
    return canvas;
}

export function resolveUIParent(store: EditorStore, parent: Entity | null): Entity {
    if (parent !== null) return parent;
    return ensureCanvasEntity(store);
}
