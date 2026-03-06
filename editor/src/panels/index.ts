/**
 * @file    index.ts
 * @brief   Editor panels exports
 */

export { HierarchyPanel } from './hierarchy/HierarchyPanel';
export { InspectorPanel } from './InspectorPanel';
export { SceneViewPanel } from './scene-view/SceneViewPanel';
export { GameViewPanel } from './game-view/GameViewPanel';
export { OutputPanel } from './OutputPanel';
export { ExtensionsPanel } from './ExtensionsPanel';

export {
    type PanelPosition,
    type PanelDescriptor,
    type PanelFactory,
    type PanelInstance,
    type PanelFactoryResult,
    registerPanel,
    getPanel,
    getAllPanels,
    getPanelsByPosition,
} from './PanelRegistry';
export { registerBuiltinPanels } from './builtinPanels';
