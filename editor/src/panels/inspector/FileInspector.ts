/**
 * @file    FileInspector.ts
 * @brief   Script, scene, and generic file inspectors
 */

import type { AssetType } from '../../store/EditorStore';
import { icons } from '../../utils/icons';
import { getEditorInstance } from '../../context/EditorContext';
import { getNativeFS, getFileExtension, formatFileSize, formatDate, getAssetTypeName, escapeHtml, renderError } from './InspectorHelpers';

export async function renderScriptInspector(container: HTMLElement, path: string): Promise<void> {
    const fs = getNativeFS();
    if (!fs) {
        renderError(container, 'File system not available');
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

    container.appendChild(propsSection);

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
                <pre class="es-code-preview">${escapeHtml(previewContent)}</pre>
            </div>
        `;

        const header2 = previewSection.querySelector('.es-collapsible-header');
        header2?.addEventListener('click', () => {
            previewSection.classList.toggle('es-expanded');
        });

        container.appendChild(previewSection);
    }
}

export async function renderSceneInspector(container: HTMLElement, path: string): Promise<void> {
    const fs = getNativeFS();
    if (!fs) {
        renderError(container, 'File system not available');
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

    container.appendChild(propsSection);

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

    container.appendChild(actionsWrapper);
}

export async function renderFileInspector(container: HTMLElement, path: string, type: AssetType): Promise<void> {
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

    container.appendChild(propsSection);
}
