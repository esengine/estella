// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { assetRefId, normalizeAssetPathSeparators } from './AssetRegistry';
import { registeredAssetFields } from './registeredAssetFields';

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

export function hasAssetFileExtension(ref: string, extension: string): boolean {
    return ref.split(/[?#]/, 1)[0].toLowerCase().endsWith(extension.toLowerCase());
}

/** File-backed component and motion fields also accept registered names, which need no asset load. */
export function isFileAssetRef(ref: unknown, extension: string): ref is string {
    if (typeof ref !== 'string' || !ref) return false;
    const id = assetRefId(ref);
    if (id !== null) return !!id;
    const path = ref.replace(/\\/g, '/');
    return isLogicalAssetRef(path) || path.startsWith('./') || path.startsWith('../')
        || /^(?:[a-z][a-z0-9+.-]*:\/\/|data:|blob:)/i.test(path)
        || hasAssetFileExtension(path, extension);
}

/** A game may register a name for a slot that declares a file format alongside it. */
export function isRegisteredAssetName(ref: unknown, fileExtension?: string): ref is string {
    return !!fileExtension && typeof ref === 'string' && !!ref.trim() && assetRefId(ref) === null
        && !isBuiltinAssetRef(ref) && !isFileAssetRef(ref, fileExtension);
}

/** The project index and runtime loaders use different type names for these two formats. */
export function matchesAssetFieldType(indexed: string | undefined, type: string): boolean {
    return indexed === type || (indexed === 'animation' && type === 'timeline') || (indexed === 'animclip' && type === 'anim-clip');
}

/** Identify a file-backed motion and its indexed path. Names of code registrations keep their authored spelling. */
export function animatorMotionFile(
    kind: string | undefined, clip: string, documentPath: string, typeAt: (path: string) => string | undefined,
): { type: 'timeline' | 'anim-clip'; path?: string } | undefined {
    if (!clip || (kind !== 'sprite' && kind !== 'timeline')) return undefined;
    const { type, fileExtension } = kind === 'sprite' ? registeredAssetFields.SpriteAnimator : registeredAssetFields.TimelinePlayer;
    const explicit = isFileAssetRef(clip, fileExtension);
    const path = findDocumentAsset(documentPath, clip, candidate => {
        const indexed = typeAt(candidate);
        return indexed && (explicit || matchesAssetFieldType(indexed, type)) ? candidate : undefined;
    }, 'document');
    return explicit || path ? { type, path } : undefined;
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
    return rebaseDocumentRef(documentPath, ref, 'project');
}

/** A relative owner will itself be joined to another document, so keep leading parent segments. */
export function rebaseDocumentRef(documentPath: string, ref: string, owner: 'project' | 'relative'): string {
    if (isLocatorOrId(ref)) return ref;
    const child = normalizeAssetPathSeparators(ref);
    return isLogicalAssetRef(child) ? child : joinDocumentPath(documentPath, child, owner === 'relative');
}

/** @deprecated Name it for the question, not for Tiled: {@link resolveDocumentRef}. */
export const resolveTiledRef = resolveDocumentRef;

/** A qualified reference has one owner. Older unqualified names can also be looked up in the project index. */
export function findDocumentAsset<T>(
    document: string, ref: string, lookup: (path: string) => T | undefined, first: 'project' | 'document' = 'project',
): T | undefined {
    const normalized = normalizeAssetPathSeparators(ref);
    if (isLocatorOrId(normalized)) return undefined;
    const exact = lookupDocumentPath(document, normalized, lookup, first);
    if (exact !== undefined) return exact;
    // Honor literal indexed names before treating a query or fragment as URL metadata.
    const suffix = normalized.search(/[?#]/);
    return suffix > 0 ? lookupDocumentPath(document, normalized.slice(0, suffix), lookup, first) : undefined;
}

function lookupDocumentPath<T>(document: string, ref: string, lookup: (path: string) => T | undefined, first: 'project' | 'document'): T | undefined {
    if (isLogicalAssetRef(ref)) return lookup(ref.replace(/^\//, ''));
    const sibling = resolveDocumentRef(document, ref).replace(/^\//, '');
    if (ref === sibling || ref.startsWith('./') || ref.startsWith('../')) return lookup(sibling);
    return first === 'document' ? lookup(sibling) ?? lookup(ref) : lookup(ref) ?? lookup(sibling);
}

/** Prefer the document's sibling, using the index for legacy unqualified project paths. */
export function resolveIndexedSiblingRef(document: string, ref: string, isKnown: (path: string) => boolean): string {
    return resolveIndexedRef(document, ref, isKnown, 'document');
}

/** Preserve legacy project paths, allowing indexed siblings and explicit relative paths. */
export function resolveIndexedProjectRef(document: string, ref: string, isKnown: (path: string) => boolean): string {
    return resolveIndexedRef(document, ref, isKnown, 'project');
}

function resolveIndexedRef(document: string, ref: string, isKnown: (path: string) => boolean, first: 'project' | 'document'): string {
    const normalized = normalizeAssetPathSeparators(ref);
    if (isLocatorOrId(normalized)) return ref;
    const relative = normalized.startsWith('./') || normalized.startsWith('../');
    const qualified = isLogicalAssetRef(normalized) || relative;
    if (!qualified || /[?#]/.test(normalized)) {
        const indexed = findDocumentAsset(document, normalized, path => isKnown(path) ? path : undefined, first);
        if (indexed !== undefined) return indexed;
    }
    return qualified || first === 'document' ? resolveDocumentRef(document, ref) : normalized;
}

function isLocatorOrId(ref: string): boolean {
    return /^[\\/]{2}/.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref) || assetRefId(ref) !== null;
}

/** Join path segments literally. Asset references with project or index semantics use resolveDocumentRef. */
export function resolveRelativePath(basePath: string, relativePath: string): string {
    return joinDocumentPath(basePath, relativePath.replace(/\\/g, '/'), true);
}

function joinDocumentPath(basePath: string, child: string, relativeBase: boolean): string {
    if (child.startsWith('#')) return basePath.split('#', 1)[0] + child;
    const base = basePath.split(/[?#]/, 1)[0].replace(/\\/g, '/');
    if (child.startsWith('?')) return base + child;
    const end = child.search(/[?#]/);
    const relativePath = end < 0 ? child : child.slice(0, end);
    const suffix = end < 0 ? '' : child.slice(end);
    // Preserve a URL scheme+authority (e.g. "estella://project", "http://host")
    // before normalizing: the "//" after the scheme must survive, but the segment
    // walk below drops empty parts — which would collapse "estella://" to
    // "estella:/" and break the fetch. The editor Play realm resolves assets to
    // absolute estella:// URLs, so a Tiled map's relative tileset image ("../x.png")
    // is joined against such a base.
    const origin = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*/i.exec(base)?.[0] ?? '';
    const pathPart = base.slice(origin.length);
    const prefix = (origin || pathPart.startsWith('/')) ? origin + '/' : '';
    const keepParents = relativeBase && !prefix && !isLogicalAssetRef(pathPart);

    const lastSlash = pathPart.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? pathPart.substring(0, lastSlash + 1) : '';
    const parts = (baseDir + relativePath).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            if (resolved.length && resolved[resolved.length - 1] !== '..') resolved.pop();
            else if (keepParents) resolved.push('..');
        } else if (part !== '.' && part !== '') {
            resolved.push(part);
        }
    }
    return prefix + resolved.join('/') + suffix;
}
