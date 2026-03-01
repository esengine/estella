import type { Entity } from 'esengine';
import type { EntityData } from '../../types/SceneTypes';
import { icons } from '../../utils/icons';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import { showContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../../ui/ContextMenuRegistry';
import { getEditorInstance } from '../../context/EditorContext';
import { generateUniqueName } from '../../utils/naming';
import { showInputDialog } from '../../ui/dialog';
import { joinPath, getParentDir } from '../../utils/path';
import { hasAnyOverrides } from '../../prefab';
import { getAssetTypeDescriptor } from '../../asset/AssetTypeRegistry';
import type { HierarchyState } from './HierarchyTypes';

export function showEntityContextMenu(state: HierarchyState, x: number, y: number, entity: Entity | null): void {
    const entityData = entity !== null ? state.store.getEntityData(entity as number) : null;
    const has = (type: string) => entityData?.components.some(c => c.type === type) ?? false;
    const editor = getEditorInstance();
    const multiSelected = state.store.selectedEntities.size > 1;

    const createChildren: ContextMenuItem[] = [
        { label: 'Empty Entity', icon: icons.plus(14), onClick: () => {
            const newEntity = state.store.createEntity(undefined, entity);
            state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
        } },
        { label: '', separator: true },
        { label: '2D', icon: icons.image(14), children: [
            { label: 'Sprite', icon: icons.image(14), onClick: () => createEntityWithComponent(state, 'Sprite', entity) },
            { label: 'Text', icon: icons.type(14), onClick: () => createEntityWithComponent(state, 'Text', entity) },
            { label: 'BitmapText', icon: icons.type(14), onClick: () => createEntityWithComponent(state, 'BitmapText', entity) },
            { label: 'Spine', icon: icons.bone(14), onClick: () => createEntityWithComponent(state, 'SpineAnimation', entity) },
            { label: 'Particle', icon: icons.star(14), onClick: () => createEntityWithComponent(state, 'ParticleEmitter', entity) },
        ] },
        { label: 'UI', icon: icons.pointer(14), children: [
            { label: 'Canvas', icon: icons.template(14), onClick: () => createEntityWithComponent(state, 'Canvas', entity) },
            { label: '', separator: true },
            { label: 'Button', icon: icons.pointer(14), onClick: () => createButtonEntity(state, entity) },
            { label: 'TextInput', icon: icons.type(14), onClick: () => createTextInputEntity(state, entity) },
            { label: 'Image', icon: icons.image(14), onClick: () => createImageEntity(state, entity) },
            { label: 'Panel', icon: icons.layers(14), onClick: () => createPanelEntity(state, entity) },
            { label: '', separator: true },
            { label: 'Toggle', icon: icons.toggle(14), onClick: () => createToggleEntity(state, entity) },
            { label: 'Slider', icon: icons.sliders(14), onClick: () => createSliderEntity(state, entity) },
            { label: 'ProgressBar', icon: icons.gauge(14), onClick: () => createProgressBarEntity(state, entity) },
            { label: 'ScrollView', icon: icons.list(14), onClick: () => createScrollViewEntity(state, entity) },
            { label: 'Dropdown', icon: icons.chevronDown(14), onClick: () => createDropdownEntity(state, entity) },
        ] },
        { label: 'Audio', icon: icons.volume(14), children: [
            { label: 'AudioSource', icon: icons.volume(14), onClick: () => createAudioEntity(state, 'AudioSource', entity) },
            { label: 'AudioListener', icon: icons.headphones(14), onClick: () => createAudioEntity(state, 'AudioListener', entity) },
        ] },
        { label: 'Physics', icon: icons.circle(14), children: [
            { label: 'Box Collider', icon: icons.box(14), onClick: () => createPhysicsEntity(state, 'BoxCollider', entity) },
            { label: 'Circle Collider', icon: icons.circle(14), onClick: () => createPhysicsEntity(state, 'CircleCollider', entity) },
            { label: 'Capsule Collider', icon: icons.shield(14), onClick: () => createPhysicsEntity(state, 'CapsuleCollider', entity) },
        ] },
        { label: '', separator: true },
        { label: 'Camera', icon: icons.camera(14), onClick: () => createEntityWithComponent(state, 'Camera', entity) },
    ];

    const items: ContextMenuItem[] = [];

    if (entity !== null) {
        items.push(
            { label: 'Rename', icon: icons.pencil(14), onClick: () => {
                state.renamingEntityId = entity as number;
                state.renderVisibleRows();
            } },
            { label: 'Duplicate', icon: icons.copy(14), onClick: () => {
                if (multiSelected) {
                    for (const id of state.store.selectedEntities) {
                        duplicateEntity(state, id as Entity);
                    }
                } else {
                    duplicateEntity(state, entity);
                }
            } },
            { label: 'Copy', icon: icons.copy(14), onClick: () => { state.store.selectEntity(entity); editor?.copySelected(); } },
            { label: 'Cut', icon: icons.copy(14), onClick: () => {
                state.store.selectEntity(entity);
                editor?.copySelected();
                if (multiSelected) {
                    state.store.deleteSelectedEntities();
                } else {
                    state.store.deleteEntity(entity);
                }
            } },
            { label: 'Paste', icon: icons.template(14), disabled: !editor?.hasClipboard(), onClick: () => { state.store.selectEntity(entity); editor?.pasteEntity(); } },
            { label: 'Delete', icon: icons.trash(14), onClick: () => {
                if (multiSelected) {
                    state.store.deleteSelectedEntities();
                } else {
                    state.store.deleteEntity(entity);
                }
            } },
            { label: '', separator: true },
        );
    }

    items.push({ label: 'Create', icon: icons.plus(14), children: createChildren });

    if (entity === null) {
        items.push({ label: 'Paste', icon: icons.template(14), disabled: !editor?.hasClipboard(), onClick: () => { editor?.pasteEntity(); } });
    }

    if (entity !== null) {
        const addComp = (type: string) => state.store.addComponent(entity, type, getInitialComponentData(type));
        items.push({
            label: 'Add Component', children: [
                { label: 'Interactable', icon: icons.pointer(14), disabled: has('Interactable'), onClick: () => addComp('Interactable') },
                { label: 'Button', icon: icons.pointer(14), disabled: has('Button'), onClick: () => addComp('Button') },
                { label: 'Image', icon: icons.image(14), disabled: has('Image'), onClick: () => addComp('Image') },
                { label: 'UIMask', icon: icons.scan(14), disabled: has('UIMask'), onClick: () => addComp('UIMask') },
                { label: '', separator: true },
                { label: 'Toggle', icon: icons.toggle(14), disabled: has('Toggle'), onClick: () => addComp('Toggle') },
                { label: 'Slider', icon: icons.sliders(14), disabled: has('Slider'), onClick: () => addComp('Slider') },
                { label: 'ProgressBar', icon: icons.gauge(14), disabled: has('ProgressBar'), onClick: () => addComp('ProgressBar') },
                { label: 'Draggable', icon: icons.move(14), disabled: has('Draggable'), onClick: () => addComp('Draggable') },
                { label: 'ScrollView', icon: icons.list(14), disabled: has('ScrollView'), onClick: () => addComp('ScrollView') },
                { label: 'Dropdown', icon: icons.chevronDown(14), disabled: has('Dropdown'), onClick: () => addComp('Dropdown') },
                { label: 'ListView', icon: icons.list(14), disabled: has('ListView'), onClick: () => addComp('ListView') },
                { label: 'Focusable', icon: icons.eye(14), disabled: has('Focusable'), onClick: () => addComp('Focusable') },
                { label: 'SafeArea', icon: icons.shield(14), disabled: has('SafeArea'), onClick: () => addComp('SafeArea') },
                { label: '', separator: true },
                { label: 'ParticleEmitter', icon: icons.star(14), disabled: has('ParticleEmitter'), onClick: () => addComp('ParticleEmitter') },
                { label: '', separator: true },
                { label: 'AudioSource', icon: icons.volume(14), disabled: has('AudioSource'), onClick: () => addComp('AudioSource') },
                { label: 'AudioListener', icon: icons.headphones(14), disabled: has('AudioListener'), onClick: () => addComp('AudioListener') },
                { label: '', separator: true },
                { label: 'RigidBody', icon: icons.box(14), disabled: has('RigidBody'), onClick: () => addComp('RigidBody') },
                { label: 'BoxCollider', icon: icons.box(14), disabled: has('BoxCollider'), onClick: () => addComp('BoxCollider') },
                { label: 'CircleCollider', icon: icons.circle(14), disabled: has('CircleCollider'), onClick: () => addComp('CircleCollider') },
                { label: 'CapsuleCollider', icon: icons.shield(14), disabled: has('CapsuleCollider'), onClick: () => addComp('CapsuleCollider') },
            ],
        });

        if (has('UIRect')) {
            items.push({
                label: 'UIRect', icon: icons.maximize(14), children: [
                    { label: 'Fill Parent', icon: icons.maximize(14), onClick: () => {
                        const uiRect = entityData!.components.find(c => c.type === 'UIRect');
                        const d = uiRect?.data ?? {};
                        state.store.updateProperty(entity, 'UIRect', 'anchorMin', d.anchorMin ?? { x: 0.5, y: 0.5 }, { x: 0, y: 0 });
                        state.store.updateProperty(entity, 'UIRect', 'anchorMax', d.anchorMax ?? { x: 0.5, y: 0.5 }, { x: 1, y: 1 });
                        state.store.updateProperty(entity, 'UIRect', 'offsetMin', d.offsetMin ?? { x: 0, y: 0 }, { x: 0, y: 0 });
                        state.store.updateProperty(entity, 'UIRect', 'offsetMax', d.offsetMax ?? { x: 0, y: 0 }, { x: 0, y: 0 });
                    } },
                    { label: 'Reset', icon: icons.rotateCw(14), onClick: () => {
                        const uiRect = entityData!.components.find(c => c.type === 'UIRect');
                        const d = uiRect?.data ?? {};
                        state.store.updateProperty(entity, 'UIRect', 'anchorMin', d.anchorMin ?? { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
                        state.store.updateProperty(entity, 'UIRect', 'anchorMax', d.anchorMax ?? { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
                        state.store.updateProperty(entity, 'UIRect', 'offsetMin', d.offsetMin ?? { x: 0, y: 0 }, { x: 0, y: 0 });
                        state.store.updateProperty(entity, 'UIRect', 'offsetMax', d.offsetMax ?? { x: 0, y: 0 }, { x: 0, y: 0 });
                        state.store.updateProperty(entity, 'UIRect', 'size', d.size ?? { x: 100, y: 100 }, { x: 100, y: 100 });
                        state.store.updateProperty(entity, 'UIRect', 'pivot', d.pivot ?? { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
                    } },
                ],
            });
        }

        items.push({ label: '', separator: true });

        const prefabChildren: ContextMenuItem[] = [
            { label: 'Save as Prefab...', icon: icons.package(14), onClick: () => saveEntityAsPrefab(state, entity) },
        ];
        if (state.store.isPrefabRoot(entity as number)) {
            const instanceId = state.store.getPrefabInstanceId(entity as number);
            const prefabPath = state.store.getPrefabPath(entity as number);
            if (instanceId && prefabPath) {
                const overridden = hasAnyOverrides(state.store.scene, instanceId);
                prefabChildren.push(
                    { label: '', separator: true },
                    { label: 'Revert Prefab', icon: icons.rotateCw(14), disabled: !overridden, onClick: () => state.store.revertPrefabInstance(instanceId, prefabPath) },
                    { label: 'Apply to Prefab', icon: icons.check(14), disabled: !overridden, onClick: () => state.store.applyPrefabOverrides(instanceId, prefabPath) },
                    { label: 'Unpack Prefab', icon: icons.package(14), onClick: () => state.store.unpackPrefab(instanceId) },
                );
            }
        }
        items.push({ label: 'Prefab', icon: icons.package(14), children: prefabChildren });
    }

    const location = entity !== null ? 'hierarchy.entity' : 'hierarchy.background';
    const ctx: ContextMenuContext = { location, entity: entity ?? undefined, entityData: entityData ?? undefined };
    const extensionItems = getContextMenuItems(location, ctx);
    if (extensionItems.length > 0) {
        items.push({ label: '', separator: true }, ...extensionItems);
    }

    showContextMenu({ x, y, items });
}

function createEntityWithComponent(state: HierarchyState, componentType: string, parent: Entity | null): void {
    const newEntity = state.store.createEntity(componentType, parent);

    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));

    if (componentType === 'Text') {
        const parentHasUIRect = parent !== null && state.store.getComponent(parent, 'UIRect') !== null;
        if (parentHasUIRect) {
            state.store.addComponent(newEntity, 'UIRect', {
                ...getInitialComponentData('UIRect'),
                anchorMin: { x: 0, y: 0 },
                anchorMax: { x: 1, y: 1 },
                size: { x: 0, y: 0 },
            });
        } else {
            state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
        }
    }

    state.store.addComponent(newEntity, componentType, getInitialComponentData(componentType));
}

function createAudioEntity(state: HierarchyState, componentType: string, parent: Entity | null): void {
    const newEntity = state.store.createEntity(componentType, parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, componentType, getInitialComponentData(componentType));
}

function createPhysicsEntity(state: HierarchyState, colliderType: string, parent: Entity | null): void {
    const newEntity = state.store.createEntity(colliderType, parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, 'RigidBody', getInitialComponentData('RigidBody'));
    state.store.addComponent(newEntity, colliderType, getInitialComponentData(colliderType));
}

function createButtonEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('Button', parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'Interactable', getInitialComponentData('Interactable'));
    state.store.addComponent(newEntity, 'Button', getInitialComponentData('Button'));
}

function createTextInputEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('TextInput', parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    const tiDefaults = getInitialComponentData('TextInput');
    state.store.addComponent(newEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        color: tiDefaults.backgroundColor,
        size: { x: 200, y: 36 },
    });
    state.store.addComponent(newEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 200, y: 36 },
    });
    state.store.addComponent(newEntity, 'Interactable', getInitialComponentData('Interactable'));
    state.store.addComponent(newEntity, 'TextInput', getInitialComponentData('TextInput'));
}

function createPanelEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('Panel', parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'UIMask', getInitialComponentData('UIMask'));
}

function createImageEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('Image', parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'Image', getInitialComponentData('Image'));
}

function createToggleEntity(state: HierarchyState, parent: Entity | null): void {
    const toggleEntity = state.store.createEntity('Toggle', parent);
    state.store.addComponent(toggleEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(toggleEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 24, y: 24 },
    });
    state.store.addComponent(toggleEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 24, y: 24 },
    });
    state.store.addComponent(toggleEntity, 'Interactable', getInitialComponentData('Interactable'));

    const checkmark = state.store.createEntity('Checkmark', toggleEntity);
    state.store.addComponent(checkmark, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(checkmark, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 16, y: 16 },
        color: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
    });
    state.store.addComponent(checkmark, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 16, y: 16 },
    });

    state.store.addComponent(toggleEntity, 'Toggle', {
        ...getInitialComponentData('Toggle'),
        graphicEntity: checkmark as number,
    });

    state.store.selectEntity(toggleEntity);
}

function createProgressBarEntity(state: HierarchyState, parent: Entity | null): void {
    const barEntity = state.store.createEntity('ProgressBar', parent);
    state.store.addComponent(barEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(barEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 200, y: 20 },
        color: { r: 0.3, g: 0.3, b: 0.3, a: 1 },
    });
    state.store.addComponent(barEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 200, y: 20 },
    });

    const fill = state.store.createEntity('Fill', barEntity);
    state.store.addComponent(fill, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(fill, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 200, y: 20 },
        color: { r: 0.2, g: 0.6, b: 1, a: 1 },
    });
    state.store.addComponent(fill, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 0.5, y: 1 },
        offsetMin: { x: 0, y: 0 },
        offsetMax: { x: 0, y: 0 },
    });

    state.store.addComponent(barEntity, 'ProgressBar', {
        ...getInitialComponentData('ProgressBar'),
        value: 0.5,
        fillEntity: fill as number,
    });

    state.store.selectEntity(barEntity);
}

function createScrollViewEntity(state: HierarchyState, parent: Entity | null): void {
    const scrollEntity = state.store.createEntity('ScrollView', parent);
    state.store.addComponent(scrollEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(scrollEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 300, y: 200 },
        color: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
    });
    state.store.addComponent(scrollEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 300, y: 200 },
    });
    state.store.addComponent(scrollEntity, 'UIMask', getInitialComponentData('UIMask'));
    state.store.addComponent(scrollEntity, 'Interactable', getInitialComponentData('Interactable'));

    const content = state.store.createEntity('Content', scrollEntity);
    state.store.addComponent(content, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(content, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 1, y: 1 },
        offsetMin: { x: 0, y: 0 },
        offsetMax: { x: 0, y: 0 },
    });

    state.store.addComponent(scrollEntity, 'ScrollView', {
        ...getInitialComponentData('ScrollView'),
        contentEntity: content as number,
    });

    state.store.selectEntity(scrollEntity);
}

function createSliderEntity(state: HierarchyState, parent: Entity | null): void {
    const sliderEntity = state.store.createEntity('Slider', parent);
    state.store.addComponent(sliderEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(sliderEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 200, y: 8 },
        color: { r: 0.3, g: 0.3, b: 0.3, a: 1 },
    });
    state.store.addComponent(sliderEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 200, y: 20 },
    });
    state.store.addComponent(sliderEntity, 'Interactable', getInitialComponentData('Interactable'));

    const fill = state.store.createEntity('Fill', sliderEntity);
    state.store.addComponent(fill, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(fill, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 200, y: 8 },
        color: { r: 0.2, g: 0.6, b: 1, a: 1 },
    });
    state.store.addComponent(fill, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 0.5, y: 1 },
        offsetMin: { x: 0, y: 0 },
        offsetMax: { x: 0, y: 0 },
    });

    const handle = state.store.createEntity('Handle', sliderEntity);
    state.store.addComponent(handle, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(handle, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 20, y: 20 },
        color: { r: 1, g: 1, b: 1, a: 1 },
    });
    state.store.addComponent(handle, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 20, y: 20 },
    });

    state.store.addComponent(sliderEntity, 'Slider', {
        ...getInitialComponentData('Slider'),
        value: 0.5,
        fillEntity: fill as number,
        handleEntity: handle as number,
    });

    state.store.selectEntity(sliderEntity);
}

function createDropdownEntity(state: HierarchyState, parent: Entity | null): void {
    const ddEntity = state.store.createEntity('Dropdown', parent);
    state.store.addComponent(ddEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(ddEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 160, y: 32 },
    });
    state.store.addComponent(ddEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 160, y: 32 },
    });
    state.store.addComponent(ddEntity, 'Interactable', getInitialComponentData('Interactable'));

    const label = state.store.createEntity('Label', ddEntity);
    state.store.addComponent(label, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(label, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 1, y: 1 },
        offsetMin: { x: 8, y: 0 },
        offsetMax: { x: -8, y: 0 },
    });
    state.store.addComponent(label, 'Text', {
        ...getInitialComponentData('Text'),
        content: 'Select...',
    });

    const list = state.store.createEntity('List', ddEntity);
    state.store.addComponent(list, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(list, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 160, y: 120 },
        enabled: false,
    });
    state.store.addComponent(list, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 160, y: 120 },
    });

    state.store.addComponent(ddEntity, 'Dropdown', {
        ...getInitialComponentData('Dropdown'),
        options: ['Option 1', 'Option 2', 'Option 3'],
        labelEntity: label as number,
        listEntity: list as number,
    });

    state.store.selectEntity(ddEntity);
}

export function duplicateEntity(state: HierarchyState, entity: Entity): void {
    const entityData = state.store.getEntityData(entity as number);
    if (!entityData) return;

    const scene = state.store.scene;
    const siblings = scene.entities
        .filter(e => e.parent === entityData.parent)
        .map(e => e.name);
    const siblingNames = new Set(siblings);
    const newName = generateUniqueName(entityData.name, siblingNames);

    const newEntity = state.store.createEntity(
        newName,
        entityData.parent as Entity | null
    );

    for (const comp of entityData.components) {
        state.store.addComponent(newEntity, comp.type, JSON.parse(JSON.stringify(comp.data)));
    }

    duplicateChildren(state, entityData, newEntity);
}

function duplicateChildren(state: HierarchyState, sourceEntity: EntityData, newParent: Entity): void {
    for (const childId of sourceEntity.children) {
        const childData = state.store.getEntityData(childId);
        if (!childData) continue;

        const childEntity = state.store.createEntity(childData.name, newParent);

        for (const comp of childData.components) {
            state.store.addComponent(childEntity, comp.type, JSON.parse(JSON.stringify(comp.data)));
        }

        duplicateChildren(state, childData, childEntity);
    }
}

async function saveEntityAsPrefab(state: HierarchyState, entity: Entity): Promise<void> {
    const entityData = state.store.getEntityData(entity as number);
    if (!entityData) return;

    const projectPath = getEditorInstance()?.projectPath;
    if (!projectPath) return;

    const projectDir = getParentDir(projectPath);
    const assetsDir = joinPath(projectDir, 'assets');

    const name = await showInputDialog({
        title: 'Save as Prefab',
        placeholder: 'Prefab name',
        defaultValue: entityData.name,
        confirmText: 'Save',
        validator: async (value) => {
            if (!value.trim()) return 'Name is required';
            if (/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())) {
                return 'Name contains invalid characters';
            }
            return null;
        },
    });

    if (!name) return;

    const fileName = name.trim().endsWith('.esprefab')
        ? name.trim()
        : `${name.trim()}.esprefab`;
    const filePath = joinPath(assetsDir, fileName);

    const success = await state.store.saveAsPrefab(entity as number, filePath);
    if (!success) {
        console.error('[HierarchyPanel] Failed to save prefab:', filePath);
    }
}

export async function createEntityFromAsset(
    state: HierarchyState,
    asset: { type: string; path: string; name: string },
    parent: Entity | null,
): Promise<void> {
    const descriptor = getAssetTypeDescriptor(asset.type);
    if (descriptor?.onCreateEntity) {
        await descriptor.onCreateEntity(state, asset, parent);
    }
}
