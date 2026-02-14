/**
 * @file    InspectorHelpers.ts
 * @brief   Shared helper functions and context type for inspector sub-modules
 */

import type { EditorStore, AssetType } from '../../store/EditorStore';
import type { PropertyEditorInstance } from '../../property/PropertyEditor';
import type { EditorAssetServer } from '../../asset/EditorAssetServer';
import type { NativeFS } from '../../types/NativeFS';
import { getAssetMimeType } from 'esengine';
import { getEditorContext, getEditorInstance } from '../../context/EditorContext';
import { icons } from '../../utils/icons';

// =============================================================================
// Types
// =============================================================================

export interface EditorInfo {
    editor: PropertyEditorInstance;
    componentType: string;
    propertyName: string;
}

export interface InspectorHelperContext {
    store: EditorStore;
    contentContainer: HTMLElement;
    editors: EditorInfo[];
    getProjectDir(): string | null;
    getAssetServer(): EditorAssetServer | null;
    escapeHtml(text: string): string;
    openAssetInBrowser(assetPath: string): void;
    renderError(message: string): void;
}

// =============================================================================
// Helpers
// =============================================================================

export function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

export function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
}

export function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.substring(dotIndex).toLowerCase() : '';
}

export function getMimeType(ext: string): string {
    const clean = ext.startsWith('.') ? ext.slice(1) : ext;
    return getAssetMimeType(clean) ?? 'application/octet-stream';
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(date: Date | null): string {
    if (!date) return 'Unknown';
    return date.toLocaleString();
}

export function getAssetIcon(type: AssetType, size: number = 16): string {
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

export function getAssetTypeName(type: AssetType): string {
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

export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function getProjectDir(): string | null {
    const editor = getEditorInstance();
    const projectPath = editor?.projectPath;
    if (!projectPath) return null;
    return projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
}

export function openAssetInBrowser(assetPath: string): void {
    const editor = getEditorInstance();
    if (editor && typeof editor.navigateToAsset === 'function') {
        editor.navigateToAsset(assetPath);
    }
}

export function getAssetServer(): EditorAssetServer | null {
    const editor = getEditorInstance();
    return editor?.assetServer ?? null;
}

export function getComponentIcon(type: string): string {
    switch (type) {
        case 'LocalTransform':
        case 'WorldTransform':
            return icons.move(14);
        case 'Sprite':
            return icons.image(14);
        case 'Camera':
            return icons.camera(14);
        case 'Text':
        case 'TextInput':
            return icons.type(14);
        default:
            return icons.settings(14);
    }
}

export function renderError(container: HTMLElement, message: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'es-asset-preview-error';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
}
