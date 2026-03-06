import { ServiceToken } from './ServiceToken';

export interface PluginRegistrar {
    provide<V>(token: ServiceToken<V>, key: string, value: V): void;
    get<V>(token: ServiceToken<V>, key: string): V | undefined;
    has<V>(token: ServiceToken<V>, key: string): boolean;
    getAll<V>(token: ServiceToken<V>): ReadonlyMap<string, V>;
}

export class EditorContainer implements PluginRegistrar {
    private stores_ = new Map<ServiceToken<any>, Map<string, any>>();
    private builtinKeys_ = new Map<ServiceToken<any>, Set<string>>();
    private locked_ = false;

    provide<V>(token: ServiceToken<V>, key: string, value: V): void {
        let map = this.stores_.get(token);
        if (!map) {
            map = new Map();
            this.stores_.set(token, map);
        }
        map.set(key, value);
    }

    get<V>(token: ServiceToken<V>, key: string): V | undefined {
        return this.stores_.get(token)?.get(key) as V | undefined;
    }

    has<V>(token: ServiceToken<V>, key: string): boolean {
        return this.stores_.get(token)?.has(key) ?? false;
    }

    getAll<V>(token: ServiceToken<V>): ReadonlyMap<string, V> {
        return (this.stores_.get(token) as ReadonlyMap<string, V>) ?? new Map<string, V>();
    }

    remove<V>(token: ServiceToken<V>, key: string): boolean {
        return this.stores_.get(token)?.delete(key) ?? false;
    }

    removeWhere<V>(token: ServiceToken<V>, pred: (key: string, value: V) => boolean): void {
        const map = this.stores_.get(token);
        if (!map) return;
        for (const [key, value] of map) {
            if (pred(key, value)) map.delete(key);
        }
    }

    isBuiltin<V>(token: ServiceToken<V>, key: string): boolean {
        return this.builtinKeys_.get(token)?.has(key) ?? false;
    }

    lockBuiltins(): void {
        if (this.locked_) return;
        this.locked_ = true;
        for (const [token, map] of this.stores_) {
            this.builtinKeys_.set(token, new Set(map.keys()));
        }
    }

    getOrdered<V extends { order?: number }>(token: ServiceToken<V>): V[] {
        return Array.from(this.getAll(token).values())
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    filter<V>(token: ServiceToken<V>, pred: (v: V) => boolean): V[] {
        return Array.from(this.getAll(token).values()).filter(pred);
    }

    clearExtensions(): void {
        for (const [token, map] of this.stores_) {
            const builtin = this.builtinKeys_.get(token);
            if (!builtin) {
                map.clear();
                continue;
            }
            for (const key of map.keys()) {
                if (!builtin.has(key)) map.delete(key);
            }
        }
    }
}

let editorContainer_: EditorContainer | null = null;

export function setEditorContainer(container: EditorContainer): void {
    editorContainer_ = container;
}

export function getEditorContainer(): EditorContainer {
    if (!editorContainer_) {
        throw new Error('EditorContainer not initialized');
    }
    return editorContainer_;
}
