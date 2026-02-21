import 'dockview-core/dist/styles/dockview.css';
import '@esengine/editor/styles';
import {
    setPlatformAdapter,
    setEditorContext,
    getPanel,
    registerBuiltinEditors,
    registerBuiltinSchemas,
    registerBuiltinPanels,
    getAssetDatabase,
    type PanelInstance,
    isOutputAppendable,
    RemoteEditorStore,
    CHANNEL_OUTPUT,
    type OutputMessage,
} from '@esengine/editor';
import { TauriPlatformAdapter } from './TauriPlatformAdapter';
import { nativeFS, nativeShell } from './native-fs';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';

async function init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const panelId = params.get('panel');
    if (!panelId) {
        console.error('No panel specified in URL');
        return;
    }

    const version = await getVersion();
    setPlatformAdapter(new TauriPlatformAdapter());
    setEditorContext({
        fs: nativeFS,
        invoke,
        shell: nativeShell,
        version,
    });

    registerBuiltinEditors();
    registerBuiltinSchemas();
    registerBuiltinPanels({});

    const projectPath = params.get('projectPath');
    if (projectPath) {
        const projectDir = projectPath.replace(/[/\\][^/\\]+$/, '');
        const db = getAssetDatabase();
        await db.initialize(projectDir, nativeFS);
    }

    const container = document.getElementById('panel-root');
    if (!container) {
        console.error('Panel root container not found');
        return;
    }

    const desc = getPanel(panelId);
    if (!desc) {
        container.textContent = `Unknown panel: ${panelId}`;
        return;
    }

    document.title = desc.title;

    const store = new RemoteEditorStore(panelId);
    await store.connect();

    let panelInstance: PanelInstance | null = null;
    try {
        panelInstance = desc.factory(container, store as any);
    } catch (err) {
        console.error(`Failed to create panel "${panelId}":`, err);
        container.textContent = `Failed to load panel: ${(err as Error).message}`;
        return;
    }

    if (panelId === 'output' && panelInstance && isOutputAppendable(panelInstance)) {
        const outputPanel = panelInstance;
        await listen<OutputMessage>(CHANNEL_OUTPUT, (event) => {
            outputPanel.appendOutput(event.payload.text, event.payload.type);
        });
    }

    window.addEventListener('beforeunload', () => {
        store.disconnect();
        panelInstance?.dispose();
    });
}

init().catch(console.error);
