import { registerSettingsSection, registerSettingsItem } from './SettingsRegistry';

export function registerBuiltinSettings(): void {
    registerSettingsSection({
        id: 'general',
        title: 'General',
        order: 0,
    });

    registerSettingsSection({
        id: 'scene-view',
        title: 'Scene View',
        order: 1,
    });

    registerSettingsSection({
        id: 'project',
        title: 'Project',
        order: 2,
    });

    registerSettingsItem({
        id: 'project.spineVersion',
        section: 'project',
        label: 'Spine Version',
        type: 'select',
        defaultValue: '4.2',
        order: 0,
        options: [
            { label: 'Spine 4.2', value: '4.2' },
            { label: 'Spine 3.8', value: '3.8' },
        ],
    });

    registerSettingsItem({
        id: 'general.language',
        section: 'general',
        label: 'Language',
        type: 'select',
        defaultValue: 'en',
        order: 0,
        options: [
            { label: 'English', value: 'en' },
        ],
    });

    registerSettingsItem({
        id: 'scene.showGrid',
        section: 'scene-view',
        label: 'Show Grid',
        type: 'boolean',
        defaultValue: true,
        order: 0,
    });

    registerSettingsItem({
        id: 'scene.gridColor',
        section: 'scene-view',
        label: 'Grid Color',
        type: 'color',
        defaultValue: '#333333',
        order: 1,
    });

    registerSettingsItem({
        id: 'scene.gridOpacity',
        section: 'scene-view',
        label: 'Grid Opacity',
        type: 'range',
        defaultValue: 1.0,
        min: 0,
        max: 1,
        step: 0.1,
        order: 2,
    });

    registerSettingsItem({
        id: 'scene.showGizmos',
        section: 'scene-view',
        label: 'Show Gizmos',
        type: 'boolean',
        defaultValue: true,
        order: 3,
    });

    registerSettingsItem({
        id: 'scene.showSelectionBox',
        section: 'scene-view',
        label: 'Show Selection Box',
        type: 'boolean',
        defaultValue: true,
        order: 4,
    });
}
