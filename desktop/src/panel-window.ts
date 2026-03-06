import 'dockview-core/dist/styles/dockview.css';
import '@esengine/editor/styles';
import {
    setPlatformAdapter,
    setEditorContext,
    getPanel,
    getAssetDatabase,
    type PanelInstance,
    EditorContainer,
    setEditorContainer,
    builtinPlugins,
    getOutputService,
    RemoteEditorStore,
    CHANNEL_OUTPUT,
    type OutputMessage,
    tokens,
    type ServiceToken,
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

    const iocContainer = new EditorContainer();
    setEditorContainer(iocContainer);

    const projectPath = params.get('projectPath');
    const pluginCtx = { registrar: iocContainer, projectPath };
    for (const plugin of builtinPlugins) {
        plugin.register(pluginCtx);
    }

    const store = new RemoteEditorStore(panelId);
    await store.connect();
    const storeToken = tokens.EDITOR_STORE as ServiceToken<RemoteEditorStore>;
    iocContainer.provide(storeToken, 'default', store);

    if (projectPath) {
        iocContainer.provide(tokens.PROJECT_SERVICE, 'default', { projectPath });
    }

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

    let panelInstance: PanelInstance | null = null;
    try {
        const result = desc.factory(container);
        panelInstance = result.instance;
    } catch (err) {
        console.error(`Failed to create panel "${panelId}":`, err);
        container.textContent = `Failed to load panel: ${(err as Error).message}`;
        return;
    }

    if (panelId === 'output') {
        const outputService = getOutputService();
        await listen<OutputMessage>(CHANNEL_OUTPUT, (event) => {
            outputService.appendOutput(event.payload.text, event.payload.type);
        });
    }

    window.addEventListener('beforeunload', () => {
        store.disconnect();
        panelInstance?.dispose();
    });
}

init().catch(console.error);
