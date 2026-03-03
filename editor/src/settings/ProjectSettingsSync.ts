import { getSettingsValue, setSettingsValue, onSettingsChange } from './SettingsRegistry';
import { loadProjectConfig } from '../launcher/ProjectService';
import { getEditorContext } from '../context/EditorContext';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT } from 'esengine';
import type { ProjectConfig, SpineVersion } from '../types/ProjectTypes';
import { MAX_COLLISION_LAYERS } from './collisionLayers';

type SettingMapping = {
    settingId: string;
    read: (config: ProjectConfig) => unknown;
    write: (config: ProjectConfig, value: unknown) => void;
};

const SETTINGS_TO_PROJECT_MAP: SettingMapping[] = [
    {
        settingId: 'project.name',
        read: c => c.name,
        write: (c, v) => { c.name = (v as string) || c.name; },
    },
    {
        settingId: 'project.version',
        read: c => c.version,
        write: (c, v) => { c.version = (v as string) || c.version; },
    },
    {
        settingId: 'project.defaultScene',
        read: c => c.defaultScene,
        write: (c, v) => { c.defaultScene = (v as string) || c.defaultScene; },
    },
    {
        settingId: 'project.spineVersion',
        read: c => c.spineVersion ?? 'none',
        write: (c, v) => { c.spineVersion = v as SpineVersion; },
    },
    {
        settingId: 'project.enablePhysics',
        read: c => c.enablePhysics ?? false,
        write: (c, v) => { c.enablePhysics = v as boolean; },
    },
    {
        settingId: 'physics.gravityX',
        read: c => c.physicsGravityX ?? 0,
        write: (c, v) => { c.physicsGravityX = v as number; },
    },
    {
        settingId: 'physics.gravityY',
        read: c => c.physicsGravityY ?? -9.81,
        write: (c, v) => { c.physicsGravityY = v as number; },
    },
    {
        settingId: 'physics.fixedTimestep',
        read: c => c.physicsFixedTimestep ?? 1 / 60,
        write: (c, v) => { c.physicsFixedTimestep = v as number; },
    },
    {
        settingId: 'physics.subStepCount',
        read: c => c.physicsSubStepCount ?? 4,
        write: (c, v) => { c.physicsSubStepCount = v as number; },
    },
    {
        settingId: 'physics.contactHertz',
        read: c => c.physicsContactHertz ?? 120,
        write: (c, v) => { c.physicsContactHertz = v as number; },
    },
    {
        settingId: 'physics.contactDampingRatio',
        read: c => c.physicsContactDampingRatio ?? 10,
        write: (c, v) => { c.physicsContactDampingRatio = v as number; },
    },
    {
        settingId: 'physics.contactSpeed',
        read: c => c.physicsContactSpeed ?? 10,
        write: (c, v) => { c.physicsContactSpeed = v as number; },
    },
    {
        settingId: 'project.designWidth',
        read: c => c.designResolution?.width ?? DEFAULT_DESIGN_WIDTH,
        write: (c, v) => {
            if (!c.designResolution) c.designResolution = { width: DEFAULT_DESIGN_WIDTH, height: DEFAULT_DESIGN_HEIGHT };
            c.designResolution.width = (v as number) || DEFAULT_DESIGN_WIDTH;
        },
    },
    {
        settingId: 'project.designHeight',
        read: c => c.designResolution?.height ?? DEFAULT_DESIGN_HEIGHT,
        write: (c, v) => {
            if (!c.designResolution) c.designResolution = { width: DEFAULT_DESIGN_WIDTH, height: DEFAULT_DESIGN_HEIGHT };
            c.designResolution.height = (v as number) || DEFAULT_DESIGN_HEIGHT;
        },
    },
    {
        settingId: 'build.atlasMaxSize',
        read: c => String(c.atlasMaxSize ?? 2048),
        write: (c, v) => { c.atlasMaxSize = parseInt(v as string, 10); },
    },
    {
        settingId: 'build.atlasPadding',
        read: c => c.atlasPadding ?? 2,
        write: (c, v) => { c.atlasPadding = v as number; },
    },
    {
        settingId: 'runtime.sceneTransitionDuration',
        read: c => c.sceneTransitionDuration ?? 0.3,
        write: (c, v) => { c.sceneTransitionDuration = v as number; },
    },
    {
        settingId: 'runtime.sceneTransitionColor',
        read: c => c.sceneTransitionColor ?? '#000000',
        write: (c, v) => { c.sceneTransitionColor = v as string; },
    },
    {
        settingId: 'runtime.defaultFontFamily',
        read: c => c.defaultFontFamily ?? 'Arial',
        write: (c, v) => { c.defaultFontFamily = v as string; },
    },
    {
        settingId: 'runtime.canvasScaleMode',
        read: c => c.canvasScaleMode ?? 'FixedHeight',
        write: (c, v) => { c.canvasScaleMode = v as string; },
    },
    {
        settingId: 'runtime.canvasMatchWidthOrHeight',
        read: c => c.canvasMatchWidthOrHeight ?? 0.5,
        write: (c, v) => { c.canvasMatchWidthOrHeight = v as number; },
    },
    {
        settingId: 'runtime.maxDeltaTime',
        read: c => c.maxDeltaTime ?? 0.25,
        write: (c, v) => { c.maxDeltaTime = v as number; },
    },
    {
        settingId: 'runtime.maxFixedSteps',
        read: c => c.maxFixedSteps ?? 8,
        write: (c, v) => { c.maxFixedSteps = v as number; },
    },
    {
        settingId: 'runtime.textCanvasSize',
        read: c => String(c.textCanvasSize ?? 512),
        write: (c, v) => { c.textCanvasSize = parseInt(v as string, 10); },
    },
    {
        settingId: 'rendering.defaultSpriteWidth',
        read: c => c.defaultSpriteWidth ?? 100,
        write: (c, v) => { c.defaultSpriteWidth = v as number; },
    },
    {
        settingId: 'rendering.defaultSpriteHeight',
        read: c => c.defaultSpriteHeight ?? 100,
        write: (c, v) => { c.defaultSpriteHeight = v as number; },
    },
    {
        settingId: 'rendering.pixelsPerUnit',
        read: c => c.pixelsPerUnit ?? 100,
        write: (c, v) => { c.pixelsPerUnit = v as number; },
    },
    {
        settingId: 'asset.timeout',
        read: c => c.assetLoadTimeout ?? 30000,
        write: (c, v) => { c.assetLoadTimeout = v as number; },
    },
    {
        settingId: 'asset.failureCooldown',
        read: c => c.assetFailureCooldown ?? 5000,
        write: (c, v) => { c.assetFailureCooldown = v as number; },
    },
    ...Array.from({ length: MAX_COLLISION_LAYERS }, (_, i): SettingMapping => ({
        settingId: `physics.layerName${i}`,
        read: c => c.collisionLayerNames?.[i] ?? (i === 0 ? 'Default' : ''),
        write: (c, v) => {
            if (!c.collisionLayerNames) c.collisionLayerNames = Array.from({ length: MAX_COLLISION_LAYERS }, (_, j) => j === 0 ? 'Default' : '');
            c.collisionLayerNames[i] = v as string;
        },
    })),
    ...Array.from({ length: MAX_COLLISION_LAYERS }, (_, i): SettingMapping => ({
        settingId: `physics.layerMask${i}`,
        read: c => c.collisionLayerMasks?.[i] ?? 0xFFFF,
        write: (c, v) => {
            if (!c.collisionLayerMasks) c.collisionLayerMasks = Array(MAX_COLLISION_LAYERS).fill(0xFFFF);
            c.collisionLayerMasks[i] = v as number;
        },
    })),
];

const SYNC_PREFIXES = ['project.', 'physics.', 'build.', 'runtime.', 'rendering.', 'asset.'];

export class ProjectSettingsSync {
    private debounceTimer_: ReturnType<typeof setTimeout> | null = null;
    private unsubscribe_: (() => void) | null = null;
    private onSpineVersionChange_: ((version: string) => void) | null = null;

    constructor(
        private projectPath_: string,
        onSpineVersionChange?: (version: string) => void,
    ) {
        this.onSpineVersionChange_ = onSpineVersionChange ?? null;
    }

    async loadFromProject(): Promise<void> {
        const config = await loadProjectConfig(this.projectPath_);
        if (!config) return;

        for (const mapping of SETTINGS_TO_PROJECT_MAP) {
            setSettingsValue(mapping.settingId, mapping.read(config));
        }
    }

    startAutoSync(): void {
        this.unsubscribe_ = onSettingsChange((id, value) => {
            if (SYNC_PREFIXES.some(prefix => id.startsWith(prefix))) {
                if (this.debounceTimer_) clearTimeout(this.debounceTimer_);
                this.debounceTimer_ = setTimeout(() => this.flushToProject(), 500);
                if (id === 'project.spineVersion') {
                    this.onSpineVersionChange_?.(value as string);
                }
            }
        });
    }

    async flushToProject(): Promise<void> {
        const config = await loadProjectConfig(this.projectPath_);
        if (!config) return;

        for (const mapping of SETTINGS_TO_PROJECT_MAP) {
            mapping.write(config, getSettingsValue(mapping.settingId));
        }

        config.modified = new Date().toISOString();
        const fs = getEditorContext().fs;
        if (fs) {
            await fs.writeFile(this.projectPath_, JSON.stringify(config, null, 2));
        }
    }

    dispose(): void {
        this.unsubscribe_?.();
        this.unsubscribe_ = null;
        if (this.debounceTimer_) {
            clearTimeout(this.debounceTimer_);
            this.debounceTimer_ = null;
        }
    }
}
