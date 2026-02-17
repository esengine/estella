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
            { label: 'Panel', onClick: () => createPanelEntity(state, entity) },
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
        items.push({
            label: 'Add Component', children: [
                { label: 'Interactable', disabled: has('Interactable'), onClick: () => state.store.addComponent(entity, 'Interactable', getInitialComponentData('Interactable')) },
                { label: 'Button', disabled: has('Button'), onClick: () => state.store.addComponent(entity, 'Button', getInitialComponentData('Button')) },
                { label: 'ScreenSpace', disabled: has('ScreenSpace'), onClick: () => state.store.addComponent(entity, 'ScreenSpace', getInitialComponentData('ScreenSpace')) },
                { label: '', separator: true },
                { label: 'RigidBody', disabled: has('RigidBody'), onClick: () => state.store.addComponent(entity, 'RigidBody', getInitialComponentData('RigidBody')) },
                { label: 'BoxCollider', disabled: has('BoxCollider'), onClick: () => state.store.addComponent(entity, 'BoxCollider', getInitialComponentData('BoxCollider')) },
                { label: 'CircleCollider', disabled: has('CircleCollider'), onClick: () => state.store.addComponent(entity, 'CircleCollider', getInitialComponentData('CircleCollider')) },
                { label: 'CapsuleCollider', disabled: has('CapsuleCollider'), onClick: () => state.store.addComponent(entity, 'CapsuleCollider', getInitialComponentData('CapsuleCollider')) },
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
