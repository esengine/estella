/**
 * @file    AssetRefCounter.ts
 * @brief   Optional asset reference counting for debugging and monitoring
 */

export interface AssetRefInfo {
    assetPath: string;
    refCount: number;
    entities: number[];
}

export class AssetRefCounter {
    private textureRefs_ = new Map<string, Set<number>>();
    private fontRefs_ = new Map<string, Set<number>>();
    private materialRefs_ = new Map<string, Set<number>>();

    addTextureRef(path: string, entity: number): void {
        let refs = this.textureRefs_.get(path);
        if (!refs) {
            refs = new Set();
            this.textureRefs_.set(path, refs);
        }
        refs.add(entity);
    }

    removeTextureRef(path: string, entity: number): void {
        const refs = this.textureRefs_.get(path);
        if (refs) {
            refs.delete(entity);
            if (refs.size === 0) {
                this.textureRefs_.delete(path);
            }
        }
    }

    getTextureRefCount(path: string): number {
        return this.textureRefs_.get(path)?.size ?? 0;
    }

    getTextureRefs(path: string): number[] {
        return Array.from(this.textureRefs_.get(path) ?? []);
    }

    addFontRef(path: string, entity: number): void {
        let refs = this.fontRefs_.get(path);
        if (!refs) {
            refs = new Set();
            this.fontRefs_.set(path, refs);
        }
        refs.add(entity);
    }

    removeFontRef(path: string, entity: number): void {
        const refs = this.fontRefs_.get(path);
        if (refs) {
            refs.delete(entity);
            if (refs.size === 0) {
                this.fontRefs_.delete(path);
            }
        }
    }

    getFontRefCount(path: string): number {
        return this.fontRefs_.get(path)?.size ?? 0;
    }

    getFontRefs(path: string): number[] {
        return Array.from(this.fontRefs_.get(path) ?? []);
    }

    addMaterialRef(path: string, entity: number): void {
        let refs = this.materialRefs_.get(path);
        if (!refs) {
            refs = new Set();
            this.materialRefs_.set(path, refs);
        }
        refs.add(entity);
    }

    removeMaterialRef(path: string, entity: number): void {
        const refs = this.materialRefs_.get(path);
        if (refs) {
            refs.delete(entity);
            if (refs.size === 0) {
                this.materialRefs_.delete(path);
            }
        }
    }

    getMaterialRefCount(path: string): number {
        return this.materialRefs_.get(path)?.size ?? 0;
    }

    getMaterialRefs(path: string): number[] {
        return Array.from(this.materialRefs_.get(path) ?? []);
    }

    getAllTextureRefs(): AssetRefInfo[] {
        const result: AssetRefInfo[] = [];
        for (const [path, refs] of this.textureRefs_.entries()) {
            result.push({
                assetPath: path,
                refCount: refs.size,
                entities: Array.from(refs),
            });
        }
        return result;
    }

    getAllFontRefs(): AssetRefInfo[] {
        const result: AssetRefInfo[] = [];
        for (const [path, refs] of this.fontRefs_.entries()) {
            result.push({
                assetPath: path,
                refCount: refs.size,
                entities: Array.from(refs),
            });
        }
        return result;
    }

    getAllMaterialRefs(): AssetRefInfo[] {
        const result: AssetRefInfo[] = [];
        for (const [path, refs] of this.materialRefs_.entries()) {
            result.push({
                assetPath: path,
                refCount: refs.size,
                entities: Array.from(refs),
            });
        }
        return result;
    }

    removeAllRefsForEntity(entity: number): void {
        for (const refs of this.textureRefs_.values()) {
            refs.delete(entity);
        }
        for (const refs of this.fontRefs_.values()) {
            refs.delete(entity);
        }
        for (const refs of this.materialRefs_.values()) {
            refs.delete(entity);
        }

        for (const [path, refs] of this.textureRefs_.entries()) {
            if (refs.size === 0) {
                this.textureRefs_.delete(path);
            }
        }
        for (const [path, refs] of this.fontRefs_.entries()) {
            if (refs.size === 0) {
                this.fontRefs_.delete(path);
            }
        }
        for (const [path, refs] of this.materialRefs_.entries()) {
            if (refs.size === 0) {
                this.materialRefs_.delete(path);
            }
        }
    }

    clear(): void {
        this.textureRefs_.clear();
        this.fontRefs_.clear();
        this.materialRefs_.clear();
    }

    getTotalRefCount(): { textures: number; fonts: number; materials: number } {
        return {
            textures: this.textureRefs_.size,
            fonts: this.fontRefs_.size,
            materials: this.materialRefs_.size,
        };
    }
}
