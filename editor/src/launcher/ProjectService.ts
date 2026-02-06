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

// =============================================================================
// Native FS Interface
// =============================================================================

interface NativeFS {
    selectDirectory(): Promise<string | null>;
    createDirectory(path: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    openProject(): Promise<string | null>;
}

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

function joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

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
        joinPath(projectDir, 'editor'),
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
    };

    const projectFilePath = joinPath(projectDir, 'project.esproject');
    const configJson = JSON.stringify(config, null, 2);
    if (!(await fs.writeFile(projectFilePath, configJson))) {
        return { success: false, error: 'Failed to write project file' };
    }

    // Create default scene based on template
    const defaultScene = createDefaultScene(name, template);
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

    // Create script files
    const scriptFiles = createProjectScripts(name, template);
    for (const [filePath, content] of Object.entries(scriptFiles)) {
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

        // Update SDK if needed
        const projectDir = projectPath.replace(/\/[^/]+\.esproject$/, '');
        const sdkService = new SdkExportService();
        if (await sdkService.needsUpdate(projectDir)) {
            await sdkService.exportToProject(projectDir);
        }

        // Update editor types if needed
        const editorExportService = new EditorExportService();
        if (await editorExportService.needsUpdate(projectDir)) {
            await editorExportService.exportToProject(projectDir);
        }

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
// Script Templates
// =============================================================================

const MAIN_TS_TEMPLATE = `/**
 * ESEngine Project Entry Point
 *
 * This file is the main entry point for your game logic.
 * Press F5 in the editor to run, or use Web Preview for browser testing.
 */
import {
    type ESEngineModule,
    App,
    createWebApp,
    defineSystem,
    Schedule,
    Commands,
    LocalTransform,
    Sprite,
    Camera,
    Canvas,
    Res,
    Time,
    Query,
    Mut,
    type Entity
} from 'esengine';

// =============================================================================
// Main Entry Point
// =============================================================================

export async function main(Module: ESEngineModule): Promise<void> {
    console.log('ESEngine starting...');

    // Create the app with WASM module (handles renderer init + render loop)
    const app = createWebApp(Module);

    // Add startup system - runs once at beginning
    app.addSystemToSchedule(Schedule.Startup, defineSystem(
        [Commands()],
        (cmds) => {
            console.log('Startup: Creating entities...');

            // Create camera
            const camera = cmds.spawn()
                .insert(Camera, {
                    projectionType: 1, // Orthographic
                    fov: 60,
                    orthoSize: 400,
                    nearPlane: 0.1,
                    farPlane: 1000,
                    aspectRatio: 1,
                    isActive: true,
                    priority: 0
                })
                .insert(LocalTransform, {
                    position: { x: 0, y: 0, z: 10 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                })
                .id();

            // Create a test sprite
            const sprite = cmds.spawn()
                .insert(Sprite, {
                    texture: 0,
                    color: { x: 1, y: 0.5, z: 0.2, w: 1 },
                    size: { x: 100, y: 100 },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: 0,
                    flipX: false,
                    flipY: false
                })
                .insert(LocalTransform, {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                })
                .id();

            console.log(\`Created camera: \${camera}, sprite: \${sprite}\`);
        }
    ));

    // Add update system - runs every frame
    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [Res(Time), Query(LocalTransform, Sprite)],
        (time, query) => {
            for (const [entity, transform, sprite] of query) {
                // Move the sprite in a circle
                transform.position.x = Math.sin(time.elapsed) * 100;
                transform.position.y = Math.cos(time.elapsed) * 100;
            }
        }
    ));

    // Start the game loop
    console.log('Starting game loop...');
    app.run();
}
`;

function createPackageJson(projectName: string): string {
    return JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-'),
        version: '0.1.0',
        type: 'module',
        scripts: {
            build: 'rollup -c',
            watch: 'rollup -c -w',
        },
        devDependencies: {
            '@rollup/plugin-node-resolve': '^15.2.3',
            '@rollup/plugin-typescript': '^11.1.6',
            rollup: '^4.18.0',
            typescript: '^5.4.5',
        },
    }, null, 2);
}

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
    include: ['src/**/*', 'editor/**/*'],
    exclude: ['node_modules'],
}, null, 2);

const ROLLUP_CONFIG_TEMPLATE = `import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/main.ts',
    output: {
        file: 'dist/bundle.js',
        format: 'es',
        sourcemap: true
    },
    plugins: [
        resolve(),
        typescript()
    ],
    external: ['esengine']
};
`;

const GITIGNORE_TEMPLATE = `# Dependencies
node_modules/

# Build outputs
dist/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Editor cache
.esengine/cache/
`;

function createProjectScripts(
    name: string,
    _template: ProjectTemplate
): Record<string, string> {
    return {
        'src/main.ts': MAIN_TS_TEMPLATE,
        'package.json': createPackageJson(name),
        'tsconfig.json': TSCONFIG_TEMPLATE,
        'rollup.config.js': ROLLUP_CONFIG_TEMPLATE,
        '.gitignore': GITIGNORE_TEMPLATE,
    };
}

// =============================================================================
// Default Scene Creation
// =============================================================================

function createDefaultScene(projectName: string, _template: ProjectTemplate) {
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
                            orthoSize: 400,
                            nearPlane: 0.1,
                            farPlane: 1000,
                        },
                    },
                ],
            },
        ],
    };
}
