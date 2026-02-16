import { registerSettingsSection, registerSettingsItem } from './SettingsRegistry';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT } from 'esengine';

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

    registerSettingsSection({
        id: 'build',
        title: 'Build',
        order: 4,
    });

    registerSettingsSection({
        id: 'runtime',
        title: 'Runtime',
        order: 5,
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
        defaultValue: DEFAULT_DESIGN_WIDTH,
        min: 1,
        step: 1,
        order: 4,
    });

    registerSettingsItem({
        id: 'project.designHeight',
        section: 'project',
        label: 'Design Height',
        type: 'number',
        defaultValue: DEFAULT_DESIGN_HEIGHT,
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

    registerSettingsItem({
        id: 'scene.gridSize',
        section: 'scene-view',
        label: 'Grid Size',
        type: 'number',
        defaultValue: 50,
        min: 5,
        max: 500,
        step: 5,
        order: 7,
    });

    registerSettingsItem({
        id: 'general.previewPort',
        section: 'general',
        label: 'Preview Port',
        type: 'number',
        defaultValue: 3456,
        min: 1024,
        max: 65535,
        step: 1,
        order: 1,
    });

    registerSettingsItem({
        id: 'build.atlasMaxSize',
        section: 'build',
        label: 'Atlas Max Size',
        type: 'select',
        defaultValue: '2048',
        order: 0,
        options: [
            { label: '512', value: '512' },
            { label: '1024', value: '1024' },
            { label: '2048', value: '2048' },
            { label: '4096', value: '4096' },
        ],
    });

    registerSettingsItem({
        id: 'build.atlasPadding',
        section: 'build',
        label: 'Atlas Padding',
        type: 'number',
        defaultValue: 2,
        min: 0,
        max: 16,
        step: 1,
        order: 1,
    });

    registerSettingsItem({
        id: 'runtime.sceneTransitionDuration',
        section: 'runtime',
        label: 'Scene Transition Duration',
        type: 'number',
        defaultValue: 0.3,
        min: 0,
        max: 5,
        step: 0.1,
        order: 0,
    });

    registerSettingsItem({
        id: 'runtime.sceneTransitionColor',
        section: 'runtime',
        label: 'Scene Transition Color',
        type: 'color',
        defaultValue: '#000000',
        order: 1,
    });

    registerSettingsItem({
        id: 'runtime.defaultFontFamily',
        section: 'runtime',
        label: 'Default Font Family',
        type: 'string',
        defaultValue: 'Arial',
        order: 2,
    });

    registerSettingsItem({
        id: 'runtime.canvasScaleMode',
        section: 'runtime',
        label: 'Canvas Scale Mode',
        type: 'select',
        defaultValue: 'FixedHeight',
        order: 3,
        options: [
            { label: 'Fixed Width', value: 'FixedWidth' },
            { label: 'Fixed Height', value: 'FixedHeight' },
            { label: 'Expand', value: 'Expand' },
            { label: 'Shrink', value: 'Shrink' },
            { label: 'Match', value: 'Match' },
        ],
    });

    registerSettingsItem({
        id: 'runtime.canvasMatchWidthOrHeight',
        section: 'runtime',
        label: 'Canvas Match W/H',
        type: 'range',
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.1,
        order: 4,
    });

    registerSettingsItem({
        id: 'runtime.maxDeltaTime',
        section: 'runtime',
        label: 'Max Delta Time',
        type: 'number',
        defaultValue: 0.25,
        min: 0.01,
        max: 1,
        step: 0.01,
        order: 5,
    });

    registerSettingsItem({
        id: 'runtime.maxFixedSteps',
        section: 'runtime',
        label: 'Max Fixed Steps',
        type: 'number',
        defaultValue: 8,
        min: 1,
        max: 64,
        step: 1,
        order: 6,
    });

    registerSettingsItem({
        id: 'runtime.textCanvasSize',
        section: 'runtime',
        label: 'Text Canvas Size',
        type: 'select',
        defaultValue: '512',
        order: 7,
        options: [
            { label: '256', value: '256' },
            { label: '512', value: '512' },
            { label: '1024', value: '1024' },
            { label: '2048', value: '2048' },
        ],
    });
}
