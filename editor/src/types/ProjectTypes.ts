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
    physicsContactHertz?: number;
    physicsContactDampingRatio?: number;
    physicsContactSpeed?: number;
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

export type ExampleCategory =
    | 'getting-started' | 'rendering' | 'physics'
    | 'ui' | 'animation' | 'audio' | 'input' | 'game';

export type ExampleDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface ExampleProjectInfo {
    id: string;
    name: string;
    description: string;
    zipFile: string;
    category: ExampleCategory;
    difficulty: ExampleDifficulty;
    thumbnail: string;
    tags: string[];
}

export const EXAMPLE_CATEGORY_LABELS: Record<ExampleCategory, string> = {
    'getting-started': 'Getting Started',
    'rendering': 'Rendering',
    'physics': 'Physics',
    'ui': 'UI',
    'animation': 'Animation',
    'audio': 'Audio',
    'input': 'Input',
    'game': 'Game',
};

export const EXAMPLE_PROJECTS: ExampleProjectInfo[] = [
    {
        id: 'hello-world',
        name: 'Hello World',
        description: 'Minimal example: spawn colored sprites, rotate and animate them',
        zipFile: 'examples/hello-world.zip',
        category: 'getting-started',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/hello-world.png',
        tags: ['beginner', 'sprite', 'transform', 'system', 'query'],
    },
    {
        id: 'ecs-basics',
        name: 'ECS Basics',
        description: 'Components, systems, queries, commands, tags, and entity lifecycle',
        zipFile: 'examples/ecs-basics.zip',
        category: 'getting-started',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/ecs-basics.png',
        tags: ['ecs', 'component', 'system', 'query', 'commands', 'tag', 'spawn', 'despawn'],
    },
    {
        id: 'event-system',
        name: 'Event System',
        description: 'Custom events, event readers/writers, and resource-based shared state',
        zipFile: 'examples/event-system.zip',
        category: 'getting-started',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/event-system.png',
        tags: ['event', 'resource', 'eventwriter', 'eventreader', 'defineEvent', 'defineResource'],
    },
    {
        id: 'sprite-rendering',
        name: 'Sprite & Draw API',
        description: 'Sprite layers, colors, flip, orbit, and wave animations',
        zipFile: 'examples/sprite-rendering.zip',
        category: 'rendering',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/sprite-rendering.png',
        tags: ['sprite', 'layer', 'color', 'flip', 'rendering', 'draw'],
    },
    {
        id: 'tween-animation',
        name: 'Tween Animation',
        description: 'Easing functions, position/scale/rotation/color tweens with loop modes',
        zipFile: 'examples/tween-animation.zip',
        category: 'animation',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/tween-animation.png',
        tags: ['tween', 'easing', 'animation', 'loop', 'pingpong'],
    },
    {
        id: 'physics-playground',
        name: 'Physics Playground',
        description: 'Dynamic rigid bodies, box/circle colliders, static platforms, and gravity',
        zipFile: 'examples/physics-playground.zip',
        category: 'physics',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/physics-playground.png',
        tags: ['physics', 'rigidbody', 'collider', 'box2d', 'gravity'],
    },
    {
        id: 'input-demo',
        name: 'Input Handling',
        description: 'Keyboard WASD movement, mouse following, click to spawn, and trail effects',
        zipFile: 'examples/input-demo.zip',
        category: 'input',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/input-demo.png',
        tags: ['input', 'keyboard', 'mouse', 'wasd', 'click'],
    },
    {
        id: 'ui-controls',
        name: 'UI Controls Gallery',
        description: 'Buttons, toggles, sliders, progress bars, and text with Canvas layout',
        zipFile: 'examples/ui-controls.zip',
        category: 'ui',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/ui-controls.png',
        tags: ['ui', 'button', 'toggle', 'slider', 'progressbar', 'canvas', 'text'],
    },
    {
        id: 'ui-layout',
        name: 'UIRect Layout',
        description: 'Anchor-based positioning, stretch panels, and grid layout with UIRect',
        zipFile: 'examples/ui-layout.zip',
        category: 'ui',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/ui-layout.png',
        tags: ['ui', 'layout', 'uirect', 'anchor', 'stretch', 'grid'],
    },
    {
        id: 'particle-demo',
        name: 'Particle Effects',
        description: 'Fire, sparkles, smoke, and burst particle emitters with various shapes',
        zipFile: 'examples/particle-demo.zip',
        category: 'rendering',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/particle-demo.png',
        tags: ['particle', 'emitter', 'fire', 'smoke', 'burst', 'effects'],
    },
    {
        id: 'postprocess-effects',
        name: 'Post-Processing',
        description: 'Bloom, vignette, and global PostProcessVolume with orbiting sprites',
        zipFile: 'examples/postprocess-effects.zip',
        category: 'rendering',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/postprocess-effects.png',
        tags: ['postprocess', 'bloom', 'vignette', 'volume', 'effects'],
    },
    {
        id: 'collision-layers',
        name: 'Collision Layers',
        description: 'Physics collision filtering with categoryBits/maskBits per color group',
        zipFile: 'examples/collision-layers.zip',
        category: 'physics',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/collision-layers.png',
        tags: ['physics', 'collision', 'layers', 'filtering', 'category', 'mask'],
    },
    {
        id: 'ui-interaction',
        name: 'Drag & Focus',
        description: 'Draggable cards, focusable elements, and drop zone with tab navigation',
        zipFile: 'examples/ui-interaction.zip',
        category: 'ui',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/ui-interaction.png',
        tags: ['ui', 'drag', 'focus', 'interactable', 'draggable', 'focusable'],
    },
    {
        id: 'audio-demo',
        name: 'Audio Playback',
        description: 'SFX trigger buttons, volume control, and animated visualizer bars',
        zipFile: 'examples/audio-demo.zip',
        category: 'audio',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/audio-demo.png',
        tags: ['audio', 'sfx', 'volume', 'mixer', 'visualizer'],
    },
    {
        id: 'sprite-animation',
        name: 'Sprite Animation',
        description: 'Frame-by-frame sprite animation with walk/idle clip switching',
        zipFile: 'examples/sprite-animation.zip',
        category: 'animation',
        difficulty: 'beginner',
        thumbnail: 'examples/thumbnails/sprite-animation.png',
        tags: ['sprite', 'animation', 'frames', 'clip', 'spriteanimator'],
    },
    {
        id: 'platformer',
        name: 'Platformer',
        description: 'Side-scrolling platformer with gravity, jumping, and coin collection',
        zipFile: 'examples/platformer.zip',
        category: 'game',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/platformer.png',
        tags: ['platformer', 'input', 'game', 'gravity', 'collision'],
    },
    {
        id: 'space-shooter',
        name: 'Space Shooter',
        description: 'A vertical scrolling shoot\'em up with enemies, bullets, explosions and HUD',
        zipFile: 'examples/space-shooter.zip',
        category: 'game',
        difficulty: 'intermediate',
        thumbnail: 'examples/thumbnails/space-shooter.png',
        tags: ['shooter', 'sprites', 'input', 'hud', 'collision'],
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
