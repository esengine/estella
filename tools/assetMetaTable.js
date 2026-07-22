// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assetMetaTable.js
 * @brief   The ONE extension -> `.meta` type table.
 *
 * The `.meta` sidecar's `type` field is minted from here by both the CLI
 * (`tools/asset-meta.js`) and the editor's mint door
 * (`desktop/electron/assetMeta.ts`). Keeping the two doors on one table is the
 * point: before this module they were hand-mirrored and had drifted — `.esanim`
 * minted as `animation` from the CLI but `animclip` from the editor, and
 * `.esanimator` had no CLI entry at all — so the same file got a different
 * `type` (or none) depending on which door created it.
 *
 * This is deliberately a dependency-free plain-data module: the CLI is raw
 * `node tools/asset-meta.js` (no build step) and the editor bundles it into the
 * Electron main process, so neither can pull in TypeScript or the SDK barrel.
 *
 * The vocabulary here is the on-disk `.meta` `type` (`animclip`/`animation`/
 * `statemachine`/…), NOT the SDK's runtime `EditorAssetType` spellings. The
 * editor maps it to a content-browser slot in ProjectStore.metaTypeToSlot.
 */

/** Extension (lower-case, dot-included) -> `.meta` type. */
export const EXT_TO_TYPE = Object.freeze({
    // Textures
    '.png': 'texture',
    '.jpg': 'texture',
    '.jpeg': 'texture',
    '.webp': 'texture',
    '.bmp': 'texture',
    '.gif': 'texture',
    '.svg': 'texture',
    '.ktx2': 'texture',
    // Audio
    '.wav': 'audio',
    '.mp3': 'audio',
    '.ogg': 'audio',
    '.aac': 'audio',
    '.flac': 'audio',
    '.m4a': 'audio',
    '.webm': 'audio',
    // Video
    '.mp4': 'video',
    '.m4v': 'video',
    '.mov': 'video',
    '.mpg': 'video',
    '.mpeg': 'video',
    '.esv': 'video',
    // Engine data
    '.esprefab': 'prefab',
    '.esscene': 'scene',
    '.esshader': 'shader',
    '.esmaterial': 'material',
    '.esmat': 'material',
    '.esanim': 'animclip',
    '.esanimclip': 'animclip',
    '.estimeline': 'animation',
    '.estileset': 'tileset',
    '.esfsm': 'statemachine',
    '.esbt': 'behaviortree',
    '.esanimator': 'animatorcontroller',
    '.eslocale': 'locale',
    '.inputmap': 'inputmap',
    // Fonts
    '.fnt': 'bitmapFont',
    '.bmfont': 'bitmapFont',
    '.ttf': 'font',
    '.otf': 'font',
    '.woff': 'font',
    '.woff2': 'font',
    // Tilemap (.estilemap is the editor-native doc; .tmx is import-only, cooked to .tmj)
    '.estilemap': 'tilemap',
    '.tmx': 'tilemap',
    '.tmj': 'tilemap',
    // Spine (skel / atlas — the .png pair is a plain texture)
    '.skel': 'spine',
    '.atlas': 'spine',
});

/** The `.meta` type for a file name/path, or null for unknown extensions. */
export function metaTypeForExt(fileOrExt) {
    const dot = fileOrExt.lastIndexOf('.');
    const ext = (dot >= 0 ? fileOrExt.slice(dot) : fileOrExt).toLowerCase();
    return EXT_TO_TYPE[ext] ?? null;
}
