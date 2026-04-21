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
