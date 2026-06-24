// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   The unified acquirer for Estella's optional native modules (physics,
 *          the per-version spine runtimes). One {@link SideModuleHost} per realm;
 *          the transport (fetch / inlined base64 / WeChat factory) is the only
 *          thing that differs. Physics and spine self-gate off `app.sideModules`.
 */
export {
    SIDE_MODULES,
    SPINE_VERSIONS,
    spineModuleId,
    type SideModuleId,
    type SideModuleDescriptor,
    type SpineVersion,
} from './registry';
export {
    createSideModuleHost,
    instantiateWithBytes,
    instantiateFromGlueText,
    type SideModuleHost,
    type SideModule,
    type SideModuleInstantiator,
    type EmscriptenFactory,
} from './host';
export { createFetchSideModuleHost } from './fetchHost';
export {
    createEmbeddedSideModuleHost,
    type EmbeddedSideModuleEntry,
    type EmbeddedSideModuleRegistry,
} from './embeddedHost';
export { createWeChatSideModuleHost, type WeChatSideModuleFactories } from './wechatHost';
