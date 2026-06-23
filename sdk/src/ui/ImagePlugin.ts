// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/ImagePlugin.ts
 * @brief   Back-compat shim — the Image→UIRenderer system moved to the render
 *          concept module (REARCH_GUI P0). Re-exported here to keep the public
 *          symbol + existing imports stable until REARCH_GUI P4.
 */
export { ImagePlugin, imagePlugin } from './render/image';
