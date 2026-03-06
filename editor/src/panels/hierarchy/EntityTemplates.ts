import type { Entity } from 'esengine';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import type { HierarchyState } from './HierarchyTypes';

interface ComponentEntry {
    type: string;
    defaults?: Record<string, unknown>;
}

interface EntityTemplateNode {
    name: string;
    ref?: string;
    components: ComponentEntry[];
    children?: EntityTemplateNode[];
}

interface EntityTemplate {
    root: EntityTemplateNode;
    bindings?: Record<string, string>;
}

function defineTemplate(root: EntityTemplateNode, bindings?: Record<string, string>): EntityTemplate {
    return { root, bindings };
}

export const ENTITY_TEMPLATES: Record<string, EntityTemplate> = {
    Button: defineTemplate({
        name: 'Button',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
            { type: 'Interactable' },
            { type: 'Button' },
        ],
    }),

    Panel: defineTemplate({
        name: 'Panel',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
            { type: 'UIMask' },
        ],
    }),

    Image: defineTemplate({
        name: 'Image',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
        ],
    }),

    Toggle: defineTemplate({
        name: 'Toggle',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect', defaults: { size: { x: 24, y: 24 } } },
            { type: 'Interactable' },
            { type: 'Toggle' },
        ],
        children: [
            {
                name: 'Checkmark', ref: 'checkmark',
                components: [
                    { type: 'Transform' },
                    { type: 'Image', defaults: { color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } } },
                    { type: 'UIRect', defaults: { size: { x: 16, y: 16 } } },
                ],
            },
        ],
    }, {
        'Toggle.graphicEntity': 'checkmark',
    }),

    ProgressBar: defineTemplate({
        name: 'ProgressBar',
        components: [
            { type: 'Transform' },
            { type: 'Image', defaults: { color: { r: 0.3, g: 0.3, b: 0.3, a: 1 } } },
            { type: 'UIRect', defaults: { size: { x: 200, y: 20 } } },
            { type: 'ProgressBar', defaults: { value: 0.5 } },
        ],
        children: [
            {
                name: 'Fill', ref: 'fill',
                components: [
                    { type: 'Transform' },
                    { type: 'Image', defaults: { color: { r: 0.2, g: 0.6, b: 1, a: 1 } } },
                    { type: 'UIRect', defaults: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0.5, y: 1 }, offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 } } },
                ],
            },
        ],
    }, {
        'ProgressBar.fillEntity': 'fill',
    }),

    ScrollView: defineTemplate({
        name: 'ScrollView',
        components: [
            { type: 'Transform' },
            { type: 'Image', defaults: { color: { r: 0.15, g: 0.15, b: 0.15, a: 1 } } },
            { type: 'UIRect', defaults: { size: { x: 300, y: 200 } } },
            { type: 'UIMask' },
            { type: 'Interactable' },
            { type: 'ScrollView' },
        ],
        children: [
            {
                name: 'Content', ref: 'content',
                components: [
                    { type: 'Transform' },
                    { type: 'UIRect', defaults: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 } } },
                ],
            },
        ],
    }, {
        'ScrollView.contentEntity': 'content',
    }),

    Slider: defineTemplate({
        name: 'Slider',
        components: [
            { type: 'Transform' },
            { type: 'Image', defaults: { color: { r: 0.3, g: 0.3, b: 0.3, a: 1 } } },
            { type: 'UIRect', defaults: { size: { x: 200, y: 20 } } },
            { type: 'Interactable' },
            { type: 'Slider', defaults: { value: 0.5 } },
        ],
        children: [
            {
                name: 'Fill', ref: 'fill',
                components: [
                    { type: 'Transform' },
                    { type: 'Image', defaults: { color: { r: 0.2, g: 0.6, b: 1, a: 1 } } },
                    { type: 'UIRect', defaults: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0.5, y: 1 }, offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 } } },
                ],
            },
            {
                name: 'Handle', ref: 'handle',
                components: [
                    { type: 'Transform' },
                    { type: 'Image' },
                    { type: 'UIRect', defaults: { size: { x: 20, y: 20 } } },
                ],
            },
        ],
    }, {
        'Slider.fillEntity': 'fill',
        'Slider.handleEntity': 'handle',
    }),

    Dropdown: defineTemplate({
        name: 'Dropdown',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect', defaults: { size: { x: 160, y: 32 } } },
            { type: 'Interactable' },
            { type: 'Dropdown', defaults: { options: ['Option 1', 'Option 2', 'Option 3'] } },
        ],
        children: [
            {
                name: 'Label', ref: 'label',
                components: [
                    { type: 'Transform' },
                    { type: 'UIRect', defaults: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, offsetMin: { x: 8, y: 0 }, offsetMax: { x: -8, y: 0 } } },
                    { type: 'Text', defaults: { content: 'Select...' } },
                ],
            },
            {
                name: 'List', ref: 'list',
                components: [
                    { type: 'Transform' },
                    { type: 'Image', defaults: { enabled: false } },
                    { type: 'UIRect', defaults: { size: { x: 160, y: 120 } } },
                ],
            },
        ],
    }, {
        'Dropdown.labelEntity': 'label',
        'Dropdown.listEntity': 'list',
    }),

    Tilemap: defineTemplate({
        name: 'Tilemap',
        components: [
            { type: 'Transform' },
            { type: 'Tilemap' },
        ],
    }),
};

export function instantiateTemplate(
    state: HierarchyState,
    templateName: string,
    parent: Entity | null,
): Entity | null {
    const template = ENTITY_TEMPLATES[templateName];
    if (!template) return null;

    const refMap = new Map<string, Entity>();

    const rootEntity = createNode(state, template.root, parent, refMap);

    if (template.bindings) {
        for (const [binding, ref] of Object.entries(template.bindings)) {
            const dotIdx = binding.indexOf('.');
            const compType = binding.substring(0, dotIdx);
            const fieldName = binding.substring(dotIdx + 1);
            const targetEntity = refMap.get(ref);
            if (targetEntity !== undefined) {
                state.store.updateProperty(
                    rootEntity, compType, fieldName,
                    undefined, targetEntity as number,
                );
            }
        }
    }

    state.store.selectEntity(rootEntity);
    return rootEntity;
}

function createNode(
    state: HierarchyState,
    node: EntityTemplateNode,
    parent: Entity | null,
    refMap: Map<string, Entity>,
): Entity {
    const entity = state.store.createEntity(node.name, parent);

    for (const comp of node.components) {
        let data = getInitialComponentData(comp.type);
        if (comp.defaults) {
            data = { ...data };
            for (const [key, val] of Object.entries(comp.defaults)) {
                if (val === undefined) {
                    const initData = getInitialComponentData(comp.type);
                    if (key in initData) {
                        data[key] = initData[key];
                    }
                } else {
                    data[key] = val;
                }
            }
        }
        state.store.addComponent(entity, comp.type, data);
    }

    if (node.ref) {
        refMap.set(node.ref, entity);
    }

    if (node.children) {
        for (const child of node.children) {
            createNode(state, child, entity, refMap);
        }
    }

    return entity;
}
