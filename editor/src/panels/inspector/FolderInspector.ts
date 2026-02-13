/**
 * @file    FolderInspector.ts
 * @brief   Folder asset inspector with export settings
 */

import { icons } from '../../utils/icons';
import { AssetExportConfigService, type FolderExportMode } from '../../builder/AssetCollector';
import { getNativeFS, getProjectDir, escapeHtml } from './InspectorHelpers';

export async function renderFolderInspector(container: HTMLElement, path: string): Promise<void> {
    const fs = getNativeFS();
    const projectDir = getProjectDir();
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

    container.appendChild(exportSection);

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
                <div class="es-property-value">${escapeHtml(relativePath)}</div>
            </div>
        </div>
    `;

    const propsHeader = propsSection.querySelector('.es-collapsible-header');
    propsHeader?.addEventListener('click', () => {
        propsSection.classList.toggle('es-expanded');
    });

    container.appendChild(propsSection);
}
