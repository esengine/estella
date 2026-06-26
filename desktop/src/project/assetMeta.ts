// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetMeta.ts
 * @brief Re-exports the asset-type helpers used by the Content Browser and the
 *        unified Details inspector, derived from the single `assetTypes` registry
 *        so selecting an asset resolves the same type/badge everywhere.
 */
import type { AssetType } from '@/types';
import { ASSET_TYPES, assetTypeOf } from './assetTypes';

export { assetTypeOf };

export const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Short uppercase code shown in a tile's corner badge / detail tag, per type. */
export const TYPE_CODE = Object.fromEntries(
  (Object.entries(ASSET_TYPES) as [AssetType, { badge: string }][]).map(([type, def]) => [type, def.badge]),
) as Record<AssetType, string>;

export const baseName = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
