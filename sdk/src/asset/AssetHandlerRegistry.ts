import type { AssetServer } from './AssetServer';

export type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline' | (string & {});

export interface AssetFieldHandler {
    load(
        paths: Set<string>,
        assetServer: AssetServer,
        baseUrl: string | undefined,
        texturePathToUrl: Map<string, string>,
    ): Promise<Map<string, number>>;
}

const handlers_ = new Map<string, AssetFieldHandler>();
let initialized_ = false;
let initFn_: (() => void) | null = null;

export function setBuiltinAssetHandlerInit(fn: () => void): void {
    initFn_ = fn;
}

function ensureInitialized(): void {
    if (!initialized_ && initFn_) {
        initialized_ = true;
        initFn_();
    }
}

export function registerAssetHandler(type: string, handler: AssetFieldHandler): void {
    handlers_.set(type, handler);
}

export function getAssetHandler(type: string): AssetFieldHandler | undefined {
    ensureInitialized();
    return handlers_.get(type);
}

export function getAssetHandlers(): ReadonlyMap<string, AssetFieldHandler> {
    ensureInitialized();
    return handlers_;
}

export function clearAssetHandlerRegistry(): void {
    handlers_.clear();
    initialized_ = false;
}
