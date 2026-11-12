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
    // The visual material graph. It never ships (it compiles to the sibling
    // `.esshader` that materials actually reference), but it has to be TYPED
    // here all the same: without an entry the create door cannot name it
    // (`create_asset` derives its extension from this table, so a graph could
    // only be made by the Content Browser's own button) and a graph written by
    // any other hand is never adopted by the scan, which types orphans by name.
    '.esmatgraph': 'materialgraph',
    // A material graph used as a node of another; inlined at compile time, never shipped itself.
    '.esmatsub': 'materialgraph',
    // Import-only sources: importing one writes .esmesh (+ images + a prefab)
    // beside it, and THOSE are what a scene references. Typed apart from the
    // products for that reason — the engine loads no model format.
    '.gltf': 'model',
    '.glb': 'model',
    '.fbx': 'model',
    // The same shape for lighting: a `.hdr` panorama is import-only and produces
    // the `.esenv` + atlas a scene references. So is a `.escube`, which names six
    // images instead of holding one — the same type, because it is imported the same
    // way and answers to the same settings.
    '.hdr': 'panorama',
    '.exr': 'panorama',
    '.escube': 'panorama',
    // And for 2D art: a layered document produces one image per layer plus the
    // prefab that stacks them, and those are what a scene references.
    '.psd': 'layered',
    '.psb': 'layered',
    // Its animated cousin: an Aseprite document is frames and tags, so it
    // produces a sprite sheet plus one clip per tag instead of a stack.
    '.aseprite': 'animated',
    '.ase': 'animated',
    '.esenv': 'environment',
    '.esprobes': 'probeVolume',
    '.esmesh': 'mesh',
    '.esmeshsdf': 'meshSdf',
    '.esmeshcards': 'meshCards',
    // A model as the steps that build it. Never shipped: saving one bakes the sibling
    // `.esmesh`, and that is what a scene references. Typed for the same reason
    // `.esmatgraph` is, and apart from `model` because nothing imports it.
    '.esmodel': 'modeling',
    // A 2D character as it is authored. Never shipped, for the same reason: saving one bakes
    // the sibling `.esmesh`, and a scene references that.
    '.esrig': 'rig',
    '.esanim': 'animclip',
    '.esanimclip': 'animclip',
    '.estimeline': 'animation',
    '.estileset': 'tileset',
    '.esfsm': 'statemachine',
    '.esbt': 'behaviortree',
    '.esgraph': 'scriptgraph',
    '.esanimator': 'animatorcontroller',
    '.esavatar': 'avatar',
    '.eslocale': 'locale',
    '.esaudioevent': 'sound-event',
    '.esworld': 'world-rules',
    '.esterrainlayer': 'terrain-layer',
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

/**
 * Files that are the project's own configuration, never its content.
 *
 * A plain `.json` is a data asset (see {@link metaTypeForContent}), and these
 * are the ones that would be swept up by that and should not be: they are read
 * by the toolchain, not by the game, and a `.meta` beside `package.json` is
 * noise in every project that has ever existed. Matched by full name, because
 * `data/package.json` — a file a game genuinely ships — is not this.
 */
const PLUMBING_FILES = Object.freeze(new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'jsconfig.json',
]));

/** Is this the project's own plumbing rather than a game asset? */
export function isProjectPlumbing(fileOrPath) {
    const parts = String(fileOrPath).toLowerCase().replace(/\\/g, '/').split('/');
    return PLUMBING_FILES.has(parts[parts.length - 1]);
}

/** How much of a file's head the sniff needs. A skeleton's `"skeleton"` header
 *  is the first thing the exporter writes, and a bound keeps the scan from
 *  re-reading every unrelated multi-megabyte JSON in the project. */
export const CONTENT_SNIFF_BYTES = 65536;

/** Whether @p fileOrExt is one the name cannot type but content can. */
export function needsContentType(fileOrExt) {
    const lower = fileOrExt.toLowerCase();
    if (isProjectPlumbing(lower)) return false;
    return metaTypeForExt(lower) === null && CONTENT_TYPED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Spine's JSON skeleton header — a `skeleton` object naming the editor version
 *  that wrote it. The same marker the runtime types the file by
 *  (SpineManager.detectVersionJson), so the editor and the runtime cannot
 *  disagree about what a given `.json` is. */
const SPINE_SKELETON_JSON = /"skeleton"\s*:\s*\{[^{}]*"spine"\s*:\s*"\d/;

/**
 * The `.meta` type for a file whose head has been read — the name-derived one
 * where a name suffices, else what the content declares.
 *
 * A `.json` nobody else claims is `json`: a data asset, the type a game's own
 * tables and configuration load as. It is the LAST claim on purpose — Spine's
 * skeleton and DragonBones' pair are also `.json`, and they are recognised
 * first, so nothing that was already a skeleton becomes data.
 *
 * Null still means "not an asset", but now only for a name nothing can type at
 * all (a `.md`, a `.ts`) and for the project's own plumbing.
 */
export function metaTypeForContent(fileOrExt, head) {
    const byName = metaTypeForExt(fileOrExt);
    if (byName) return byName;
    if (!needsContentType(fileOrExt)) return null;
    return SPINE_SKELETON_JSON.test(head) ? 'spine' : 'json';
}

/**
 * The import settings of a texture read as numbers (its `use` is `data`): no size cap (0 is the source's own size), no codec,
 * no colour decode, no mips or fill. What marking a texture Data writes, and what {@link dataImporterForHead} adopts one with.
 */
export const DATA_TEXTURE_IMPORTER = Object.freeze({
    use: 'data', maxSize: 0, compress: 'off', mipmaps: false, sRGB: false, alphaIsTransparency: false,
});

/**
 * What a texture file's first bytes say it needs, or null for a picture: a PNG of 16 bits a sample is numbers (a heightmap, in
 * nearly every case), and a picture's settings would shrink it and take its depth. Both mint doors ask this, so the same file
 * is adopted the same way from the CLI and from the editor.
 */
export function dataImporterForHead(fileOrPath, head) {
    if (!String(fileOrPath).toLowerCase().endsWith('.png') || !head || head.length < 25) return null;
    const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    return png && head[24] === 16 ? { ...DATA_TEXTURE_IMPORTER, filterMode: 'linear', wrapMode: 'clamp' } : null;
}
