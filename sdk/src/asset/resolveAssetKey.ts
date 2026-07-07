// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resolveAssetKey.ts
 * @brief   The single place a path-keyed runtime store maps an authored
 *          component ref to the key it is registered under.
 *
 * A data asset (`.esfsm`, `.esbt`, `.estimeline`, `.estilemap`…) loads under its
 * RESOLVED load path — the realm's ref resolver maps a plain path or `@uuid:` ref
 * (in the play realm it gains the `estella://project/` origin), then the
 * addressable Catalog applies. But the component still holds the authored ref,
 * and `resolveSceneAssetPaths` leaves these path-keyed fields untouched (only
 * texture/material/font become handles). So the runtime plugin must resolve the
 * ref through the SAME two steps before the lookup — resolver alone diverges
 * from the registration key once the Catalog carries mappings — and fall back
 * to the raw value for keys registered verbatim (a `registerFsm`/`registerBt`
 * code name). See the FSM/BT/tilemap/timeline plugins.
 */

import type { AssetsData } from './AssetPlugin';

/** Resolve an authored asset ref to its runtime-store key (or the ref itself). */
export function resolveAssetKey(assets: AssetsData | null | undefined, ref: string): string {
    return assets ? assets.resolveLoadPath(ref) : ref;
}
