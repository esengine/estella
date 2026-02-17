/**
 * @file    index.ts
 * @brief   Editor panels exports
 */

export { HierarchyPanel } from './hierarchy/HierarchyPanel';
export { InspectorPanel } from './InspectorPanel';
export { SceneViewPanel } from './scene-view/SceneViewPanel';
export { OutputPanel } from './OutputPanel';

export {
    type PanelPosition,
    type PanelDescriptor,
    type PanelFactory,
    type PanelInstance,
    type Resizable,
    type BridgeAware,
    type AppAware,
    type AssetServerProvider,
    type AssetNavigable,
    type OutputAppendable,
    registerPanel,
    getPanel,
    getAllPanels,
    getPanelsByPosition,
    isResizable,
    isBridgeAware,
    isAppAware,
    isAssetServerProvider,
    isAssetNavigable,
    isOutputAppendable,
} from './PanelRegistry';
export { registerBuiltinPanels } from './builtinPanels';
