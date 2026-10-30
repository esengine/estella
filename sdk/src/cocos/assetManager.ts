// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/assetManager.ts
 * @brief   `resources.load`, `assetManager.loadBundle` / `loadRemote` / `loadAny`, and `Bundle`.
 *
 * In Cocos a path under a `resources` folder (or a bundle) names an asset by its location, resolved at run time. The engine has no
 * such folder convention, so the importer writes a *manifest* — `assets/cocos/resources.json`, bundle name → path inside the
 * bundle → the project file and its kind — and this layer resolves a Cocos path through it.
 *
 * Kinds that load: **prefab** (prepared, so a following `instantiate` works), **json** and **text**. Textures, sprite frames,
 * audio and the rest come back with an error that says so, since a loaded asset of those kinds must be bound to the engine's
 * resource tables and that binding is not made here yet; a script gets a failure it can handle rather than an empty object.
 *
 * The cache objects (`assetManager.assets`, `.bundles`, `.cacheManager`) have the shape scripts iterate; what is in them is what
 * this layer has loaded.
 */
import { platformFetch } from '../platform';
import { log } from '../util/logger';
import { Asset, JsonAsset, Material, Prefab, TextAsset } from './assets';
import { getCurrentWorld } from './node';
import { assetsFor, loadPrefab } from './prefabs';

export interface ResourceEntry {
    /** The project-relative path of the file. */
    path: string;
    /** What kind of asset it is: `prefab`, `json`, `text`, or another the layer cannot load. */
    kind: string;
    /** The Cocos uuid of the asset, which `loadAny({ uuid })` names it by. */
    uuid?: string;
}
export type ResourceManifest = Record<string, Record<string, ResourceEntry>>;

type Callback<T> = (err: Error | null, data: T) => void;
type AssetCtor = new (...args: any[]) => Asset;

/** A Map with the extra reads Cocos's `Cache` has. */
export class Cache<T> {
    private readonly map_ = new Map<string, T>();
    get count(): number { return this.map_.size; }
    get(key: string): T | undefined { return this.map_.get(key); }
    has(key: string): boolean { return this.map_.has(key); }
    add(key: string, value: T): T { this.map_.set(key, value); return value; }
    remove(key: string): T | undefined { const v = this.map_.get(key); this.map_.delete(key); return v; }
    clear(): void { this.map_.clear(); }
    entries(): IterableIterator<[string, T]> { return this.map_.entries(); }
    forEach(fn: (value: T, key: string) => void): void { this.map_.forEach(fn); }
    find(predicate: (value: T, key: string) => boolean): T | null {
        for (const [k, v] of this.map_) if (predicate(v, k)) return v;
        return null;
    }
    destroy(): void { this.map_.clear(); }
}

let manifest: ResourceManifest | null = null;
let manifestLoad: Promise<ResourceManifest> | null = null;
const MANIFEST_PATH = 'assets/cocos/resources.json';

/** Provide the manifest directly (a host that has it, or a test). */
export function setResourceManifest(m: ResourceManifest): void { manifest = m; manifestLoad = null; }

async function theManifest(): Promise<ResourceManifest> {
    if (manifest) return manifest;
    manifestLoad ??= (async () => {
        const assets = assetsFor(getCurrentWorld());
        if (!assets) throw new Error('the engine\'s asset loader is not running');
        const loaded = await assets.loadJson<ResourceManifest>(MANIFEST_PATH);
        manifest = loaded.data;
        return manifest;
    })();
    try {
        return await manifestLoad;
    } catch (err) {
        manifestLoad = null;
        throw new Error(`cocos compat: cannot read the resource manifest ${MANIFEST_PATH}: ${String((err as Error).message ?? err)}`);
    }
}

const stripExt = (p: string): string => p.replace(/\.[^./]+$/, '');

/** `(path, type?, onProgress?, onComplete?)` in every order Cocos accepts. */
function parseLoadArgs<T>(args: unknown[]): { type: AssetCtor | null; onProgress: ((a: number, b: number, item: unknown) => void) | null; onComplete: Callback<T> | null } {
    let type: AssetCtor | null = null;
    const fns: Function[] = [];
    for (const a of args) {
        if (typeof a !== 'function') continue;
        if ((a as { prototype?: unknown }).prototype instanceof Asset || a === Asset) type = a as AssetCtor;
        else fns.push(a);
    }
    return { type, onProgress: fns.length > 1 ? (fns[0] as never) : null, onComplete: (fns.length > 1 ? fns[1] : fns[0] ?? null) as Callback<T> | null };
}

const loaded = new Cache<Asset>();

/** An asset of a kind the layer does not load: not a fault of the asset, so a directory load goes on without it. */
export class UnsupportedAssetKind extends Error {}

async function loadEntry(entry: ResourceEntry, type: AssetCtor | null): Promise<Asset> {
    const assets = assetsFor(getCurrentWorld());
    switch (entry.kind) {
        case 'prefab': {
            if (type && type !== Prefab && !(Prefab.prototype instanceof type)) break;
            return loadPrefab(entry.path);
        }
        case 'json': {
            if (!assets) throw new Error('the engine\'s asset loader is not running');
            const a = new JsonAsset(entry.path);
            a.json = (await assets.loadJson(entry.path)).data;
            return a;
        }
        case 'text': {
            const response = await platformFetch(entry.path);
            if (!response.ok) throw new Error(`could not read ${entry.path}: ${response.status}`);
            const a = new TextAsset(entry.path);
            a.text = await response.text();
            return a;
        }
        case 'mtl':
        case 'material': {
            // a Cocos material file is not converted: a script that asks for one gets a Material with no engine material behind it, which takes
            // properties and holds them, so what loads it carries on
            if (type && type !== Material && !(Material.prototype instanceof type)) break;
            return new Material(entry.path);
        }
        default:
    }
    throw new UnsupportedAssetKind(`cocos compat: loading "${entry.path}" (${entry.kind}${type ? `, as ${type.name}` : ''}) is not supported by the compatibility layer yet; prefabs, JSON and text are`);
}

export class Bundle {
    readonly base = '';
    constructor(readonly name: string, private readonly entries_: () => Promise<Record<string, ResourceEntry>>) {}

    private async entry_(path: string): Promise<ResourceEntry> {
        const entries = await this.entries_();
        const found = entries[stripExt(path)] ?? entries[path];
        if (!found) throw new Error(`cocos compat: bundle "${this.name}" has no asset "${path}"`);
        return found;
    }

    load(...args: unknown[]): void {
        const paths = args[0];
        const { type, onProgress, onComplete } = parseLoadArgs<Asset | Asset[]>(args.slice(1));
        const list = Array.isArray(paths) ? paths as string[] : [paths as string];
        (async () => {
            const out: Asset[] = [];
            for (let i = 0; i < list.length; i++) {
                const entry = await this.entry_(list[i]!);
                const key = `${this.name}/${entry.path}`;
                let asset = loaded.get(key);
                if (!asset) loaded.add(key, (asset = await loadEntry(entry, type)));
                out.push(asset);
                onProgress?.(i + 1, list.length, entry);
            }
            return Array.isArray(paths) ? out : out[0]!;
        })().then(
            (r) => onComplete?.(null, r),
            (e: Error) => { if (onComplete) onComplete(e, null as never); else log.warn('cocos', e.message); },
        );
    }

    loadDir(...args: unknown[]): void {
        const dir = String(args[0]).replace(/\/$/, '');
        const { type, onProgress, onComplete } = parseLoadArgs<Asset[]>(args.slice(1));
        (async () => {
            const entries = await this.entries_();
            const keys = Object.keys(entries).filter((k) => dir === '' || k === dir || k.startsWith(`${dir}/`));
            const out: Asset[] = [];
            const skipped = new Set<string>();
            for (let i = 0; i < keys.length; i++) {
                const entry = entries[keys[i]!]!;
                try {
                    const key = `${this.name}/${entry.path}`;
                    let asset = loaded.get(key);
                    if (!asset) loaded.add(key, (asset = await loadEntry(entry, type)));
                    out.push(asset);
                } catch (err) {
                    // an entry of a kind that does not load, or of another type than asked for, is left out: a directory of configs holds a readme too
                    if (type) continue;
                    if (err instanceof UnsupportedAssetKind) { skipped.add(entry.kind); continue; }
                    throw err;
                }
                onProgress?.(i + 1, keys.length, entry);
            }
            if (skipped.size > 0) log.info('cocos', `loadDir("${dir}") left out the assets of kind ${[...skipped].join(', ')}, which the layer does not load`);
            return out;
        })().then(
            (r) => onComplete?.(null, r),
            (e: Error) => { if (onComplete) onComplete(e, null as never); else log.warn('cocos', e.message); },
        );
    }

    /** Preparing is loading, here. */
    preload(...args: unknown[]): void { this.load(...args); }
    preloadDir(...args: unknown[]): void { this.loadDir(...args); }

    /** The asset at @p path if it has been loaded. */
    get<T extends Asset>(path: string, _type?: AssetCtor): T | null {
        for (const [key, asset] of loaded.entries()) {
            if (key.startsWith(`${this.name}/`) && stripExt(key.slice(this.name.length + 1)).endsWith(stripExt(path))) return asset as T;
        }
        return null;
    }
    getInfoWithPath(path: string): { path: string; kind: string } | null {
        const m = manifest?.[this.name]?.[stripExt(path)];
        return m ? { path: m.path, kind: m.kind } : null;
    }
    getDirWithPath(dir: string): Array<{ path: string; kind: string }> {
        const entries = manifest?.[this.name] ?? {};
        return Object.entries(entries).filter(([k]) => k === dir || k.startsWith(`${dir.replace(/\/$/, '')}/`)).map(([path, e]) => ({ path, kind: e.kind }));
    }
    release(path: string): void { const a = this.get(path); if (a) loaded.remove(`${this.name}/${(a as Asset).path}`); }
    releaseAll(): void { for (const [k] of [...loaded.entries()]) if (k.startsWith(`${this.name}/`)) loaded.remove(k); }
}

const bundleOf = (name: string): Bundle => new Bundle(name, async () => (await theManifest())[name] ?? {});

const bundles = new Cache<Bundle>();
const resources = bundleOf('resources');
bundles.add('resources', resources);

class AssetManager {
    /** The cache class, as `AssetManager.Cache`: scripts derive their own caches from it. */
    static readonly Cache = Cache;
    static readonly Bundle = Bundle;
    /** The names Cocos gives its own bundles. */
    static readonly BuiltinBundleName = Object.freeze({ INTERNAL: 'internal', MAIN: 'main', RESOURCES: 'resources', START_SCENE: 'start-scene' });
    /** The one asset manager, as `AssetManager.instance`: the same object the module exports as `assetManager`. */
    static get instance(): AssetManager { return assetManager; }
    /** `factory`: how a downloaded file is made into an object, by kind. The registrations a game makes are held; files here are made by the layer's own loaders. */
    readonly factory = {
        _creators: {} as Record<string, unknown>,
        register(type: string | Record<string, unknown>, handler?: unknown): void {
            if (typeof type === 'string') this._creators[type] = handler;
            else Object.assign(this._creators, type);
        },
    };
    readonly assets = loaded;
    readonly bundles = bundles;
    readonly resources = resources;
    readonly presets: Record<string, { priority: number; maxConcurrency: number }> = {
        default: { priority: 0, maxConcurrency: 6 }, preload: { priority: -1, maxConcurrency: 2 }, scene: { priority: 1, maxConcurrency: 6 }, bundle: { priority: 2, maxConcurrency: 6 }, remote: { priority: 0, maxConcurrency: 6 },
    };
    /**
     * `assetManager.downloader`: how Cocos fetches a file of each kind. Here a file is read from the project or by URL, so it takes the registrations
     * a game makes (its own scheme for remote bundles) and holds them, and says what it is told about where remote bundles live.
     */
    readonly downloader = {
        remoteServerAddress: '',
        bundleVers: {} as Record<string, string>,
        maxConcurrency: 6,
        maxRequestsPerFrame: 6,
        _downloaders: {} as Record<string, unknown>,
        _remoteBundles: [] as string[],
        register(type: string | Record<string, unknown>, handler?: unknown): void {
            if (typeof type === 'string') this._downloaders[type] = handler;
            else Object.assign(this._downloaders, type);
        },
        loadSubpackage(_name: string, _onProgress?: unknown, _onComplete?: unknown): void { /* every file is in the project */ },
    };

    readonly cacheManager = {
        cacheDir: '', cachedFiles: new Cache<unknown>(), tempFiles: new Cache<unknown>(), cacheInterval: 500, cacheEnabled: false,
        clearCache(): void { this.cachedFiles.clear(); },
        clearLRU(): void { /* no persistent cache */ },
        removeCache(url: string): void { this.cachedFiles.remove(url); },
        getCache(url: string): unknown { return this.cachedFiles.get(url); },
        getTemp(url: string): unknown { return this.tempFiles.get(url); },
    };

    getBundle(name: string): Bundle | null { return bundles.get(name) ?? null; }
    removeBundle(bundle: Bundle): void { bundles.remove(bundle.name); }

    /** A bundle by name; the manifest says what is in it. */
    loadBundle(nameOrUrl: string, ...rest: unknown[]): void {
        const onComplete = rest.find((a) => typeof a === 'function') as Callback<Bundle> | undefined;
        const name = nameOrUrl.replace(/\/+$/, '').split('/').pop() ?? nameOrUrl;
        theManifest().then((m) => {
            if (!m[name]) throw new Error(`cocos compat: no bundle "${name}" in the resource manifest`);
            const bundle = bundles.get(name) ?? bundles.add(name, bundleOf(name));
            onComplete?.(null, bundle);
        }).catch((e: Error) => { if (onComplete) onComplete(e, null as never); else log.warn('cocos', e.message); });
    }

    /** A file by URL. JSON and text are read; an image or binary is not made into an asset here. */
    loadRemote(url: string, ...rest: unknown[]): void {
        const onComplete = rest.find((a) => typeof a === 'function') as Callback<Asset> | undefined;
        const ext = (rest.find((a) => typeof a === 'object' && a !== null) as { ext?: string } | undefined)?.ext ?? (/\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1] ?? '');
        (async () => {
            if (!/^\.?(json|txt|text|atlas|xml|csv)$/i.test(ext)) {
                throw new Error(`cocos compat: loadRemote of "${ext || 'this kind of'}" files is not supported by the compatibility layer yet; JSON and text are`);
            }
            const response = await platformFetch(url);
            if (!response.ok) throw new Error(`could not read ${url}: ${response.status}`);
            if (/json/i.test(ext)) { const a = new JsonAsset(url); a.json = await response.json(); return a; }
            const a = new TextAsset(url); a.text = await response.text(); return a;
        })().then((a) => { loaded.add(url, a); onComplete?.(null, a); }, (e: Error) => { if (onComplete) onComplete(e, null as never); else log.warn('cocos', e.message); });
    }

    /** Requests in the shapes a script writes: `{ url }` remote, `{ path, bundle?, type? }` a bundle's asset, `{ uuid }` or a bare uuid (by the manifest's listing). */
    loadAny(requests: unknown, ...rest: unknown[]): void {
        const onComplete = rest.find((a) => typeof a === 'function') as Callback<unknown> | undefined;
        const one = (r: any): Promise<Asset> => new Promise((resolve, reject) => {
            const done: Callback<Asset> = (e, a) => (e ? reject(e) : resolve(a));
            if (r && typeof r === 'object' && typeof r.url === 'string') this.loadRemote(r.url, r, done);
            else if (r && typeof r === 'object' && typeof r.path === 'string') (bundles.get(r.bundle ?? 'resources') ?? resources).load(r.path, r.type ?? null, done);
            else if (r && typeof r === 'object' && typeof r.uuid === 'string') {
                this.loadByUuid_(r.uuid, r.type ?? null).then(resolve, reject);
            } else if (typeof r === 'string') this.loadByUuid_(r, null).then(resolve, reject);
            else reject(new Error('cocos compat: loadAny takes a uuid, a bundle path or a url'));
        });
        const list = Array.isArray(requests) ? requests : [requests];
        Promise.all(list.map(one)).then(
            (r) => onComplete?.(null, Array.isArray(requests) ? r : r[0]),
            (e: Error) => { if (onComplete) onComplete(e, null); else log.warn('cocos', e.message); },
        );
    }

    /** The bundle and key a uuid is listed under in the resource manifest. */
    private async loadByUuid_(uuid: string, type: AssetCtor | null): Promise<Asset> {
        const m = await theManifest();
        for (const [bundle, entries] of Object.entries(m)) {
            for (const [key, entry] of Object.entries(entries)) {
                if (entry.uuid !== uuid) continue;
                return new Promise<Asset>((resolve, reject) => {
                    (bundles.get(bundle) ?? resources).load(key, type, (e: Error | null, a: Asset) => (e ? reject(e) : resolve(a)));
                });
            }
        }
        throw new Error(`cocos compat: no asset with uuid ${uuid} is listed in the project's bundles`);
    }

    releaseAsset(asset: Asset): void { for (const [k, v] of [...loaded.entries()]) if (v === asset) loaded.remove(k); }
    releaseAll(): void { loaded.clear(); }
}

export { AssetManager };
export const assetManager = new AssetManager();
export { resources };
