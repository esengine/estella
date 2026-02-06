/**
 * @file    native-fs.ts
 * @brief   Native file system adapter for Tauri
 */

import { open, save } from '@tauri-apps/plugin-dialog';
import {
    readTextFile,
    writeTextFile,
    readFile,
    writeFile,
    mkdir,
    exists,
    readDir,
    stat,
    copyFile,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { resourceDir } from '@tauri-apps/api/path';

export interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
}

export interface FileChangeEvent {
    type: 'create' | 'modify' | 'remove' | 'rename' | 'any';
    paths: string[];
}

export interface FileStats {
    size: number;
    modified: Date | null;
    created: Date | null;
}

export type UnwatchFn = () => void;

export interface NativeFS {
    saveFile(content: string, defaultPath?: string): Promise<string | null>;
    loadFile(): Promise<{ path: string; content: string } | null>;
    selectDirectory(): Promise<string | null>;
    createDirectory(path: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    writeBinaryFile(path: string, data: Uint8Array): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    copyFile(src: string, dest: string): Promise<boolean>;
    getFileStats(path: string): Promise<FileStats | null>;
    openProject(): Promise<string | null>;
    listDirectory(path: string): Promise<string[]>;
    listDirectoryDetailed(path: string): Promise<DirectoryEntry[]>;
    watchDirectory(
        path: string,
        callback: (event: FileChangeEvent) => void,
        options?: { recursive?: boolean }
    ): Promise<UnwatchFn>;
    openFolder(path: string): Promise<boolean>;
    getResourcePath(): Promise<string>;
    getEngineJs(): Promise<string>;
    getEngineWasm(): Promise<Uint8Array>;
    getEngineSingleJs(): Promise<string>;
    getEngineWxgameJs(): Promise<string>;
    getEngineWxgameWasm(): Promise<Uint8Array>;
    getSdkWechatJs(): Promise<string>;
    getSdkEsmJs(): Promise<string>;
    getSdkEsmDts(): Promise<string>;
    getSdkWasmJs(): Promise<string>;
    getSdkWasmDts(): Promise<string>;
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

        async selectDirectory() {
            try {
                const path = await open({
                    directory: true,
                    multiple: false,
                });
                return typeof path === 'string' ? path : null;
            } catch (err) {
                console.error('Failed to select directory:', err);
                return null;
            }
        },

        async createDirectory(path: string) {
            try {
                await mkdir(path, { recursive: true });
                return true;
            } catch (err) {
                console.error('Failed to create directory:', err);
                return false;
            }
        },

        async exists(path: string) {
            try {
                return await exists(path);
            } catch {
                return false;
            }
        },

        async writeFile(path: string, content: string) {
            try {
                await writeTextFile(path, content);
                return true;
            } catch (err) {
                console.error('Failed to write file:', err);
                return false;
            }
        },

        async writeBinaryFile(path: string, data: Uint8Array) {
            try {
                await writeFile(path, data);
                return true;
            } catch (err) {
                console.error('Failed to write binary file:', err);
                return false;
            }
        },

        async readFile(path: string) {
            try {
                return await readTextFile(path);
            } catch (err) {
                console.error('Failed to read file:', err);
                return null;
            }
        },

        async readBinaryFile(path: string) {
            try {
                return await readFile(path);
            } catch (err) {
                console.error('Failed to read binary file:', err);
                return null;
            }
        },

        async copyFile(src: string, dest: string) {
            try {
                await copyFile(src, dest);
                return true;
            } catch (err) {
                console.error('Failed to copy file:', err);
                return false;
            }
        },

        async getFileStats(path: string) {
            try {
                const stats = await stat(path);
                return {
                    size: stats.size,
                    modified: stats.mtime,
                    created: stats.birthtime,
                };
            } catch (err) {
                console.error('Failed to get file stats:', err);
                return null;
            }
        },

        async openProject() {
            try {
                const path = await open({
                    multiple: false,
                    filters: [{ name: 'ESEngine Project', extensions: ['esproject'] }],
                });
                return typeof path === 'string' ? path : null;
            } catch (err) {
                console.error('Failed to open project:', err);
                return null;
            }
        },

        async listDirectory(path: string) {
            try {
                const entries = await readDir(path);
                return entries.map(e => e.name);
            } catch {
                return [];
            }
        },

        async listDirectoryDetailed(path: string) {
            try {
                const entries = await readDir(path);
                return entries.map(e => ({
                    name: e.name,
                    isDirectory: e.isDirectory,
                    isFile: e.isFile,
                }));
            } catch (err) {
                console.error('Failed to list directory:', err);
                return [];
            }
        },

        async watchDirectory(
            _path: string,
            _callback: (event: FileChangeEvent) => void,
            _options?: { recursive?: boolean }
        ) {
            // File watching not yet supported - use manual refresh
            return () => {};
        },

        async openFolder(path: string) {
            try {
                await invoke('open_folder', { path });
                return true;
            } catch (err) {
                console.error('Failed to open folder:', err);
                return false;
            }
        },

        async getResourcePath() {
            try {
                return await resourceDir();
            } catch {
                return '';
            }
        },

        async getEngineJs() {
            const data = await invoke<number[]>('get_engine_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getEngineWasm() {
            const data = await invoke<number[]>('get_engine_wasm');
            return new Uint8Array(data);
        },

        async getEngineSingleJs() {
            const data = await invoke<number[]>('get_engine_single_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getEngineWxgameJs() {
            const data = await invoke<number[]>('get_engine_wxgame_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getEngineWxgameWasm() {
            const data = await invoke<number[]>('get_engine_wxgame_wasm');
            return new Uint8Array(data);
        },

        async getSdkWechatJs() {
            const data = await invoke<number[]>('get_sdk_wechat_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getSdkEsmJs() {
            const data = await invoke<number[]>('get_sdk_esm_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getSdkEsmDts() {
            const data = await invoke<number[]>('get_sdk_esm_dts');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getSdkWasmJs() {
            const data = await invoke<number[]>('get_sdk_wasm_js');
            return new TextDecoder().decode(new Uint8Array(data));
        },

        async getSdkWasmDts() {
            const data = await invoke<number[]>('get_sdk_wasm_dts');
            return new TextDecoder().decode(new Uint8Array(data));
        },
    };

    (window as any).__esengine_fs = nativeFS;

    const nativeShell = {
        async openFile(path: string): Promise<void> {
            await invoke('execute_command', {
                cmd: 'open',
                args: [path],
                cwd: '/',
            });
        },

        async openInEditor(projectPath: string, filePath: string): Promise<void> {
            await invoke('execute_command', {
                cmd: 'open',
                args: ['-a', 'Visual Studio Code', projectPath, filePath],
                cwd: projectPath,
            });
        },

        async execute(
            cmd: string,
            args: string[],
            cwd: string,
            onOutput?: (stream: 'stdout' | 'stderr', data: string) => void
        ): Promise<{ code: number }> {
            let unlisten: UnlistenFn | null = null;

            try {
                if (onOutput) {
                    unlisten = await listen<{ stream: string; data: string }>(
                        'command-output',
                        (event) => {
                            onOutput(event.payload.stream as 'stdout' | 'stderr', event.payload.data);
                        }
                    );
                }

                const result = await invoke<{ code: number }>('execute_command', { cmd, args, cwd });
                return result;
            } catch (err) {
                return { code: 1 };
            } finally {
                if (unlisten) {
                    unlisten();
                }
            }
        },
    };

    (window as any).__esengine_shell = nativeShell;
}
