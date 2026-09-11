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
import { PNG } from 'pngjs';
import { readPsd, initializeCanvas, type Layer, type Psd } from 'ag-psd';
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
}

/** How a layer name becomes a file name: one spelling, so two passes agree. */
function fileStem(name: string): string {
    const cleaned = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned === '' ? 'layer' : cleaned;
}

/** A leaf layer with pixels, or a group, in the order the file stores them. */
interface Flat {
    layer: Layer;
    /** Group depth's parent entity id, or null at the document root. */
    parent: string | null;
    id: string;
    /** Position in the global bottom-to-top stack; only leaves take one. */
    depth: number;
}

/**
 * The stack, flattened bottom-to-top — which is the order the FILE stores layers
 * in, and therefore the order `children` arrives in. Groups are kept as entities
 * so the prefab has the artist's own structure, but they take no stack position:
 * PSD stacking is global, and a group only draws what is inside it.
 */
function flatten(psd: Psd): { nodes: Flat[]; leaves: number } {
    const nodes: Flat[] = [];
    let depth = 0;
    let n = 0;
    const visit = (layers: readonly Layer[] | undefined, parent: string | null): void => {
        for (const layer of layers ?? []) {
            const id = `l${n++}`;
            const group = layer.children !== undefined;
            nodes.push({ layer, parent, id, depth: group ? -1 : depth++ });
            if (group) visit(layer.children, id);
        }
    };
    visit(psd.children, null);
    return { nodes, leaves: depth };
}

/** Width and height of a layer's own rectangle; zero for one with no pixels. */
function rect(layer: Layer): { x: number; y: number; w: number; h: number } {
    const x = layer.left ?? 0;
    const y = layer.top ?? 0;
    return { x, y, w: (layer.right ?? x) - x, h: (layer.bottom ?? y) - y };
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
export function importPsd(bytes: Uint8Array, stem: string, refPrefix = ''): PsdImportResult {
    const psd = readPsd(bytes, {
        useImageData: true,
        // The flattened composite and the thumbnail are pictures of the result;
        // what this import wants is the parts. Skipping them is most of the read.
        skipCompositeImageData: true,
        skipThumbnail: true,
    });

    const warnings: string[] = [];
    const images: PsdLayerImage[] = [];
    const entities: PrefabEntityData[] = [];
    const used = new Set<string>();

    const root = entity('root', stem, null,
                        [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }], true);
    entities.push(root);

    const { nodes, leaves } = flatten(psd);
    // Sprite.order is a signed byte, so a stack taller than that cannot be
    // expressed and the top layers would all pin to the same value — said out
    // loud, because the picture would be subtly wrong rather than obviously so.
    if (leaves > 128) {
        warnings.push(`${leaves} layers: only the lowest 128 keep a distinct draw order `
            + '(Sprite.order is -128..127) — merge layers in Photoshop, or split the document');
    }

    const byId = new Map<string, PrefabEntityData>([['root', root]]);
    const parentOf = (node: Flat): PrefabEntityData =>
        (node.parent === null ? root : byId.get(node.parent) ?? root);

    for (const node of nodes) {
        const { layer, id } = node;
        const name = layer.name ?? id;
        const holder = parentOf(node);
        // A group's own rectangle is its contents' union and moves when they do,
        // so it carries no offset of its own — its children are already placed in
        // document space. An identity Transform keeps that true.
        if (layer.children !== undefined) {
            holder.children.push(id);
            const group = entity(id, name, node.parent,
                                 [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
                                 layer.hidden !== true);
            entities.push(group);
            byId.set(id, group);
            continue;
        }

        const { x, y, w, h } = rect(layer);
        const data = layer.imageData;
        if (w <= 0 || h <= 0 || !data) {
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

        let file = `${stem}_${fileStem(name)}`;
        for (let n = 2; used.has(file.toLowerCase()); n++) file = `${stem}_${fileStem(name)}-${n}`;
        used.add(file.toLowerCase());

        const png = new PNG({ width: data.width, height: data.height });
        Buffer.from(data.data.buffer, data.data.byteOffset, data.data.byteLength).copy(png.data);
        images.push({ file: `${file}.png`, bytes: new Uint8Array(PNG.sync.write(png)) });

        // PSD measures from the top-left with Y down; the engine's Y is up and a
        // sprite is placed by its centre. So the document's centre becomes the
        // prefab's origin and the layer's own centre is offset from it.
        holder.children.push(id);
        entities.push(entity(id, name, node.parent, [
            { type: 'Transform', data: { position: {
                x: x + w / 2 - psd.width / 2,
                y: psd.height / 2 - (y + h / 2),
                z: 0,
            } } },
            { type: 'Sprite', data: {
                texture: `${refPrefix}${file}.png`,
                size: { x: w, y: h },
                // Opacity is the layer's, and a Sprite spends it in the tint's alpha.
                color: { r: 1, g: 1, b: 1, a: layer.opacity ?? 1 },
                // The one field that makes a stack a stack. Bottom-to-top is the
                // order the file stores layers in, so the index IS the answer.
                order: Math.min(127, node.depth),
            } },
        ], layer.hidden !== true));
    }

    return {
        images,
        prefab: { version: PREFAB_FORMAT_VERSION, name: stem, rootEntityId: 'root', entities },
        warnings,
    };
}

/** The extensions this import claims. */
export const PSD_EXTENSIONS = ['.psd', '.psb'];

export function isPsdSource(file: string): boolean {
    const dot = file.lastIndexOf('.');
    return dot >= 0 && PSD_EXTENSIONS.includes(file.slice(dot).toLowerCase());
}
