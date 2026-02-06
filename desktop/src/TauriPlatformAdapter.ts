/**
 * @file    TauriPlatformAdapter.ts
 * @brief   Tauri implementation of PlatformAdapter
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { PlatformAdapter, FileDialogOptions, SaveDialogOptions } from '@esengine/editor';

export class TauriPlatformAdapter implements PlatformAdapter {
    convertFilePathToUrl(path: string): string {
        const normalizedPath = path.replace(/\\/g, '/');
        const url = convertFileSrc(normalizedPath);
        console.log(`[TauriPlatformAdapter] convertFilePathToUrl: ${normalizedPath} -> ${url}`);
        return url;
    }

    async openFileDialog(options: FileDialogOptions): Promise<string | null> {
        const result = await open({
            title: options.title,
            filters: options.filters,
            defaultPath: options.defaultPath,
            multiple: options.multiple ?? false,
        });

        if (result === null) return null;
        if (Array.isArray(result)) return result[0] ?? null;
        return result;
    }

    async openSaveDialog(options: SaveDialogOptions): Promise<string | null> {
        return await save({
            title: options.title,
            filters: options.filters,
            defaultPath: options.defaultPath,
        });
    }

    async readTextFile(path: string): Promise<string> {
        return await readTextFile(path);
    }

    async writeTextFile(path: string, content: string): Promise<void> {
        await writeTextFile(path, content);
    }

    async exists(path: string): Promise<boolean> {
        return await exists(path);
    }

    async mkdir(path: string): Promise<void> {
        await mkdir(path, { recursive: true });
    }

    async remove(path: string): Promise<void> {
        await remove(path, { recursive: true });
    }

    joinPath(...segments: string[]): string {
        return segments.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
    }
}
