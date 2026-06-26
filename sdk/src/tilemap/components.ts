// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../component';

export { TilemapLayer, type TilemapLayerData } from '../component';

export interface TilemapData {
    source: string;
}

export const Tilemap = defineComponent<TilemapData>('Tilemap', {
    source: '',
}, {
    assetFields: [{ field: 'source', type: 'tilemap' }],
});
