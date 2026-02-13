/**
 * @file    InspectorPanel.ts
 * @brief   Unified inspector panel for entities and assets
 */

import type { Entity } from 'esengine';
import type { ComponentData } from '../types/SceneTypes';
import type { EditorStore, AssetSelection, AssetType } from '../store/EditorStore';
import {
    createPropertyEditor,
    type PropertyEditorInstance,
} from '../property/PropertyEditor';
import { getComponentSchema, getDefaultComponentData, isComponentRemovable } from '../schemas/ComponentSchemas';
import { icons } from '../utils/icons';
import { showAddComponentPopup } from './AddComponentPopup';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import {
    type SliceBorder,
    type TextureMetadata,
    getMetaFilePath,
    parseTextureMetadata,
    serializeTextureMetadata,
    createDefaultTextureMetadata,
} from '../types/TextureMetadata';
import {
    type MaterialMetadata,
    parseMaterialMetadata,
    serializeMaterialMetadata,
    createDefaultMaterialMetadata,
    BLEND_MODE_OPTIONS,
} from '../types/MaterialMetadata';
import {
    parseShaderProperties,
    ShaderPropertyType,
    getDefaultPropertyValue,
    type ShaderProperty,
} from '../shader/ShaderPropertyParser';
import { getEditorContext, getEditorInstance } from '../context/EditorContext';
import { AssetExportConfigService, type FolderExportMode } from '../builder/AssetCollector';
import { getAssetDatabase } from '../asset/AssetDatabase';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// Types
// =============================================================================

interface EditorInfo {
    editor: PropertyEditorInstance;
    componentType: string;
    propertyName: string;
}

// =============================================================================
// Helpers
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
}

function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.substring(dotIndex).toLowerCase() : '';
}

function getMimeType(ext: string): string {
    switch (ext) {
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        case '.webp': return 'image/webp';
        case '.bmp': return 'image/bmp';
        case '.svg': return 'image/svg+xml';
        default: return 'application/octet-stream';
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date | null): string {
    if (!date) return 'Unknown';
    return date.toLocaleString();
}

function getAssetIcon(type: AssetType, size: number = 16): string {
    switch (type) {
        case 'image': return icons.image(size);
        case 'script': return icons.code(size);
        case 'scene': return icons.layers(size);
        case 'audio': return icons.volume(size);
        case 'json': return icons.braces(size);
        case 'material': return icons.settings(size);
        case 'shader': return icons.code(size);
        case 'font': return icons.type(size);
        case 'folder': return icons.folder(size);
        default: return icons.file(size);
    }
}

function getAssetTypeName(type: AssetType): string {
    switch (type) {
        case 'image': return 'Image';
        case 'script': return 'Script';
        case 'scene': return 'Scene';
        case 'audio': return 'Audio';
        case 'json': return 'JSON';
        case 'material': return 'Material';
        case 'shader': return 'Shader';
        case 'font': return 'BitmapFont';
        case 'folder': return 'Folder';
        default: return 'File';
    }
}

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
    private currentImageUrl_: string | null = null;

    private footerContainer_: HTMLElement | null = null;
    private lockBtn_: HTMLElement | null = null;
    private locked_: boolean = false;
    private currentTextureMetadata_: TextureMetadata | null = null;
    private currentMaterialMetadata_: MaterialMetadata | null = null;
    private currentShaderProperties_: ShaderProperty[] = [];
    private materialPreviewContainer_: HTMLElement | null = null;
    private materialPreviewExpanded_: boolean = true;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-inspector-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">${icons.settings(14)} Inspector</span>
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
        this.materialPreviewContainer_ = this.container_.querySelector('.es-material-preview-panel')!;
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

        const entity = this.store_.selectedEntity;
        const asset = this.store_.selectedAsset;

        if (entity !== null) {
            this.renderEntityInspector(entity);
        } else if (asset !== null) {
            this.renderAssetInspector(asset);
        } else {
            this.renderEmptyState();
        }
    }

    private renderEmptyState(): void {
        if (this.currentEntity_ === null && this.currentAssetPath_ === null) {
            return;
        }

        this.currentEntity_ = null;
        this.currentAssetPath_ = null;
        this.currentComponentCount_ = 0;
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '<div class="es-inspector-empty">No selection</div>';
        this.hideMaterialPreview();
        this.updateFooter('No selection');
    }

    // =========================================================================
    // Entity Inspector
    // =========================================================================

    private renderEntityInspector(entity: Entity): void {
        const entityData = this.store_.getSelectedEntityData();
        const componentCount = entityData?.components.length ?? 0;

        const entityChanged = entity !== this.currentEntity_;
        const componentsChanged = componentCount !== this.currentComponentCount_;
        const wasAsset = this.currentAssetPath_ !== null;

        if (!entityChanged && !componentsChanged && !wasAsset) {
            this.updateEditors();
            this.updateVisibilityIcon();
            const entityData = this.store_.getSelectedEntityData();
            if (entityData) {
                this.renderMaterialPreview(entity, entityData.components);
            }
            return;
        }

        this.currentEntity_ = entity;
        this.currentAssetPath_ = null;
        this.currentComponentCount_ = componentCount;
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '';

        if (!entityData) {
            this.contentContainer_.innerHTML = '<div class="es-inspector-empty">Entity not found</div>';
            this.updateFooter('Error');
            return;
        }

        this.renderEntityHeader(entityData.name, entity);

        for (const component of entityData.components) {
            this.renderComponent(entity, component);
        }

        this.renderAddComponentButton(entity, entityData.components);
        this.renderMaterialPreview(entity, entityData.components);
        this.updateFooter(`${entityData.components.length + 1} components`);
    }

    private updateFooter(text: string): void {
        if (this.footerContainer_) {
            this.footerContainer_.textContent = text;
        }
    }

    private renderEntityHeader(name: string, entity: Entity): void {
        const isVisible = this.store_.isEntityVisible(entity as number);
        const visibilityIcon = isVisible ? icons.eye(14) : icons.eyeOff(14);

        const header = document.createElement('div');
        header.className = 'es-inspector-entity-header';
        header.innerHTML = `
            <span class="es-entity-icon">${icons.box(16)}</span>
            <input type="text" class="es-entity-name-input" value="${this.escapeHtml(name)}">
            <span class="es-entity-visibility">${visibilityIcon}</span>
            <span class="es-entity-id">ID:${entity}</span>
        `;

        const input = header.querySelector('.es-entity-name-input') as HTMLInputElement;
        input.addEventListener('change', () => {
            const newName = input.value.trim();
            if (newName && newName !== name) {
                this.store_.renameEntity(entity, newName);
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
            this.store_.toggleVisibility(entity as number);
        });

        this.contentContainer_.appendChild(header);
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

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private getComponentIcon(type: string): string {
        switch (type) {
            case 'LocalTransform':
            case 'WorldTransform':
                return icons.move(14);
            case 'Sprite':
                return icons.image(14);
            case 'Camera':
                return icons.camera(14);
            case 'Text':
                return icons.type(14);
            default:
                return icons.settings(14);
        }
    }

    private renderComponent(entity: Entity, component: ComponentData): void {
        const schema = getComponentSchema(component.type);
        if (schema?.category === 'tag') {
            this.renderTagComponent(entity, component);
            return;
        }

        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';

        const icon = this.getComponentIcon(component.type);
        const removable = isComponentRemovable(component.type);

        const header = document.createElement('div');
        header.className = 'es-component-header es-collapsible-header';
        header.innerHTML = `
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icon}</span>
            <span class="es-component-title">${component.type}</span>
            ${removable ? `<button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>` : ''}
        `;

        if (removable) {
            const removeBtn = header.querySelector('.es-btn-remove');
            removeBtn?.addEventListener('click', () => {
                this.store_.removeComponent(entity, component.type);
            });
        }

        header.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
            section.classList.toggle('es-expanded');
        });

        if (schema?.category === 'script') {
            header.addEventListener('dblclick', () => {
                const sourceMap = window.__esengine_componentSourceMap;
                const scriptPath = sourceMap?.get(component.type);
                if (!scriptPath) return;
                const projectDir = this.getProjectDir();
                if (projectDir) {
                    getEditorContext().shell?.openInEditor(projectDir, scriptPath);
                }
            });
        }

        section.appendChild(header);

        if (schema) {
            const propsContainer = document.createElement('div');
            propsContainer.className = 'es-component-properties es-collapsible-content';

            for (const propMeta of schema.properties) {
                if (propMeta.name === '*') {
                    const editorContainer = document.createElement('div');
                    editorContainer.className = 'es-property-editor es-property-editor-full';

                    const defaults = getDefaultComponentData(component.type);
                    const fullData = { ...defaults, ...component.data };

                    const editor = createPropertyEditor(editorContainer, {
                        value: fullData,
                        meta: propMeta,
                        onChange: (changes) => {
                            const arr = changes as { property: string; oldValue: unknown; newValue: unknown }[];
                            this.store_.updateProperties(entity, component.type, arr);
                        },
                        componentData: component.data,
                        getComponentValue: (name: string) => component.data[name],
                    });

                    if (editor) {
                        this.editors_.push({
                            editor,
                            componentType: component.type,
                            propertyName: '*',
                        });
                    }

                    propsContainer.appendChild(editorContainer);
                    continue;
                }

                const row = document.createElement('div');
                row.className = 'es-property-row';

                const label = document.createElement('label');
                label.className = 'es-property-label';
                label.textContent = propMeta.name;

                const editorContainer = document.createElement('div');
                editorContainer.className = 'es-property-editor';

                let currentValue = component.data[propMeta.name];
                if (currentValue === undefined) {
                    const defaults = getDefaultComponentData(component.type);
                    currentValue = defaults[propMeta.name];
                }
                const editor = createPropertyEditor(editorContainer, {
                    value: currentValue,
                    meta: propMeta,
                    onChange: (newValue) => {
                        this.store_.updateProperty(
                            entity,
                            component.type,
                            propMeta.name,
                            currentValue,
                            newValue
                        );
                    },
                    componentData: component.data,
                    getComponentValue: (name: string) => component.data[name],
                });

                if (editor) {
                    this.editors_.push({
                        editor,
                        componentType: component.type,
                        propertyName: propMeta.name,
                    });
                }

                row.appendChild(label);
                row.appendChild(editorContainer);
                propsContainer.appendChild(row);
            }

            section.appendChild(propsContainer);
        } else {
            const rawView = document.createElement('pre');
            rawView.className = 'es-component-raw';
            rawView.textContent = JSON.stringify(component.data, null, 2);
            section.appendChild(rawView);
        }

        this.contentContainer_.appendChild(section);
    }

    private renderTagComponent(entity: Entity, component: ComponentData): void {
        const row = document.createElement('div');
        row.className = 'es-component-section es-component-tag-row';
        row.innerHTML = `
            <span class="es-component-icon">${icons.tag(14)}</span>
            <span class="es-component-title">${component.type}</span>
            <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
        `;

        const removeBtn = row.querySelector('.es-btn-remove');
        removeBtn?.addEventListener('click', () => {
            this.store_.removeComponent(entity, component.type);
        });

        this.contentContainer_.appendChild(row);
    }

    private renderAddComponentButton(entity: Entity, existingComponents: ComponentData[]): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-add-component-wrapper';

        const btn = document.createElement('button');
        btn.className = 'es-btn es-btn-add-component';
        btn.textContent = 'Add Component';

        btn.addEventListener('click', () => {
            this.showAddComponentMenu(btn, entity, existingComponents);
        });

        wrapper.appendChild(btn);
        this.contentContainer_.appendChild(wrapper);
    }

    private showAddComponentMenu(
        _anchor: HTMLElement,
        entity: Entity,
        existingComponents: ComponentData[]
    ): void {
        const existingTypes = existingComponents.map(c => c.type);

        showAddComponentPopup(existingTypes, (componentName: string) => {
            const defaultData = this.createDefaultComponentData(componentName);
            this.store_.addComponent(entity, componentName, defaultData);
        });
    }

    private createDefaultComponentData(type: string): Record<string, unknown> {
        return getDefaultComponentData(type);
    }

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
    }

    private disposeEditors(): void {
        for (const info of this.editors_) {
            info.editor.dispose();
        }
        this.editors_ = [];
    }

    // =========================================================================
    // Material Preview Panel
    // =========================================================================

    private renderMaterialPreview(entity: Entity, components: ComponentData[]): void {
        if (!this.materialPreviewContainer_) return;

        const spriteComp = components.find(c => c.type === 'Sprite');
        const materialPath = spriteComp?.data?.material as string | undefined;

        if (!materialPath) {
            this.hideMaterialPreview();
            return;
        }

        this.renderMaterialPreviewContent(entity, spriteComp!, materialPath);
    }

    private renderEmptyMaterialPreview(): void {
        if (!this.materialPreviewContainer_) return;

        this.materialPreviewContainer_.innerHTML = `
            <div class="es-material-preview-header">
                <span class="es-material-preview-title">
                    ${icons.chevronRight(12)} Material Preview
                </span>
            </div>
            <div class="es-material-preview-content">
                <div class="es-material-preview-empty">(No material selected)</div>
            </div>
        `;

        if (this.materialPreviewExpanded_) {
            this.materialPreviewContainer_.classList.add('es-expanded');
        } else {
            this.materialPreviewContainer_.classList.remove('es-expanded');
        }

        this.setupMaterialPreviewHeader();
    }

    private async renderMaterialPreviewContent(
        entity: Entity,
        spriteComp: ComponentData,
        materialPath: string
    ): Promise<void> {
        if (!this.materialPreviewContainer_) return;

        const fileName = materialPath.split('/').pop() ?? materialPath;

        this.materialPreviewContainer_.innerHTML = `
            <div class="es-material-preview-header">
                <span class="es-material-preview-title">
                    ${icons.chevronRight(12)} Material Preview
                </span>
                <button class="es-btn es-material-preview-open-btn">Open Material</button>
            </div>
            <div class="es-material-preview-content">
                <div class="es-material-preview-name">${this.escapeHtml(fileName)}</div>
                <div class="es-material-preview-properties"></div>
                <div class="es-material-preview-status"></div>
            </div>
        `;

        if (this.materialPreviewExpanded_) {
            this.materialPreviewContainer_.classList.add('es-expanded');
        } else {
            this.materialPreviewContainer_.classList.remove('es-expanded');
        }

        this.setupMaterialPreviewHeader();

        const openBtn = this.materialPreviewContainer_.querySelector('.es-material-preview-open-btn');
        openBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openAssetInBrowser(materialPath);
        });

        const propsContainer = this.materialPreviewContainer_.querySelector('.es-material-preview-properties')!;
        const statusContainer = this.materialPreviewContainer_.querySelector('.es-material-preview-status')!;

        const shaderInfo = await this.loadShaderInfoForMaterial(materialPath);
        if (!shaderInfo || !shaderInfo.valid || shaderInfo.properties.length === 0) {
            propsContainer.innerHTML = '<div class="es-material-preview-empty">No shader properties</div>';
            statusContainer.textContent = '';
            return;
        }

        const materialDefaults = await this.loadMaterialDefaults(materialPath);
        const currentOverrides = (spriteComp.data.materialOverrides as Record<string, unknown>) ?? {};

        const editableProps = shaderInfo.properties.filter(p => p.type !== ShaderPropertyType.Texture);
        let overrideCount = 0;

        for (const prop of editableProps) {
            const isOverridden = prop.name in currentOverrides;
            const value = isOverridden
                ? currentOverrides[prop.name]
                : (materialDefaults[prop.name] ?? getDefaultPropertyValue(prop.type));

            if (isOverridden) overrideCount++;

            const row = document.createElement('div');
            row.className = `es-material-preview-row${isOverridden ? ' es-overridden' : ''}`;

            const label = document.createElement('label');
            label.className = 'es-property-label';
            label.textContent = prop.displayName;

            const editorContainer = document.createElement('div');
            editorContainer.className = 'es-property-editor';

            this.createMaterialPreviewEditor(editorContainer, prop, value, (newValue) => {
                this.handleMaterialOverrideChange(
                    entity,
                    prop.name,
                    newValue,
                    materialDefaults[prop.name] ?? getDefaultPropertyValue(prop.type),
                    currentOverrides
                );
            });

            row.appendChild(label);
            row.appendChild(editorContainer);

            if (isOverridden) {
                const resetBtn = document.createElement('button');
                resetBtn.className = 'es-btn es-btn-icon es-btn-reset-override';
                resetBtn.title = 'Reset to material default';
                resetBtn.innerHTML = icons.refresh(12);
                resetBtn.addEventListener('click', () => {
                    this.handleMaterialOverrideReset(entity, prop.name, currentOverrides);
                });
                row.appendChild(resetBtn);
            }

            propsContainer.appendChild(row);
        }

        if (overrideCount > 0) {
            statusContainer.textContent = `${overrideCount} override${overrideCount > 1 ? 's' : ''} active`;
        } else {
            statusContainer.textContent = 'No overrides';
        }
    }

    private setupMaterialPreviewHeader(): void {
        const header = this.materialPreviewContainer_?.querySelector('.es-material-preview-header');
        header?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-material-preview-open-btn')) return;
            this.materialPreviewExpanded_ = !this.materialPreviewExpanded_;
            if (this.materialPreviewExpanded_) {
                this.materialPreviewContainer_?.classList.add('es-expanded');
            } else {
                this.materialPreviewContainer_?.classList.remove('es-expanded');
            }
        });
    }

    private async loadShaderInfoForMaterial(materialPath: string): Promise<import('../shader/ShaderPropertyParser').ParsedShaderInfo | null> {
        const fs = getNativeFS();
        const projectDir = this.getProjectDir();
        if (!fs || !projectDir) return null;

        const materialFullPath = `${projectDir}/${materialPath}`;
        const materialContent = await fs.readFile(materialFullPath);
        if (!materialContent) return null;

        try {
            const material = JSON.parse(materialContent);
            if (!material.shader) return null;

            const shaderPath = material.shader.startsWith('/')
                ? material.shader
                : material.shader.startsWith('assets/')
                    ? material.shader
                    : `${materialPath.substring(0, materialPath.lastIndexOf('/'))}/${material.shader}`;

            const shaderFullPath = `${projectDir}/${shaderPath}`;
            const shaderContent = await fs.readFile(shaderFullPath);
            if (!shaderContent) return null;

            return parseShaderProperties(shaderContent);
        } catch {
            return null;
        }
    }

    private async loadMaterialDefaults(materialPath: string): Promise<Record<string, unknown>> {
        const fs = getNativeFS();
        const projectDir = this.getProjectDir();
        if (!fs || !projectDir) return {};

        const materialFullPath = `${projectDir}/${materialPath}`;
        const materialContent = await fs.readFile(materialFullPath);
        if (!materialContent) return {};

        try {
            const material = JSON.parse(materialContent);
            return material.properties ?? {};
        } catch {
            return {};
        }
    }

    private createMaterialPreviewEditor(
        container: HTMLElement,
        prop: ShaderProperty,
        value: unknown,
        onChange: (value: unknown) => void
    ): void {
        switch (prop.type) {
            case ShaderPropertyType.Float:
                this.createFloatEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
                break;
            case ShaderPropertyType.Int:
                this.createIntEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
                break;
            case ShaderPropertyType.Vec2:
                this.createVec2Editor(container, value as { x: number; y: number }, onChange);
                break;
            case ShaderPropertyType.Vec3:
                this.createVec3Editor(container, value as { x: number; y: number; z: number }, onChange);
                break;
            case ShaderPropertyType.Vec4:
                this.createVec4Editor(container, value as { x: number; y: number; z: number; w: number }, onChange);
                break;
            case ShaderPropertyType.Color:
                this.createColorEditor(container, value as { r: number; g: number; b: number; a: number }, onChange);
                break;
            default:
                container.textContent = 'Unknown type';
        }
    }

    private deepEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object' || a === null || b === null) return false;

        const keysA = Object.keys(a as object);
        const keysB = Object.keys(b as object);
        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
                return false;
            }
        }
        return true;
    }

    private handleMaterialOverrideChange(
        entity: Entity,
        propName: string,
        newValue: unknown,
        defaultValue: unknown,
        currentOverrides: Record<string, unknown>
    ): void {
        const newOverrides = { ...currentOverrides };

        if (this.deepEqual(newValue, defaultValue)) {
            delete newOverrides[propName];
        } else {
            newOverrides[propName] = newValue;
        }

        const oldOverrides = currentOverrides;
        const finalOverrides = Object.keys(newOverrides).length > 0 ? newOverrides : undefined;

        this.store_.updateProperty(
            entity,
            'Sprite',
            'materialOverrides',
            Object.keys(oldOverrides).length > 0 ? oldOverrides : undefined,
            finalOverrides
        );
    }

    private handleMaterialOverrideReset(
        entity: Entity,
        propName: string,
        currentOverrides: Record<string, unknown>
    ): void {
        const newOverrides = { ...currentOverrides };
        delete newOverrides[propName];

        const oldOverrides = currentOverrides;
        const finalOverrides = Object.keys(newOverrides).length > 0 ? newOverrides : undefined;

        this.store_.updateProperty(
            entity,
            'Sprite',
            'materialOverrides',
            Object.keys(oldOverrides).length > 0 ? oldOverrides : undefined,
            finalOverrides
        );
    }

    private hideMaterialPreview(): void {
        if (this.materialPreviewContainer_) {
            this.materialPreviewContainer_.innerHTML = '';
        }
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
        this.disposeEditors();
        this.cleanupImageUrl();
        this.contentContainer_.innerHTML = '';
        this.hideMaterialPreview();

        this.renderAssetHeader(asset);
        this.renderAddressableSection(asset.path);

        switch (asset.type) {
            case 'image':
                await this.renderImageInspector(asset.path);
                break;
            case 'script':
                await this.renderScriptInspector(asset.path);
                break;
            case 'scene':
                await this.renderSceneInspector(asset.path);
                break;
            case 'material':
                await this.renderMaterialInspector(asset.path);
                break;
            case 'font':
                await this.renderBitmapFontInspector(asset.path);
                break;
            case 'folder':
                await this.renderFolderInspector(asset.path);
                break;
            default:
                await this.renderFileInspector(asset.path, asset.type);
        }

        this.updateFooter(getAssetTypeName(asset.type));
    }

    private renderAssetHeader(asset: AssetSelection): void {
        const header = document.createElement('div');
        header.className = 'es-inspector-asset-header';
        header.innerHTML = `
            <span class="es-asset-header-icon">${getAssetIcon(asset.type, 20)}</span>
            <span class="es-asset-header-name">${this.escapeHtml(asset.name)}</span>
        `;
        this.contentContainer_.appendChild(header);
    }

    private resolveAssetEntry(assetPath: string) {
        const db = getAssetDatabase();
        const projectDir = this.getProjectDir();

        if (projectDir && assetPath.startsWith(projectDir)) {
            const rel = assetPath.substring(projectDir.length + 1);
            const e = db.getEntryByPath(rel);
            if (e) return e;
        }

        const direct = db.getEntryByPath(assetPath);
        if (direct) return direct;

        const normalized = assetPath.replace(/\\/g, '/');
        const fileName = normalized.split('/').pop() || '';
        for (const e of db.getAllEntries()) {
            if (e.path === normalized || e.path.endsWith('/' + fileName)) {
                return e;
            }
        }
        return undefined;
    }

    private renderAddressableSection(assetPath: string): void {
        const db = getAssetDatabase();

        const entry = this.resolveAssetEntry(assetPath);
        if (!entry) return;

        const groupService = db.getGroupService();
        const groups = groupService?.groups ?? [];
        const allLabels = groupService?.allLabels ?? [];

        const groupOptions = groups.map(g =>
            `<option value="${this.escapeHtml(g.name)}"${g.name === entry.group ? ' selected' : ''}>${this.escapeHtml(g.name)}</option>`
        ).join('');

        const LABEL_COLORS = [
            '#61afef', '#e06c75', '#98c379', '#d19a66',
            '#c678dd', '#56b6c2', '#e5c07b', '#be5046',
        ];
        const hashLabel = (label: string) => {
            let h = 0;
            for (let i = 0; i < label.length; i++) {
                h = ((h << 5) - h + label.charCodeAt(i)) | 0;
            }
            return LABEL_COLORS[Math.abs(h) % LABEL_COLORS.length];
        };

        const labelsHtml = allLabels.map(l => {
            const checked = entry.labels.has(l);
            const color = hashLabel(l);
            return `
                <label class="es-addr-label-toggle" style="--tag-color: ${color}">
                    <input type="checkbox" data-label="${this.escapeHtml(l)}" ${checked ? 'checked' : ''} />
                    <span>${this.escapeHtml(l)}</span>
                </label>
            `;
        }).join('');

        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.layers(14)}</span>
                <span class="es-component-title">Addressable</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Group</label>
                    <div class="es-property-editor">
                        <select class="es-input es-addr-inspector-group">${groupOptions}</select>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Address</label>
                    <div class="es-property-editor">
                        <input type="text" class="es-input es-addr-inspector-address" value="${this.escapeHtml(entry.address ?? '')}" placeholder="Logical address" />
                    </div>
                </div>
                <div class="es-property-row es-property-row-top">
                    <label class="es-property-label">Labels</label>
                    <div class="es-property-editor es-addr-inspector-labels">
                        ${labelsHtml || '<span class="es-muted">No labels defined</span>'}
                    </div>
                </div>
            </div>
        `;

        const header = section.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
        });

        const groupSelect = section.querySelector('.es-addr-inspector-group') as HTMLSelectElement;
        groupSelect?.addEventListener('change', async () => {
            await db.updateMeta(entry.uuid, { group: groupSelect.value });
        });

        const addressInput = section.querySelector('.es-addr-inspector-address') as HTMLInputElement;
        addressInput?.addEventListener('change', async () => {
            await db.updateMeta(entry.uuid, { address: addressInput.value || null });
        });

        section.querySelectorAll('.es-addr-inspector-labels input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', async () => {
                const labelName = (cb as HTMLInputElement).dataset.label;
                if (!labelName) return;
                const currentLabels = new Set(entry.labels);
                if ((cb as HTMLInputElement).checked) {
                    currentLabels.add(labelName);
                } else {
                    currentLabels.delete(labelName);
                }
                entry.labels = currentLabels;
                await db.updateMeta(entry.uuid, { labels: currentLabels });
            });
        });

        this.contentContainer_.appendChild(section);
    }

    private async renderImageInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        if (!fs) {
            this.renderError('File system not available');
            return;
        }

        const previewSection = document.createElement('div');
        previewSection.className = 'es-asset-preview-section';
        previewSection.innerHTML = '<div class="es-asset-preview-loading">Loading...</div>';
        this.contentContainer_.appendChild(previewSection);

        try {
            const data = await fs.readBinaryFile(path);
            if (!data) {
                previewSection.innerHTML = '<div class="es-asset-preview-error">Failed to load image</div>';
                return;
            }

            const ext = getFileExtension(path);
            const mimeType = getMimeType(ext);
            const blob = new Blob([new Uint8Array(data).buffer], { type: mimeType });
            const url = URL.createObjectURL(blob);
            this.currentImageUrl_ = url;

            previewSection.innerHTML = `
                <div class="es-image-preview-container">
                    <img class="es-image-preview" src="${url}" alt="${getFileName(path)}">
                </div>
            `;

            const img = previewSection.querySelector('.es-image-preview') as HTMLImageElement;
            img.onload = async () => {
                await this.renderImageMetadata(path, img.naturalWidth, img.naturalHeight);
            };
        } catch (err) {
            console.error('Failed to load image:', err);
            previewSection.innerHTML = '<div class="es-asset-preview-error">Failed to load image</div>';
        }
    }

    private async renderImageMetadata(path: string, width: number, height: number): Promise<void> {
        const fs = getNativeFS();
        const stats = fs ? await fs.getFileStats(path) : null;

        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Properties</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Size</label>
                    <div class="es-property-value">${width} × ${height}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Format</label>
                    <div class="es-property-value">${getFileExtension(path).substring(1).toUpperCase() || 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">File Size</label>
                    <div class="es-property-value">${stats ? formatFileSize(stats.size) : 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Modified</label>
                    <div class="es-property-value">${stats ? formatDate(stats.modified) : 'Unknown'}</div>
                </div>
            </div>
        `;

        const header = section.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(section);

        await this.renderNineSliceSection(path, width, height);
    }

    private async renderNineSliceSection(path: string, texWidth: number, texHeight: number): Promise<void> {
        const platform = getPlatformAdapter();
        const metaPath = getMetaFilePath(path);

        let metadata: TextureMetadata = createDefaultTextureMetadata();

        try {
            if (await platform.exists(metaPath)) {
                const content = await platform.readTextFile(metaPath);
                const parsed = parseTextureMetadata(content);
                if (parsed) {
                    metadata = parsed;
                }
            }
        } catch (err) {
            console.warn('Failed to load texture metadata:', err);
        }

        this.currentTextureMetadata_ = metadata;
        const border = metadata.sliceBorder;

        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.grid(14)}</span>
                <span class="es-component-title">Nine-Slice</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-nine-slice-editor">
                    <div class="es-nine-slice-preview">
                        <img class="es-nine-slice-image" src="${this.currentImageUrl_ || ''}">
                        <div class="es-nine-slice-line es-nine-slice-left"></div>
                        <div class="es-nine-slice-line es-nine-slice-right"></div>
                        <div class="es-nine-slice-line es-nine-slice-top"></div>
                        <div class="es-nine-slice-line es-nine-slice-bottom"></div>
                    </div>
                </div>
                <div class="es-nine-slice-inputs">
                    <div class="es-property-row">
                        <label class="es-property-label">Left</label>
                        <div class="es-property-editor">
                            <input type="number" class="es-input es-input-number es-slice-input-left" value="${border.left}" min="0" max="${texWidth}" step="1">
                        </div>
                    </div>
                    <div class="es-property-row">
                        <label class="es-property-label">Right</label>
                        <div class="es-property-editor">
                            <input type="number" class="es-input es-input-number es-slice-input-right" value="${border.right}" min="0" max="${texWidth}" step="1">
                        </div>
                    </div>
                    <div class="es-property-row">
                        <label class="es-property-label">Top</label>
                        <div class="es-property-editor">
                            <input type="number" class="es-input es-input-number es-slice-input-top" value="${border.top}" min="0" max="${texHeight}" step="1">
                        </div>
                    </div>
                    <div class="es-property-row">
                        <label class="es-property-label">Bottom</label>
                        <div class="es-property-editor">
                            <input type="number" class="es-input es-input-number es-slice-input-bottom" value="${border.bottom}" min="0" max="${texHeight}" step="1">
                        </div>
                    </div>
                </div>
            </div>
        `;

        const headerEl = section.querySelector('.es-collapsible-header');
        headerEl?.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
        });

        const preview = section.querySelector('.es-nine-slice-preview') as HTMLElement;
        const leftLine = section.querySelector('.es-nine-slice-left') as HTMLElement;
        const rightLine = section.querySelector('.es-nine-slice-right') as HTMLElement;
        const topLine = section.querySelector('.es-nine-slice-top') as HTMLElement;
        const bottomLine = section.querySelector('.es-nine-slice-bottom') as HTMLElement;
        const leftInput = section.querySelector('.es-slice-input-left') as HTMLInputElement;
        const rightInput = section.querySelector('.es-slice-input-right') as HTMLInputElement;
        const topInput = section.querySelector('.es-slice-input-top') as HTMLInputElement;
        const bottomInput = section.querySelector('.es-slice-input-bottom') as HTMLInputElement;

        const updateLines = () => {
            const previewRect = preview.getBoundingClientRect();
            const scaleX = previewRect.width / texWidth;
            const scaleY = previewRect.height / texHeight;

            const left = parseFloat(leftInput.value) || 0;
            const right = parseFloat(rightInput.value) || 0;
            const top = parseFloat(topInput.value) || 0;
            const bottom = parseFloat(bottomInput.value) || 0;

            leftLine.style.left = `${left * scaleX}px`;
            rightLine.style.right = `${right * scaleX}px`;
            topLine.style.top = `${top * scaleY}px`;
            bottomLine.style.bottom = `${bottom * scaleY}px`;
        };

        const saveMetadata = async () => {
            if (!this.currentTextureMetadata_) return;

            const newBorder: SliceBorder = {
                left: parseFloat(leftInput.value) || 0,
                right: parseFloat(rightInput.value) || 0,
                top: parseFloat(topInput.value) || 0,
                bottom: parseFloat(bottomInput.value) || 0,
            };

            this.currentTextureMetadata_.sliceBorder = newBorder;

            try {
                const json = serializeTextureMetadata(this.currentTextureMetadata_);
                await platform.writeTextFile(metaPath, json);
            } catch (err) {
                console.error('Failed to save texture metadata:', err);
            }
        };

        const onInputChange = () => {
            updateLines();
            saveMetadata();
        };

        leftInput.addEventListener('input', updateLines);
        rightInput.addEventListener('input', updateLines);
        topInput.addEventListener('input', updateLines);
        bottomInput.addEventListener('input', updateLines);
        leftInput.addEventListener('change', saveMetadata);
        rightInput.addEventListener('change', saveMetadata);
        topInput.addEventListener('change', saveMetadata);
        bottomInput.addEventListener('change', saveMetadata);

        // Draggable lines
        const setupDrag = (line: HTMLElement, input: HTMLInputElement, isHorizontal: boolean, isInverse: boolean) => {
            let isDragging = false;
            let startPos = 0;
            let startValue = 0;

            line.addEventListener('mousedown', (e) => {
                isDragging = true;
                startPos = isHorizontal ? e.clientX : e.clientY;
                startValue = parseFloat(input.value) || 0;
                e.preventDefault();
                document.body.style.cursor = isHorizontal ? 'ew-resize' : 'ns-resize';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const previewRect = preview.getBoundingClientRect();
                const scale = isHorizontal ? (previewRect.width / texWidth) : (previewRect.height / texHeight);
                const delta = isHorizontal ? (e.clientX - startPos) : (e.clientY - startPos);
                const pixelDelta = delta / scale;

                let newValue = isInverse ? (startValue - pixelDelta) : (startValue + pixelDelta);
                const maxValue = isHorizontal ? texWidth : texHeight;
                newValue = Math.max(0, Math.min(maxValue, Math.round(newValue)));

                input.value = String(newValue);
                updateLines();
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    document.body.style.cursor = '';
                    saveMetadata();
                }
            });
        };

        setupDrag(leftLine, leftInput, true, false);
        setupDrag(rightLine, rightInput, true, true);
        setupDrag(topLine, topInput, false, false);
        setupDrag(bottomLine, bottomInput, false, true);

        // Initial line positions after image loads
        const img = section.querySelector('.es-nine-slice-image') as HTMLImageElement;
        if (img.complete) {
            setTimeout(updateLines, 0);
        } else {
            img.onload = updateLines;
        }

        // Update lines on resize
        const resizeObserver = new ResizeObserver(updateLines);
        resizeObserver.observe(preview);

        this.contentContainer_.appendChild(section);
    }

    private async renderScriptInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        if (!fs) {
            this.renderError('File system not available');
            return;
        }

        const stats = await fs.getFileStats(path);
        const content = await fs.readFile(path);
        const lineCount = content ? content.split('\n').length : 0;
        const ext = getFileExtension(path);

        const propsSection = document.createElement('div');
        propsSection.className = 'es-component-section es-collapsible es-expanded';
        propsSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Properties</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Type</label>
                    <div class="es-property-value">${ext === '.ts' ? 'TypeScript' : ext === '.js' ? 'JavaScript' : 'Script'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Lines</label>
                    <div class="es-property-value">${lineCount}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">File Size</label>
                    <div class="es-property-value">${stats ? formatFileSize(stats.size) : 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Modified</label>
                    <div class="es-property-value">${stats ? formatDate(stats.modified) : 'Unknown'}</div>
                </div>
            </div>
        `;

        const header1 = propsSection.querySelector('.es-collapsible-header');
        header1?.addEventListener('click', () => {
            propsSection.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(propsSection);

        if (content) {
            const previewSection = document.createElement('div');
            previewSection.className = 'es-component-section es-collapsible es-expanded';
            const previewContent = content.substring(0, 500) + (content.length > 500 ? '\n...' : '');
            previewSection.innerHTML = `
                <div class="es-component-header es-collapsible-header">
                    <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                    <span class="es-component-icon">${icons.code(14)}</span>
                    <span class="es-component-title">Preview</span>
                </div>
                <div class="es-collapsible-content">
                    <pre class="es-code-preview">${this.escapeHtml(previewContent)}</pre>
                </div>
            `;

            const header2 = previewSection.querySelector('.es-collapsible-header');
            header2?.addEventListener('click', () => {
                previewSection.classList.toggle('es-expanded');
            });

            this.contentContainer_.appendChild(previewSection);
        }
    }

    private async renderSceneInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        if (!fs) {
            this.renderError('File system not available');
            return;
        }

        const stats = await fs.getFileStats(path);
        const content = await fs.readFile(path);

        let entityCount = 0;
        if (content) {
            try {
                const scene = JSON.parse(content);
                entityCount = scene.entities?.length ?? 0;
            } catch {
                // Ignore parse errors
            }
        }

        const propsSection = document.createElement('div');
        propsSection.className = 'es-component-section es-collapsible es-expanded';
        propsSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Properties</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Entities</label>
                    <div class="es-property-value">${entityCount}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">File Size</label>
                    <div class="es-property-value">${stats ? formatFileSize(stats.size) : 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Modified</label>
                    <div class="es-property-value">${stats ? formatDate(stats.modified) : 'Unknown'}</div>
                </div>
            </div>
        `;

        const header = propsSection.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            propsSection.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(propsSection);

        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'es-asset-actions';
        actionsWrapper.innerHTML = `
            <button class="es-btn es-btn-primary es-btn-open-scene">Open Scene</button>
        `;

        const openBtn = actionsWrapper.querySelector('.es-btn-open-scene');
        openBtn?.addEventListener('click', () => {
            const editor = getEditorInstance();
            if (editor && typeof editor.openSceneFromPath === 'function') {
                editor.openSceneFromPath(path);
            }
        });

        this.contentContainer_.appendChild(actionsWrapper);
    }

    private async renderMaterialInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        const platform = getPlatformAdapter();
        if (!fs) {
            this.renderError('File system not available');
            return;
        }

        const content = await fs.readFile(path);
        if (!content) {
            this.renderError('Failed to load material file');
            return;
        }

        const metadata = parseMaterialMetadata(content);
        if (!metadata) {
            this.renderError('Invalid material file');
            return;
        }

        this.currentMaterialMetadata_ = metadata;
        this.currentShaderProperties_ = [];

        const saveMaterial = async () => {
            if (!this.currentMaterialMetadata_) return;
            try {
                const json = serializeMaterialMetadata(this.currentMaterialMetadata_);
                await platform.writeTextFile(path, json);
            } catch (err) {
                console.error('Failed to save material:', err);
            }
        };

        const shaderSection = document.createElement('div');
        shaderSection.className = 'es-component-section es-collapsible es-expanded';
        shaderSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.code(14)}</span>
                <span class="es-component-title">Shader</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Shader</label>
                    <div class="es-property-editor es-shader-editor-container"></div>
                </div>
            </div>
        `;

        const shaderHeader = shaderSection.querySelector('.es-collapsible-header');
        shaderHeader?.addEventListener('click', () => {
            shaderSection.classList.toggle('es-expanded');
        });

        const shaderEditorContainer = shaderSection.querySelector('.es-shader-editor-container')!;
        this.createShaderFileInput(shaderEditorContainer as HTMLElement, metadata.shader, async (newPath) => {
            if (this.currentMaterialMetadata_) {
                this.currentMaterialMetadata_.shader = newPath;
                await saveMaterial();
                await this.reloadShaderProperties(path);
            }
        });

        this.contentContainer_.appendChild(shaderSection);

        const renderSection = document.createElement('div');
        renderSection.className = 'es-component-section es-collapsible es-expanded';
        renderSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Render Settings</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Blend Mode</label>
                    <div class="es-property-editor es-blend-mode-container"></div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Depth Test</label>
                    <div class="es-property-editor es-depth-test-container"></div>
                </div>
            </div>
        `;

        const renderHeader = renderSection.querySelector('.es-collapsible-header');
        renderHeader?.addEventListener('click', () => {
            renderSection.classList.toggle('es-expanded');
        });

        const blendContainer = renderSection.querySelector('.es-blend-mode-container')!;
        const blendSelect = document.createElement('select');
        blendSelect.className = 'es-input es-input-select';
        BLEND_MODE_OPTIONS.forEach(opt => {
            const option = document.createElement('option');
            option.value = String(opt.value);
            option.textContent = opt.label;
            if (opt.value === metadata.blendMode) {
                option.selected = true;
            }
            blendSelect.appendChild(option);
        });
        blendSelect.addEventListener('change', async () => {
            if (this.currentMaterialMetadata_) {
                const newBlendMode = parseInt(blendSelect.value, 10);
                this.currentMaterialMetadata_.blendMode = newBlendMode;
                await saveMaterial();

                const assetServer = this.getAssetServer();
                if (assetServer) {
                    const projectDir = this.getProjectDir();
                    if (projectDir && path.startsWith(projectDir)) {
                        const relativePath = path.substring(projectDir.length + 1);
                        assetServer.updateMaterialBlendMode(relativePath, newBlendMode);
                    }
                }
            }
        });
        blendContainer.appendChild(blendSelect);

        const depthContainer = renderSection.querySelector('.es-depth-test-container')!;
        const depthCheckbox = document.createElement('input');
        depthCheckbox.type = 'checkbox';
        depthCheckbox.className = 'es-input es-input-checkbox';
        depthCheckbox.checked = metadata.depthTest;
        depthCheckbox.addEventListener('change', async () => {
            if (this.currentMaterialMetadata_) {
                this.currentMaterialMetadata_.depthTest = depthCheckbox.checked;
                await saveMaterial();
            }
        });
        depthContainer.appendChild(depthCheckbox);

        this.contentContainer_.appendChild(renderSection);

        await this.renderMaterialProperties(path, metadata, saveMaterial);
    }

    private createShaderFileInput(
        container: HTMLElement,
        currentPath: string,
        onChange: (path: string) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-file-editor';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-input es-input-file es-asset-link';
        input.value = currentPath;
        input.placeholder = 'None';
        input.readOnly = true;

        const browseBtn = document.createElement('button');
        browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
        browseBtn.title = 'Browse';
        browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

        input.addEventListener('click', () => {
            if (input.value) {
                this.openAssetInBrowser(input.value);
            }
        });

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            const data = e.dataTransfer?.types.includes('application/esengine-asset');
            if (data) {
                wrapper.classList.add('es-drag-over');
                e.dataTransfer!.dropEffect = 'copy';
            } else {
                e.dataTransfer!.dropEffect = 'none';
            }
        });

        wrapper.addEventListener('dragleave', () => {
            wrapper.classList.remove('es-drag-over');
        });

        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            wrapper.classList.remove('es-drag-over');

            const jsonData = e.dataTransfer?.getData('application/esengine-asset');
            if (!jsonData) return;

            try {
                const assetData = JSON.parse(jsonData);
                if (assetData.type === 'shader') {
                    const projectDir = this.getProjectDir();
                    if (projectDir && assetData.path.startsWith(projectDir)) {
                        const relativePath = assetData.path.substring(projectDir.length + 1);
                        input.value = relativePath;
                        onChange(relativePath);
                    }
                }
            } catch (err) {
                console.error('Failed to parse drop data:', err);
            }
        });

        browseBtn.addEventListener('click', async () => {
            const projectDir = this.getProjectDir();
            if (!projectDir) return;

            const assetsDir = `${projectDir}/assets`;

            try {
                const platform = getPlatformAdapter();
                const result = await platform.openFileDialog({
                    title: 'Select Shader',
                    defaultPath: assetsDir,
                    filters: [{ name: 'Shader Files', extensions: ['esshader'] }],
                });
                if (result) {
                    const normalizedPath = result.replace(/\\/g, '/');
                    const assetsIndex = normalizedPath.indexOf('/assets/');
                    if (assetsIndex !== -1) {
                        const relativePath = normalizedPath.substring(assetsIndex + 1);
                        input.value = relativePath;
                        onChange(relativePath);
                    }
                }
            } catch (err) {
                console.error('Failed to open file dialog:', err);
            }
        });

        wrapper.appendChild(input);
        wrapper.appendChild(browseBtn);
        container.appendChild(wrapper);
    }

    private getProjectDir(): string | null {
        const editor = getEditorInstance();
        const projectPath = editor?.projectPath;
        if (!projectPath) return null;
        return projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
    }

    private openAssetInBrowser(assetPath: string): void {
        const editor = getEditorInstance();
        if (editor && typeof editor.navigateToAsset === 'function') {
            editor.navigateToAsset(assetPath);
        }
    }

    private getAssetServer(): import('../asset/EditorAssetServer').EditorAssetServer | null {
        const editor = getEditorInstance();
        return editor?.assetServer ?? null;
    }

    private async reloadShaderProperties(materialPath: string): Promise<void> {
        const propsSections = this.contentContainer_.querySelectorAll('.es-material-properties-section');
        propsSections.forEach(s => s.remove());

        if (this.currentMaterialMetadata_) {
            await this.renderMaterialProperties(materialPath, this.currentMaterialMetadata_, async () => {
                const platform = getPlatformAdapter();
                if (this.currentMaterialMetadata_) {
                    const json = serializeMaterialMetadata(this.currentMaterialMetadata_);
                    await platform.writeTextFile(materialPath, json);
                }
            });
        }
    }

    private async renderMaterialProperties(
        materialPath: string,
        metadata: MaterialMetadata,
        saveMaterial: () => Promise<void>
    ): Promise<void> {
        if (!metadata.shader) {
            this.currentShaderProperties_ = [];
            return;
        }

        const fs = getNativeFS();
        const projectDir = this.getProjectDir();
        if (!fs || !projectDir) return;

        const shaderFullPath = `${projectDir}/${metadata.shader}`;
        const shaderContent = await fs.readFile(shaderFullPath);
        if (!shaderContent) {
            this.currentShaderProperties_ = [];
            return;
        }

        const shaderInfo = parseShaderProperties(shaderContent);
        if (!shaderInfo.valid || shaderInfo.properties.length === 0) {
            this.currentShaderProperties_ = [];
            return;
        }

        this.currentShaderProperties_ = shaderInfo.properties;

        const groupedProps = new Map<string, ShaderProperty[]>();
        const ungroupedProps: ShaderProperty[] = [];

        for (const prop of shaderInfo.properties) {
            if (prop.group) {
                const group = groupedProps.get(prop.group) ?? [];
                group.push(prop);
                groupedProps.set(prop.group, group);
            } else {
                ungroupedProps.push(prop);
            }
        }

        if (ungroupedProps.length > 0) {
            this.renderPropertyGroup('Properties', ungroupedProps, metadata, saveMaterial, materialPath);
        }

        for (const [groupName, props] of groupedProps) {
            this.renderPropertyGroup(groupName, props, metadata, saveMaterial, materialPath);
        }
    }

    private renderPropertyGroup(
        groupName: string,
        properties: ShaderProperty[],
        metadata: MaterialMetadata,
        saveMaterial: () => Promise<void>,
        materialPath: string
    ): void {
        const propsSection = document.createElement('div');
        propsSection.className = 'es-component-section es-collapsible es-expanded es-material-properties-section';
        propsSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">${this.escapeHtml(groupName)}</span>
            </div>
            <div class="es-component-properties es-collapsible-content"></div>
        `;

        const propsHeader = propsSection.querySelector('.es-collapsible-header');
        propsHeader?.addEventListener('click', () => {
            propsSection.classList.toggle('es-expanded');
        });

        const propsContainer = propsSection.querySelector('.es-component-properties')!;

        for (const prop of properties) {
            const row = document.createElement('div');
            row.className = 'es-property-row';

            const label = document.createElement('label');
            label.className = 'es-property-label';
            label.textContent = prop.displayName;

            const editorContainer = document.createElement('div');
            editorContainer.className = 'es-property-editor';

            const currentValue = metadata.properties[prop.name] ?? getDefaultPropertyValue(prop.type);

            this.createPropertyEditorForType(editorContainer, prop, currentValue, async (newValue) => {
                if (this.currentMaterialMetadata_) {
                    this.currentMaterialMetadata_.properties[prop.name] = newValue;
                    await saveMaterial();

                    const assetServer = this.getAssetServer();
                    const projectDir = this.getProjectDir();
                    if (assetServer && projectDir && materialPath.startsWith(projectDir)) {
                        const relativePath = materialPath.substring(projectDir.length + 1);
                        assetServer.updateMaterialUniform(relativePath, prop.name, newValue);
                    }
                }
            });

            row.appendChild(label);
            row.appendChild(editorContainer);
            propsContainer.appendChild(row);
        }

        this.contentContainer_.appendChild(propsSection);
    }

    private createPropertyEditorForType(
        container: HTMLElement,
        prop: ShaderProperty,
        value: unknown,
        onChange: (value: unknown) => void
    ): void {
        switch (prop.type) {
            case ShaderPropertyType.Float:
                this.createFloatEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
                break;
            case ShaderPropertyType.Int:
                this.createIntEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
                break;
            case ShaderPropertyType.Vec2:
                this.createVec2Editor(container, value as { x: number; y: number }, onChange);
                break;
            case ShaderPropertyType.Vec3:
                this.createVec3Editor(container, value as { x: number; y: number; z: number }, onChange);
                break;
            case ShaderPropertyType.Vec4:
                this.createVec4Editor(container, value as { x: number; y: number; z: number; w: number }, onChange);
                break;
            case ShaderPropertyType.Color:
                this.createColorEditor(container, value as { r: number; g: number; b: number; a: number }, onChange);
                break;
            case ShaderPropertyType.Texture:
                this.createTextureEditor(container, value as string, onChange);
                break;
            default:
                container.textContent = 'Unknown type';
        }
    }

    private setupDragLabel(
        label: HTMLElement,
        input: HTMLInputElement,
        onChange: (value: number) => void,
        step: number = 0.1,
        min?: number,
        max?: number
    ): void {
        let startX = 0;
        let startValue = 0;
        let isDragging = false;

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const delta = (e.clientX - startX) * step;
            let newValue = startValue + delta;
            if (min !== undefined && newValue < min) newValue = min;
            if (max !== undefined && newValue > max) newValue = max;
            newValue = parseFloat(newValue.toFixed(4));
            input.value = String(newValue);
            onChange(newValue);
        };

        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
        };

        label.style.cursor = 'ew-resize';
        label.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startValue = parseFloat(input.value) || 0;
            document.body.style.cursor = 'ew-resize';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    private createFloatEditor(
        container: HTMLElement,
        value: number,
        onChange: (v: number) => void,
        min?: number,
        max?: number,
        step?: number
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-number-editor';

        const label = document.createElement('span');
        label.className = 'es-number-drag-label';
        label.innerHTML = '⋮⋮';
        label.title = 'Drag to adjust value';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = String(step ?? 0.01);
        input.value = String(parseFloat((value ?? 0).toFixed(4)));
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);
        input.addEventListener('change', () => {
            let val = parseFloat(input.value) || 0;
            if (min !== undefined && val < min) val = min;
            if (max !== undefined && val > max) val = max;
            val = parseFloat(val.toFixed(4));
            input.value = String(val);
            onChange(val);
        });

        this.setupDragLabel(label, input, (v) => onChange(parseFloat(v.toFixed(4))), step ?? 0.01, min, max);

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        container.appendChild(wrapper);
    }

    private createIntEditor(
        container: HTMLElement,
        value: number,
        onChange: (v: number) => void,
        min?: number,
        max?: number,
        step?: number
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-number-editor';

        const label = document.createElement('span');
        label.className = 'es-number-drag-label';
        label.innerHTML = '⋮⋮';
        label.title = 'Drag to adjust value';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-input-number';
        input.step = String(step ?? 1);
        input.value = String(value ?? 0);
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);
        input.addEventListener('change', () => {
            let val = parseInt(input.value, 10) || 0;
            if (min !== undefined && val < min) val = min;
            if (max !== undefined && val > max) val = max;
            input.value = String(val);
            onChange(val);
        });

        this.setupDragLabel(label, input, (v) => onChange(Math.round(v)), step ?? 1, min, max);

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        container.appendChild(wrapper);
    }

    private createVec2Editor(
        container: HTMLElement,
        value: { x: number; y: number },
        onChange: (v: { x: number; y: number }) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-vec-editor es-vec2-editor';

        const val = value ?? { x: 0, y: 0 };
        const keys: ('x' | 'y')[] = ['x', 'y'];
        const labels = ['X', 'Y'];
        const classes = ['es-vec-x', 'es-vec-y'];

        keys.forEach((key, i) => {
            const group = document.createElement('div');
            group.className = `es-vec-field ${classes[i]}`;

            const label = document.createElement('span');
            label.className = 'es-vec-label';
            label.textContent = labels[i];

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'es-input es-input-number';
            input.step = '0.01';
            input.value = String(parseFloat(val[key].toFixed(4)));
            input.addEventListener('change', () => {
                val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
                onChange({ ...val });
            });

            this.setupDragLabel(label, input, (v) => {
                val[key] = parseFloat(v.toFixed(4));
                onChange({ ...val });
            });

            group.appendChild(label);
            group.appendChild(input);
            wrapper.appendChild(group);
        });

        container.appendChild(wrapper);
    }

    private createVec3Editor(
        container: HTMLElement,
        value: { x: number; y: number; z: number },
        onChange: (v: { x: number; y: number; z: number }) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-vec-editor es-vec3-editor';

        const val = value ?? { x: 0, y: 0, z: 0 };
        const keys: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
        const labels = ['X', 'Y', 'Z'];
        const classes = ['es-vec-x', 'es-vec-y', 'es-vec-z'];

        keys.forEach((key, i) => {
            const group = document.createElement('div');
            group.className = `es-vec-field ${classes[i]}`;

            const label = document.createElement('span');
            label.className = 'es-vec-label';
            label.textContent = labels[i];

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'es-input es-input-number';
            input.step = '0.01';
            input.value = String(parseFloat(val[key].toFixed(4)));
            input.addEventListener('change', () => {
                val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
                onChange({ ...val });
            });

            this.setupDragLabel(label, input, (v) => {
                val[key] = parseFloat(v.toFixed(4));
                onChange({ ...val });
            });

            group.appendChild(label);
            group.appendChild(input);
            wrapper.appendChild(group);
        });

        container.appendChild(wrapper);
    }

    private createVec4Editor(
        container: HTMLElement,
        value: { x: number; y: number; z: number; w: number },
        onChange: (v: { x: number; y: number; z: number; w: number }) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-vec-editor es-vec4-editor';

        const val = value ?? { x: 0, y: 0, z: 0, w: 1 };
        const keys: ('x' | 'y' | 'z' | 'w')[] = ['x', 'y', 'z', 'w'];
        const labels = ['X', 'Y', 'Z', 'W'];
        const classes = ['es-vec-x', 'es-vec-y', 'es-vec-z', 'es-vec-w'];

        keys.forEach((key, i) => {
            const group = document.createElement('div');
            group.className = `es-vec-field ${classes[i]}`;

            const label = document.createElement('span');
            label.className = 'es-vec-label';
            label.textContent = labels[i];

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'es-input es-input-number';
            input.step = '0.01';
            input.value = String(parseFloat(val[key].toFixed(4)));
            input.addEventListener('change', () => {
                val[key] = parseFloat((parseFloat(input.value) || 0).toFixed(4));
                onChange({ ...val });
            });

            this.setupDragLabel(label, input, (v) => {
                val[key] = parseFloat(v.toFixed(4));
                onChange({ ...val });
            });

            group.appendChild(label);
            group.appendChild(input);
            wrapper.appendChild(group);
        });

        container.appendChild(wrapper);
    }

    private createColorEditor(
        container: HTMLElement,
        value: { r: number; g: number; b: number; a: number },
        onChange: (v: { r: number; g: number; b: number; a: number }) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-color-editor';

        const val = value ?? { r: 1, g: 1, b: 1, a: 1 };

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'es-input es-input-color';
        colorInput.value = this.colorToHex(val);

        const alphaInput = document.createElement('input');
        alphaInput.type = 'number';
        alphaInput.className = 'es-input es-input-number es-input-alpha';
        alphaInput.min = '0';
        alphaInput.max = '1';
        alphaInput.step = '0.01';
        alphaInput.value = String(val.a);

        const update = () => {
            const hex = colorInput.value;
            const newColor = this.hexToColor(hex);
            newColor.a = parseFloat(alphaInput.value) || 1;
            onChange(newColor);
        };

        colorInput.addEventListener('input', update);
        colorInput.addEventListener('change', update);
        alphaInput.addEventListener('change', update);

        wrapper.appendChild(colorInput);
        wrapper.appendChild(alphaInput);
        container.appendChild(wrapper);
    }

    private colorToHex(color: { r: number; g: number; b: number; a: number }): string {
        const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    private hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return { r, g, b, a: 1 };
    }

    private createTextureEditor(container: HTMLElement, value: string, onChange: (v: string) => void): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-file-editor';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-input es-input-file es-asset-link';
        input.value = value ?? '';
        input.placeholder = 'None';
        input.readOnly = true;

        const browseBtn = document.createElement('button');
        browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
        browseBtn.title = 'Browse';
        browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

        input.addEventListener('click', () => {
            if (input.value) {
                this.openAssetInBrowser(input.value);
            }
        });

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            const data = e.dataTransfer?.types.includes('application/esengine-asset');
            if (data) {
                wrapper.classList.add('es-drag-over');
                e.dataTransfer!.dropEffect = 'copy';
            } else {
                e.dataTransfer!.dropEffect = 'none';
            }
        });

        wrapper.addEventListener('dragleave', () => {
            wrapper.classList.remove('es-drag-over');
        });

        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            wrapper.classList.remove('es-drag-over');

            const jsonData = e.dataTransfer?.getData('application/esengine-asset');
            if (!jsonData) return;

            try {
                const assetData = JSON.parse(jsonData);
                if (assetData.type === 'image') {
                    const projectDir = this.getProjectDir();
                    if (projectDir && assetData.path.startsWith(projectDir)) {
                        const relativePath = assetData.path.substring(projectDir.length + 1);
                        input.value = relativePath;
                        onChange(relativePath);
                    }
                }
            } catch (err) {
                console.error('Failed to parse drop data:', err);
            }
        });

        browseBtn.addEventListener('click', async () => {
            const projectDir = this.getProjectDir();
            if (!projectDir) return;

            const assetsDir = `${projectDir}/assets`;

            try {
                const platform = getPlatformAdapter();
                const result = await platform.openFileDialog({
                    title: 'Select Texture',
                    defaultPath: assetsDir,
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                });
                if (result) {
                    const normalizedPath = result.replace(/\\/g, '/');
                    const assetsIndex = normalizedPath.indexOf('/assets/');
                    if (assetsIndex !== -1) {
                        const relativePath = normalizedPath.substring(assetsIndex + 1);
                        input.value = relativePath;
                        onChange(relativePath);
                    }
                }
            } catch (err) {
                console.error('Failed to open file dialog:', err);
            }
        });

        wrapper.appendChild(input);
        wrapper.appendChild(browseBtn);
        container.appendChild(wrapper);
    }

    private async renderBitmapFontInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        const platform = getPlatformAdapter();
        if (!fs) {
            this.renderError('File system not available');
            return;
        }

        const content = await fs.readFile(path);
        if (!content) {
            this.renderError('Failed to load font file');
            return;
        }

        let fontData: Record<string, unknown>;
        try {
            fontData = JSON.parse(content);
        } catch {
            this.renderError('Invalid font file');
            return;
        }

        const fontType = (fontData.type as string) ?? 'label-atlas';

        const fontDir = path.substring(0, path.lastIndexOf('/'));
        const baseName = getFileName(path).replace('.bmfont', '');

        const save = async () => {
            try {
                await platform.writeTextFile(path, JSON.stringify(fontData, null, 2));
            } catch (err) {
                console.error('Failed to save bitmap font:', err);
            }
        };

        const buildAtlas = async (): Promise<boolean> => {
            const glyphs = (fontData.glyphs ?? {}) as Record<string, string>;
            const validGlyphs = Object.fromEntries(
                Object.entries(glyphs).filter(([, v]) => v)
            );
            const generated = await this.buildBitmapFontAtlas(fontDir, baseName, validGlyphs);
            if (generated) {
                fontData.generatedFnt = generated.fntName;
                await save();
                return true;
            }
            return false;
        };

        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.type(14)}</span>
                <span class="es-component-title">BitmapFont</span>
            </div>
            <div class="es-component-properties es-collapsible-content"></div>
        `;

        const header = section.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            section.classList.toggle('es-expanded');
        });

        const propsContainer = section.querySelector('.es-component-properties')!;

        const typeRow = document.createElement('div');
        typeRow.className = 'es-property-row';
        typeRow.innerHTML = `<label class="es-property-label">Type</label><div class="es-property-editor"></div>`;
        const typeEditor = typeRow.querySelector('.es-property-editor')!;
        const typeSelect = document.createElement('select');
        typeSelect.className = 'es-input es-input-select';
        for (const opt of [{ label: 'BMFont (.fnt)', value: 'bmfont' }, { label: 'LabelAtlas', value: 'label-atlas' }]) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === fontType) option.selected = true;
            typeSelect.appendChild(option);
        }
        typeEditor.appendChild(typeSelect);
        propsContainer.appendChild(typeRow);

        const dynamicContainer = document.createElement('div');
        propsContainer.appendChild(dynamicContainer);

        const renderFields = () => {
            dynamicContainer.innerHTML = '';
            const currentType = fontData.type as string;

            if (currentType === 'bmfont') {
                this.createBmfontFileInput(dynamicContainer, 'fntFile', String(fontData.fntFile ?? ''), ['.fnt'], 'FNT Files', async (v) => {
                    fontData.fntFile = v;
                    await save();
                });
            } else {
                this.renderGlyphList(dynamicContainer, fontData, fontDir, save);

                const buildBtn = document.createElement('button');
                buildBtn.className = 'es-btn es-btn-primary';
                buildBtn.textContent = 'Build Atlas';
                buildBtn.style.marginTop = '8px';
                buildBtn.style.width = '100%';
                buildBtn.addEventListener('click', async () => {
                    buildBtn.disabled = true;
                    buildBtn.textContent = 'Building...';
                    try {
                        const result = await buildAtlas();
                        buildBtn.textContent = result ? 'Done!' : 'No valid glyphs';
                    } catch (err) {
                        console.error('[BitmapFont] Build failed:', err);
                        buildBtn.textContent = 'Build Failed';
                    }
                    setTimeout(() => {
                        buildBtn.disabled = false;
                        buildBtn.textContent = 'Build Atlas';
                    }, 1500);
                });
                dynamicContainer.appendChild(buildBtn);
            }
        };

        typeSelect.addEventListener('change', async () => {
            fontData.type = typeSelect.value;
            if (typeSelect.value === 'label-atlas' && !fontData.glyphs) {
                fontData.glyphs = {};
            }
            await save();
            renderFields();
        });

        renderFields();
        this.contentContainer_.appendChild(section);
    }

    private async buildBitmapFontAtlas(
        fontDir: string,
        baseName: string,
        glyphs: Record<string, string>,
    ): Promise<{ fntName: string } | null> {
        const fs = getNativeFS();
        const platform = getPlatformAdapter();
        if (!fs) return null;

        const entries: { char: string; img: HTMLImageElement; w: number; h: number }[] = [];

        for (const [char, imgPath] of Object.entries(glyphs)) {
            if (!imgPath) continue;
            const fullPath = `${fontDir}/${imgPath}`;
            const url = platform.convertFilePathToUrl(fullPath);
            try {
                const img = await this.loadImageFromUrl(url);
                entries.push({ char, img, w: img.naturalWidth, h: img.naturalHeight });
            } catch (err) {
                console.error(`[BitmapFont] Failed to load glyph '${char}': ${fullPath}`, err);
            }
        }

        console.log(`[BitmapFont] Loaded ${entries.length}/${Object.keys(glyphs).length} glyphs`);

        const maxH = entries.length > 0 ? Math.max(...entries.map(e => e.h)) : 1;
        const totalW = entries.reduce((sum, e) => sum + e.w, 0) || 1;
        const atlasW = this.nextPowerOf2(totalW);
        const atlasH = this.nextPowerOf2(maxH);

        const canvas = document.createElement('canvas');
        canvas.width = atlasW;
        canvas.height = atlasH;
        const ctx = canvas.getContext('2d')!;

        let x = 0;
        const fntLines = [
            `info face="${baseName}" size=${maxH}`,
            `common lineHeight=${maxH} base=${maxH} scaleW=${atlasW} scaleH=${atlasH} pages=1`,
            `page id=0 file="${baseName}.atlas.png"`,
            `chars count=${entries.length}`,
        ];

        for (const entry of entries) {
            ctx.drawImage(entry.img, x, 0);
            const charCode = entry.char.codePointAt(0)!;
            fntLines.push(
                `char id=${charCode} x=${x} y=0 width=${entry.w} height=${entry.h} xoffset=0 yoffset=0 xadvance=${entry.w} page=0`
            );
            x += entry.w;
        }

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return null;

        const arrayBuffer = await blob.arrayBuffer();
        const pngData = new Uint8Array(arrayBuffer);

        const atlasPath = `${fontDir}/${baseName}.atlas.png`;
        const fntPath = `${fontDir}/${baseName}.fnt`;

        await fs.writeBinaryFile(atlasPath, pngData);
        await fs.writeFile(fntPath, fntLines.join('\n'));

        return { fntName: `${baseName}.fnt` };
    }

    private loadImageFromUrl(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load: ${url}`));
            img.src = url;
        });
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }

    private renderGlyphList(
        container: HTMLElement,
        fontData: Record<string, unknown>,
        fontDir: string,
        save: () => Promise<void>,
    ): void {
        const glyphs = (fontData.glyphs ?? {}) as Record<string, string>;

        const listContainer = document.createElement('div');
        listContainer.className = 'es-bmfont-glyph-list';

        const blobUrls: string[] = [];

        const loadGlyphThumb = async (imgPath: string, dir: string, thumb: HTMLImageElement) => {
            const fs = getNativeFS();
            if (!fs) return;
            const fullPath = `${dir}/${imgPath}`;
            try {
                const data = await fs.readBinaryFile(fullPath);
                if (!data) return;
                const ext = getFileExtension(imgPath);
                const blob = new Blob([new Uint8Array(data).buffer], { type: getMimeType(ext) });
                const url = URL.createObjectURL(blob);
                blobUrls.push(url);
                thumb.src = url;
                thumb.style.display = 'block';
            } catch {}
        };

        const rebuildList = () => {
            for (const url of blobUrls) URL.revokeObjectURL(url);
            blobUrls.length = 0;
            listContainer.innerHTML = '';
            const currentGlyphs = (fontData.glyphs ?? {}) as Record<string, string>;

            for (const [char, imgPath] of Object.entries(currentGlyphs)) {
                const row = document.createElement('div');
                row.className = 'es-property-row es-bmfont-glyph-row';

                const charInput = document.createElement('input');
                charInput.type = 'text';
                charInput.className = 'es-input es-bmfont-char-input';
                charInput.value = char;
                charInput.maxLength = 2;
                charInput.style.width = '36px';
                charInput.style.textAlign = 'center';

                const fileInput = document.createElement('input');
                fileInput.type = 'text';
                fileInput.className = 'es-input es-input-file';
                fileInput.value = imgPath;
                fileInput.placeholder = 'image.png';
                fileInput.readOnly = true;
                fileInput.style.flex = '1';

                const browseBtn = document.createElement('button');
                browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
                browseBtn.title = 'Browse';
                browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

                const removeBtn = document.createElement('button');
                removeBtn.className = 'es-btn es-btn-icon es-btn-clear';
                removeBtn.title = 'Remove';
                removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

                const thumb = document.createElement('img');
                thumb.className = 'es-bmfont-glyph-thumb';
                thumb.style.cssText = 'width:24px;height:24px;object-fit:contain;border-radius:2px;background:#222;flex-shrink:0';
                thumb.style.display = 'none';

                if (imgPath) {
                    loadGlyphThumb(imgPath, fontDir, thumb);
                }

                charInput.addEventListener('change', async () => {
                    const newChar = charInput.value;
                    if (newChar && newChar !== char) {
                        const g = fontData.glyphs as Record<string, string>;
                        delete g[char];
                        g[newChar] = imgPath;
                        await save();
                        rebuildList();
                    }
                });

                charInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const inputs = listContainer.querySelectorAll('.es-bmfont-char-input');
                        const arr = Array.from(inputs);
                        const idx = arr.indexOf(charInput);
                        const next = e.shiftKey ? arr[idx - 1] : arr[idx + 1];
                        if (next) (next as HTMLInputElement).focus();
                    }
                });

                fileInput.style.cursor = 'pointer';
                fileInput.classList.add('es-asset-link');
                fileInput.addEventListener('click', () => {
                    if (!imgPath) return;
                    const fullRelative = `${fontDir}/${imgPath}`;
                    const projectDir = this.getProjectDir();
                    if (projectDir && fullRelative.startsWith(projectDir + '/')) {
                        this.openAssetInBrowser(fullRelative.substring(projectDir.length + 1));
                    } else {
                        this.openAssetInBrowser(fullRelative);
                    }
                });

                browseBtn.addEventListener('click', async () => {
                    try {
                        const result = await getPlatformAdapter().openFileDialog({
                            title: 'Select Glyph Image',
                            defaultPath: fontDir,
                            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                        });
                        if (result) {
                            const relativePath = this.toRelativeFromDir(result, fontDir);
                            if (relativePath) {
                                (fontData.glyphs as Record<string, string>)[char] = relativePath;
                                fileInput.value = relativePath;
                                await save();
                                loadGlyphThumb(relativePath, fontDir, thumb);
                            }
                        }
                    } catch (err) {
                        console.error('Failed to open file dialog:', err);
                    }
                });

                removeBtn.addEventListener('click', async () => {
                    delete (fontData.glyphs as Record<string, string>)[char];
                    await save();
                    rebuildList();
                });

                const wrapper = document.createElement('div');
                wrapper.className = 'es-file-editor';
                wrapper.style.display = 'flex';
                wrapper.style.gap = '4px';
                wrapper.style.alignItems = 'center';
                wrapper.style.width = '100%';
                wrapper.appendChild(charInput);
                wrapper.appendChild(thumb);
                wrapper.appendChild(fileInput);
                wrapper.appendChild(browseBtn);
                wrapper.appendChild(removeBtn);

                row.appendChild(wrapper);
                listContainer.appendChild(row);
            }
        };

        rebuildList();
        container.appendChild(listContainer);

        const actionsRow = document.createElement('div');
        actionsRow.className = 'es-bmfont-actions';
        actionsRow.style.display = 'flex';
        actionsRow.style.gap = '4px';
        actionsRow.style.padding = '4px 0';

        const addBtn = document.createElement('button');
        addBtn.className = 'es-btn es-btn-small';
        addBtn.textContent = 'Add Glyph';
        addBtn.addEventListener('click', async () => {
            const g = (fontData.glyphs ?? {}) as Record<string, string>;
            let nextChar = 'A';
            for (let i = 65; i < 127; i++) {
                const c = String.fromCharCode(i);
                if (!(c in g)) { nextChar = c; break; }
            }
            g[nextChar] = '';
            fontData.glyphs = g;
            await save();
            rebuildList();
        });

        const importBtn = document.createElement('button');
        importBtn.className = 'es-btn es-btn-small';
        importBtn.textContent = 'Import Folder';
        importBtn.addEventListener('click', async () => {
            const fs = getNativeFS();
            if (!fs) return;
            try {
                const sampleFile = await getPlatformAdapter().openFileDialog({
                    title: 'Select any image in the glyph folder',
                    defaultPath: fontDir,
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                });
                if (!sampleFile) return;
                const normalized = sampleFile.replace(/\\/g, '/');
                const folderPath = normalized.substring(0, normalized.lastIndexOf('/'));
                const entries = await fs.listDirectoryDetailed(folderPath);
                const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
                const g = (fontData.glyphs ?? {}) as Record<string, string>;
                for (const entry of entries) {
                    if (entry.isDirectory) continue;
                    const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
                    if (!imageExts.includes(ext)) continue;
                    const charName = entry.name.substring(0, entry.name.lastIndexOf('.'));
                    if (!charName) continue;
                    const relativePath = this.toRelativeFromDir(`${folderPath}/${entry.name}`, fontDir);
                    if (relativePath) {
                        g[charName] = relativePath;
                    }
                }
                fontData.glyphs = g;
                await save();
                rebuildList();
            } catch (err) {
                console.error('Failed to import folder:', err);
            }
        });

        actionsRow.appendChild(addBtn);
        actionsRow.appendChild(importBtn);
        container.appendChild(actionsRow);

        const countDiv = document.createElement('div');
        countDiv.className = 'es-property-value';
        countDiv.style.padding = '2px 0';
        countDiv.style.fontSize = '11px';
        countDiv.style.opacity = '0.6';
        countDiv.textContent = `${Object.keys(glyphs).length} glyphs`;
        container.appendChild(countDiv);
    }

    private toRelativeFromDir(absolutePath: string, dir: string): string | null {
        const normalized = absolutePath.replace(/\\/g, '/');
        const normalizedDir = dir.replace(/\\/g, '/');
        if (normalized.startsWith(normalizedDir + '/')) {
            return normalized.substring(normalizedDir.length + 1);
        }
        return normalized.substring(normalized.lastIndexOf('/') + 1);
    }

    private createBmfontFileInput(
        container: HTMLElement, label: string, value: string,
        extensions: string[], filterName: string,
        onChange: (v: string) => void
    ): void {
        const row = document.createElement('div');
        row.className = 'es-property-row';
        row.innerHTML = `<label class="es-property-label">${label}</label><div class="es-property-editor"></div>`;
        const editor = row.querySelector('.es-property-editor')!;

        const wrapper = document.createElement('div');
        wrapper.className = 'es-file-editor';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-input es-input-file';
        input.value = value;
        input.placeholder = 'None';

        const browseBtn = document.createElement('button');
        browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
        browseBtn.title = 'Browse';
        browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

        browseBtn.addEventListener('click', async () => {
            const projectDir = this.getProjectDir();
            if (!projectDir) return;
            try {
                const result = await getPlatformAdapter().openFileDialog({
                    title: `Select ${label}`,
                    defaultPath: `${projectDir}/assets`,
                    filters: [{ name: filterName, extensions: extensions.map(e => e.replace('.', '')) }],
                });
                if (result) {
                    const normalizedPath = result.replace(/\\/g, '/');
                    const assetsIndex = normalizedPath.indexOf('/assets/');
                    if (assetsIndex !== -1) {
                        const relativePath = normalizedPath.substring(assetsIndex + '/assets/'.length);
                        input.value = relativePath;
                        onChange(relativePath);
                    }
                }
            } catch (err) {
                console.error('Failed to open file dialog:', err);
            }
        });

        input.addEventListener('change', () => onChange(input.value));
        wrapper.appendChild(input);
        wrapper.appendChild(browseBtn);
        editor.appendChild(wrapper);
        container.appendChild(row);
    }

    private async renderFolderInspector(path: string): Promise<void> {
        const fs = getNativeFS();
        const projectDir = this.getProjectDir();
        if (!projectDir) return;

        const relativePath = path.startsWith(projectDir)
            ? path.substring(projectDir.length + 1)
            : path;

        const configService = new AssetExportConfigService(projectDir, fs as any);
        const exportConfig = await configService.load();
        const currentMode: FolderExportMode = exportConfig.folders[relativePath] || 'auto';

        const descriptions: Record<FolderExportMode, string> = {
            auto: 'Included only if referenced by build scenes',
            always: 'Always included in all builds',
            exclude: 'Never included in builds',
        };

        const exportSection = document.createElement('div');
        exportSection.className = 'es-component-section es-collapsible es-expanded';
        exportSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Export Settings</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Export Mode</label>
                    <div class="es-property-editor">
                        <select class="es-input es-folder-export-mode">
                            <option value="auto"${currentMode === 'auto' ? ' selected' : ''}>Auto</option>
                            <option value="always"${currentMode === 'always' ? ' selected' : ''}>Always Include</option>
                            <option value="exclude"${currentMode === 'exclude' ? ' selected' : ''}>Exclude</option>
                        </select>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label"></label>
                    <div class="es-property-value es-folder-export-desc" style="color: var(--text-muted); font-size: 11px;">${descriptions[currentMode]}</div>
                </div>
            </div>
        `;

        const header = exportSection.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            exportSection.classList.toggle('es-expanded');
        });

        const select = exportSection.querySelector('.es-folder-export-mode') as HTMLSelectElement;
        const descEl = exportSection.querySelector('.es-folder-export-desc') as HTMLElement;
        select?.addEventListener('change', async () => {
            const mode = select.value as FolderExportMode;
            descEl.textContent = descriptions[mode];
            await configService.setMode(relativePath, mode);
        });

        this.contentContainer_.appendChild(exportSection);

        let itemCount = 0;
        if (fs) {
            try {
                const entries = await (fs as any).listDirectoryDetailed(path);
                itemCount = entries?.length ?? 0;
            } catch {
                // Ignore
            }
        }

        const propsSection = document.createElement('div');
        propsSection.className = 'es-component-section es-collapsible es-expanded';
        propsSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Properties</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Items</label>
                    <div class="es-property-value">${itemCount}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Path</label>
                    <div class="es-property-value">${this.escapeHtml(relativePath)}</div>
                </div>
            </div>
        `;

        const propsHeader = propsSection.querySelector('.es-collapsible-header');
        propsHeader?.addEventListener('click', () => {
            propsSection.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(propsSection);
    }

    private async renderFileInspector(path: string, type: AssetType): Promise<void> {
        const fs = getNativeFS();
        const stats = fs ? await fs.getFileStats(path) : null;
        const ext = getFileExtension(path);

        const propsSection = document.createElement('div');
        propsSection.className = 'es-component-section es-collapsible es-expanded';
        propsSection.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.settings(14)}</span>
                <span class="es-component-title">Properties</span>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">Type</label>
                    <div class="es-property-value">${getAssetTypeName(type)}${ext ? ` (${ext})` : ''}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">File Size</label>
                    <div class="es-property-value">${stats ? formatFileSize(stats.size) : 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Modified</label>
                    <div class="es-property-value">${stats ? formatDate(stats.modified) : 'Unknown'}</div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">Created</label>
                    <div class="es-property-value">${stats ? formatDate(stats.created) : 'Unknown'}</div>
                </div>
            </div>
        `;

        const header = propsSection.querySelector('.es-collapsible-header');
        header?.addEventListener('click', () => {
            propsSection.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(propsSection);
    }

    private renderError(message: string): void {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'es-asset-preview-error';
        errorDiv.textContent = message;
        this.contentContainer_.appendChild(errorDiv);
    }

    private cleanupImageUrl(): void {
        if (this.currentImageUrl_) {
            URL.revokeObjectURL(this.currentImageUrl_);
            this.currentImageUrl_ = null;
        }
    }
}
