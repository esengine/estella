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

    registerSettingsSection({
        id: 'physics',
        title: 'Physics',
        order: 3,
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
        defaultValue: 'none',
        order: 0,
        options: [
            { label: 'None', value: 'none' },
            { label: 'Spine 4.2', value: '4.2' },
            { label: 'Spine 4.1', value: '4.1' },
            { label: 'Spine 3.8', value: '3.8' },
        ],
    });

    registerSettingsItem({
        id: 'project.enablePhysics',
        section: 'physics',
        label: 'Enable Physics',
        type: 'boolean',
        defaultValue: false,
        order: 0,
    });

    registerSettingsItem({
        id: 'physics.gravityX',
        section: 'physics',
        label: 'Gravity X',
        type: 'number',
        defaultValue: 0,
        step: 0.1,
        order: 1,
    });

    registerSettingsItem({
        id: 'physics.gravityY',
        section: 'physics',
        label: 'Gravity Y',
        type: 'number',
        defaultValue: -9.81,
        step: 0.1,
        order: 2,
    });

    registerSettingsItem({
        id: 'physics.fixedTimestep',
        section: 'physics',
        label: 'Fixed Timestep',
        type: 'number',
        defaultValue: 1 / 60,
        step: 0.001,
        min: 0.001,
        order: 3,
    });

    registerSettingsItem({
        id: 'physics.subStepCount',
        section: 'physics',
        label: 'Sub-Step Count',
        type: 'number',
        defaultValue: 4,
        step: 1,
        min: 1,
        max: 16,
        order: 4,
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

    registerSettingsItem({
        id: 'scene.showColliders',
        section: 'scene-view',
        label: 'Show Colliders',
        type: 'boolean',
        defaultValue: true,
        order: 5,
    });

    registerSettingsItem({
        id: 'scene.showStats',
        section: 'scene-view',
        label: 'Show Stats',
        type: 'boolean',
        defaultValue: false,
        order: 6,
    });
}
