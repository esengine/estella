import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import { icons } from '../../utils/icons';
import { getNavigationService } from '../../services';
import { getAssetLibrary, isUUID } from '../../asset/AssetLibrary';
import { escapeHtml } from './InspectorHelpers';
import { isPropertyOverridden, hasAnyOverrides } from '../../prefab';

export function renderEntityHeader(
    container: HTMLElement,
    name: string,
    entity: Entity,
    store: EditorStore
): void {
    const isVisible = store.isEntityVisible(entity as number);
    const visibilityIcon = isVisible ? icons.eye(14) : icons.eyeOff(14);

    const entityData = store.getEntityData(entity as number);
    const entityIcon = entityData?.prefab?.isRoot ? icons.package(16) : icons.box(16);

    const header = document.createElement('div');
    header.className = 'es-inspector-entity-header';
    header.innerHTML = `
        <span class="es-entity-icon">${entityIcon}</span>
        <input type="text" class="es-entity-name-input" value="${escapeHtml(name)}">
        <span class="es-entity-visibility">${visibilityIcon}</span>
        <span class="es-entity-id">ID:${entity}</span>
    `;

    const input = header.querySelector('.es-entity-name-input') as HTMLInputElement;
    input.addEventListener('change', () => {
        const newName = input.value.trim();
        if (newName && newName !== name) {
            store.renameEntity(entity, newName);
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = name;
            input.blur();
        }
    });

    const visBtn = header.querySelector('.es-entity-visibility');
    visBtn?.addEventListener('click', () => {
        store.toggleVisibility(entity as number);
    });

    container.appendChild(header);

    if (entityData?.prefab) {
        renderPrefabInfoBar(container, entity, entityData, store);
    }
}

function renderPrefabInfoBar(
    container: HTMLElement,
    entity: Entity,
    entityData: import('../../types/SceneTypes').EntityData,
    store: EditorStore
): void {
    const prefab = entityData.prefab!;
    const resolvedPath = isUUID(prefab.prefabPath)
        ? (getAssetLibrary().getPath(prefab.prefabPath) ?? prefab.prefabPath)
        : prefab.prefabPath;
    const pathDisplay = resolvedPath.split('/').pop() ?? resolvedPath;

    const bar = document.createElement('div');
    bar.className = 'es-prefab-info-bar';
    bar.innerHTML = `
        ${icons.package(12)}
        <span class="es-prefab-info-path es-prefab-info-link" title="${escapeHtml(resolvedPath)}">${escapeHtml(pathDisplay)}</span>
    `;

    const pathEl = bar.querySelector('.es-prefab-info-link');
    pathEl?.addEventListener('click', () => {
        getNavigationService().navigateToAsset(resolvedPath);
    });

    if (prefab.basePrefab) {
        const baseResolved = isUUID(prefab.basePrefab)
            ? (getAssetLibrary().getPath(prefab.basePrefab) ?? prefab.basePrefab)
            : prefab.basePrefab;
        const baseDisplay = baseResolved.split('/').pop()?.replace('.esprefab', '') ?? baseResolved;
        const variantLabel = document.createElement('span');
        variantLabel.className = 'es-prefab-variant-label';
        variantLabel.textContent = `Variant of: ${baseDisplay}`;
        variantLabel.title = baseResolved;
        variantLabel.style.cursor = 'pointer';
        variantLabel.style.opacity = '0.7';
        variantLabel.style.fontSize = '11px';
        variantLabel.addEventListener('click', () => {
            getNavigationService().navigateToAsset(baseResolved);
        });
        bar.appendChild(variantLabel);
    }

    if (prefab.isRoot) {
        const overridden = hasAnyOverrides(store.scene, prefab.instanceId);

        const revertBtn = document.createElement('button');
        revertBtn.className = 'es-btn';
        revertBtn.textContent = 'Revert';
        revertBtn.disabled = !overridden;
        revertBtn.addEventListener('click', () => {
            store.revertPrefabInstance(prefab.instanceId, prefab.prefabPath);
        });

        const applyBtn = document.createElement('button');
        applyBtn.className = 'es-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.disabled = !overridden;
        applyBtn.addEventListener('click', () => {
            store.applyPrefabOverrides(prefab.instanceId, prefab.prefabPath);
        });

        bar.appendChild(revertBtn);
        bar.appendChild(applyBtn);
    }

    container.appendChild(bar);
}
