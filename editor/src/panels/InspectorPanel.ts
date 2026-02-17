/**
 * @file    InspectorPanel.ts
 * @brief   Unified inspector panel for entities and assets
 */

import type { Entity } from 'esengine';
import type { EditorStore, AssetSelection } from '../store/EditorStore';
import { getDefaultComponentData } from '../schemas/ComponentSchemas';
import { icons } from '../utils/icons';
import type { EditorInfo } from './inspector/InspectorHelpers';
import { getAssetTypeName } from './inspector/InspectorHelpers';
import { renderEntityHeader, renderComponent, renderAddComponentButton, renderEntityExtensionSections, renderAssetExtensionSections } from './inspector/EntityInspector';
import type { InspectorSectionInstance } from './inspector/InspectorRegistry';
import { type MaterialPreviewState, renderMaterialPreview, hideMaterialPreview } from './inspector/MaterialPreviewSection';
import { renderAssetHeader, renderAddressableSection } from './inspector/AssetInspector';
import { type ImageUrlRef, renderImageInspector } from './inspector/ImageInspector';
import { renderMaterialInspector } from './inspector/MaterialInspector';
import { renderBitmapFontInspector } from './inspector/BitmapFontInspector';
import { renderFolderInspector } from './inspector/FolderInspector';
import { renderScriptInspector, renderSceneInspector, renderFileInspector } from './inspector/FileInspector';

// =============================================================================
// InspectorPanel
// =============================================================================

export class InspectorPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private contentContainer_: HTMLElement;
    private unsubscribe_: (() => void) | null = null;
    private unsubPropertyChange_: (() => void) | null = null;
    private editors_: EditorInfo[] = [];
    private currentEntity_: Entity | null = null;
    private currentAssetPath_: string | null = null;
    private currentComponentCount_: number = 0;
    private currentPrefabPath_: string | undefined = undefined;
    private currentComponentOrder_: string = '';
    private imageUrlRef_: ImageUrlRef = { current: null };

    private footerContainer_: HTMLElement | null = null;
    private lockBtn_: HTMLElement | null = null;
    private locked_: boolean = false;
    private materialPreviewState_: MaterialPreviewState;
    private extensionSections_: InspectorSectionInstance[] = [];

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-inspector-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <div class="es-panel-actions">
                    <button class="es-btn es-btn-icon" title="Minimize">${icons.chevronDown(12)}</button>
                    <button class="es-btn es-btn-icon" title="Close">${icons.x(12)}</button>
                </div>
            </div>
            <div class="es-inspector-toolbar">
                <button class="es-btn es-btn-icon es-lock-btn" title="Lock Inspector">${icons.lockOpen()}</button>
            </div>
            <div class="es-inspector-content"></div>
            <div class="es-material-preview-panel es-expanded"></div>
            <div class="es-inspector-footer">No selection</div>
        `;

        this.contentContainer_ = this.container_.querySelector('.es-inspector-content')!;
        this.materialPreviewState_ = {
            container: this.container_.querySelector('.es-material-preview-panel')!,
            expanded: true,
        };
        this.footerContainer_ = this.container_.querySelector('.es-inspector-footer');
        this.lockBtn_ = this.container_.querySelector('.es-lock-btn');

        this.setupLockButton();
        this.unsubscribe_ = store.subscribe(() => this.render());
        this.unsubPropertyChange_ = store.subscribeToPropertyChanges(() => this.updateEditors());
        this.render();
    }

    private setupLockButton(): void {
        this.lockBtn_?.addEventListener('click', () => {
            this.locked_ = !this.locked_;
            this.updateLockButton();
        });
    }

    private updateLockButton(): void {
        if (this.lockBtn_) {
            if (this.locked_) {
                this.lockBtn_.classList.add('es-active');
                this.lockBtn_.title = 'Unlock Inspector';
                this.lockBtn_.innerHTML = icons.lock();
            } else {
                this.lockBtn_.classList.remove('es-active');
                this.lockBtn_.title = 'Lock Inspector';
                this.lockBtn_.innerHTML = icons.lockOpen();
            }
        }
    }

    dispose(): void {
        this.disposeEditors();
        this.cleanupImageUrl();
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
        if (this.unsubPropertyChange_) {
            this.unsubPropertyChange_();
            this.unsubPropertyChange_ = null;
        }
    }

    // =========================================================================
    // Main Render
    // =========================================================================

    private render(): void {
        if (this.locked_) {
            if (this.currentEntity_ !== null) {
                this.updateEditors();
            }
            return;
        }

        const selectedEntities = Array.from(this.store_.selectedEntities);
        const asset = this.store_.selectedAsset;

        if (selectedEntities.length === 1) {
            const entity = selectedEntities[0] as Entity;
            if (this.needsStructureRebuild(entity)) {
                this.rebuildEntityStructure(entity);
            } else if (this.currentEntity_ === entity) {
                this.updateEditors();
                this.updateVisibilityIcon();
                const entityData = this.store_.getSelectedEntityData();
                if (entityData) {
                    renderMaterialPreview(this.materialPreviewState_, entity, entityData.components, this.store_);
                }
            }
        } else if (selectedEntities.length > 1) {
            this.renderMultiEntityInspector(selectedEntities as Entity[]);
        } else if (asset !== null) {
            this.renderAssetInspector(asset);
        } else {
            this.renderEmptyState();
        }
    }

    private needsStructureRebuild(entity: Entity): boolean {
        if (entity !== this.currentEntity_) return true;
        if (this.currentAssetPath_ !== null) return true;

        const entityData = this.store_.getSelectedEntityData();
        const componentCount = entityData?.components.length ?? 0;
        const prefabPath = entityData?.prefab?.prefabPath;
        const componentOrder = entityData?.components.map(c => c.type).join(',') ?? '';

        return componentCount !== this.currentComponentCount_
            || prefabPath !== this.currentPrefabPath_
            || componentOrder !== this.currentComponentOrder_;
    }

    private renderEmptyState(): void {
        if (this.currentEntity_ === null && this.currentAssetPath_ === null) {
            return;
        }

        this.currentEntity_ = null;
        this.currentAssetPath_ = null;
        this.currentComponentCount_ = 0;
        this.currentComponentOrder_ = '';
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '<div class="es-inspector-empty">No selection</div>';
        hideMaterialPreview(this.materialPreviewState_);
        this.updateFooter('No selection');
    }

    // =========================================================================
    // Entity Inspector
    // =========================================================================

    private rebuildEntityStructure(entity: Entity): void {
        const entityData = this.store_.getSelectedEntityData();
        const componentCount = entityData?.components.length ?? 0;
        const prefabPath = entityData?.prefab?.prefabPath;

        this.currentEntity_ = entity;
        this.currentAssetPath_ = null;
        this.currentComponentCount_ = componentCount;
        this.currentComponentOrder_ = entityData?.components.map(c => c.type).join(',') ?? '';
        this.currentPrefabPath_ = prefabPath;
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '';

        if (!entityData) {
            this.contentContainer_.innerHTML = '<div class="es-inspector-empty">Entity not found</div>';
            this.updateFooter('Error');
            return;
        }

        renderEntityHeader(this.contentContainer_, entityData.name, entity, this.store_);

        for (let i = 0; i < entityData.components.length; i++) {
            renderComponent(
                this.contentContainer_, entity, entityData.components[i],
                this.store_, this.editors_, i, entityData.components.length
            );
        }

        renderAddComponentButton(this.contentContainer_, entity, entityData.components, this.store_);
        this.extensionSections_ = renderEntityExtensionSections(this.contentContainer_, entity, this.store_);
        renderMaterialPreview(this.materialPreviewState_, entity, entityData.components, this.store_);
        this.updateFooter(`${entityData.components.length} components`);
    }

    private updateVisibilityIcon(): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;
        const visBtn = this.contentContainer_.querySelector('.es-entity-visibility');
        if (visBtn) {
            const isVisible = entityData.visible !== false;
            visBtn.innerHTML = isVisible ? icons.eye(14) : icons.eyeOff(14);
        }
    }

    private renderMultiEntityInspector(entities: Entity[]): void {
        this.currentEntity_ = null;
        this.currentAssetPath_ = null;
        this.currentComponentCount_ = 0;
        this.currentComponentOrder_ = '';
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'es-inspector-multi-header';
        header.innerHTML = `
            <h3>${icons.layers(16)} Multi-Selection</h3>
            <p>${entities.length} entities selected</p>
        `;
        this.contentContainer_.appendChild(header);

        const commonComponents = this.getCommonComponents(entities);
        if (commonComponents.length > 0) {
            const section = document.createElement('div');
            section.className = 'es-inspector-common-components';
            section.innerHTML = `
                <div class="es-section-header">
                    <span class="es-section-title">Common Components</span>
                </div>
                <div class="es-common-component-list">
                    ${commonComponents.map(name => `<div class="es-common-component-item">${icons.box(12)} ${name}</div>`).join('')}
                </div>
            `;
            this.contentContainer_.appendChild(section);
        }

        hideMaterialPreview(this.materialPreviewState_);
        this.updateFooter(`${entities.length} entities selected`);
    }

    private getCommonComponents(entities: Entity[]): string[] {
        if (entities.length === 0) return [];

        const first = this.store_.getEntityData(entities[0] as number);
        if (!first) return [];

        let common = new Set(first.components.map(c => c.type));

        for (let i = 1; i < entities.length; i++) {
            const data = this.store_.getEntityData(entities[i] as number);
            if (!data) return [];
            const types = new Set(data.components.map(c => c.type));
            common = new Set([...common].filter(t => types.has(t)));
        }

        return [...common];
    }

    // =========================================================================
    // Asset Inspector
    // =========================================================================

    private async renderAssetInspector(asset: AssetSelection): Promise<void> {
        if (asset.path === this.currentAssetPath_) {
            return;
        }

        this.currentAssetPath_ = asset.path;
        this.currentEntity_ = null;
        this.currentComponentCount_ = 0;
        this.currentComponentOrder_ = '';
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '';
        hideMaterialPreview(this.materialPreviewState_);

        renderAssetHeader(this.contentContainer_, asset);
        renderAddressableSection(this.contentContainer_, asset.path);

        switch (asset.type) {
            case 'image':
                await renderImageInspector(this.contentContainer_, asset.path, this.imageUrlRef_);
                break;
            case 'script':
                await renderScriptInspector(this.contentContainer_, asset.path);
                break;
            case 'scene':
                await renderSceneInspector(this.contentContainer_, asset.path);
                break;
            case 'material':
                await renderMaterialInspector(this.contentContainer_, asset.path);
                break;
            case 'font':
                await renderBitmapFontInspector(this.contentContainer_, asset.path);
                break;
            case 'folder':
                await renderFolderInspector(this.contentContainer_, asset.path);
                break;
            default:
                await renderFileInspector(this.contentContainer_, asset.path, asset.type);
        }

        this.extensionSections_ = renderAssetExtensionSections(this.contentContainer_, asset.path, asset.type, this.store_);
        this.updateFooter(getAssetTypeName(asset.type));
    }

    // =========================================================================
    // Editors
    // =========================================================================

    private updateEditors(): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        for (const info of this.editors_) {
            const component = entityData.components.find(c => c.type === info.componentType);
            if (component) {
                if (info.propertyName === '*') {
                    const defaults = getDefaultComponentData(component.type);
                    info.editor.update({ ...defaults, ...component.data });
                } else {
                    let value = component.data[info.propertyName];
                    if (value === undefined) {
                        const defaults = getDefaultComponentData(component.type);
                        value = defaults[info.propertyName];
                    }
                    info.editor.update(value);
                }
            }
        }

        for (const section of this.extensionSections_) {
            section.update?.();
        }
    }

    private disposeEditors(): void {
        for (const info of this.editors_) {
            info.editor.dispose();
        }
        this.editors_ = [];
        for (const section of this.extensionSections_) {
            section.dispose();
        }
        this.extensionSections_ = [];
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private updateFooter(text: string): void {
        if (this.footerContainer_) {
            this.footerContainer_.textContent = text;
        }
    }

    private cleanupImageUrl(): void {
        if (this.imageUrlRef_.current) {
            URL.revokeObjectURL(this.imageUrlRef_.current);
            this.imageUrlRef_.current = null;
        }
    }
}
