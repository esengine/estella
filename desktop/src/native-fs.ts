/**
 * @file    native-fs.ts
 * @brief   Native file system adapter for Tauri
 */

import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export interface NativeFS {
    saveFile(content: string, defaultPath?: string): Promise<string | null>;
    loadFile(): Promise<{ path: string; content: string } | null>;
}

export function injectNativeFS(): void {
    const nativeFS: NativeFS = {
        async saveFile(content: string, defaultPath?: string) {
            try {
                const path = await save({
                    defaultPath,
                    filters: [{ name: 'ESEngine Scene', extensions: ['esscene'] }],
                });

                if (path) {
                    await writeTextFile(path, content);
                    return path;
                }
                return null;
            } catch (err) {
                console.error('Failed to save file:', err);
                return null;
            }
        },

        async loadFile() {
            try {
                const path = await open({
                    multiple: false,
                    filters: [{ name: 'ESEngine Scene', extensions: ['esscene'] }],
                });

                if (path && typeof path === 'string') {
                    const content = await readTextFile(path);
                    return { path, content };
                }
                return null;
            } catch (err) {
                console.error('Failed to load file:', err);
                return null;
            }
        },
    };

    (window as any).__esengine_fs = nativeFS;
}
