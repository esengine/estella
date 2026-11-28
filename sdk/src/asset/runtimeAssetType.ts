// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** The typed loaders for metadata names used by the project index and the cook. */
export const LOADER_TYPE_OF_META_TYPE: Readonly<Record<string, string>> = Object.freeze({
    imageSource: 'texture',
    soundSource: 'audio',
    musicSource: 'audio',
    animclip: 'anim-clip',
    animation: 'timeline',
    bitmapfont: 'font',
    shader: 'material-shader',
    scene: 'json',
    inputmap: 'json',
    'terrain-tiles': 'json',
    'terrain-layer-info': 'json',
    'physical-material': 'json',
    // The Groom plugin fetches a groom as text. Its curves ship as bytes.
    groom: 'json',
});

export const UNLOADED_TYPE = 'binary';

export const UNLOADED_META_TYPES: ReadonlySet<string> = new Set([
    'video', 'dragonbones',
    'model', 'panorama', 'layered', 'animated', 'materialgraph', 'modeling', 'land', 'proc', 'rig', 'curves',
]);

export function runtimeAssetTypeFromMetadata(type: string, path?: string): string {
    // Older projects used one metadata name for sprite clips and timelines.
    if (type === 'animation' && path?.split(/[?#]/, 1)[0].toLowerCase().endsWith('.esanim')) return 'anim-clip';
    if (UNLOADED_META_TYPES.has(type)) return UNLOADED_TYPE;
    return Object.prototype.hasOwnProperty.call(LOADER_TYPE_OF_META_TYPE, type) ? LOADER_TYPE_OF_META_TYPE[type] : type;
}
