/**
 * @file    ImageInspector.ts
 * @brief   Image asset inspector with preview and nine-slice editing
 */

import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import {
    type SliceBorder,
    type TextureMetadata,
    getMetaFilePath,
    parseTextureMetadata,
    serializeTextureMetadata,
    createDefaultTextureMetadata,
} from '../../types/TextureMetadata';
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
            await renderNineSliceSection(container, path, img.naturalWidth, img.naturalHeight, imageUrlRef);
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

async function renderNineSliceSection(
    container: HTMLElement,
    path: string,
    texWidth: number,
    texHeight: number,
    imageUrlRef: ImageUrlRef
): Promise<void> {
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
                    <img class="es-nine-slice-image" src="${imageUrlRef.current || ''}">
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
        const newBorder: SliceBorder = {
            left: parseFloat(leftInput.value) || 0,
            right: parseFloat(rightInput.value) || 0,
            top: parseFloat(topInput.value) || 0,
            bottom: parseFloat(bottomInput.value) || 0,
        };

        metadata.sliceBorder = newBorder;

        try {
            const json = serializeTextureMetadata(metadata);
            await platform.writeTextFile(metaPath, json);
        } catch (err) {
            console.error('Failed to save texture metadata:', err);
        }
    };

    leftInput.addEventListener('input', updateLines);
    rightInput.addEventListener('input', updateLines);
    topInput.addEventListener('input', updateLines);
    bottomInput.addEventListener('input', updateLines);
    leftInput.addEventListener('change', saveMetadata);
    rightInput.addEventListener('change', saveMetadata);
    topInput.addEventListener('change', saveMetadata);
    bottomInput.addEventListener('change', saveMetadata);

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

    const img = section.querySelector('.es-nine-slice-image') as HTMLImageElement;
    if (img.complete) {
        setTimeout(updateLines, 0);
    } else {
        img.onload = updateLines;
    }

    const resizeObserver = new ResizeObserver(updateLines);
    resizeObserver.observe(preview);

    container.appendChild(section);
}
