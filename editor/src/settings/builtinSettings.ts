import { registerSettingsSection, registerSettingsGroup, registerSettingsItem, type SettingsItemType } from './SettingsRegistry';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT } from 'esengine';
import { renderCollisionMatrix } from './CollisionMatrixWidget';
import { MAX_COLLISION_LAYERS } from './collisionLayers';

export function registerBuiltinSettings(): void {
    // =========================================================================
    // Sections
    // =========================================================================

    registerSettingsSection({
        id: 'general',
        title: 'General',
        icon: 'settings',
        order: 0,
    });

    registerSettingsSection({
        id: 'scene-view',
        title: 'Scene View',
        icon: 'eye',
        order: 1,
    });

    registerSettingsSection({
        id: 'project',
        title: 'Project',
        icon: 'folder',
        order: 2,
    });

    registerSettingsSection({
        id: 'rendering',
        title: 'Rendering',
        icon: 'image',
        order: 2.5,
    });

    registerSettingsSection({
        id: 'physics',
        title: 'Physics',
        icon: 'zap',
        order: 3,
    });

    registerSettingsSection({
        id: 'build',
        title: 'Build',
        icon: 'package',
        order: 4,
    });

    registerSettingsSection({
        id: 'runtime',
        title: 'Runtime',
        icon: 'play',
        order: 5,
    });

    registerSettingsSection({
        id: 'asset-loading',
        title: 'Asset Loading',
        icon: 'download',
        order: 6.5,
    });

    registerSettingsSection({
        id: 'network',
        title: 'Network',
        icon: 'globe',
        order: 7,
    });

    // =========================================================================
    // Groups
    // =========================================================================

    registerSettingsGroup({
        id: 'scene-view.grid',
        section: 'scene-view',
        label: 'Grid',
        order: 0,
    });

    registerSettingsGroup({
        id: 'scene-view.overlays',
        section: 'scene-view',
        label: 'Overlays',
        order: 1,
    });

    registerSettingsGroup({
        id: 'scene-view.gizmo-appearance',
        section: 'scene-view',
        label: 'Gizmo Appearance',
        order: 2,
        collapsed: true,
    });

    registerSettingsGroup({
        id: 'runtime.canvas',
        section: 'runtime',
        label: 'Canvas',
        order: 0,
    });

    registerSettingsGroup({
        id: 'runtime.timing',
        section: 'runtime',
        label: 'Timing',
        order: 1,
    });

    registerSettingsGroup({
        id: 'runtime.scene-transitions',
        section: 'runtime',
        label: 'Scene Transitions',
        order: 2,
    });

    // =========================================================================
    // General
    // =========================================================================

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

    // =========================================================================
    // Scene View — Grid group
    // =========================================================================

    registerSettingsItem({
        id: 'scene.showGrid',
        section: 'scene-view',
        group: 'scene-view.grid',
        label: 'Show Grid',
        type: 'boolean',
        defaultValue: true,
        order: 0,
    });

    registerSettingsItem({
        id: 'scene.gridColor',
        section: 'scene-view',
        group: 'scene-view.grid',
        label: 'Grid Color',
        type: 'color',
        defaultValue: '#333333',
        order: 1,
    });

    registerSettingsItem({
        id: 'scene.gridOpacity',
        section: 'scene-view',
        group: 'scene-view.grid',
        label: 'Grid Opacity',
        type: 'range',
        defaultValue: 1.0,
        min: 0,
        max: 1,
        step: 0.1,
        order: 2,
    });

    registerSettingsItem({
        id: 'scene.gridSize',
        section: 'scene-view',
        group: 'scene-view.grid',
        label: 'Grid Size',
        type: 'number',
        defaultValue: 50,
        min: 5,
        max: 500,
        step: 5,
        order: 3,
    });

    // =========================================================================
    // Scene View — Overlays group
    // =========================================================================

    registerSettingsItem({
        id: 'scene.showGizmos',
        section: 'scene-view',
        group: 'scene-view.overlays',
        label: 'Show Gizmos',
        type: 'boolean',
        defaultValue: true,
        order: 0,
    });

    registerSettingsItem({
        id: 'scene.showSelectionBox',
        section: 'scene-view',
        group: 'scene-view.overlays',
        label: 'Show Selection Box',
        type: 'boolean',
        defaultValue: true,
        order: 1,
    });

    registerSettingsItem({
        id: 'scene.showColliders',
        section: 'scene-view',
        group: 'scene-view.overlays',
        label: 'Show Colliders',
        type: 'boolean',
        defaultValue: true,
        order: 2,
    });

    registerSettingsItem({
        id: 'scene.showStats',
        section: 'scene-view',
        group: 'scene-view.overlays',
        label: 'Show Stats',
        type: 'boolean',
        defaultValue: false,
        order: 3,
    });

    // =========================================================================
    // Scene View — Gizmo Appearance group
    // =========================================================================

    registerSettingsItem({
        id: 'scene.gizmoColorX',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Color X',
        type: 'color',
        defaultValue: '#e74c3c',
        order: 0,
        tags: ['gizmo', 'color'],
    });

    registerSettingsItem({
        id: 'scene.gizmoColorY',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Color Y',
        type: 'color',
        defaultValue: '#2ecc71',
        order: 1,
        tags: ['gizmo', 'color'],
    });

    registerSettingsItem({
        id: 'scene.gizmoColorXY',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Color XY',
        type: 'color',
        defaultValue: '#f1c40f',
        order: 2,
        tags: ['gizmo', 'color'],
    });

    registerSettingsItem({
        id: 'scene.gizmoColorHover',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Color Hover',
        type: 'color',
        defaultValue: '#ffffff',
        order: 3,
        tags: ['gizmo', 'color'],
    });

    registerSettingsItem({
        id: 'scene.selectionColor',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Selection Color',
        type: 'color',
        defaultValue: '#00aaff',
        order: 4,
        tags: ['gizmo', 'selection'],
    });

    registerSettingsItem({
        id: 'scene.gizmoHandleSize',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Handle Size',
        type: 'number',
        defaultValue: 10,
        min: 4,
        max: 24,
        step: 1,
        order: 5,
        tags: ['gizmo'],
    });

    registerSettingsItem({
        id: 'scene.gizmoSize',
        section: 'scene-view',
        group: 'scene-view.gizmo-appearance',
        label: 'Gizmo Size',
        type: 'number',
        defaultValue: 80,
        min: 40,
        max: 200,
        step: 5,
        order: 6,
        tags: ['gizmo'],
    });

    // =========================================================================
    // Project
    // =========================================================================

    registerSettingsItem({
        id: 'project.spineVersion',
        section: 'project',
        label: 'Spine Version',
        type: 'select',
        defaultValue: 'none',
        order: 0,
        projectSync: true,
        options: [
            { label: 'None', value: 'none' },
            { label: 'Spine 4.2', value: '4.2' },
            { label: 'Spine 4.1', value: '4.1' },
            { label: 'Spine 3.8', value: '3.8' },
        ],
    });

    registerSettingsItem({
        id: 'project.name',
        section: 'project',
        label: 'Project Name',
        type: 'string',
        defaultValue: '',
        order: 1,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'project.version',
        section: 'project',
        label: 'Version',
        type: 'string',
        defaultValue: '',
        order: 2,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'project.defaultScene',
        section: 'project',
        label: 'Default Scene',
        type: 'string',
        defaultValue: '',
        order: 3,
        projectSync: true,
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
        projectSync: true,
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
        projectSync: true,
    });

    registerSettingsItem({
        id: 'project.enablePhysics',
        section: 'physics',
        label: 'Enable Physics',
        type: 'boolean',
        defaultValue: false,
        order: 0,
        projectSync: true,
    });

    // =========================================================================
    // Rendering
    // =========================================================================

    registerSettingsItem({
        id: 'rendering.defaultSpriteWidth',
        section: 'rendering',
        label: 'Default Sprite Width',
        description: 'Default width for new sprites in pixels',
        type: 'number',
        defaultValue: 100,
        min: 1,
        max: 4096,
        step: 1,
        order: 0,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'rendering.defaultSpriteHeight',
        section: 'rendering',
        label: 'Default Sprite Height',
        description: 'Default height for new sprites in pixels',
        type: 'number',
        defaultValue: 100,
        min: 1,
        max: 4096,
        step: 1,
        order: 1,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'rendering.pixelsPerUnit',
        section: 'rendering',
        label: 'Pixels Per Unit',
        description: 'Number of pixels per world unit',
        type: 'number',
        defaultValue: 100,
        min: 1,
        max: 1000,
        step: 1,
        order: 2,
        projectSync: true,
    });

    // =========================================================================
    // Physics
    // =========================================================================

    // =========================================================================
    // Physics — Collision Layers group
    // =========================================================================

    registerSettingsGroup({
        id: 'physics.collision-layers',
        section: 'physics',
        label: 'Collision Layers',
        order: 10,
        collapsed: true,
    });

    registerSettingsGroup({
        id: 'physics.collision-matrix',
        section: 'physics',
        label: 'Collision Matrix',
        order: 11,
    });

    const COLLISION_LAYER_DEFAULTS = [
        'Default', '', '', '', '', '', '', '',
        '', '', '', '', '', '', '', '',
    ];

    for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
        registerSettingsItem({
            id: `physics.layerName${i}`,
            section: 'physics',
            group: 'physics.collision-layers',
            label: `Layer ${i}`,
            type: 'string',
            defaultValue: COLLISION_LAYER_DEFAULTS[i],
            order: i,
            projectSync: true,
            tags: ['collision', 'layer'],
        });

        registerSettingsItem({
            id: `physics.layerMask${i}`,
            section: 'physics',
            label: `Layer ${i} Mask`,
            type: 'number',
            defaultValue: 0xFFFF,
            hidden: true,
            projectSync: true,
        });
    }

    registerSettingsItem({
        id: 'physics.collisionMatrix',
        section: 'physics',
        group: 'physics.collision-matrix',
        label: 'Collision Matrix',
        type: 'custom' as SettingsItemType,
        defaultValue: null,
        render: renderCollisionMatrix,
        tags: ['collision', 'matrix', 'layer'],
    });

    registerSettingsItem({
        id: 'physics.gravityX',
        section: 'physics',
        label: 'Gravity X',
        type: 'number',
        defaultValue: 0,
        step: 0.1,
        order: 1,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.gravityY',
        section: 'physics',
        label: 'Gravity Y',
        type: 'number',
        defaultValue: -9.81,
        step: 0.1,
        order: 2,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.fixedTimestep',
        section: 'physics',
        label: 'Fixed Timestep',
        description: 'Maximum simulation time step in seconds',
        type: 'number',
        defaultValue: 1 / 60,
        step: 0.001,
        min: 0.001,
        order: 3,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.subStepCount',
        section: 'physics',
        label: 'Sub-Step Count',
        description: 'Maximum physics sub-steps per frame',
        type: 'number',
        defaultValue: 4,
        step: 1,
        min: 1,
        max: 16,
        order: 4,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.contactHertz',
        section: 'physics',
        label: 'Contact Hertz',
        description: 'Contact stiffness (cycles/sec). Higher = less overlap but more jitter',
        type: 'number',
        defaultValue: 120,
        step: 10,
        min: 1,
        max: 500,
        order: 5,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.contactDampingRatio',
        section: 'physics',
        label: 'Contact Damping Ratio',
        description: 'Contact bounciness damping. Lower = faster overlap recovery but more energetic',
        type: 'number',
        defaultValue: 10,
        step: 1,
        min: 0.1,
        max: 100,
        order: 6,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'physics.contactSpeed',
        section: 'physics',
        label: 'Contact Speed',
        description: 'Max overlap resolution speed (m/s)',
        type: 'number',
        defaultValue: 10,
        step: 1,
        min: 1,
        max: 100,
        order: 7,
        projectSync: true,
    });

    // =========================================================================
    // Build
    // =========================================================================

    registerSettingsItem({
        id: 'build.atlasMaxSize',
        section: 'build',
        label: 'Atlas Max Size',
        type: 'select',
        defaultValue: '2048',
        order: 0,
        projectSync: true,
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
        projectSync: true,
    });

    // =========================================================================
    // Runtime — Scene Transitions group
    // =========================================================================

    registerSettingsItem({
        id: 'runtime.sceneTransitionDuration',
        section: 'runtime',
        group: 'runtime.scene-transitions',
        label: 'Scene Transition Duration',
        description: 'Fade duration when switching scenes, in seconds',
        type: 'number',
        defaultValue: 0.3,
        min: 0,
        max: 5,
        step: 0.1,
        order: 0,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'runtime.sceneTransitionColor',
        section: 'runtime',
        group: 'runtime.scene-transitions',
        label: 'Scene Transition Color',
        description: 'Background color during scene transitions',
        type: 'color',
        defaultValue: '#000000',
        order: 1,
        projectSync: true,
    });

    // =========================================================================
    // Runtime — ungrouped
    // =========================================================================

    registerSettingsItem({
        id: 'runtime.defaultFontFamily',
        section: 'runtime',
        label: 'Default Font Family',
        description: 'Fallback font used for text rendering',
        type: 'string',
        defaultValue: 'Arial',
        order: 2,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'runtime.textCanvasSize',
        section: 'runtime',
        label: 'Text Canvas Size',
        type: 'select',
        defaultValue: '512',
        order: 3,
        projectSync: true,
        options: [
            { label: '256', value: '256' },
            { label: '512', value: '512' },
            { label: '1024', value: '1024' },
            { label: '2048', value: '2048' },
        ],
    });

    // =========================================================================
    // Runtime — Canvas group
    // =========================================================================

    registerSettingsItem({
        id: 'runtime.canvasScaleMode',
        section: 'runtime',
        group: 'runtime.canvas',
        label: 'Canvas Scale Mode',
        description: 'How the canvas adapts to different screen sizes',
        type: 'select',
        defaultValue: 'FixedHeight',
        order: 0,
        projectSync: true,
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
        group: 'runtime.canvas',
        label: 'Canvas Match W/H',
        description: 'Blend between matching width (0) and height (1)',
        type: 'range',
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.1,
        order: 1,
        projectSync: true,
        visibleWhen: { settingId: 'runtime.canvasScaleMode', value: 'Match' },
    });

    // =========================================================================
    // Runtime — Timing group
    // =========================================================================

    registerSettingsItem({
        id: 'runtime.maxDeltaTime',
        section: 'runtime',
        group: 'runtime.timing',
        label: 'Max Delta Time',
        description: 'Maximum allowed frame delta time in seconds',
        type: 'number',
        defaultValue: 0.25,
        min: 0.01,
        max: 1,
        step: 0.01,
        order: 0,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'runtime.maxFixedSteps',
        section: 'runtime',
        group: 'runtime.timing',
        label: 'Max Fixed Steps',
        description: 'Maximum fixed update iterations per frame',
        type: 'number',
        defaultValue: 8,
        min: 1,
        max: 64,
        step: 1,
        order: 1,
        projectSync: true,
    });

    // =========================================================================
    // Asset Loading
    // =========================================================================

    registerSettingsItem({
        id: 'asset.timeout',
        section: 'asset-loading',
        label: 'Load Timeout',
        description: 'Maximum time to wait for an asset load in milliseconds',
        type: 'number',
        defaultValue: 30000,
        min: 1000,
        max: 120000,
        step: 1000,
        order: 0,
        projectSync: true,
    });

    registerSettingsItem({
        id: 'asset.failureCooldown',
        section: 'asset-loading',
        label: 'Failure Cooldown',
        description: 'Time to wait before retrying a failed asset load in milliseconds',
        type: 'number',
        defaultValue: 5000,
        min: 0,
        max: 60000,
        step: 1000,
        order: 1,
        projectSync: true,
    });

    // =========================================================================
    // Network
    // =========================================================================

    registerSettingsItem({
        id: 'network.proxy',
        section: 'network',
        label: 'HTTP Proxy',
        description: 'Proxy for update downloads (e.g. http://127.0.0.1:7890)',
        type: 'string',
        defaultValue: '',
        order: 0,
    });
}
