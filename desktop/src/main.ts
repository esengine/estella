/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import '@esengine/editor/styles';
import { createEditor, ProjectLauncher, setPlatformAdapter, type Editor } from '@esengine/editor';
import { TauriPlatformAdapter } from './TauriPlatformAdapter';
import { injectNativeFS } from './native-fs';
import { invoke } from '@tauri-apps/api/core';
import type { App, ESEngineModule } from 'esengine';

let currentLauncher: ProjectLauncher | null = null;
let wasmModule: ESEngineModule | null = null;

function loadScript(src: string): Promise<void> {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.innerHTML = `
            import createModule from '${src}';
            window.__ESEngineModule = createModule;
            window.dispatchEvent(new Event('esengine-loaded'));
        `;
        document.head.appendChild(script);
        resolve();
    });
}

async function loadWasmModule(): Promise<ESEngineModule | null> {
    if (wasmModule) return wasmModule;

    try {
        await loadScript('/esengine.js');

        await new Promise<void>((resolve, reject) => {
            if ((window as any).__ESEngineModule) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('WASM module load timeout'));
            }, 10000);

            window.addEventListener('esengine-loaded', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
        });

        const createModule = (window as any).__ESEngineModule;
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
    injectNativeFS();
    (window as any).__esengine_invoke = invoke;

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    showLauncher(container);
}

init().catch(console.error);
