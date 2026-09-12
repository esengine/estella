// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a `.aseprite` becomes: one sprite sheet and one `.esanim` per tag.
 *
 *        An Aseprite document is frames and tags where a PSD is a stack, so the
 *        products differ even though the division is the same one the PSD and
 *        model imports draw — {@link ./asepriteFile} reads the format, and the
 *        translation into project files happens here.
 *
 *        The frame composite is the artwork: layers exist so the artist can
 *        work, and what plays is what they see. So the layer stack collapses
 *        here, and the sheet's cells are frames rather than parts.
 */
import { PNG } from 'pngjs';
import type { AnimClipAssetData, AnimClipFrameData } from 'esengine';
import {
    parseAseprite, type AsepriteDocument, type AsepriteTag,
} from './asepriteFile';
import { blendPixel } from './asepriteBlend';

/** Widest sheet this import will lay out before it wraps to another row. */
const MAX_SHEET_SIDE = 4096;

export interface AsepriteSheetImage {
    /** `<stem>.png`, written beside the clips. */
    file: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

export interface AsepriteClipFile {
    file: string;
    data: AnimClipAssetData;
}

/**
 * The sheet's import settings. Pixel art is the one kind of image where the
 * defaults are all wrong: a bilinear filter blurs the pixels the artist placed,
 * and a lossy GPU compression invents colours a small palette does not have.
 */
export interface AsepriteSheetSettings {
    filterMode: 'nearest';
    compress: false;
    sheet: { cellWidth: number; cellHeight: number; margin: number; spacing: number };
}

export interface AsepriteImportResult {
    sheet: AsepriteSheetImage;
    settings: AsepriteSheetSettings;
    /** One per tag, or a single clip over every frame when the file has no tags. */
    clips: AsepriteClipFile[];
    /** What the document says that the products cannot carry. Never dropped. */
    warnings: string[];
}

/** How a document or tag name becomes a file name: one spelling, so two passes agree. */
function fileStem(name: string): string {
    const cleaned = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned === '' ? 'clip' : cleaned;
}

/**
 * Whether layer `index` is visible once the groups above it have their say.
 *
 * A group's switch hides everything inside it, and the format states nesting as
 * a child level rather than a tree: the enclosing group is the nearest preceding
 * layer one level up.
 */
function layerVisible(doc: AsepriteDocument, index: number): boolean {
    const layer = doc.layers[index];
    if (!layer) return false;
    if (!layer.visible) return false;
    let level = layer.childLevel;
    for (let i = index - 1; i >= 0 && level > 0; i--) {
        const above = doc.layers[i]!;
        if (above.childLevel === level - 1) {
            if (!above.visible) return false;
            level = above.childLevel;
        }
    }
    return true;
}

/**
 * Composite frame `index` into `dst` at cell origin (`ox`,`oy`) of a `stride`-wide
 * RGBA image.
 *
 * Cels draw in layer order, shifted by the per-cel z-index that lets one frame
 * reorder what the stack says.
 */
function compositeFrame(doc: AsepriteDocument, index: number, visible: boolean[],
                        dst: Uint8Array, stride: number, ox: number, oy: number): void {
    const frame = doc.frames[index];
    if (!frame) return;
    const order = frame.cels
        .map((cel, i) => ({ cel, i }))
        .filter(({ cel }) => cel.pixels !== null && visible[cel.layer] === true)
        .sort((a, b) => (a.cel.layer + a.cel.zIndex) - (b.cel.layer + b.cel.zIndex)
            || a.cel.layer - b.cel.layer || a.i - b.i);

    for (const { cel } of order) {
        const layer = doc.layers[cel.layer]!;
        const opacity = Math.round((layer.opacity * cel.opacity) / 255);
        for (let y = 0; y < cel.height; y++) {
            const cy = cel.y + y;
            if (cy < 0 || cy >= doc.height) continue;
            for (let x = 0; x < cel.width; x++) {
                const cx = cel.x + x;
                if (cx < 0 || cx >= doc.width) continue;
                blendPixel(dst, ((oy + cy) * stride + ox + cx) * 4,
                           cel.pixels!, (y * cel.width + x) * 4, layer.blend, opacity);
            }
        }
    }
}

/** The frame indices a tag plays, in order — its direction spelled out as a sequence. */
function tagSequence(tag: AsepriteTag): number[] {
    const forward: number[] = [];
    for (let i = tag.from; i <= tag.to; i++) forward.push(i);
    switch (tag.direction) {
        case 'reverse': return [...forward].reverse();
        // A ping-pong turns around ON its end frames rather than repeating them, so
        // the return leg drops both — which is also what makes a two-frame ping-pong
        // the same as playing it forward.
        case 'pingpong': return [...forward, ...forward.slice(1, -1).reverse()];
        case 'pingpong-reverse': {
            const back = [...forward].reverse();
            return [...back, ...back.slice(1, -1).reverse()];
        }
        default: return forward;
    }
}

/**
 * Read `bytes` and produce what a project can hold.
 *
 * `stem` names the products. `refPrefix` is what a texture ref has to carry to
 * resolve from the project root — the clips are written beside the sheet, so it
 * is the destination folder.
 */
export function importAseprite(bytes: Uint8Array, stem: string,
                               refPrefix = ''): AsepriteImportResult {
    const doc = parseAseprite(bytes);
    const warnings = [...doc.warnings];

    const frameCount = doc.frames.length;
    const cols = Math.max(1, Math.min(frameCount, Math.floor(MAX_SHEET_SIDE / Math.max(1, doc.width))));
    const rows = Math.ceil(frameCount / cols);
    const pageWidth = cols * doc.width;
    const pageHeight = rows * doc.height;

    const visible = doc.layers.map((_, i) => layerVisible(doc, i));
    if (doc.layers.some((l) => l.isTilemap)) {
        warnings.push('tilemap layers are drawn from a tileset rather than pixels and are not '
            + 'composited — flatten them in Aseprite, or keep the map in a .tmx tilemap');
    }

    const pixels = new Uint8Array(pageWidth * pageHeight * 4);
    for (let f = 0; f < frameCount; f++) {
        compositeFrame(doc, f, visible, pixels, pageWidth,
                       (f % cols) * doc.width, Math.floor(f / cols) * doc.height);
    }

    const png = new PNG({ width: pageWidth, height: pageHeight });
    Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength).copy(png.data);
    const sheetFile = `${stem}.png`;

    const sheet: AnimClipAssetData['sheet'] = {
        texture: `${refPrefix}${sheetFile}`,
        cellWidth: doc.width, cellHeight: doc.height,
        margin: 0, spacing: 0,
        pageWidth, pageHeight,
    };

    const pivot = clipPivot(doc, warnings);
    const frameData = (index: number): AnimClipFrameData => ({
        cell: index,
        // The file times each frame on its own, in milliseconds; a clip's are seconds.
        duration: Math.max(0, doc.frames[index]?.durationMs ?? 0) / 1000,
    });

    const clips: AsepriteClipFile[] = [];
    const used = new Set<string>();
    const claim = (name: string): string => {
        let file = name;
        for (let n = 2; used.has(file.toLowerCase()); n++) file = `${name}-${n}`;
        used.add(file.toLowerCase());
        return `${file}.esanim`;
    };

    const clip = (frames: AnimClipFrameData[], loop: boolean): AnimClipAssetData => ({
        version: '1.5', type: 'animation-clip', loop, sheet, frames,
        ...(pivot !== null ? { pivot } : {}),
    });

    if (doc.tags.length === 0) {
        clips.push({
            file: claim(stem),
            data: clip(doc.frames.map((_, i) => frameData(i)), true),
        });
    } else {
        for (const tag of doc.tags) {
            // Aseprite counts a tag's plays; a clip only knows whether it repeats. Zero is
            // the editor's "forever", and anything else has an end, which `loop: false` is.
            clips.push({
                file: claim(`${stem}_${fileStem(tag.name)}`),
                data: clip(tagSequence(tag).map(frameData), tag.repeat === 0),
            });
            if (tag.repeat > 1) {
                warnings.push(`tag "${tag.name}" repeats ${tag.repeat} times, which a clip cannot `
                    + 'state — it plays once and stops');
            }
        }
    }

    return {
        sheet: { file: sheetFile, bytes: new Uint8Array(PNG.sync.write(png)), width: pageWidth, height: pageHeight },
        settings: {
            filterMode: 'nearest', compress: false,
            sheet: { cellWidth: doc.width, cellHeight: doc.height, margin: 0, spacing: 0 },
        },
        clips,
        warnings,
    };
}

/**
 * The anchor every frame inherits, from the first slice the artist gave a pivot.
 *
 * A slice's pivot is the one place an Aseprite document says where its artwork is
 * held — "the feet", "the hand" — and it is stated in canvas pixels from the
 * top-left, where a clip's anchor is normalized inside the frame with Y up.
 */
function clipPivot(doc: AsepriteDocument, warnings: string[]): { x: number; y: number } | null {
    if (doc.slices.some((s) => s.keys.some((k) => k.center !== null))) {
        warnings.push('a slice carries a 9-slice centre, which belongs to a texture rather than '
            + 'an animation — set the borders on the sheet\'s import settings');
    }
    for (const slice of doc.slices) {
        const key = slice.keys.find((k) => k.pivot !== null);
        if (!key || !key.pivot) continue;
        if (slice.keys.length > 1) {
            warnings.push(`slice "${slice.name}" moves between frames; a clip's anchor is one `
                + 'value, so the first key\'s is used');
        }
        const height = Math.max(1, doc.height);
        return {
            x: (key.x + key.pivot.x) / Math.max(1, doc.width),
            // Measured from the bottom by subtracting first: `1 - y/h` is the same
            // anchor and a worse number, and this one is written into a file.
            y: (height - (key.y + key.pivot.y)) / height,
        };
    }
    return null;
}

/** The extensions this import claims. */
export const ASEPRITE_EXTENSIONS = ['.aseprite', '.ase'];

export function isAsepriteSource(file: string): boolean {
    const dot = file.lastIndexOf('.');
    return dot >= 0 && ASEPRITE_EXTENSIONS.includes(file.slice(dot).toLowerCase());
}
