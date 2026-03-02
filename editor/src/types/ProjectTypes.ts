/**
 * @file    ProjectTypes.ts
 * @brief   Project configuration and management types
 */

// =============================================================================
// Project Configuration
// =============================================================================

export type SpineVersion = 'none' | '3.8' | '4.1' | '4.2';

export interface ProjectConfig {
    name: string;
    version: string;
    engine: string;
    defaultScene: string;
    created: string;
    modified: string;
    spineVersion?: SpineVersion;
    enablePhysics?: boolean;
    physicsGravityX?: number;
    physicsGravityY?: number;
    physicsFixedTimestep?: number;
    physicsSubStepCount?: number;
    designResolution?: { width: number; height: number };
    atlasMaxSize?: number;
    atlasPadding?: number;
    sceneTransitionDuration?: number;
    sceneTransitionColor?: string;
    defaultFontFamily?: string;
    canvasScaleMode?: string;
    canvasMatchWidthOrHeight?: number;
    maxDeltaTime?: number;
    maxFixedSteps?: number;
    textCanvasSize?: number;
    defaultSpriteWidth?: number;
    defaultSpriteHeight?: number;
    pixelsPerUnit?: number;
    assetLoadTimeout?: number;
    assetFailureCooldown?: number;
    collisionLayerNames?: string[];
    collisionLayerMasks?: number[];
}

// =============================================================================
// Recent Projects
// =============================================================================

export interface RecentProject {
    name: string;
    path: string;
    lastOpened: string;
}

// =============================================================================
// Project Templates
// =============================================================================

export type ProjectTemplate = 'empty' | '2d' | '3d';

export interface ProjectTemplateInfo {
    id: ProjectTemplate;
    name: string;
    description: string;
    enabled: boolean;
}

export const PROJECT_TEMPLATES: ProjectTemplateInfo[] = [
    {
        id: 'empty',
        name: 'Empty Project',
        description: 'A blank project with basic folder structure',
        enabled: true,
    },
    {
        id: '2d',
        name: '2D Game',
        description: 'Template for 2D games with sprite rendering',
        enabled: false,
    },
    {
        id: '3d',
        name: '3D Game',
        description: 'Template for 3D games with camera and lighting',
        enabled: false,
    },
];

// =============================================================================
// Example Projects
// =============================================================================

export interface ExampleProjectInfo {
    id: string;
    name: string;
    description: string;
    zipFile: string;
}

export const EXAMPLE_PROJECTS: ExampleProjectInfo[] = [
    {
        id: 'space-shooter',
        name: 'Space Shooter',
        description: 'A vertical scrolling shoot\'em up with enemies, bullets, explosions and HUD',
        zipFile: 'examples/space-shooter.zip',
    },
];

// =============================================================================
// Constants
// =============================================================================

export const PROJECT_FILE_EXTENSION = '.esproject';
export const SCENE_FILE_EXTENSION = '.esscene';
declare const __ENGINE_VERSION__: string;
declare const __SDK_VERSION__: string;

export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ !== 'undefined' ? __ENGINE_VERSION__ : '0.0.0';
export const SDK_VERSION: string = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0';
