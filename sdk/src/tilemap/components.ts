import { defineComponent } from '../component';

export interface TilemapData {
    source: string;
}

export interface TilemapLayerData {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    texture: number;
    tilesetColumns: number;
    layer: number;
    tiles: number[];
    tint: { r: number; g: number; b: number; a: number };
    opacity: number;
    visible: boolean;
    parallaxFactor: { x: number; y: number };
}

export const Tilemap = defineComponent<TilemapData>('Tilemap', {
    source: '',
});

export const TilemapLayer = defineComponent<TilemapLayerData>('TilemapLayer', {
    width: 10,
    height: 10,
    tileWidth: 32,
    tileHeight: 32,
    texture: 0,
    tilesetColumns: 1,
    layer: 0,
    tiles: [],
    tint: { r: 1, g: 1, b: 1, a: 1 },
    opacity: 1,
    visible: true,
    parallaxFactor: { x: 1, y: 1 },
});
