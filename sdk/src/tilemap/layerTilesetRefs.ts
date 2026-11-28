// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** An authored list, including an empty list, takes precedence over the legacy single ref. */
export function tilemapLayerTilesetRefs(data: Record<string, unknown> | undefined): string[] {
    const list = data?.tilesetAssets;
    if (Array.isArray(list)) return list.filter((ref): ref is string => typeof ref === 'string' && ref !== '');
    const single = data?.tilesetAsset;
    return typeof single === 'string' && single !== '' ? [single] : [];
}
