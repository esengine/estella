/**
 * @file    ProjectService.ts
 * @brief   Project creation and management service
 */

import type {
    ProjectConfig,
    RecentProject,
    ProjectTemplate,
} from '../types/ProjectTypes';
import { ENGINE_VERSION } from '../types/ProjectTypes';
import { SdkExportService } from '../sdk';
import { EditorExportService } from '../extension';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

// =============================================================================
// Recent Projects Storage
// =============================================================================

const RECENT_PROJECTS_KEY = 'esengine_recent_projects';
const MAX_RECENT_PROJECTS = 10;

export function getRecentProjects(): RecentProject[] {
    try {
        const data = localStorage.getItem(RECENT_PROJECTS_KEY);
        if (!data) return [];
        return JSON.parse(data) as RecentProject[];
    } catch {
        return [];
    }
}

export function addRecentProject(project: RecentProject): void {
    const projects = getRecentProjects().filter(p => p.path !== project.path);
    projects.unshift(project);
    if (projects.length > MAX_RECENT_PROJECTS) {
        projects.pop();
    }
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects));
}

export function removeRecentProject(path: string): void {
    const projects = getRecentProjects().filter(p => p.path !== path);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects));
}

export function clearRecentProjects(): void {
    localStorage.removeItem(RECENT_PROJECTS_KEY);
}

// =============================================================================
// Project Service
// =============================================================================

export interface CreateProjectOptions {
    name: string;
    location: string;
    template: ProjectTemplate;
}

export interface ProjectServiceResult<T = void> {
    success: boolean;
    data?: T;
    error?: string;
}

import { joinPath } from '../utils/path';

function getProjectDir(location: string, name: string): string {
    return joinPath(location, name);
}

export async function selectProjectLocation(): Promise<string | null> {
    const fs = getNativeFS();
    if (!fs) {
        console.warn('Native FS not available');
        return null;
    }
    return fs.selectDirectory();
}

export async function createProject(
    options: CreateProjectOptions
): Promise<ProjectServiceResult<string>> {
    const fs = getNativeFS();
    if (!fs) {
        return { success: false, error: 'Native file system not available' };
    }

    const { name, location, template } = options;
    const projectDir = getProjectDir(location, name);

    // Check if directory already exists
    if (await fs.exists(projectDir)) {
        return { success: false, error: 'Project directory already exists' };
    }

    // Create project structure
    const directories = [
        projectDir,
        joinPath(projectDir, 'src'),
        joinPath(projectDir, 'assets'),
        joinPath(projectDir, 'assets/scenes'),
        joinPath(projectDir, 'assets/textures'),
        joinPath(projectDir, 'assets/audio'),
        joinPath(projectDir, '.esengine'),
    ];

    for (const dir of directories) {
        const success = await fs.createDirectory(dir);
        if (!success) {
            return { success: false, error: `Failed to create directory: ${dir}` };
        }
    }

    // Create project config
    const now = new Date().toISOString();
    const config: ProjectConfig = {
        name,
        version: '0.1.0',
        engine: ENGINE_VERSION,
        defaultScene: 'assets/scenes/main.esscene',
        created: now,
        modified: now,
        spineVersion: '4.2',
        designResolution: { width: 1920, height: 1080 },
    };

    const projectFilePath = joinPath(projectDir, 'project.esproject');
    const configJson = JSON.stringify(config, null, 2);
    if (!(await fs.writeFile(projectFilePath, configJson))) {
        return { success: false, error: 'Failed to write project file' };
    }

    // Create default scene based on template
    const defaultScene = createDefaultScene(name, template, config.designResolution!);
    const sceneFilePath = joinPath(projectDir, 'assets/scenes/main.esscene');
    if (!(await fs.writeFile(sceneFilePath, JSON.stringify(defaultScene, null, 2)))) {
        return { success: false, error: 'Failed to write default scene' };
    }

    // Create editor settings
    const editorSettings = {
        lastOpenedScene: 'assets/scenes/main.esscene',
    };
    const settingsPath = joinPath(projectDir, '.esengine/settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(editorSettings, null, 2));

    const projectFiles = createProjectFiles(name, template);
    for (const [filePath, content] of Object.entries(projectFiles)) {
        const fullPath = joinPath(projectDir, filePath);
        if (!(await fs.writeFile(fullPath, content))) {
            console.warn(`Failed to write script file: ${filePath}`);
        }
    }

    // Export SDK to project
    const sdkService = new SdkExportService();
    await sdkService.exportToProject(projectDir);

    // Export editor types to project
    const editorExportService = new EditorExportService();
    await editorExportService.exportToProject(projectDir);

    // Add to recent projects
    addRecentProject({
        name,
        path: projectFilePath,
        lastOpened: now,
    });

    return { success: true, data: projectFilePath };
}

export async function openProjectDialog(): Promise<ProjectServiceResult<string>> {
    const fs = getNativeFS();
    if (!fs) {
        return { success: false, error: 'Native file system not available' };
    }

    const projectPath = await fs.openProject();
    if (!projectPath) {
        return { success: false, error: 'No project selected' };
    }

    return openProject(projectPath);
}

export async function openProject(
    projectPath: string
): Promise<ProjectServiceResult<string>> {
    const fs = getNativeFS();
    if (!fs) {
        return { success: false, error: 'Native file system not available' };
    }

    // Validate project file exists
    if (!(await fs.exists(projectPath))) {
        removeRecentProject(projectPath);
        return { success: false, error: 'Project file not found' };
    }

    // Read and validate project config
    const content = await fs.readFile(projectPath);
    if (!content) {
        return { success: false, error: 'Failed to read project file' };
    }

    try {
        const config = JSON.parse(content) as ProjectConfig;
        if (!config.name || !config.version) {
            return { success: false, error: 'Invalid project file format' };
        }

        const projectDir = projectPath.replace(/\/[^/]+\.esproject$/, '');
        const sdkService = new SdkExportService();
        await sdkService.exportToProject(projectDir);

        const editorExportService = new EditorExportService();
        await editorExportService.exportToProject(projectDir);

        // Update recent projects
        addRecentProject({
            name: config.name,
            path: projectPath,
            lastOpened: new Date().toISOString(),
        });

        return { success: true, data: projectPath };
    } catch {
        return { success: false, error: 'Failed to parse project file' };
    }
}

export async function loadProjectConfig(
    projectPath: string
): Promise<ProjectConfig | null> {
    const fs = getNativeFS();
    if (!fs) return null;

    const content = await fs.readFile(projectPath);
    if (!content) return null;

    try {
        return JSON.parse(content) as ProjectConfig;
    } catch {
        return null;
    }
}

// =============================================================================
// Project File Templates
// =============================================================================

const TSCONFIG_TEMPLATE = JSON.stringify({
    compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: false,
        outDir: './dist',
        rootDir: '.',
        baseUrl: '.',
        paths: {
            'esengine': ['./.esengine/sdk/index.d.ts'],
            'esengine/wasm': ['./.esengine/sdk/wasm.d.ts'],
            '@esengine/editor': ['./.esengine/editor/index.d.ts'],
        },
    },
    include: ['src/**/*'],
    exclude: ['node_modules'],
}, null, 2);

const GITIGNORE_TEMPLATE = `node_modules/
dist/
.vscode/
.idea/
.DS_Store
Thumbs.db
.esengine/cache/
`;

function createProjectFiles(
    _name: string,
    _template: ProjectTemplate
): Record<string, string> {
    return {
        'tsconfig.json': TSCONFIG_TEMPLATE,
        '.gitignore': GITIGNORE_TEMPLATE,
    };
}

// =============================================================================
// Default Scene Creation
// =============================================================================

function createDefaultScene(
    projectName: string,
    _template: ProjectTemplate,
    designResolution: { width: number; height: number },
) {
    const pixelsPerUnit = 100;
    const orthoSize = designResolution.height / 2;

    return {
        version: '1.0',
        name: 'Main',
        entities: [
            {
                id: 1,
                name: 'Camera',
                parent: null,
                children: [],
                components: [
                    {
                        type: 'LocalTransform',
                        data: {
                            position: { x: 0, y: 0, z: 10 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    },
                    {
                        type: 'Camera',
                        data: {
                            isActive: true,
                            projectionType: 1,
                            fov: 60,
                            orthoSize,
                            nearPlane: 0.1,
                            farPlane: 1000,
                            showFrustum: true,
                        },
                    },
                ],
            },
            {
                id: 2,
                name: 'Canvas',
                parent: null,
                children: [],
                components: [
                    {
                        type: 'LocalTransform',
                        data: {
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    },
                    {
                        type: 'Canvas',
                        data: {
                            designResolution: { x: designResolution.width, y: designResolution.height },
                            pixelsPerUnit,
                            scaleMode: 1,
                            matchWidthOrHeight: 0.5,
                            backgroundColor: { r: 0, g: 0, b: 0, a: 1 },
                        },
                    },
                ],
            },
        ],
    };
}
