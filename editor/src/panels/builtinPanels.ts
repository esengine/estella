import { registerPanel } from './PanelRegistry';
import { HierarchyPanel } from './hierarchy/HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { SceneViewPanel } from './scene-view/SceneViewPanel';
import { GameViewPanel } from './game-view/GameViewPanel';
import { ContentBrowserPanel } from './content-browser/ContentBrowserPanel';
import { OutputPanel } from './OutputPanel';
import { ProfilerPanel } from './profiler/ProfilerPanel';
import { TimelinePanel } from './timeline/TimelinePanel';
import { icons } from '../utils/icons';

const PANEL_ICON_SIZE = 14;

export interface BuiltinPanelOptions {
    projectPath?: string;
    onOpenScene?: (path: string) => void;
}

export function registerBuiltinPanels(options: BuiltinPanelOptions): void {
    registerPanel({
        id: 'hierarchy',
        title: 'Hierarchy',
        icon: icons.list(PANEL_ICON_SIZE),
        position: 'left',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => new HierarchyPanel(c, s),
    });

    registerPanel({
        id: 'scene',
        title: 'Scene',
        position: 'center',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => new SceneViewPanel(c, s, { projectPath: options.projectPath }),
    });

    registerPanel({
        id: 'game',
        title: 'Game',
        icon: icons.play(PANEL_ICON_SIZE),
        position: 'center',
        order: 2,
        defaultVisible: true,
        factory: (c, s) => new GameViewPanel(c, s, { projectPath: options.projectPath }),
    });

    registerPanel({
        id: 'inspector',
        title: 'Inspector',
        icon: icons.settings(PANEL_ICON_SIZE),
        position: 'right',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => new InspectorPanel(c, s),
    });

    registerPanel({
        id: 'content-browser',
        title: 'Content Browser',
        icon: icons.folder(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => new ContentBrowserPanel(c, s, {
            projectPath: options.projectPath,
            onOpenScene: options.onOpenScene,
        }),
    });

    registerPanel({
        id: 'output',
        title: 'Output',
        icon: icons.list(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 1,
        defaultVisible: false,
        factory: (c) => new OutputPanel(c),
    });

    registerPanel({
        id: 'timeline',
        title: 'Timeline',
        icon: icons.film(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 2,
        defaultVisible: false,
        factory: (c, s) => new TimelinePanel(c, s),
    });

    registerPanel({
        id: 'profiler',
        title: 'Profiler',
        icon: icons.gauge(PANEL_ICON_SIZE),
        position: 'bottom',
        detachOnly: true,
        order: 99,
        factory: (c) => new ProfilerPanel(c),
    });

}
