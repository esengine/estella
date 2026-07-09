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
