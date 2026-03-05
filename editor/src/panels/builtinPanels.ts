import type { PanelHooks, PanelDescriptor } from './PanelRegistry';
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

const PANEL_ICON_SIZE = 14;

export interface BuiltinPanelOptions {
    projectPath?: string;
    onOpenScene?: (path: string) => void;
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
        factory: (c, s) => ({ instance: new HierarchyPanel(c, s) }),
    });

    registerPanel({
        id: 'scene',
        title: 'Scene',
        position: 'center',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => {
            const panel = new SceneViewPanel(c, s, { projectPath: options.projectPath });
            const hooks: PanelHooks = {
                setBridge: (b) => panel.setBridge(b),
                setApp: (a) => panel.setApp(a!),
                resize: () => panel.resize(),
                getAssetServer: () => panel.assetServer,
                setSpineController: (ctrl) => panel.setSpineController(ctrl),
                getSpineSkeletonInfo: (id) => panel.getSpineSkeletonInfo(id),
                onSpineInstanceReady: (listener) => panel.onSpineInstanceReady(listener),
            };
            return { instance: panel, hooks };
        },
    });

    registerPanel({
        id: 'game',
        title: 'Game',
        icon: icons.play(PANEL_ICON_SIZE),
        position: 'center',
        order: 2,
        defaultVisible: true,
        factory: (c, s) => {
            const panel = new GameViewPanel(c, s, { projectPath: options.projectPath });
            const hooks: PanelHooks = {
                resize: () => panel.resize(),
            };
            return { instance: panel, hooks };
        },
    });

    registerPanel({
        id: 'inspector',
        title: 'Inspector',
        icon: icons.settings(PANEL_ICON_SIZE),
        position: 'right',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => ({ instance: new InspectorPanel(c, s) }),
    });

    registerPanel({
        id: 'content-browser',
        title: 'Content Browser',
        icon: icons.folder(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => {
            const panel = new ContentBrowserPanel(c, s, {
                projectPath: options.projectPath,
                onOpenScene: options.onOpenScene,
            });
            const hooks: PanelHooks = {
                navigateToAsset: (path) => panel.navigateToAsset(path),
            };
            return { instance: panel, hooks };
        },
    });

    registerPanel({
        id: 'output',
        title: 'Output',
        icon: icons.list(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 1,
        defaultVisible: false,
        factory: (c) => {
            const panel = new OutputPanel(c);
            const hooks: PanelHooks = {
                appendOutput: (text, type) => panel.appendOutput(text, type as any),
            };
            return { instance: panel, hooks };
        },
    });

    registerPanel({
        id: 'timeline',
        title: 'Timeline',
        icon: icons.film(PANEL_ICON_SIZE),
        position: 'bottom',
        order: 2,
        defaultVisible: false,
        factory: (c, s) => {
            const panel = new TimelinePanel(c, s);
            const hooks: PanelHooks = {
                resize: () => panel.resize(),
                saveAsset: () => panel.saveAsset(),
                isDirty: () => panel.isDirty,
            };
            return { instance: panel, hooks };
        },
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
