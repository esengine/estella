export { Tilemap, TilemapLayer, type TilemapData, type TilemapLayerData } from './components';
export { TilemapAPI, initTilemapAPI, shutdownTilemapAPI } from './tilemapAPI';
export { TilemapPlugin, tilemapPlugin } from './tilemapPlugin';
export {
    parseTiledMap, parseTmjJson, loadTiledMap, resolveRelativePath,
    type TiledMapData, type TiledLayerData, type TiledTilesetData,
} from './tiledLoader';
export {
    registerTextureDimensions, getTextureDimensions, clearTextureDimensionsCache,
    registerTilemapSource, getTilemapSource, clearTilemapSourceCache,
    type TextureDimensions, type LoadedTilemapSource, type LoadedTilemapLayer, type LoadedTilemapTileset,
} from './tilesetCache';
