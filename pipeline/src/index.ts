// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The pipeline's public surface: what a project IS, and what turning one
 *        into a build needs. Every consumer — the editor, the command line, CI —
 *        comes through here, so there is one answer rather than one per host.
 */
export * from './project/format';
export * from './project/platforms';
export * from './project/runtimeConfig';
export * from './project/sizeBudget';
export * from './project/targetSupport';
export * from './project/importSettings';
export * from './project/pluginPaths';
export * from './project/readProject';
export * from './fs/pathSandbox';
export * from './assets/contentPolicy';
export * from './assets/assetMeta';
export * from './assets/assetDb';
export * from './assets/cookAssets';
export * from './assets/addressableManifest';
export * from './bundle/importMap';
export * from './bundle/esengineResolve';
export * from './bundle/bundleDiagnostics';
export * from './bundle/buildScripts';
export * from './bundle/buildOpenData';
export * from './bundle/sideModuleScan';
export * from './export/exportGame';
export * from './export/exportProgress';
export * from './export/platformCatalog';
export * from './export/projectModules';
export * from './export/miniGameExportProfile';
export * from './export/playableAdProfile';
export * from './export/orientationHtml';
export * from './export/nativeTemplates';
export * from './export/sizeReport';
