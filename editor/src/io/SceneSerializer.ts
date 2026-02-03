/**
 * @file    SceneSerializer.ts
 * @brief   Scene save/load functionality
 */

import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';

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
// File Operations (Browser)
// =============================================================================

export async function saveSceneToFile(scene: SceneData, fileName?: string): Promise<void> {
    const serializer = new SceneSerializer();
    const json = serializer.serialize(scene);
    const blob = new Blob([json], { type: 'application/json' });

    const name = fileName ?? `${scene.name}.esscene`;

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
            return;
        } catch (e) {
            if ((e as Error).name === 'AbortError') return;
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

export async function loadSceneFromFile(): Promise<SceneData | null> {
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
