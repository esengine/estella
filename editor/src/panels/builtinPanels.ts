import type { PanelDescriptor } from './PanelRegistry';
import type { PluginRegistrar } from '../container';
import { PANEL } from '../container/tokens';
import { HierarchyPanel } from './hierarchy/HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { SceneViewPanel } from './scene-view/SceneViewPanel';
import { GameViewPanel } from './game-view/GameViewPanel';
import { ContentBrowserPanel } from './content-browser/ContentBrowserPanel';
import { OutputPanel } from './OutputPanel';
import { ProfilerPanel } from './profiler/ProfilerPanel';
import { TimelinePanel } from './timeline/TimelinePanel';
import { icons } from '../utils/icons';
import { getEditorStore } from '../store';
import { getSceneService } from '../services';

const PANEL_ICON_SIZE = 14;

export interface BuiltinPanelOptions {
    projectPath?: string;
}

export function registerBuiltinPanels(registrar: PluginRegistrar, options: BuiltinPanelOptions): void {
    const registerPanel = (d: PanelDescriptor) => registrar.provide(PANEL, d.id, d);
    registerPanel({
        id: 'hierarchy',
        title: 'Hierarchy',
        icon: icons.list(PANEL_ICON_SIZE),
        position: 'left',
        order: 0,
        defaultVisible: true,
        factory: (c) => ({ instance: new HierarchyPanel(c, getEditorStore()) }),
    });

    registerPanel({
        id: 'scene',
        title: 'Scene',
        position: 'center',
        order: 0,
        defaultVisible: true,
        factory: (c) => ({ instance: new SceneViewPanel(c, getEditorStore(), { projectPath: options.projectPath }) }),
    });

    registerPanel({
        id: 'game',
        title: 'Game',
        icon: icons.play(PANEL_ICON_SIZE),
        position: 'center',
        order: 2,
        defaultVisible: true,
        factory: (c) => ({ instance: new GameViewPanel(c, getEditorStore(), { projectPath: options.projectPath }) }),
    });

    registerPanel({
        id: 'inspector',
        title: 'Inspector',
        icon: icons.settings(PANEL_ICON_SIZE),
        position: 'right',
        order: 0,
        defaultVisible: true,
        factory: (c) => ({ instance: new InspectorPanel(c, getEditorStore()) }),
    });

    registerPanel({
        id: 'content-browser',
        title: 'Content Browser',
        icon: icons.folder(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 0,
        defaultVisible: true,
        factory: (c) => ({
            instance: new ContentBrowserPanel(c, getEditorStore(), {
                projectPath: options.projectPath,
                onOpenScene: (path: string) => getSceneService().openSceneFromPath(path),
            }),
        }),
    });

    registerPanel({
        id: 'output',
        title: 'Output',
        icon: icons.list(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 1,
        defaultVisible: false,
        factory: (c) => ({ instance: new OutputPanel(c) }),
    });

    registerPanel({
        id: 'timeline',
        title: 'Timeline',
        icon: icons.film(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 2,
        defaultVisible: false,
        factory: (c) => ({ instance: new TimelinePanel(c, getEditorStore()) }),
    });

    registerPanel({
        id: 'profiler',
        title: 'Profiler',
        icon: icons.gauge(PANEL_ICON_SIZE),
        position: 'bottom',
        detachOnly: true,
        order: 99,
        factory: (c) => ({ instance: new ProfilerPanel(c) }),
    });
}
