/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import '@esengine/editor/styles';
import { createEditor, ProjectLauncher, setPlatformAdapter, setEditorContext, type Editor } from '@esengine/editor';
import { TauriPlatformAdapter } from './TauriPlatformAdapter';
import { nativeFS, nativeShell } from './native-fs';
import { invoke } from '@tauri-apps/api/core';
import type { App, ESEngineModule } from 'esengine';

let currentLauncher: ProjectLauncher | null = null;
let wasmModule: ESEngineModule | null = null;

function loadWasmScript(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (window.__ESEngineModule) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/wasm/wasm-loader.js';
        script.onerror = () => reject(new Error('Failed to load WASM loader script'));
        document.head.appendChild(script);

        window.addEventListener('esengine-loaded', () => resolve(), { once: true });
    });
}

async function loadWasmModule(): Promise<ESEngineModule | null> {
    if (wasmModule) return wasmModule;

    try {
        await loadWasmScript();

        const createModule = window.__ESEngineModule;
        if (typeof createModule !== 'function') {
            console.warn('WebGL preview disabled: ESEngineModule not available');
            return null;
        }

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
}

async function init(): Promise<void> {
    setPlatformAdapter(new TauriPlatformAdapter());
    setEditorContext({
        fs: nativeFS,
        invoke,
        shell: nativeShell,
        esbuildWasmURL: '/esbuild.wasm',
    });

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    showLauncher(container);
}

init().catch(console.error);
