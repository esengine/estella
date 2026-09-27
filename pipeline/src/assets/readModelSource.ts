// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which reader a model source gets — the one place a format is named.
 *
 * Both import doors (the editor's and the CLI's) go through here, so adding a
 * format is adding a reader rather than a branch in every caller.
 */
import type { ModelImportResult, SpecularMapReading } from './modelImport';

/** Source formats a project can import. The engine loads none of them. */
export const MODEL_EXTENSIONS = ['.gltf', '.glb', '.fbx'];

/** The extension of `file`, lowercased, or `''`. */
function extensionOf(file: string): string {
    const dot = file.lastIndexOf('.');
    return dot < 0 ? '' : file.slice(dot).toLowerCase();
}

export function isModelSource(file: string): boolean {
    return MODEL_EXTENSIONS.includes(extensionOf(file));
}

/** The products' base name: the source's own file name without its extension. */
export function modelStem(file: string): string {
    const name = file.split(/[\\/]/).pop() ?? file;
    const ext = extensionOf(name);
    return ext ? name.slice(0, -ext.length) : name;
}

export interface ModelSourceOptions {
    /** What the source is called — how a reader resolves the paths inside it. */
    filename?: string;
    /** Resolver for the files a source points out to: a glTF's non-data `buffers[].uri`,
     *  and any DDS image, which is read to be converted. */
    externalBuffers?: (uri: string) => Uint8Array | null;
    /** The model's `specularMap` import setting; FBX is the format that carries one. */
    specularMap?: SpecularMapReading;
}

/**
 * Reads a model source into the products a project can reference.
 *
 * @param bytes The file, whichever of {@link MODEL_EXTENSIONS} it is.
 * @param stem  Base name for the products.
 */
export async function readModelSource(bytes: Uint8Array, stem: string,
                                      options: ModelSourceOptions = {}): Promise<ModelImportResult> {
    let result: ModelImportResult;
    const fbx = extensionOf(options.filename ?? '') === '.fbx';
    if (fbx) {
        const { importFbxMeshes } = await import('./fbxImport');
        result = await importFbxMeshes(bytes, stem, options.filename, options.specularMap);
    } else {
        const { importGltfMeshes } = await import('./gltfImport');
        result = await importGltfMeshes(bytes, stem, options.externalBuffers);
    }
    const { prepareModelImages } = await import('./modelImages');
    prepareModelImages(result, options.externalBuffers, { alphaFromBaseColor: fbx });
    return result;
}
