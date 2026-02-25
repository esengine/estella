/**
 * @file    ImageInspector.ts
 * @brief   Image asset inspector with preview and nine-slice editing
 */

import { icons } from '../../utils/icons';
import { getNativeFS, getFileName, getFileExtension, getMimeType, formatFileSize, formatDate, renderError } from './InspectorHelpers';

export interface ImageUrlRef {
    current: string | null;
}

export async function renderImageInspector(container: HTMLElement, path: string, imageUrlRef: ImageUrlRef): Promise<void> {
    const fs = getNativeFS();
    if (!fs) {
        renderError(container, 'File system not available');
        return;
    }

    const previewSection = document.createElement('div');
    previewSection.className = 'es-asset-preview-section';
    previewSection.innerHTML = '<div class="es-asset-preview-loading">Loading...</div>';
    container.appendChild(previewSection);

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
        imageUrlRef.current = url;

        previewSection.innerHTML = `
            <div class="es-image-preview-container">
                <img class="es-image-preview" src="${url}" alt="${getFileName(path)}">
            </div>
        `;

        const img = previewSection.querySelector('.es-image-preview') as HTMLImageElement;
        img.onload = async () => {
            await renderImageMetadata(container, path, img.naturalWidth, img.naturalHeight);
        };
    } catch (err) {
        console.error('Failed to load image:', err);
        previewSection.innerHTML = '<div class="es-asset-preview-error">Failed to load image</div>';
    }
}

async function renderImageMetadata(container: HTMLElement, path: string, width: number, height: number): Promise<void> {
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

    container.appendChild(section);
}

