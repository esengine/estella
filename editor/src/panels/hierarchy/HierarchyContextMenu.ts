import type { Entity } from 'esengine';
import type { EntityData } from '../../types/SceneTypes';
import { icons } from '../../utils/icons';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import { showContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../../ui/ContextMenuRegistry';
import { getEditorContext, getEditorInstance } from '../../context/EditorContext';
import { getAssetDatabase, isUUID } from '../../asset/AssetDatabase';
import { getGlobalPathResolver } from '../../asset';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { generateUniqueName } from '../../utils/naming';
import { showInputDialog } from '../../ui/dialog';
import { joinPath, getParentDir } from '../../utils/path';
import { hasAnyOverrides } from '../../prefab';
import type { HierarchyState } from './HierarchyTypes';

export function showEntityContextMenu(state: HierarchyState, x: number, y: number, entity: Entity | null): void {
    const entityData = entity !== null ? state.store.getEntityData(entity as number) : null;
    const has = (type: string) => entityData?.components.some(c => c.type === type) ?? false;
    const editor = getEditorInstance();
    const multiSelected = state.store.selectedEntities.size > 1;

    const createChildren: ContextMenuItem[] = [
        { label: 'Empty Entity', icon: icons.plus(14), onClick: () => {
            const newEntity = state.store.createEntity(undefined, entity);
            state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        } },
        { label: 'Sprite', icon: icons.image(14), onClick: () => createEntityWithComponent(state, 'Sprite', entity) },
        { label: 'Text', icon: icons.type(14), onClick: () => createEntityWithComponent(state, 'Text', entity) },
        { label: 'BitmapText', icon: icons.type(14), onClick: () => createEntityWithComponent(state, 'BitmapText', entity) },
        { label: 'Spine', icon: icons.bone(14), onClick: () => createEntityWithComponent(state, 'SpineAnimation', entity) },
        { label: 'Camera', icon: icons.camera(14), onClick: () => createEntityWithComponent(state, 'Camera', entity) },
        { label: 'Canvas', icon: icons.template(14), onClick: () => createEntityWithComponent(state, 'Canvas', entity) },
        { label: '', separator: true },
        { label: 'UI', icon: icons.pointer(14), children: [
            { label: 'Button', onClick: () => createButtonEntity(state, entity) },
            { label: 'TextInput', onClick: () => createTextInputEntity(state, entity) },
            { label: 'Image', onClick: () => createImageEntity(state, entity) },
            { label: 'Panel', onClick: () => createPanelEntity(state, entity) },
            { label: '', separator: true },
            { label: 'Toggle', onClick: () => createToggleEntity(state, entity) },
            { label: 'Slider', onClick: () => createSliderEntity(state, entity) },
            { label: 'ProgressBar', onClick: () => createProgressBarEntity(state, entity) },
            { label: 'ScrollView', onClick: () => createScrollViewEntity(state, entity) },
            { label: 'Dropdown', onClick: () => createDropdownEntity(state, entity) },
            { label: '', separator: true },
            { label: 'ScreenSpace Root', onClick: () => createScreenSpaceRootEntity(state, entity) },
        ] },
        { label: 'Physics', icon: icons.circle(14), children: [
            { label: 'Box Collider', onClick: () => createPhysicsEntity(state, 'BoxCollider', entity) },
            { label: 'Circle Collider', onClick: () => createPhysicsEntity(state, 'CircleCollider', entity) },
            { label: 'Capsule Collider', onClick: () => createPhysicsEntity(state, 'CapsuleCollider', entity) },
        ] },
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
                { label: 'Interactable', disabled: has('Interactable'), onClick: () => addComp('Interactable') },
                { label: 'Button', disabled: has('Button'), onClick: () => addComp('Button') },
                { label: 'Image', disabled: has('Image'), onClick: () => addComp('Image') },
                { label: 'UIMask', disabled: has('UIMask'), onClick: () => addComp('UIMask') },
                { label: 'ScreenSpace', disabled: has('ScreenSpace'), onClick: () => addComp('ScreenSpace') },
                { label: '', separator: true },
                { label: 'Toggle', disabled: has('Toggle'), onClick: () => addComp('Toggle') },
                { label: 'Slider', disabled: has('Slider'), onClick: () => addComp('Slider') },
                { label: 'ProgressBar', disabled: has('ProgressBar'), onClick: () => addComp('ProgressBar') },
                { label: 'Draggable', disabled: has('Draggable'), onClick: () => addComp('Draggable') },
                { label: 'ScrollView', disabled: has('ScrollView'), onClick: () => addComp('ScrollView') },
                { label: 'Dropdown', disabled: has('Dropdown'), onClick: () => addComp('Dropdown') },
                { label: 'ListView', disabled: has('ListView'), onClick: () => addComp('ListView') },
                { label: 'Focusable', disabled: has('Focusable'), onClick: () => addComp('Focusable') },
                { label: 'SafeArea', disabled: has('SafeArea'), onClick: () => addComp('SafeArea') },
                { label: '', separator: true },
                { label: 'RigidBody', disabled: has('RigidBody'), onClick: () => addComp('RigidBody') },
                { label: 'BoxCollider', disabled: has('BoxCollider'), onClick: () => addComp('BoxCollider') },
                { label: 'CircleCollider', disabled: has('CircleCollider'), onClick: () => addComp('CircleCollider') },
                { label: 'CapsuleCollider', disabled: has('CapsuleCollider'), onClick: () => addComp('CapsuleCollider') },
            ],
        });

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

    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

    if (componentType === 'Text') {
        state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    }

    state.store.addComponent(newEntity, componentType, getInitialComponentData(componentType));
}

function createPhysicsEntity(state: HierarchyState, colliderType: string, parent: Entity | null): void {
    const newEntity = state.store.createEntity(colliderType, parent);
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(newEntity, 'RigidBody', getInitialComponentData('RigidBody'));
    state.store.addComponent(newEntity, colliderType, getInitialComponentData(colliderType));
}

function createButtonEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('Button', parent);
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'Interactable', getInitialComponentData('Interactable'));
    state.store.addComponent(newEntity, 'Button', getInitialComponentData('Button'));
}

function createTextInputEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('TextInput', parent);
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'UIMask', getInitialComponentData('UIMask'));
}

function createScreenSpaceRootEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('ScreenSpace Root', parent);
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(newEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 1, y: 1 },
    });
    state.store.addComponent(newEntity, 'ScreenSpace', {});
}

function createImageEntity(state: HierarchyState, parent: Entity | null): void {
    const newEntity = state.store.createEntity('Image', parent);
    state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
    state.store.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
    state.store.addComponent(newEntity, 'Image', getInitialComponentData('Image'));
}

function createToggleEntity(state: HierarchyState, parent: Entity | null): void {
    const toggleEntity = state.store.createEntity('Toggle', parent);
    state.store.addComponent(toggleEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(checkmark, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
}

function createProgressBarEntity(state: HierarchyState, parent: Entity | null): void {
    const barEntity = state.store.createEntity('ProgressBar', parent);
    state.store.addComponent(barEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(fill, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
}

function createScrollViewEntity(state: HierarchyState, parent: Entity | null): void {
    const scrollEntity = state.store.createEntity('ScrollView', parent);
    state.store.addComponent(scrollEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
    state.store.addComponent(scrollEntity, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 300, y: 200 },
    });
    state.store.addComponent(scrollEntity, 'UIRect', {
        ...getInitialComponentData('UIRect'),
        size: { x: 300, y: 200 },
    });
    state.store.addComponent(scrollEntity, 'UIMask', getInitialComponentData('UIMask'));
    state.store.addComponent(scrollEntity, 'Interactable', getInitialComponentData('Interactable'));

    const content = state.store.createEntity('Content', scrollEntity);
    state.store.addComponent(content, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
        contentHeight: 600,
    });
}

function createSliderEntity(state: HierarchyState, parent: Entity | null): void {
    const sliderEntity = state.store.createEntity('Slider', parent);
    state.store.addComponent(sliderEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(fill, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(handle, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
}

function createDropdownEntity(state: HierarchyState, parent: Entity | null): void {
    const ddEntity = state.store.createEntity('Dropdown', parent);
    state.store.addComponent(ddEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(label, 'LocalTransform', getInitialComponentData('LocalTransform'));
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
    state.store.addComponent(list, 'LocalTransform', {
        ...getInitialComponentData('LocalTransform'),
        scale: { x: 0, y: 0, z: 0 },
    });
    state.store.addComponent(list, 'Sprite', {
        ...getInitialComponentData('Sprite'),
        size: { x: 160, y: 120 },
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
    if (asset.type === 'prefab') {
        await createEntityFromPrefab(state, asset.path, parent);
        return;
    }

    const baseName = asset.name.replace(/\.[^.]+$/, '');

    if (asset.type === 'spine' || asset.type === 'json') {
        const ext = asset.name.substring(asset.name.lastIndexOf('.')).toLowerCase();
        if (ext === '.atlas') return;

        const skeletonPath = toRelativePath(asset.path);
        const atlasPath = await findAtlasFile(skeletonPath);

        if (!atlasPath) {
            console.error(`[HierarchyPanel] No atlas file found for: ${skeletonPath}`);
            alert(`No atlas file found.\nPlease ensure there is an .atlas file in the same directory as the skeleton file.`);
            return;
        }

        const newEntity = state.store.createEntity(baseName, parent);

        state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

        state.store.addComponent(newEntity, 'SpineAnimation', {
            ...getInitialComponentData('SpineAnimation'),
            skeletonPath,
            atlasPath,
        });
    } else if (asset.type === 'image') {
        const newEntity = state.store.createEntity(baseName, parent);

        state.store.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

        state.store.addComponent(newEntity, 'Sprite', {
            ...getInitialComponentData('Sprite'),
            texture: toRelativePath(asset.path),
        });

        loadImageSize(asset.path).then(size => {
            if (size) {
                state.store.updateProperty(newEntity, 'Sprite', 'size', { x: 32, y: 32 }, size);
            }
        });
    }
}

function toRelativePath(absolutePath: string): string {
    return getGlobalPathResolver().toRelativePath(absolutePath);
}

async function findAtlasFile(skeletonPath: string): Promise<string | null> {
    const pathResolver = getGlobalPathResolver();

    const sameNameAtlas = skeletonPath.replace(/\.(json|skel)$/i, '.atlas');
    const validation = await pathResolver.validatePath(sameNameAtlas);
    if (validation.exists) {
        return sameNameAtlas;
    }

    const dir = skeletonPath.substring(0, skeletonPath.lastIndexOf('/'));
    const absoluteDir = pathResolver.toAbsolutePath(dir);

    const fs = getEditorContext().fs;
    if (!fs) {
        return null;
    }

    try {
        const entries = await fs.listDirectoryDetailed(absoluteDir);
        const atlasFiles = entries
            .filter(e => e.name.endsWith('.atlas'))
            .map(e => e.name);

        if (atlasFiles.length === 1) {
            return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
        }

        if (atlasFiles.length > 1) {
            const baseName = skeletonPath
                .substring(skeletonPath.lastIndexOf('/') + 1)
                .replace(/\.(json|skel)$/i, '');

            const matching = atlasFiles.find((name: string) =>
                name.replace('.atlas', '').toLowerCase().includes(baseName.toLowerCase().split('-')[0])
            );

            if (matching) {
                return dir ? `${dir}/${matching}` : matching;
            }

            return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
        }
    } catch (err) {
        console.warn('[HierarchyPanel] Failed to scan directory for atlas files:', err);
    }

    return null;
}

function loadImageSize(absolutePath: string): Promise<{ x: number; y: number } | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
    });
}

async function createEntityFromPrefab(
    state: HierarchyState,
    prefabPath: string,
    parent: Entity | null,
): Promise<void> {
    const relativePath = toRelativePath(prefabPath);
    const uuid = getAssetDatabase().getUuid(relativePath) ?? relativePath;
    await state.store.instantiatePrefab(uuid, parent);
}
