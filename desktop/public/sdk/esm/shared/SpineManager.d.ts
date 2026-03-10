import { E as Entity, a as ESEngineModule, C as CppRegistry } from './wasm.js';
import { a as SpineModuleController, b as SpineModuleFactory } from './app.js';

declare class ModuleBackend {
    private controller_;
    private entities_;
    constructor(controller: SpineModuleController);
    get controller(): SpineModuleController;
    get entityCount(): number;
    loadEntity(entity: Entity, skelData: Uint8Array | string, atlasText: string, textures: Map<string, {
        glId: number;
        w: number;
        h: number;
    }>, isBinary: boolean): boolean;
    setEntityProps(entity: Entity, props: {
        skeletonScale?: number;
        flipX?: boolean;
        flipY?: boolean;
        layer?: number;
    }): void;
    setAnimation(entity: Entity, animation: string, loop: boolean): void;
    setSkin(entity: Entity, skin: string): void;
    getBounds(entity: Entity): {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    getAnimations(entity: Entity): string[];
    getSkins(entity: Entity): string[];
    updateAll(dt: number): void;
    extractAndSubmitMeshes(coreModule: ESEngineModule, registry: CppRegistry): void;
    removeEntity(entity: Entity): void;
    shutdown(): void;
}

type SpineVersion = '3.8' | '4.1' | '4.2';
declare class SpineManager {
    private coreModule_;
    private factories_;
    private backends_;
    private loadingBackends_;
    private entityVersions_;
    constructor(coreModule: ESEngineModule, moduleFactories: Map<SpineVersion, SpineModuleFactory>);
    static detectVersion(data: Uint8Array): SpineVersion | null;
    static detectVersionJson(json: string): SpineVersion | null;
    loadEntity(entity: Entity, skelData: Uint8Array | string, atlasText: string, textures: Map<string, {
        glId: number;
        w: number;
        h: number;
    }>, registry: CppRegistry): Promise<SpineVersion | null>;
    updateAnimations(dt: number): void;
    submitMeshes(registry: CppRegistry): void;
    removeEntity(entity: Entity): void;
    getEntityVersion(entity: Entity): SpineVersion | undefined;
    hasModuleBackend(version: SpineVersion): boolean;
    getModuleBackend(version: SpineVersion): ModuleBackend | undefined;
    setAnimation(entity: Entity, animation: string, loop: boolean): void;
    setSkin(entity: Entity, skin: string): void;
    setEntityProps(entity: Entity, props: {
        skeletonScale?: number;
        flipX?: boolean;
        flipY?: boolean;
        layer?: number;
    }): void;
    getBounds(entity: Entity): {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    getAnimations(entity: Entity): string[];
    getSkins(entity: Entity): string[];
    hasInstance(entity: Entity): boolean;
    shutdown(): void;
    private ensureBackend;
}

export { ModuleBackend as M, SpineManager as S };
export type { SpineVersion as a };
