import { registerPanel } from './PanelRegistry';
import { HierarchyPanel } from './hierarchy/HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { SceneViewPanel } from './scene-view/SceneViewPanel';
import { ContentBrowserPanel } from './content-browser/ContentBrowserPanel';
import { OutputPanel } from './OutputPanel';
import { icons } from '../utils/icons';

export interface BuiltinPanelOptions {
    projectPath?: string;
    onOpenScene?: (path: string) => void;
}

export function registerBuiltinPanels(options: BuiltinPanelOptions): void {
    registerPanel({
        id: 'hierarchy',
        title: 'Hierarchy',
        icon: icons.list(14),
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
        id: 'inspector',
        title: 'Inspector',
        icon: icons.settings(14),
        position: 'right',
        order: 0,
        defaultVisible: true,
        factory: (c, s) => new InspectorPanel(c, s),
    });

    registerPanel({
        id: 'content-browser',
        title: 'Content Browser',
        icon: icons.folder(14),
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
        icon: icons.list(14),
        position: 'bottom',
        order: 1,
        defaultVisible: false,
        factory: (c) => new OutputPanel(c),
    });

}
