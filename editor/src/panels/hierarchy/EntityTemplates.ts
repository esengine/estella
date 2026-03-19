import type { Entity } from 'esengine';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import type { HierarchyState } from './HierarchyTypes';
import { resolveUIParent } from './uiEntityUtils';

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

type EntityCategory = 'ui' | 'physics' | 'general' | 'audio';

interface EntityTemplate {
    root: EntityTemplateNode;
    bindings?: Record<string, string>;
    category: EntityCategory;
    isUIRoot?: boolean;
    menuLabel?: string;
    icon?: string;
}

function ui(root: EntityTemplateNode, bindings?: Record<string, string>): EntityTemplate {
    return { root, bindings, category: 'ui' };
}

function uiRoot(root: EntityTemplateNode): EntityTemplate {
    return { root, category: 'ui', isUIRoot: true };
}

function physics(root: EntityTemplateNode): EntityTemplate {
    return { root, category: 'physics' };
}

function general(root: EntityTemplateNode): EntityTemplate {
    return { root, category: 'general' };
}

function audio(root: EntityTemplateNode): EntityTemplate {
    return { root, category: 'audio' };
}

// =============================================================================
// Template Registry
// =============================================================================

export const ENTITY_TEMPLATES: Record<string, EntityTemplate> = {
    // ---- General ----
    Sprite: general({
        name: 'Sprite',
        components: [{ type: 'Transform' }, { type: 'Sprite' }],
    }),

    BitmapText: general({
        name: 'BitmapText',
        components: [{ type: 'Transform' }, { type: 'BitmapText' }],
    }),

    SpineAnimation: general({
        name: 'Spine',
        components: [{ type: 'Transform' }, { type: 'SpineAnimation' }],
    }),

    ShapeRenderer: general({
        name: 'Shape',
        components: [{ type: 'Transform' }, { type: 'ShapeRenderer' }],
    }),

    ParticleEmitter: general({
        name: 'Particle',
        components: [{ type: 'Transform' }, { type: 'ParticleEmitter' }],
    }),

    Tilemap: general({
        name: 'Tilemap',
        components: [{ type: 'Transform' }, { type: 'Tilemap' }],
    }),

    TilemapLayer: general({
        name: 'TilemapLayer',
        components: [{ type: 'Transform' }, { type: 'TilemapLayer' }],
    }),

    Camera: general({
        name: 'Camera',
        components: [{ type: 'Transform' }, { type: 'Camera' }],
    }),

    AudioSource: audio({
        name: 'AudioSource',
        components: [{ type: 'Transform' }, { type: 'AudioSource' }],
    }),

    AudioListener: audio({
        name: 'AudioListener',
        components: [{ type: 'Transform' }, { type: 'AudioListener' }],
    }),

    // ---- UI ----
    Canvas: uiRoot({
        name: 'Canvas',
        components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Canvas' }],
    }),

    Button: ui({
        name: 'Button',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
            { type: 'Interactable' },
            { type: 'Button' },
        ],
    }),

    Panel: ui({
        name: 'Panel',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
            { type: 'UIMask' },
        ],
    }),

    Image: ui({
        name: 'Image',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect' },
        ],
    }),

    Toggle: ui({
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

    ProgressBar: ui({
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

    ScrollView: ui({
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

    Slider: ui({
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

    Dropdown: ui({
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

    Text: ui({
        name: 'Text',
        components: [
            { type: 'Transform' },
            { type: 'UIRect' },
            { type: 'Text' },
        ],
    }),

    'CollectionView (Linear)': { ...ui({
        name: 'CollectionView',
        components: [
            { type: 'Transform' },
            { type: 'UIRect', defaults: { size: { x: 300, y: 400 } } },
            { type: 'CollectionView', defaults: { itemCount: 10, layout: 'linear' } },
            { type: 'LinearLayout', defaults: { itemSize: 40, spacing: 4 } },
        ],
    }), menuLabel: 'List (Linear)' },

    'CollectionView (Grid)': { ...ui({
        name: 'CollectionView',
        components: [
            { type: 'Transform' },
            { type: 'UIRect', defaults: { size: { x: 400, y: 400 } } },
            { type: 'CollectionView', defaults: { itemCount: 20, layout: 'grid' } },
            { type: 'GridLayout', defaults: { crossAxisCount: 4, itemSize: { x: 80, y: 80 }, spacing: { x: 4, y: 4 } } },
        ],
    }), menuLabel: 'Grid' },

    'CollectionView (Fan)': { ...ui({
        name: 'CardHand',
        components: [
            { type: 'Transform' },
            { type: 'CollectionView', defaults: { itemCount: 5, layout: 'fan', virtualized: false } },
            { type: 'FanLayout', defaults: { radius: 500, maxSpreadAngle: 25 } },
        ],
    }), menuLabel: 'Card Hand (Fan)' },

    TextInput: ui({
        name: 'TextInput',
        components: [
            { type: 'Transform' },
            { type: 'Image' },
            { type: 'UIRect', defaults: { size: { x: 200, y: 36 } } },
            { type: 'Interactable' },
            { type: 'TextInput' },
        ],
    }),

    // ---- Physics ----
    BoxCollider: physics({
        name: 'BoxCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'BoxCollider' }],
    }),

    CircleCollider: physics({
        name: 'CircleCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'CircleCollider' }],
    }),

    CapsuleCollider: physics({
        name: 'CapsuleCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'CapsuleCollider' }],
    }),

    SegmentCollider: physics({
        name: 'SegmentCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'SegmentCollider' }],
    }),

    PolygonCollider: physics({
        name: 'PolygonCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'PolygonCollider' }],
    }),

    ChainCollider: physics({
        name: 'ChainCollider',
        components: [{ type: 'Transform' }, { type: 'RigidBody' }, { type: 'ChainCollider' }],
    }),
};

// =============================================================================
// Instantiation (category-driven, no type inspection)
// =============================================================================

export function instantiateTemplate(
    state: HierarchyState,
    templateName: string,
    parent: Entity | null,
): Entity | null {
    const template = ENTITY_TEMPLATES[templateName];
    if (!template) return null;

    let effectiveParent = parent;
    if (template.category === 'ui' && !template.isUIRoot) {
        effectiveParent = resolveUIParent(state.store, parent);
    }

    const refMap = new Map<string, Entity>();

    const rootEntity = createNode(state, template.root, effectiveParent, refMap);

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

// =============================================================================
// Auto-generate menu items from template registry
// =============================================================================

export function getTemplatesByCategory(category: EntityCategory): { key: string; label: string }[] {
    const results: { key: string; label: string }[] = [];
    for (const [key, template] of Object.entries(ENTITY_TEMPLATES)) {
        if (template.category === category) {
            results.push({ key, label: template.menuLabel ?? key });
        }
    }
    return results;
}
