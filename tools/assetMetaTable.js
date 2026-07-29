// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assetMetaTable.js
 * @brief   The ONE file -> `.meta` type table: by extension, by name suffix, and
 *          — where neither can decide — by a marker in the file's content.
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
    // Spine (skel / atlas — the .png pair is a plain texture). A JSON skeleton has
    // no extension of its own; see CONTENT_TYPED_EXTENSIONS below.
    '.skel': 'spine',
    '.atlas': 'spine',
    // DragonBones binary skeleton; its JSON pair is named, see SUFFIX_TO_TYPE.
    '.dbbin': 'dragonbones',
});

/**
 * Full lower-case name endings claiming a type, checked BEFORE extensions
 * because they are the more specific claim. DragonBones ships `_ske.json` beside
 * `_tex.json`, and `.json` alone cannot see the difference. Mirrors the
 * `suffixes` in sdk/src/assetTypes.ts and desktop/src/project/assetTypes.ts —
 * without it this door was the only one of the three that could not type a
 * DragonBones pair, so importing one skipped both halves.
 */
export const SUFFIX_TO_TYPE = Object.freeze({
    '_ske.json': 'dragonbones',
    '_tex.json': 'dragonbones',
});

/** The `.meta` type for a file name/path, or null when the NAME cannot say. */
export function metaTypeForExt(fileOrExt) {
    const lower = fileOrExt.toLowerCase();
    for (const suffix of Object.keys(SUFFIX_TO_TYPE)) {
        if (lower.endsWith(suffix)) return SUFFIX_TO_TYPE[suffix];
    }
    const dot = lower.lastIndexOf('.');
    return EXT_TO_TYPE[dot >= 0 ? lower.slice(dot) : lower] ?? null;
}

/**
 * Extensions whose type the name cannot decide, so the mint doors read the
 * file's head and ask {@link metaTypeForContent}. Spine's JSON skeleton export
 * is what forces this: it is a plain `.json` under any name the artist chose,
 * and Spine 2.1 has no binary export at all — a project on that runtime has
 * nothing else to hand the editor.
 */
export const CONTENT_TYPED_EXTENSIONS = Object.freeze(['.json']);

/** How much of a file's head the sniff needs. A skeleton's `"skeleton"` header
 *  is the first thing the exporter writes, and a bound keeps the scan from
 *  re-reading every unrelated multi-megabyte JSON in the project. */
export const CONTENT_SNIFF_BYTES = 65536;

/** Whether @p fileOrExt is one the name cannot type but content can. */
export function needsContentType(fileOrExt) {
    const lower = fileOrExt.toLowerCase();
    return metaTypeForExt(lower) === null && CONTENT_TYPED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Spine's JSON skeleton header — a `skeleton` object naming the editor version
 *  that wrote it. The same marker the runtime types the file by
 *  (SpineManager.detectVersionJson), so the editor and the runtime cannot
 *  disagree about what a given `.json` is. */
const SPINE_SKELETON_JSON = /"skeleton"\s*:\s*\{[^{}]*"spine"\s*:\s*"\d/;

/**
 * The `.meta` type for a file whose head has been read — the name-derived one
 * where a name suffices, else what the content declares. Null means neither
 * could type it (a plain data `.json`), which the callers treat as "not an
 * asset", exactly as an unknown extension is.
 */
export function metaTypeForContent(fileOrExt, head) {
    const byName = metaTypeForExt(fileOrExt);
    if (byName) return byName;
    if (!needsContentType(fileOrExt)) return null;
    return SPINE_SKELETON_JSON.test(head) ? 'spine' : null;
}
