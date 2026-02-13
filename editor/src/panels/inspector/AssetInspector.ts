/**
 * @file    AssetInspector.ts
 * @brief   Asset inspector header, routing, and addressable section
 */

import type { AssetSelection, AssetType } from '../../store/EditorStore';
import { getAssetDatabase } from '../../asset/AssetDatabase';
import { icons } from '../../utils/icons';
import { escapeHtml, getAssetIcon, getProjectDir } from './InspectorHelpers';

export function renderAssetHeader(container: HTMLElement, asset: AssetSelection): void {
    const header = document.createElement('div');
    header.className = 'es-inspector-asset-header';
    header.innerHTML = `
        <span class="es-asset-header-icon">${getAssetIcon(asset.type, 20)}</span>
        <span class="es-asset-header-name">${escapeHtml(asset.name)}</span>
    `;
    container.appendChild(header);
}

export function resolveAssetEntry(assetPath: string) {
    const db = getAssetDatabase();
    const projectDir = getProjectDir();

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

export function renderAddressableSection(container: HTMLElement, assetPath: string): void {
    const db = getAssetDatabase();

    const entry = resolveAssetEntry(assetPath);
    if (!entry) return;

    const groupService = db.getGroupService();
    const groups = groupService?.groups ?? [];
    const allLabels = groupService?.allLabels ?? [];

    const groupOptions = groups.map(g =>
        `<option value="${escapeHtml(g.name)}"${g.name === entry.group ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
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
                <input type="checkbox" data-label="${escapeHtml(l)}" ${checked ? 'checked' : ''} />
                <span>${escapeHtml(l)}</span>
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
                    <input type="text" class="es-input es-addr-inspector-address" value="${escapeHtml(entry.address ?? '')}" placeholder="Logical address" />
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

    container.appendChild(section);
}
