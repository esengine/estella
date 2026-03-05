export const AssetType = {
    IMAGE: 'image',
    MATERIAL: 'material',
    SHADER: 'shader',
    FONT: 'font',
    SPINE: 'spine',
    ANIMCLIP: 'animclip',
    TIMELINE: 'timeline',
    SCENE: 'scene',
    PREFAB: 'prefab',
    AUDIO: 'audio',
    SCRIPT: 'script',
    JSON: 'json',
    FOLDER: 'folder',
    FILE: 'file',
    TILEMAP: 'tilemap',
} as const;

export type AssetTypeValue = typeof AssetType[keyof typeof AssetType];
