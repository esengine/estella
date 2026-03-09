/**
 * @file    ProjectService.ts
 * @brief   Project creation and management service
 */

import type {
    ProjectConfig,
    RecentProject,
    ProjectTemplate,
    ExampleProjectInfo,
} from '../types/ProjectTypes';
import { ENGINE_VERSION } from '../types/ProjectTypes';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT, DEFAULT_PIXELS_PER_UNIT } from 'esengine';
import { SdkExportService } from '../sdk';
import { EditorExportService } from '../extension/EditorExportService';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';
import { showProgressToast, updateToast, dismissToast, showErrorToast, showSuccessToast } from '../ui/Toast';

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

    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;
    if (!name || !name.trim() || invalidChars.test(name) || reservedNames.test(name) || name.endsWith('.') || name.endsWith(' ')) {
        return { success: false, error: 'Invalid project name: contains illegal characters or is a reserved name' };
    }

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
        spineVersion: 'none',
        designResolution: { width: DEFAULT_DESIGN_WIDTH, height: DEFAULT_DESIGN_HEIGHT },
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

// =============================================================================
// Create from Example
// =============================================================================

export interface CreateFromExampleOptions {
    name: string;
    location: string;
    example: ExampleProjectInfo;
}

export async function createFromExample(
    options: CreateFromExampleOptions
): Promise<ProjectServiceResult<string>> {
    const fs = getNativeFS();
    const invoke = getEditorContext().invoke;
    if (!fs || !invoke) {
        return { success: false, error: 'Native file system not available' };
    }

    const { name, location, example } = options;
    const projectDir = getProjectDir(location, name);

    if (await fs.exists(projectDir)) {
        return { success: false, error: 'Project directory already exists' };
    }

    const toastId = showProgressToast('Creating project', `Downloading ${example.name}...`);

    try {
        const response = await fetch(`/${example.zipFile}`);
        if (!response.ok) {
            dismissToast(toastId);
            return { success: false, error: `Failed to fetch example: ${response.statusText}` };
        }

        const arrayBuffer = await response.arrayBuffer();
        const zipBytes = Array.from(new Uint8Array(arrayBuffer));

        updateToast(toastId, { message: 'Extracting files...' });
        await invoke('unzip_to_directory', {
            zipBytes,
            targetDir: projectDir,
        });

        // Update project config with user's name and current engine version
        const projectFilePath = joinPath(projectDir, 'project.esproject');
        const configContent = await fs.readFile(projectFilePath);
        if (configContent) {
            try {
                const config = JSON.parse(configContent) as ProjectConfig;
                config.name = name;
                config.engine = ENGINE_VERSION;
                const now = new Date().toISOString();
                config.created = now;
                config.modified = now;
                await fs.writeFile(projectFilePath, JSON.stringify(config, null, 2));
            } catch { /* keep original config if parse fails */ }
        }

        // Export SDK and editor types
        const sdkService = new SdkExportService();
        await sdkService.exportToProject(projectDir);

        const editorExportService = new EditorExportService();
        await editorExportService.exportToProject(projectDir);

        addRecentProject({
            name,
            path: projectFilePath,
            lastOpened: new Date().toISOString(),
        });

        dismissToast(toastId);
        showSuccessToast('Project created', name);
        return { success: true, data: projectFilePath };
    } catch (err) {
        dismissToast(toastId);
        showErrorToast('Project creation failed', String(err));
        return { success: false, error: String(err) };
    }
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

export async function loadEditorLocalSettings(projectPath: string): Promise<Record<string, unknown> | null> {
    const fs = getNativeFS();
    if (!fs) return null;

    const projectDir = projectPath.replace(/\/[^/]+\.esproject$/, '');
    const settingsPath = joinPath(projectDir, '.esengine/settings.json');
    const content = await fs.readFile(settingsPath);
    if (!content) return null;

    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

export async function saveEditorLocalSetting(projectPath: string, key: string, value: unknown): Promise<void> {
    const fs = getNativeFS();
    if (!fs) return;

    const projectDir = projectPath.replace(/\/[^/]+\.esproject$/, '');
    const settingsPath = joinPath(projectDir, '.esengine/settings.json');

    let settings: Record<string, unknown> = {};
    const content = await fs.readFile(settingsPath);
    if (content) {
        try {
            settings = JSON.parse(content);
        } catch {}
    }

    settings[key] = value;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
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
    const pixelsPerUnit = DEFAULT_PIXELS_PER_UNIT;
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
                        type: 'Transform',
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
                            viewportX: 0,
                            viewportY: 0,
                            viewportW: 1,
                            viewportH: 1,
                            clearFlags: 3,
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
                        type: 'Transform',
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
