/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import '@esengine/editor/styles';
import { createEditor, ProjectLauncher, setPlatformAdapter, setEditorContext, loadProjectConfig, type Editor } from '@esengine/editor';
import { TauriPlatformAdapter } from './TauriPlatformAdapter';
import { nativeFS, nativeShell } from './native-fs';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';
import type { App, ESEngineModule } from 'esengine';

let currentLauncher: ProjectLauncher | null = null;
let wasmModule: ESEngineModule | null = null;

function loadESModule(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = `__esm_${Date.now()}`;
        const script = document.createElement('script');
        script.type = 'module';
        script.textContent = `import m from '${url}'; window.${id}=m; window.dispatchEvent(new Event('${id}'));`;
        window.addEventListener(id, () => {
            resolve((window as any)[id]);
            delete (window as any)[id];
            script.remove();
        }, { once: true });
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadWasmModule(): Promise<ESEngineModule | null> {
    if (wasmModule) return wasmModule;

    try {
        const createModule = await loadESModule('/wasm/esengine.js');
        wasmModule = await createModule();
        return wasmModule;
    } catch (e) {
        console.warn('Failed to load WASM module:', e);
        return null;
    }
}

async function showLauncher(container: HTMLElement): Promise<void> {
    currentLauncher = new ProjectLauncher(container, {
        onProjectOpen: (projectPath) => {
            currentLauncher?.dispose();
            currentLauncher = null;
            openEditor(container, projectPath);
        },
    });
}

const SPINE_WASM_MAP: Record<string, string> = {
    '3.8': '/wasm/spine38.js',
    '4.2': '/wasm/spine42.js',
};

async function openEditor(container: HTMLElement, projectPath: string): Promise<void> {
    const editor = createEditor(container, { projectPath });
    console.log('ESEngine Editor opened project:', projectPath);

    const module = await loadWasmModule();
    if (module) {
        const app: App = {
            wasmModule: module,
        } as App;
        editor.setApp(app);
    }

    const config = await loadProjectConfig(projectPath);
    const spineVersion = config?.spineVersion ?? '4.2';
    await loadSpineModule(editor, spineVersion);

    editor.onSpineVersionChange((version) => {
        loadSpineModule(editor, version);
    });
}

async function loadSpineModule(editor: Editor, version: string): Promise<void> {
    const url = SPINE_WASM_MAP[version];
    if (!url) return;
    try {
        const factory = await loadUmdModule(url, 'ESSpineModule');
        const module = await factory();
        editor.setSpineModule(module, version);
    } catch (e) {
        console.warn(`Failed to load Spine ${version} module:`, e);
    }
}

function loadUmdModule(url: string, globalName: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            resolve((window as any)[globalName]);
            script.remove();
        };
        script.onerror = () => {
            reject(new Error(`Failed to load ${url}`));
            script.remove();
        };
        document.head.appendChild(script);
    });
}

async function checkForUpdate(): Promise<void> {
    try {
        const update = await check();
        if (!update) return;

        const yes = await ask(
            `New version ${update.version} is available. Update now?`,
            { title: 'Update Available', kind: 'info', okLabel: 'Update', cancelLabel: 'Later' }
        );
        if (!yes) return;

        await update.downloadAndInstall();
        await relaunch();
    } catch (e) {
        console.warn('Update check failed:', e);
    }
}

async function init(): Promise<void> {
    const version = await getVersion();
    setPlatformAdapter(new TauriPlatformAdapter());
    setEditorContext({
        fs: nativeFS,
        invoke,
        shell: nativeShell,
        esbuildWasmURL: '/esbuild.wasm',
        version,
    });

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    showLauncher(container);
    checkForUpdate();
}

init().catch(console.error);
