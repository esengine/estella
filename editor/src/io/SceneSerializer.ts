/**
 * @file    SceneSerializer.ts
 * @brief   Scene save/load functionality
 */

import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { getEditorContext } from '../context/EditorContext';
import { getDefaultComponentData } from '../schemas/ComponentSchemas';

// =============================================================================
// SceneSerializer
// =============================================================================

export class SceneSerializer {
    serialize(scene: SceneData): string {
        return JSON.stringify(scene, null, 2);
    }

    deserialize(json: string): SceneData {
        const data = JSON.parse(json) as SceneData;
        this.validateScene(data);
        return data;
    }

    private validateScene(scene: SceneData): void {
        if (!scene.version) {
            scene.version = '1.0';
        }
        if (!scene.name) {
            scene.name = 'Untitled';
        }
        if (!Array.isArray(scene.entities)) {
            scene.entities = [];
        }

        for (const entity of scene.entities) {
            this.validateEntity(entity);
        }
    }

    private validateEntity(entity: EntityData): void {
        if (typeof entity.id !== 'number') {
            throw new Error('Entity must have numeric id');
        }
        if (!entity.name) {
            entity.name = `Entity_${entity.id}`;
        }
        if (!Array.isArray(entity.children)) {
            entity.children = [];
        }
        if (!Array.isArray(entity.components)) {
            entity.components = [];
        }

        if (!entity.components.some(c => c.type === 'LocalTransform')) {
            entity.components.unshift({
                type: 'LocalTransform',
                data: getDefaultComponentData('LocalTransform'),
            });
        }

        for (const component of entity.components) {
            this.validateComponent(component);
        }
    }

    private validateComponent(component: ComponentData): void {
        if (!component.type) {
            throw new Error('Component must have type');
        }
        if (!component.data || typeof component.data !== 'object') {
            component.data = {};
        }
    }
}

// =============================================================================
// Native File System Interface (for Tauri)
// =============================================================================

interface NativeFS {
    saveFile(content: string, defaultPath?: string): Promise<string | null>;
    loadFile(): Promise<{ path: string; content: string } | null>;
    readFile(path: string): Promise<string | null>;
    writeFile?(path: string, content: string): Promise<boolean>;
}

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

function isNativeApp(): boolean {
    return '__TAURI__' in window || getNativeFS() !== null;
}

// =============================================================================
// File Operations
// =============================================================================

let currentFileHandle: FileSystemFileHandle | null = null;

export async function saveSceneToFile(scene: SceneData, fileName?: string): Promise<string | null> {
    const serializer = new SceneSerializer();
    const json = serializer.serialize(scene);
    const name = fileName ?? `${scene.name}.esscene`;

    const nativeFS = getNativeFS();
    if (isNativeApp() && nativeFS) {
        return nativeFS.saveFile(json, name);
    }

    return browserSaveFile(json, name);
}

export async function saveSceneToPath(scene: SceneData, filePath: string): Promise<boolean> {
    const serializer = new SceneSerializer();
    const json = serializer.serialize(scene);

    const nativeFS = getNativeFS();
    if (isNativeApp() && nativeFS) {
        if (nativeFS.writeFile) {
            return nativeFS.writeFile(filePath, json);
        }
        const result = await nativeFS.saveFile(json, filePath);
        return result !== null;
    }

    if (currentFileHandle) {
        try {
            const writable = await currentFileHandle.createWritable();
            await writable.write(json);
            await writable.close();
            return true;
        } catch (e) {
            console.error('Failed to save to existing handle:', e);
            currentFileHandle = null;
        }
    }

    return false;
}

export function hasFileHandle(): boolean {
    return currentFileHandle !== null || isNativeApp();
}

export function clearFileHandle(): void {
    currentFileHandle = null;
}

export async function loadSceneFromFile(): Promise<SceneData | null> {
    const nativeFS = getNativeFS();
    if (isNativeApp() && nativeFS) {
        const result = await nativeFS.loadFile();
        if (result) {
            const serializer = new SceneSerializer();
            return serializer.deserialize(result.content);
        }
        return null;
    }

    return browserLoadFile();
}

export async function loadSceneFromPath(path: string): Promise<SceneData | null> {
    const nativeFS = getNativeFS();
    if (!nativeFS) {
        console.error('Native FS not available');
        return null;
    }

    try {
        const content = await nativeFS.readFile(path);
        if (content) {
            const serializer = new SceneSerializer();
            return serializer.deserialize(content);
        }
        return null;
    } catch (err) {
        console.error('Failed to load scene from path:', path, err);
        return null;
    }
}

// =============================================================================
// Browser File Operations (Fallback)
// =============================================================================

async function browserSaveFile(json: string, name: string): Promise<string | null> {
    const blob = new Blob([json], { type: 'application/json' });

    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: name,
                types: [{
                    description: 'ESEngine Scene',
                    accept: { 'application/json': ['.esscene'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            currentFileHandle = handle;
            return handle.name;
        } catch (e) {
            if ((e as Error).name === 'AbortError') return null;
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
}

async function browserLoadFile(): Promise<SceneData | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.esscene,.json';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }

            try {
                const text = await file.text();
                const serializer = new SceneSerializer();
                const scene = serializer.deserialize(text);
                resolve(scene);
            } catch (e) {
                console.error('Failed to load scene:', e);
                resolve(null);
            }
        };

        input.oncancel = () => resolve(null);
        input.click();
    });
}
