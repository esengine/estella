import type { Entity } from 'esengine';
import type { EntityData } from '../../types/SceneTypes';
import { icons } from '../../utils/icons';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import { showContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../../ui/ContextMenuRegistry';
import { getClipboardService, getProjectService } from '../../services';
import { generateUniqueName } from '../../utils/naming';
import { showInputDialog } from '../../ui/dialog';
import { joinPath, getParentDir } from '../../utils/path';
import { hasAnyOverrides } from '../../prefab';
import { getAssetTypeDescriptor } from '../../asset/AssetTypeRegistry';
import type { HierarchyState } from './HierarchyTypes';
import { instantiateTemplate } from './EntityTemplates';
import { showCreateTilemapDialog } from './CreateTilemapDialog';

const create = (state: HierarchyState, template: string, parent: Entity | null) =>
    () => instantiateTemplate(state, template, parent);

export function showEntityContextMenu(state: HierarchyState, x: number, y: number, entity: Entity | null): void {
    const entityData = entity !== null ? state.store.getEntityData(entity as number) : null;
    const has = (type: string) => entityData?.components.some(c => c.type === type) ?? false;
    const clipboard = getClipboardService();
    const multiSelected = state.store.selectedEntities.size > 1;

    const createChildren: ContextMenuItem[] = [
        { label: 'Empty Entity', icon: icons.plus(14), onClick: () => {
            const newEntity = state.store.createEntity(undefined, entity);
            state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
        } },
        { label: '', separator: true },
        { label: '2D', icon: icons.image(14), children: [
            { label: 'Sprite', icon: icons.image(14), onClick: create(state, 'Sprite', entity) },
            { label: 'Text', icon: icons.type(14), onClick: create(state, 'Text', entity) },
            { label: 'BitmapText', icon: icons.type(14), onClick: create(state, 'BitmapText', entity) },
            { label: 'Spine', icon: icons.bone(14), onClick: create(state, 'SpineAnimation', entity) },
            { label: 'Shape', icon: icons.hexagon(14), onClick: create(state, 'ShapeRenderer', entity) },
            { label: 'Particle', icon: icons.star(14), onClick: create(state, 'ParticleEmitter', entity) },
            { label: 'Tilemap', icon: icons.grid(14), onClick: create(state, 'Tilemap', entity) },
            { label: 'Tilemap Layer', icon: icons.layers(14), onClick: () => showCreateTilemapDialog(state, entity) },
        ] },
        { label: 'UI', icon: icons.pointer(14), children: [
            { label: 'Canvas', icon: icons.template(14), onClick: create(state, 'Canvas', entity) },
            { label: '', separator: true },
            { label: 'Button', icon: icons.pointer(14), onClick: create(state, 'Button', entity) },
            { label: 'TextInput', icon: icons.type(14), onClick: create(state, 'TextInput', entity) },
            { label: 'Image', icon: icons.image(14), onClick: create(state, 'Image', entity) },
            { label: 'Panel', icon: icons.layers(14), onClick: create(state, 'Panel', entity) },
            { label: '', separator: true },
            { label: 'Toggle', icon: icons.toggle(14), onClick: create(state, 'Toggle', entity) },
            { label: 'Slider', icon: icons.sliders(14), onClick: create(state, 'Slider', entity) },
            { label: 'ProgressBar', icon: icons.gauge(14), onClick: create(state, 'ProgressBar', entity) },
            { label: 'ScrollView', icon: icons.list(14), onClick: create(state, 'ScrollView', entity) },
            { label: 'Dropdown', icon: icons.chevronDown(14), onClick: create(state, 'Dropdown', entity) },
        ] },
        { label: 'Audio', icon: icons.volume(14), children: [
            { label: 'AudioSource', icon: icons.volume(14), onClick: create(state, 'AudioSource', entity) },
            { label: 'AudioListener', icon: icons.headphones(14), onClick: create(state, 'AudioListener', entity) },
        ] },
        { label: 'Physics', icon: icons.circle(14), children: [
            { label: 'Box Collider', icon: icons.box(14), onClick: create(state, 'BoxCollider', entity) },
            { label: 'Circle Collider', icon: icons.circle(14), onClick: create(state, 'CircleCollider', entity) },
            { label: 'Capsule Collider', icon: icons.shield(14), onClick: create(state, 'CapsuleCollider', entity) },
            { label: 'Segment Collider', icon: icons.minus(14), onClick: create(state, 'SegmentCollider', entity) },
            { label: 'Polygon Collider', icon: icons.hexagon(14), onClick: create(state, 'PolygonCollider', entity) },
            { label: 'Chain Collider', icon: icons.link(14), onClick: create(state, 'ChainCollider', entity) },
        ] },
        { label: '', separator: true },
        { label: 'Camera', icon: icons.camera(14), onClick: create(state, 'Camera', entity) },
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
            { label: 'Copy', icon: icons.copy(14), onClick: () => { state.store.selectEntity(entity); clipboard.copySelected(); } },
            { label: 'Cut', icon: icons.copy(14), onClick: () => {
                state.store.selectEntity(entity);
                clipboard.copySelected();
                if (multiSelected) {
                    state.store.deleteSelectedEntities();
                } else {
                    state.store.deleteEntity(entity);
                }
            } },
            { label: 'Paste', icon: icons.template(14), disabled: !clipboard.hasClipboard(), onClick: () => { state.store.selectEntity(entity); clipboard.pasteEntity(); } },
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
        items.push({ label: 'Paste', icon: icons.template(14), disabled: !clipboard.hasClipboard(), onClick: () => { clipboard.pasteEntity(); } });
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
                { label: 'SegmentCollider', icon: icons.minus(14), disabled: has('SegmentCollider'), onClick: () => addComp('SegmentCollider') },
                { label: 'PolygonCollider', icon: icons.hexagon(14), disabled: has('PolygonCollider'), onClick: () => addComp('PolygonCollider') },
                { label: 'ChainCollider', icon: icons.link(14), disabled: has('ChainCollider'), onClick: () => addComp('ChainCollider') },
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

    const projectPath = getProjectService().projectPath;
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
