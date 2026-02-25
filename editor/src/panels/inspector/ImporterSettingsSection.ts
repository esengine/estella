/**
 * @file    ImporterSettingsSection.ts
 * @brief   Generic importer settings UI driven by ImporterRegistry.settingsUI()
 */

import { getAssetDatabase } from '../../asset/AssetDatabase';
import { getImporterRegistry } from '../../asset/ImporterRegistry';
import type { ImporterField } from '../../asset/ImporterRegistry';
import { type ImporterData, IMPORTER_PLATFORMS } from '../../asset/ImporterTypes';
import { icons } from '../../utils/icons';
import { resolveAssetEntry } from './AssetInspector';
import { escapeHtml, getNativeFS, getFileExtension, getMimeType } from './InspectorHelpers';

export function renderImporterSettingsSection(container: HTMLElement, assetPath: string): void {
    const entry = resolveAssetEntry(assetPath);
    if (!entry) return;

    const registry = getImporterRegistry();
    const fields = registry.getSettingsUI(entry.type, entry.importer);
    if (fields.length === 0) return;

    const section = document.createElement('div');
    section.className = 'es-component-section es-collapsible es-expanded';
    section.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.settings(14)}</span>
            <span class="es-component-title">Import Settings</span>
        </div>
        <div class="es-component-properties es-collapsible-content"></div>
    `;

    const header = section.querySelector('.es-collapsible-header')!;
    header.addEventListener('click', () => {
        section.classList.toggle('es-expanded');
    });

    const content = section.querySelector('.es-collapsible-content') as HTMLElement;

    const tabBar = buildPlatformTabBar(content, entry.uuid, entry.importer, entry.platformOverrides, assetPath, entry.type);
    content.appendChild(tabBar);

    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'es-importer-fields';
    content.appendChild(fieldsContainer);

    renderFieldsForPlatform(fieldsContainer, entry.uuid, entry.type, entry.importer, null, assetPath);

    container.appendChild(section);
}

function buildPlatformTabBar(
    parent: HTMLElement,
    uuid: string,
    baseImporter: ImporterData,
    platformOverrides: Record<string, ImporterData>,
    assetPath: string,
    assetType: string,
): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'es-platform-tabs';

    const tabs = [
        { id: '', label: 'Default' },
        ...IMPORTER_PLATFORMS,
    ];

    let activeId = '';

    for (const tab of tabs) {
        const btn = document.createElement('button');
        btn.className = 'es-platform-tab' + (tab.id === '' ? ' es-active' : '');
        btn.textContent = tab.label;

        if (tab.id !== '' && platformOverrides[tab.id] && Object.keys(platformOverrides[tab.id]).length > 0) {
            btn.classList.add('es-has-override');
        }

        btn.addEventListener('click', () => {
            activeId = tab.id;
            bar.querySelectorAll('.es-platform-tab').forEach(b => b.classList.remove('es-active'));
            btn.classList.add('es-active');

            const fieldsContainer = parent.querySelector('.es-importer-fields') as HTMLElement;
            if (!fieldsContainer) return;

            const latestEntry = resolveAssetEntry(assetPath);
            if (!latestEntry) return;

            const platformData = tab.id ? (latestEntry.platformOverrides[tab.id] ?? null) : null;
            renderFieldsForPlatform(fieldsContainer, uuid, assetType, latestEntry.importer, platformData, assetPath, tab.id || undefined);
        });
        bar.appendChild(btn);
    }

    return bar;
}

function renderFieldsForPlatform(
    container: HTMLElement,
    uuid: string,
    assetType: string,
    baseImporter: ImporterData,
    platformData: ImporterData | null,
    assetPath: string,
    platformId?: string,
): void {
    container.innerHTML = '';
    const registry = getImporterRegistry();

    if (!platformId) {
        const fields = registry.getSettingsUI(assetType, baseImporter);
        for (const field of fields) {
            container.appendChild(renderField(field, uuid, baseImporter, assetPath));
        }
        return;
    }

    const merged = { ...baseImporter, ...(platformData ?? {}) };
    const fields = registry.getSettingsUI(assetType, merged);

    for (const field of fields) {
        const isOverridden = platformData != null && field.name in platformData;
        const row = renderPlatformField(field, uuid, baseImporter, platformData ?? {}, platformId, isOverridden, assetPath);
        container.appendChild(row);
    }
}

function renderField(field: ImporterField, uuid: string, importer: ImporterData, assetPath: string): HTMLElement {
    switch (field.type) {
        case 'boolean':
            return renderBooleanField(field, uuid, importer);
        case 'select':
            return renderSelectField(field, uuid, importer);
        case 'number':
            return renderNumberField(field, uuid, importer);
        case 'slider':
            return renderSliderField(field, uuid, importer);
        case 'sliceBorder':
            return renderSliceBorderField(field, uuid, importer, assetPath);
        default:
            return renderNumberField(field, uuid, importer);
    }
}

function saveField(uuid: string, importer: ImporterData, name: string, value: unknown): void {
    const updated = { ...importer, [name]: value };
    getAssetDatabase().updateMeta(uuid, { importer: updated });
}

function savePlatformField(uuid: string, platformId: string, overrideData: ImporterData, name: string, value: unknown): void {
    const entry = getAssetDatabase().getEntry(uuid);
    if (!entry) return;
    const overrides = { ...entry.platformOverrides };
    overrides[platformId] = { ...(overrides[platformId] ?? {}), ...overrideData, [name]: value };
    getAssetDatabase().updateMeta(uuid, { platformOverrides: overrides });
}

function removePlatformField(uuid: string, platformId: string, name: string): void {
    const entry = getAssetDatabase().getEntry(uuid);
    if (!entry) return;
    const overrides = { ...entry.platformOverrides };
    const platformData = { ...(overrides[platformId] ?? {}) };
    delete platformData[name];
    if (Object.keys(platformData).length === 0) {
        delete overrides[platformId];
    } else {
        overrides[platformId] = platformData;
    }
    getAssetDatabase().updateMeta(uuid, { platformOverrides: overrides });
}

function renderPlatformField(
    field: ImporterField,
    uuid: string,
    baseImporter: ImporterData,
    overrideData: ImporterData,
    platformId: string,
    isOverridden: boolean,
    assetPath: string,
): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-platform-field' + (isOverridden ? ' es-overridden' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'es-override-toggle';
    checkbox.checked = isOverridden;
    checkbox.title = isOverridden ? 'Remove override' : 'Override for this platform';
    wrapper.appendChild(checkbox);

    const fieldContainer = document.createElement('div');
    fieldContainer.className = 'es-platform-field-content';
    fieldContainer.style.flex = '1';
    wrapper.appendChild(fieldContainer);

    const renderInner = (active: boolean) => {
        fieldContainer.innerHTML = '';
        if (active) {
            const overrideImporter = { ...baseImporter, ...overrideData };
            const overrideField = { ...field, value: overrideImporter[field.name] ?? field.value };
            const el = renderField(overrideField, uuid, overrideImporter, assetPath);
            fieldContainer.appendChild(el);

            const inputs = el.querySelectorAll('input, select');
            inputs.forEach(input => {
                input.addEventListener('change', () => {
                    let value: unknown;
                    const inputEl = input as HTMLInputElement;
                    if (inputEl.type === 'checkbox') {
                        value = inputEl.checked;
                    } else if (inputEl.type === 'number' || inputEl.type === 'range') {
                        value = parseFloat(inputEl.value);
                    } else if (inputEl.tagName === 'SELECT') {
                        const selectEl = input as HTMLSelectElement;
                        const numVal = parseFloat(selectEl.value);
                        value = isNaN(numVal) ? selectEl.value : numVal;
                    } else {
                        value = inputEl.value;
                    }
                    savePlatformField(uuid, platformId, overrideData, field.name, value);
                });
            });
        } else {
            const defaultField = { ...field, value: baseImporter[field.name] ?? field.value };
            const el = renderField(defaultField, uuid, baseImporter, assetPath);
            el.style.opacity = '0.5';
            el.style.pointerEvents = 'none';
            fieldContainer.appendChild(el);
        }
    };

    renderInner(isOverridden);

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            savePlatformField(uuid, platformId, overrideData, field.name, baseImporter[field.name] ?? field.value);
            wrapper.classList.add('es-overridden');
            renderInner(true);
        } else {
            removePlatformField(uuid, platformId, field.name);
            wrapper.classList.remove('es-overridden');
            renderInner(false);
        }
    });

    return wrapper;
}

function renderBooleanField(field: ImporterField, uuid: string, importer: ImporterData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'es-property-row';
    row.innerHTML = `
        <label class="es-property-label">${escapeHtml(field.label)}</label>
        <div class="es-property-editor">
            <input type="checkbox" class="es-checkbox" ${field.value ? 'checked' : ''}>
        </div>
    `;
    const input = row.querySelector('input')!;
    input.addEventListener('change', () => {
        saveField(uuid, importer, field.name, input.checked);
    });
    return row;
}

function renderSelectField(field: ImporterField, uuid: string, importer: ImporterData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'es-property-row';
    const optionsHtml = (field.options ?? []).map(o =>
        `<option value="${escapeHtml(String(o.value))}"${o.value === field.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    row.innerHTML = `
        <label class="es-property-label">${escapeHtml(field.label)}</label>
        <div class="es-property-editor">
            <select class="es-input">${optionsHtml}</select>
        </div>
    `;
    const select = row.querySelector('select')!;
    select.addEventListener('change', () => {
        const opt = field.options?.find(o => String(o.value) === select.value);
        saveField(uuid, importer, field.name, opt ? opt.value : select.value);
    });
    return row;
}

function renderNumberField(field: ImporterField, uuid: string, importer: ImporterData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'es-property-row';
    row.innerHTML = `
        <label class="es-property-label">${escapeHtml(field.label)}</label>
        <div class="es-property-editor">
            <input type="number" class="es-input es-input-number"
                value="${field.value}"
                ${field.min !== undefined ? `min="${field.min}"` : ''}
                ${field.max !== undefined ? `max="${field.max}"` : ''}
                ${field.step !== undefined ? `step="${field.step}"` : ''}>
        </div>
    `;
    const input = row.querySelector('input')!;
    input.addEventListener('change', () => {
        saveField(uuid, importer, field.name, parseFloat(input.value));
    });
    return row;
}

function renderSliderField(field: ImporterField, uuid: string, importer: ImporterData): HTMLElement {
    const row = document.createElement('div');
    row.className = 'es-property-row';
    row.innerHTML = `
        <label class="es-property-label">${escapeHtml(field.label)}</label>
        <div class="es-property-editor es-slider-editor">
            <input type="range" class="es-slider"
                value="${field.value}"
                min="${field.min ?? 0}" max="${field.max ?? 1}" step="${field.step ?? 0.01}">
            <span class="es-slider-value">${field.value}</span>
        </div>
    `;
    const slider = row.querySelector('input')!;
    const valueLabel = row.querySelector('.es-slider-value')!;
    slider.addEventListener('input', () => {
        valueLabel.textContent = slider.value;
    });
    slider.addEventListener('change', () => {
        saveField(uuid, importer, field.name, parseFloat(slider.value));
    });
    return row;
}

// =============================================================================
// Nine-Slice Visual Editor
// =============================================================================

type SliceSide = 'left' | 'right' | 'top' | 'bottom';

interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

function renderSliceBorderField(field: ImporterField, uuid: string, importer: ImporterData, assetPath: string): HTMLElement {
    const border = { ...(field.value as SliceBorder) };
    const editor = document.createElement('div');
    editor.className = 'es-nine-slice-editor';

    editor.innerHTML = `
        <div class="es-nine-slice-preview">
            <div class="es-nine-slice-loading">Loading...</div>
            <div class="es-nine-slice-line es-nine-slice-left"></div>
            <div class="es-nine-slice-line es-nine-slice-right"></div>
            <div class="es-nine-slice-line es-nine-slice-top"></div>
            <div class="es-nine-slice-line es-nine-slice-bottom"></div>
        </div>
        <div class="es-nine-slice-inputs">
            <div class="es-property-row">
                <label class="es-property-label">Left</label>
                <div class="es-property-editor">
                    <input type="number" class="es-input es-input-number es-slice-left" value="${border.left}" min="0" step="1">
                </div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Right</label>
                <div class="es-property-editor">
                    <input type="number" class="es-input es-input-number es-slice-right" value="${border.right}" min="0" step="1">
                </div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Top</label>
                <div class="es-property-editor">
                    <input type="number" class="es-input es-input-number es-slice-top" value="${border.top}" min="0" step="1">
                </div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Bottom</label>
                <div class="es-property-editor">
                    <input type="number" class="es-input es-input-number es-slice-bottom" value="${border.bottom}" min="0" step="1">
                </div>
            </div>
        </div>
    `;

    const preview = editor.querySelector('.es-nine-slice-preview') as HTMLElement;
    const lines = {
        left: editor.querySelector('.es-nine-slice-left') as HTMLElement,
        right: editor.querySelector('.es-nine-slice-right') as HTMLElement,
        top: editor.querySelector('.es-nine-slice-top') as HTMLElement,
        bottom: editor.querySelector('.es-nine-slice-bottom') as HTMLElement,
    };
    const inputs = {
        left: editor.querySelector('.es-slice-left') as HTMLInputElement,
        right: editor.querySelector('.es-slice-right') as HTMLInputElement,
        top: editor.querySelector('.es-slice-top') as HTMLInputElement,
        bottom: editor.querySelector('.es-slice-bottom') as HTMLInputElement,
    };

    let imageWidth = 0;
    let imageHeight = 0;
    let objectUrl: string | null = null;

    const updateLinePositions = () => {
        if (imageWidth === 0 || imageHeight === 0) return;
        lines.left.style.left = `${(border.left / imageWidth) * 100}%`;
        lines.right.style.right = `${(border.right / imageWidth) * 100}%`;
        lines.top.style.top = `${(border.top / imageHeight) * 100}%`;
        lines.bottom.style.bottom = `${(border.bottom / imageHeight) * 100}%`;
    };

    const saveBorder = () => {
        saveField(uuid, importer, field.name, { ...border });
    };

    const updateFromInputs = () => {
        border.left = Math.max(0, parseInt(inputs.left.value) || 0);
        border.right = Math.max(0, parseInt(inputs.right.value) || 0);
        border.top = Math.max(0, parseInt(inputs.top.value) || 0);
        border.bottom = Math.max(0, parseInt(inputs.bottom.value) || 0);
        updateLinePositions();
        saveBorder();
    };

    for (const side of ['left', 'right', 'top', 'bottom'] as SliceSide[]) {
        inputs[side].addEventListener('change', updateFromInputs);
    }

    loadPreviewImage(assetPath).then(result => {
        if (!result) {
            preview.querySelector('.es-nine-slice-loading')!.textContent = 'Preview unavailable';
            return;
        }

        objectUrl = result.url;
        imageWidth = result.width;
        imageHeight = result.height;

        const img = document.createElement('img');
        img.className = 'es-nine-slice-image';
        img.src = result.url;
        preview.insertBefore(img, preview.firstChild);
        preview.querySelector('.es-nine-slice-loading')?.remove();

        inputs.left.max = String(imageWidth);
        inputs.right.max = String(imageWidth);
        inputs.top.max = String(imageHeight);
        inputs.bottom.max = String(imageHeight);

        updateLinePositions();
        setupDragHandlers(preview, lines, border, inputs, imageWidth, imageHeight, saveBorder);
    });

    const cleanup = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node === editor || (node as Element).contains?.(editor)) {
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    cleanup.disconnect();
                    return;
                }
            }
        }
    });
    if (editor.parentElement) {
        cleanup.observe(editor.parentElement, { childList: true });
    } else {
        requestAnimationFrame(() => {
            if (editor.parentElement) {
                cleanup.observe(editor.parentElement, { childList: true });
            }
        });
    }

    return editor;
}

async function loadPreviewImage(assetPath: string): Promise<{ url: string; width: number; height: number } | null> {
    const fs = getNativeFS();
    if (!fs) return null;

    try {
        const data = await fs.readBinaryFile(assetPath);
        if (!data) return null;

        const ext = getFileExtension(assetPath);
        const mimeType = getMimeType(ext);
        const blob = new Blob([new Uint8Array(data).buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        return new Promise<{ url: string; width: number; height: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null!);
            };
            img.src = url;
        });
    } catch {
        return null;
    }
}

function setupDragHandlers(
    preview: HTMLElement,
    lines: Record<SliceSide, HTMLElement>,
    border: SliceBorder,
    inputs: Record<SliceSide, HTMLInputElement>,
    imageWidth: number,
    imageHeight: number,
    onSave: () => void,
): void {
    const sides: SliceSide[] = ['left', 'right', 'top', 'bottom'];

    for (const side of sides) {
        const line = lines[side];
        const isHorizontal = side === 'left' || side === 'right';

        line.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const previewRect = preview.getBoundingClientRect();

            const onMouseMove = (moveEvent: MouseEvent) => {
                let value: number;

                if (isHorizontal) {
                    const relX = moveEvent.clientX - previewRect.left;
                    const ratio = Math.max(0, Math.min(1, relX / previewRect.width));
                    if (side === 'left') {
                        value = Math.round(ratio * imageWidth);
                    } else {
                        value = Math.round((1 - ratio) * imageWidth);
                    }
                } else {
                    const relY = moveEvent.clientY - previewRect.top;
                    const ratio = Math.max(0, Math.min(1, relY / previewRect.height));
                    if (side === 'top') {
                        value = Math.round(ratio * imageHeight);
                    } else {
                        value = Math.round((1 - ratio) * imageHeight);
                    }
                }

                value = Math.max(0, value);
                border[side] = value;
                inputs[side].value = String(value);

                if (isHorizontal) {
                    if (side === 'left') {
                        line.style.left = `${(value / imageWidth) * 100}%`;
                    } else {
                        line.style.right = `${(value / imageWidth) * 100}%`;
                    }
                } else {
                    if (side === 'top') {
                        line.style.top = `${(value / imageHeight) * 100}%`;
                    } else {
                        line.style.bottom = `${(value / imageHeight) * 100}%`;
                    }
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.body.style.cursor = '';
                preview.classList.remove('es-nine-slice-dragging');
                onSave();
            };

            document.body.style.cursor = isHorizontal ? 'ew-resize' : 'ns-resize';
            preview.classList.add('es-nine-slice-dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }
}
