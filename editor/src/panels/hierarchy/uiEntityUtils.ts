import type { Entity } from 'esengine';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import type { EditorStore } from '../../store/EditorStore';

export function ensureCanvasEntity(store: EditorStore): Entity {
    for (const entity of store.scene.entities) {
        if (entity.components.some(c => c.type === 'Canvas')) {
            return entity.id as Entity;
        }
    }
    const canvas = store.createEntity('Canvas', null);
    store.addComponent(canvas, 'Transform', getInitialComponentData('Transform'));
    store.addComponent(canvas, 'UIRect', getInitialComponentData('UIRect'));
    store.addComponent(canvas, 'Canvas', getInitialComponentData('Canvas'));
    return canvas;
}

export function resolveUIParent(store: EditorStore, parent: Entity | null): Entity {
    if (parent !== null) return parent;
    return ensureCanvasEntity(store);
}
