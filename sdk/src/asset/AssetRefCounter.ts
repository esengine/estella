/**
 * @file    AssetRefCounter.ts
 * @brief   Optional asset reference counting for debugging and monitoring
 */

export interface AssetRefInfo {
    assetPath: string;
    refCount: number;
    entities: number[];
}

class RefMap {
    private refs_ = new Map<string, Set<number>>();

    add(path: string, entity: number): void {
        let refs = this.refs_.get(path);
        if (!refs) {
            refs = new Set();
            this.refs_.set(path, refs);
        }
        refs.add(entity);
    }

    remove(path: string, entity: number): void {
        const refs = this.refs_.get(path);
        if (refs) {
            refs.delete(entity);
            if (refs.size === 0) this.refs_.delete(path);
        }
    }

    getCount(path: string): number {
        return this.refs_.get(path)?.size ?? 0;
    }

    getRefs(path: string): number[] {
        return Array.from(this.refs_.get(path) ?? []);
    }

    getAll(): AssetRefInfo[] {
        const result: AssetRefInfo[] = [];
        for (const [path, refs] of this.refs_) {
            result.push({ assetPath: path, refCount: refs.size, entities: Array.from(refs) });
        }
        return result;
    }

    removeEntity(entity: number): void {
        for (const [path, refs] of this.refs_) {
            refs.delete(entity);
            if (refs.size === 0) this.refs_.delete(path);
        }
    }

    get size(): number { return this.refs_.size; }

    clear(): void { this.refs_.clear(); }
}

export class AssetRefCounter {
    private textures_ = new RefMap();
    private fonts_ = new RefMap();
    private materials_ = new RefMap();

    addTextureRef(path: string, entity: number): void { this.textures_.add(path, entity); }
    removeTextureRef(path: string, entity: number): void { this.textures_.remove(path, entity); }
    getTextureRefCount(path: string): number { return this.textures_.getCount(path); }
    getTextureRefs(path: string): number[] { return this.textures_.getRefs(path); }
    getAllTextureRefs(): AssetRefInfo[] { return this.textures_.getAll(); }

    addFontRef(path: string, entity: number): void { this.fonts_.add(path, entity); }
    removeFontRef(path: string, entity: number): void { this.fonts_.remove(path, entity); }
    getFontRefCount(path: string): number { return this.fonts_.getCount(path); }
    getFontRefs(path: string): number[] { return this.fonts_.getRefs(path); }
    getAllFontRefs(): AssetRefInfo[] { return this.fonts_.getAll(); }

    addMaterialRef(path: string, entity: number): void { this.materials_.add(path, entity); }
    removeMaterialRef(path: string, entity: number): void { this.materials_.remove(path, entity); }
    getMaterialRefCount(path: string): number { return this.materials_.getCount(path); }
    getMaterialRefs(path: string): number[] { return this.materials_.getRefs(path); }
    getAllMaterialRefs(): AssetRefInfo[] { return this.materials_.getAll(); }

    removeAllRefsForEntity(entity: number): void {
        this.textures_.removeEntity(entity);
        this.fonts_.removeEntity(entity);
        this.materials_.removeEntity(entity);
    }

    clear(): void {
        this.textures_.clear();
        this.fonts_.clear();
        this.materials_.clear();
    }

    getTotalRefCount(): { textures: number; fonts: number; materials: number } {
        return {
            textures: this.textures_.size,
            fonts: this.fonts_.size,
            materials: this.materials_.size,
        };
    }
}
