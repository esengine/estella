// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a `.psd` becomes: one PNG per layer and the prefab that puts them
 *        back where the artist had them.
 *
 *        PSD is a closed format with thirty years of features behind it, so the
 *        parsing is ag-psd's and what happens here is only the translation — the
 *        same division the FBX import draws. The products are ordinary project
 *        files: nothing downstream learns what a PSD is.
 */
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { bindPsdLayers, type PsdLayerContext, type PsdLayerHistory } from './psdLayerIdentity';
import { readPsd, initializeCanvas } from 'ag-psd';
import {
    PREFAB_FORMAT_VERSION,
    type PrefabData, type PrefabEntityData, type PrefabComponentData,
} from 'esengine';

/**
 * ag-psd reaches for a canvas to hand back layer pixels; `useImageData` makes that
 * a plain `{data,width,height}`, so an allocator is all it needs — no canvas
 * library, in a pipeline with no DOM. `createCanvas` stays a thrower rather than a
 * stub, so a path that truly wants one is loud instead of quietly empty.
 */
initializeCanvas(
    () => { throw new Error('the PSD import decodes to image data and has no canvas'); },
    (width: number, height: number) => ({
        data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
        width, height,
    }) as unknown as ImageData,
);

/** One layer's pixels, named for the file they will be written to. */
export interface PsdLayerImage {
    /** `<stem>_<layer>` plus `.png`, unique within the import. */
    file: string;
    bytes: Uint8Array;
}

export interface PsdImportResult {
    /** Every layer image to write, bottom of the stack first. */
    images: PsdLayerImage[];
    /** The assembly — where each image sits and in what order it draws. */
    prefab: PrefabData;
    /** What the document says that the products cannot carry. Never dropped. */
    warnings: string[];
    /** Authoring identities written only to the prefab sidecar. */
    history: PsdLayerHistory;
}

function entity(id: string, name: string, parent: string | null,
                components: PrefabComponentData[], visible: boolean): PrefabEntityData {
    return { prefabEntityId: id, name, parent, children: [], visible, components };
}

/**
 * Read `bytes` and produce what a project can hold.
 *
 * `stem` names the products and the prefab. `refPrefix` is what a texture ref has
 * to be prefixed with to resolve from the project root — the images are written
 * beside the prefab, so it is the destination folder.
 */
export function importPsd(bytes: Uint8Array, stem: string, refPrefix = '', context: PsdLayerContext = {}): PsdImportResult {
    const psd = readPsd(bytes, {
        useImageData: true,
        // The flattened composite and the thumbnail are pictures of the result;
        // what this import wants is the parts. Skipping them is most of the read.
        skipCompositeImageData: true,
        skipThumbnail: true,
    });

    const digest = createHash('sha256').update(bytes).digest('hex');
    const { nodes, leaves, warnings, history } = bindPsdLayers(psd.children ?? [], stem, digest, context);
    const images: PsdLayerImage[] = [];
    const entities: PrefabEntityData[] = [];

    const root = entity('root', stem, null,
                        [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }], true);
    entities.push(root);

    // Sprite.order is a signed byte, so a stack taller than that cannot be
    // expressed and the top layers would all pin to the same value — said out
    // loud, because the picture would be subtly wrong rather than obviously so.
    if (leaves > 128) {
        warnings.push(`${leaves} layers: only the lowest 128 keep a distinct draw order `
            + '(Sprite.order is -128..127) — merge layers in Photoshop, or split the document');
    }

    const byId = new Map<string, PrefabEntityData>([['root', root]]);
    for (const { layer, record, image, depth } of nodes) {
        const { entityId: id, parent } = record;
        const name = layer.name ?? id;
        const holder = byId.get(parent)!;
        // A group's own rectangle is its contents' union and moves when they do,
        // so it carries no offset of its own — its children are already placed in
        // document space. An identity Transform keeps that true.
        if (layer.children !== undefined) {
            holder.children.push(id);
            const group = entity(id, name, parent,
                                 [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
                                 layer.hidden !== true);
            entities.push(group);
            byId.set(id, group);
            continue;
        }

        if (!image) {
            // An adjustment or effect layer has no pixels of its own. It is not a
            // failure and not a sprite; naming it is how the artist learns which
            // part of the document did not come across.
            warnings.push(`"${name}" has no pixels of its own (an adjustment, effect or empty layer) — not imported`);
            continue;
        }
        if (layer.blendMode !== undefined && layer.blendMode !== 'normal') {
            warnings.push(`"${name}" uses the "${layer.blendMode}" blend mode, which a Sprite cannot carry `
                + '— assign it a material with that blend mode');
        }

        const file = record.file!;
        const { x, y, w, h, data } = image;

        const png = new PNG({ width: data.width, height: data.height });
        Buffer.from(data.data.buffer, data.data.byteOffset, data.data.byteLength).copy(png.data);
        images.push({ file, bytes: new Uint8Array(PNG.sync.write(png)) });

        // PSD measures from the top-left with Y down; the engine's Y is up and a
        // sprite is placed by its centre. So the document's centre becomes the
        // prefab's origin and the layer's own centre is offset from it.
        holder.children.push(id);
        entities.push(entity(id, name, parent, [
            { type: 'Transform', data: { position: {
                x: x + w / 2 - psd.width / 2,
                y: psd.height / 2 - (y + h / 2),
                z: 0,
            } } },
            { type: 'Sprite', data: {
                texture: `${refPrefix}${file}`,
                size: { x: w, y: h },
                // Opacity is the layer's, and a Sprite spends it in the tint's alpha.
                color: { r: 1, g: 1, b: 1, a: layer.opacity ?? 1 },
                // The one field that makes a stack a stack. Bottom-to-top is the
                // order the file stores layers in, so the index IS the answer.
                order: Math.min(127, depth),
            } },
        ], layer.hidden !== true));
    }

    return {
        images,
        prefab: { version: PREFAB_FORMAT_VERSION, name: stem, rootEntityId: 'root', entities },
        warnings, history,
    };
}

/** The extensions this import claims. */
export const PSD_EXTENSIONS = ['.psd', '.psb'];

export function isPsdSource(file: string): boolean {
    const dot = file.lastIndexOf('.');
    return dot >= 0 && PSD_EXTENSIONS.includes(file.slice(dot).toLowerCase());
}
