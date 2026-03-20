/**
 * @file    main.ts
 * @brief   Desktop application entry point
 */

import 'dockview-core/dist/styles/dockview.css';
import '@esengine/editor/styles';
import { createEditor, ProjectLauncher, LauncherBridge, setPlatformAdapter, setEditorContext, loadProjectConfig, showToast, dismissToast, showProgressToast, updateToast, getSettingsValue, LoadingOverlay, type Editor } from '@esengine/editor';
import { TauriPlatformAdapter } from './TauriPlatformAdapter';
import { nativeFS, nativeShell } from './native-fs';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import type { App, ESEngineModule } from 'esengine';

let currentLauncher: ProjectLauncher | null = null;
let launcherBridge: LauncherBridge | null = null;
let wasmModule: ESEngineModule | null = null;

function loadESModule(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = `__esm_${Date.now()}`;
        const fullUrl = new URL(url, window.location.origin).href;
        const code = `import m from '${fullUrl}'; window.${id}=m; window.dispatchEvent(new Event('${id}'));`;
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const script = document.createElement('script');
        script.type = 'module';
        script.src = blobUrl;
        window.addEventListener(id, () => {
            resolve((window as any)[id]);
            delete (window as any)[id];
            script.remove();
            URL.revokeObjectURL(blobUrl);
        }, { once: true });
        script.onerror = (e) => {
            script.remove();
            URL.revokeObjectURL(blobUrl);
            reject(e);
        };
        document.head.appendChild(script);
    });
}

async function loadWasmModule(): Promise<ESEngineModule | null> {
    if (wasmModule) return wasmModule;

    try {
        const createModule = await loadESModule('/wasm/esengine.js');
        wasmModule = await createModule({
            locateFile: (path: string) => {
                if (path.endsWith('.wasm')) {
                    return `/wasm/${path}`;
                }
                return path;
            },
        });
        return wasmModule;
    } catch (e) {
        console.warn('Failed to load WASM module:', e);
        return null;
    }
}

function openProjectFromLauncher(container: HTMLElement, projectPath: string): void {
    launcherBridge?.dispose();
    launcherBridge = null;
    currentLauncher?.dispose();
    currentLauncher = null;
    openEditor(container, projectPath);
}

async function showLauncher(container: HTMLElement): Promise<void> {
    launcherBridge = new LauncherBridge({
        onOpenProject: (path) => openProjectFromLauncher(container, path),
    });

    currentLauncher = new ProjectLauncher(container, {
        onProjectOpen: (projectPath) => openProjectFromLauncher(container, projectPath),
    });
}

async function loadPhysicsFactory(editor: Editor): Promise<void> {
    try {
        const factory = await loadUmdModule('/wasm/physics.js', 'ESPhysicsModule');
        editor.setPhysicsFactory(factory);
    } catch (e) {
        console.warn('Failed to load physics module:', e);
    }
}

async function openEditor(container: HTMLElement, projectPath: string): Promise<void> {
    const editor = createEditor(container, { projectPath });
    const overlay = new LoadingOverlay(container);

    try {
        overlay.setStatus('Loading engine...');
        const [module] = await Promise.all([
            loadWasmModule(),
            loadProjectConfig(projectPath),
        ]);

        if (module) {
            const app: App = {
                wasmModule: module,
            } as App;
            editor.setApp(app);
        }

        overlay.setStatus('Loading physics...');
        await loadPhysicsFactory(editor);

        overlay.setStatus('Scanning assets...');
        await editor.waitForAssetLibrary();

        overlay.setStatus('Initializing scripts...');
        await editor.waitForScripts();

        overlay.setStatus('Restoring scene...');
        await editor.waitForSceneRestore();

        overlay.setStatus('Ready');
        await new Promise(resolve => setTimeout(resolve, 300));
        overlay.dismiss();
    } catch (e) {
        overlay.setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
        console.error('Editor initialization failed:', e);
    }

    checkForUpdate();
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

async function checkForUpdate(manual = false): Promise<void> {
    let tid: string | undefined;
    if (manual) {
        tid = showProgressToast('Checking for updates...');
    }

    try {
        const proxy = getSettingsValue<string>('network.proxy') || undefined;
        const update = await invoke<{ version: string; body: string | null } | null>('check_update', { proxy });
        if (!update) {
            if (tid) {
                updateToast(tid, { type: 'success', title: 'You\'re up to date', message: 'No updates available.' });
                setTimeout(() => dismissToast(tid!), 3000);
            }
            return;
        }

        if (tid) dismissToast(tid);

        showToast({
            type: 'info',
            title: 'Update Available',
            message: `New version ${update.version} is ready to install.`,
            duration: 0,
            actions: [{
                label: 'Update',
                primary: true,
                onClick: async () => {
                    const dlTid = showProgressToast('Downloading update...');
                    try {
                        const installProxy = getSettingsValue<string>('network.proxy') || undefined;
                        await invoke('install_update', { proxy: installProxy });
                        updateToast(dlTid, { type: 'success', title: 'Update complete', message: 'Restarting...' });
                        setTimeout(() => relaunch(), 1000);
                    } catch (e) {
                        updateToast(dlTid, { type: 'error', title: 'Update failed', message: String(e) });
                    }
                },
            }],
        });
    } catch (e) {
        if (tid) {
            updateToast(tid, { type: 'error', title: 'Update check failed', message: String(e) });
            setTimeout(() => dismissToast(tid!), 5000);
        } else {
            console.warn('Update check failed:', e);
        }
    }
}

async function init(): Promise<void> {
    const version = await getVersion();
    setPlatformAdapter(new TauriPlatformAdapter());

    let esbuildWasmURL = '/esbuild.wasm';
    try {
        const wasmData = await nativeFS.getEsbuildWasm();
        const blob = new Blob([wasmData.buffer as ArrayBuffer], { type: 'application/wasm' });
        esbuildWasmURL = URL.createObjectURL(blob);
        console.log('[init] Using embedded esbuild.wasm');
    } catch (e) {
        console.warn('[init] Failed to load embedded esbuild.wasm, using public path:', e);
    }

    setEditorContext({
        fs: nativeFS,
        invoke,
        shell: nativeShell,
        esbuildWasmURL,
        version,
        onCheckUpdate: () => checkForUpdate(true),
    });

    const container = document.getElementById('editor-root');
    if (!container) {
        console.error('Editor root container not found');
        return;
    }

    showLauncher(container);
}

init().catch(console.error);
