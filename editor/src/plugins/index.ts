export type { EditorPlugin, EditorPluginContext } from './EditorPlugin';

import type { EditorPlugin } from './EditorPlugin';
import { assetInfraPlugin } from './assetInfra';
import { importersPlugin } from './importers';
import { corePropertyEditorsPlugin } from './corePropertyEditors';
import { materialEditorsPlugin } from './materialEditors';
import { coreComponentsPlugin } from './coreComponents';
import { spritePlugin } from './sprite';
import { textPlugin } from './text';
import { uiPlugin } from './ui';
import { physicsPlugin } from './physics';
import { spinePlugin } from './spine';
import { audioPlugin } from './audio';
import { animationPlugin } from './animation';
import { particlePlugin } from './particle';
import { postProcessPlugin } from './postProcess';
import { tilemapPlugin } from './tilemap';
import { timelinePlugin } from './timeline';
import { shapeRendererPlugin } from './shapeRenderer';
import { coreGizmosPlugin } from './coreGizmos';
import { coreSettingsPlugin } from './coreSettings';
import { sceneViewSettingsPlugin } from './sceneViewSettings';
import { runtimeSettingsPlugin } from './runtimeSettings';
import { corePanelsPlugin } from './corePanels';
import { coreMenusPlugin, coreStatusbarPlugin } from './coreMenus';
import { dataBindingPlugin } from './dataBinding';
import { collectionViewEditorPlugin } from './collectionView';
import { aiSettingsPlugin } from './aiSettings';

export {
    assetInfraPlugin,
    importersPlugin,
    corePropertyEditorsPlugin,
    materialEditorsPlugin,
    coreComponentsPlugin,
    spritePlugin,
    textPlugin,
    uiPlugin,
    physicsPlugin,
    spinePlugin,
    audioPlugin,
    animationPlugin,
    particlePlugin,
    postProcessPlugin,
    tilemapPlugin,
    timelinePlugin,
    shapeRendererPlugin,
    coreGizmosPlugin,
    coreSettingsPlugin,
    sceneViewSettingsPlugin,
    runtimeSettingsPlugin,
    corePanelsPlugin,
    coreMenusPlugin,
    coreStatusbarPlugin,
    dataBindingPlugin,
    collectionViewEditorPlugin,
    aiSettingsPlugin,
};

export const builtinPlugins: EditorPlugin[] = [
    assetInfraPlugin,
    importersPlugin,
    corePropertyEditorsPlugin,
    materialEditorsPlugin,
    coreComponentsPlugin,
    spritePlugin,
    textPlugin,
    uiPlugin,
    physicsPlugin,
    spinePlugin,
    audioPlugin,
    animationPlugin,
    particlePlugin,
    postProcessPlugin,
    tilemapPlugin,
    timelinePlugin,
    shapeRendererPlugin,
    coreGizmosPlugin,
    coreSettingsPlugin,
    sceneViewSettingsPlugin,
    runtimeSettingsPlugin,
    corePanelsPlugin,
    coreMenusPlugin,
    dataBindingPlugin,
    collectionViewEditorPlugin,
    aiSettingsPlugin,
];
