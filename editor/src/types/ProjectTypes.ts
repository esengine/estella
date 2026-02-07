/**
 * @file    ProjectTypes.ts
 * @brief   Project configuration and management types
 */

// =============================================================================
// Project Configuration
// =============================================================================

export interface ProjectConfig {
    name: string;
    version: string;
    engine: string;
    defaultScene: string;
    created: string;
    modified: string;
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
// Constants
// =============================================================================

export const PROJECT_FILE_EXTENSION = '.esproject';
export const SCENE_FILE_EXTENSION = '.esscene';
export const ENGINE_VERSION = '0.1.0';
export const SDK_VERSION = '0.4.0';
