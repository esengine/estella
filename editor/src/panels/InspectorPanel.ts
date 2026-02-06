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
import { getComponentSchema, getDefaultComponentData } from '../schemas/ComponentSchemas';
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

// =============================================================================
// Types
// =============================================================================

interface EditorInfo {
    editor: PropertyEditorInstance;
    componentType: string;
    propertyName: string;
}

interface FileStats {
    size: number;
    modified: Date | null;
    created: Date | null;
}

interface NativeFS {
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    getFileStats(path: string): Promise<FileStats | null>;
}

// =============================================================================
// Helpers
// =============================================================================

function getNativeFS(): NativeFS | null {
    return (window as any).__esengine_fs ?? null;
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
    private editors_: EditorInfo[] = [];
    private currentEntity_: Entity | null = null;
    private currentAssetPath_: string | null = null;
    private currentComponentCount_: number = 0;
    private currentImageUrl_: string | null = null;

    private footerContainer_: HTMLElement | null = null;
    private lockBtn_: HTMLElement | null = null;
    private locked_: boolean = false;
    private currentTextureMetadata_: TextureMetadata | null = null;

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
                <button class="es-btn es-btn-icon" title="Debug">${icons.bug()}</button>
                <div class="es-toolbar-spacer"></div>
                <button class="es-btn es-btn-icon" title="Add Component">${icons.plus()}</button>
                <button class="es-btn es-btn-icon" title="Settings">${icons.settings()}</button>
            </div>
            <div class="es-inspector-content"></div>
            <div class="es-inspector-footer">No selection</div>
        `;

        this.contentContainer_ = this.container_.querySelector('.es-inspector-content')!;
        this.footerContainer_ = this.container_.querySelector('.es-inspector-footer');
        this.lockBtn_ = this.container_.querySelector('.es-lock-btn');

        this.setupLockButton();
        this.unsubscribe_ = store.subscribe(() => this.render());
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
        this.renderTagsSection(entity);

        for (const component of entityData.components) {
            this.renderComponent(entity, component);
        }

        this.renderAddComponentButton(entity, entityData.components);
        this.updateFooter(`${entityData.components.length + 1} components`);
    }

    private updateFooter(text: string): void {
        if (this.footerContainer_) {
            this.footerContainer_.textContent = text;
        }
    }

    private renderEntityHeader(name: string, entity: Entity): void {
        const header = document.createElement('div');
        header.className = 'es-inspector-entity-header';
        header.innerHTML = `
            <span class="es-entity-icon">${icons.box(16)}</span>
            <input type="text" class="es-entity-name-input" value="${this.escapeHtml(name)}">
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

        this.contentContainer_.appendChild(header);
    }

    private renderTagsSection(_entity: Entity): void {
        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.check(14)}</span>
                <span class="es-component-title">Tags</span>
                <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">active</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox" checked>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">visible</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox" checked>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">static</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox">
                    </div>
                </div>
            </div>
        `;

        const header = section.querySelector('.es-collapsible-header');
        header?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
            section.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(section);
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
        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';

        const icon = this.getComponentIcon(component.type);

        const header = document.createElement('div');
        header.className = 'es-component-header es-collapsible-header';
        header.innerHTML = `
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icon}</span>
            <span class="es-component-title">${component.type}</span>
            <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
        `;

        const removeBtn = header.querySelector('.es-btn-remove');
        removeBtn?.addEventListener('click', () => {
            this.store_.removeComponent(entity, component.type);
        });

        header.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
            section.classList.toggle('es-expanded');
        });

        section.appendChild(header);

        const schema = getComponentSchema(component.type);
        if (schema) {
            const propsContainer = document.createElement('div');
            propsContainer.className = 'es-component-properties es-collapsible-content';

            for (const propMeta of schema.properties) {
                const row = document.createElement('div');
                row.className = 'es-property-row';

                const label = document.createElement('label');
                label.className = 'es-property-label';
                label.textContent = propMeta.name;

                const editorContainer = document.createElement('div');
                editorContainer.className = 'es-property-editor';

                const currentValue = component.data[propMeta.name];
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
                const value = component.data[info.propertyName];
                info.editor.update(value);
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

        this.renderAssetHeader(asset);

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
            const editor = (window as any).__esengine_editor;
            if (editor && typeof editor.openSceneFromPath === 'function') {
                editor.openSceneFromPath(path);
            }
        });

        this.contentContainer_.appendChild(actionsWrapper);
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
