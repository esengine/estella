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
        id: 'project.name',
        section: 'project',
        label: 'Project Name',
        type: 'string',
        defaultValue: '',
        order: 1,
    });

    registerSettingsItem({
        id: 'project.version',
        section: 'project',
        label: 'Version',
        type: 'string',
        defaultValue: '',
        order: 2,
    });

    registerSettingsItem({
        id: 'project.defaultScene',
        section: 'project',
        label: 'Default Scene',
        type: 'string',
        defaultValue: '',
        order: 3,
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
        id: 'project.enablePhysics',
        section: 'project',
        label: 'Enable Physics',
        type: 'boolean',
        defaultValue: false,
        order: 0.5,
    });

    registerSettingsItem({
        id: 'project.designWidth',
        section: 'project',
        label: 'Design Width',
        type: 'number',
        defaultValue: 1920,
        min: 1,
        step: 1,
        order: 4,
    });

    registerSettingsItem({
        id: 'project.designHeight',
        section: 'project',
        label: 'Design Height',
        type: 'number',
        defaultValue: 1080,
        min: 1,
        step: 1,
        order: 5,
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
