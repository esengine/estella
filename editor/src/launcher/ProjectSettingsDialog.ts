/**
 * @file    ProjectSettingsDialog.ts
 * @brief   Project settings dialog for editing .esproject config
 */

import { Dialog } from '../ui/dialog/Dialog';
import { loadProjectConfig } from './ProjectService';
import type { ProjectConfig, SpineVersion } from '../types/ProjectTypes';
import { getEditorContext } from '../context/EditorContext';

export interface ProjectSettingsDialogOptions {
    projectPath: string;
    onConfigChanged?: (config: ProjectConfig) => void;
}

async function saveProjectConfig(
    projectPath: string,
    config: ProjectConfig,
): Promise<boolean> {
    const fs = getEditorContext().fs;
    if (!fs) return false;
    config.modified = new Date().toISOString();
    return await fs.writeFile(projectPath, JSON.stringify(config, null, 2));
}

export async function showProjectSettingsDialog(
    options: ProjectSettingsDialogOptions,
): Promise<void> {
    const config = await loadProjectConfig(options.projectPath);
    if (!config) return;

    const body = document.createElement('div');
    body.style.padding = '16px';

    function addField(label: string, input: HTMLElement): void {
        const row = document.createElement('div');
        row.className = 'es-build-field';
        const lbl = document.createElement('label');
        lbl.className = 'es-build-label';
        lbl.textContent = label;
        row.appendChild(lbl);
        row.appendChild(input);
        body.appendChild(row);
    }

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'es-input';
    nameInput.value = config.name;
    addField('Project Name', nameInput);

    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.className = 'es-input';
    versionInput.value = config.version;
    addField('Version', versionInput);

    const sceneInput = document.createElement('input');
    sceneInput.type = 'text';
    sceneInput.className = 'es-input';
    sceneInput.value = config.defaultScene;
    addField('Default Scene', sceneInput);

    const spineSelect = document.createElement('select');
    spineSelect.className = 'es-select';
    for (const v of ['4.2', '3.8'] as const) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = `Spine ${v}`;
        if ((config.spineVersion ?? '4.2') === v) opt.selected = true;
        spineSelect.appendChild(opt);
    }
    addField('Spine Version', spineSelect);

    const dialog = new Dialog({
        title: 'Project Settings',
        content: body,
        width: 420,
        showCloseButton: true,
        closeOnOverlay: true,
        closeOnEscape: true,
        buttons: [
            { label: 'Cancel', role: 'cancel' },
            { label: 'Save', role: 'confirm', primary: true },
        ],
    });

    const result = await dialog.open();
    if (result.action === 'confirm') {
        config.name = nameInput.value.trim() || config.name;
        config.version = versionInput.value.trim() || config.version;
        config.defaultScene = sceneInput.value.trim() || config.defaultScene;
        config.spineVersion = spineSelect.value as SpineVersion;
        await saveProjectConfig(options.projectPath, config);
        options.onConfigChanged?.(config);
    }
}
