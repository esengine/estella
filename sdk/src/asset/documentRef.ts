// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * Resolve a document-relative path against the referencing file's path — a Tiled
 * tileset image (`"../textures/tileset.png"`), an external `.tsj` source, a material's
 * sibling shader — collapsing `./` and `../` and preserving a URL scheme+authority.
 *
 * This is a dependency-free leaf so it can be shared by BOTH the runtime tilemap loader
 * AND the editor's asset-dependency scan / cook: a tilemap's tileset dependencies must
 * resolve identically wherever they're walked (discover-what-to-ship vs load-it), or the
 * cook embeds one path and the runtime asks for another (the single-file playable then
 * 404s a tileset it did ship, or never shipped it at all).
 */
/**
 * Whether `ref` is already a LOGICAL project path rather than one relative to the
 * document carrying it.
 *
 * The cook rewrites a map's document-relative refs into logical ones
 * (`"../textures/x.png"` → `"assets/textures/x.png"`, see `rewriteTilemapRefs`),
 * because a cooked payload has no directory structure left to be relative to. That
 * only worked while such a map was loaded by `@uuid` — a base path with no
 * directory, so joining was a no-op. Load the same map by its cooked FILE path (a
 * native app reads files, not uuids) and joining doubles the prefix, which is how
 * "assets/textures/tileset.png" became "assets/assets/textures/tileset.png" and
 * every tile went invisible.
 *
 * So the shape the cook emits is recognized here, in the one place both sides
 * share.
 */
export function isLogicalAssetRef(ref: string): boolean {
    return ref.startsWith('/') || ref.startsWith('assets/');
}

/**
 * Prefix of a ref the engine answers in CODE — a stock shader, stock geometry, the
 * tilemap collision palette. Such a ref names no file, so every stage that turns a
 * ref into a path (resolution, the cook's rewrite, a dependency walk) has to
 * recognize it BEFORE resolving, and they have to recognize the same thing.
 */
export const BUILTIN_REF_PREFIX = 'builtin:';

/** Whether `ref` names something built in rather than a file. */
export function isBuiltinAssetRef(ref: string): boolean {
    return ref.startsWith(BUILTIN_REF_PREFIX);
}

/** The id a built-in ref names, minus any `?query` it carries, or null. */
export function builtinRefId(ref: string): string | null {
    if (!isBuiltinAssetRef(ref)) return null;
    const body = ref.slice(BUILTIN_REF_PREFIX.length);
    const query = body.indexOf('?');
    return query < 0 ? body : body.slice(0, query);
}

/**
 * Resolve a ref one document carries about another asset: a logical project path
 * stands as it is, anything else is relative to the document. Every loader whose
 * document names a sibling resolves through this, because the cook rewrites all
 * of those refs to the same logical shape.
 */
export function resolveDocumentRef(documentPath: string, ref: string): string {
    return isLogicalAssetRef(ref) ? ref : resolveRelativePath(documentPath, ref);
}

/** @deprecated Name it for the question, not for Tiled: {@link resolveDocumentRef}. */
export const resolveTiledRef = resolveDocumentRef;

export function resolveRelativePath(basePath: string, relativePath: string): string {
    // Preserve a URL scheme+authority (e.g. "estella://project", "http://host")
    // before normalizing: the "//" after the scheme must survive, but the segment
    // walk below drops empty parts — which would collapse "estella://" to
    // "estella:/" and break the fetch. The editor Play realm resolves assets to
    // absolute estella:// URLs, so a Tiled map's relative tileset image ("../x.png")
    // is joined against such a base.
    const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*|)$/i.exec(basePath);
    const prefix = schemeMatch ? schemeMatch[1] : '';
    const pathPart = schemeMatch ? schemeMatch[2] : basePath;

    const lastSlash = pathPart.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? pathPart.substring(0, lastSlash + 1) : '';
    const parts = (baseDir + relativePath).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            resolved.pop();
        } else if (part !== '.' && part !== '') {
            resolved.push(part);
        }
    }
    return prefix ? `${prefix}/${resolved.join('/')}` : resolved.join('/');
}
