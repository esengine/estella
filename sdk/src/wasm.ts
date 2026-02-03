/**
 * @file    wasm.ts
 * @brief   WASM module type definitions
 */

import { Entity } from './types';

// =============================================================================
// C++ Registry Interface
// =============================================================================

export interface CppRegistry {
    create(): Entity;
    destroy(entity: Entity): void;
    valid(entity: Entity): boolean;

    addLocalTransform(entity: Entity, data: unknown): void;
    getLocalTransform(entity: Entity): unknown;
    hasLocalTransform(entity: Entity): boolean;
    removeLocalTransform(entity: Entity): void;

    addWorldTransform(entity: Entity, data: unknown): void;
    getWorldTransform(entity: Entity): unknown;
    hasWorldTransform(entity: Entity): boolean;
    removeWorldTransform(entity: Entity): void;

    addSprite(entity: Entity, data: unknown): void;
    getSprite(entity: Entity): unknown;
    hasSprite(entity: Entity): boolean;
    removeSprite(entity: Entity): void;

    addCamera(entity: Entity, data: unknown): void;
    getCamera(entity: Entity): unknown;
    hasCamera(entity: Entity): boolean;
    removeCamera(entity: Entity): void;

    addCanvas(entity: Entity, data: unknown): void;
    getCanvas(entity: Entity): unknown;
    hasCanvas(entity: Entity): boolean;
    removeCanvas(entity: Entity): void;

    addVelocity(entity: Entity, data: unknown): void;
    getVelocity(entity: Entity): unknown;
    hasVelocity(entity: Entity): boolean;
    removeVelocity(entity: Entity): void;

    addParent(entity: Entity, data: unknown): void;
    getParent(entity: Entity): unknown;
    hasParent(entity: Entity): boolean;
    removeParent(entity: Entity): void;

    addChildren(entity: Entity, data: unknown): void;
    getChildren(entity: Entity): unknown;
    hasChildren(entity: Entity): boolean;
    removeChildren(entity: Entity): void;

    [key: string]: unknown;
}

// =============================================================================
// C++ Resource Manager
// =============================================================================

export interface CppResourceManager {
    createTexture(width: number, height: number, pixels: number, pixelsLen: number, format: number): number;
    createShader(vertSrc: string, fragSrc: string): number;
    releaseTexture(handle: number): void;
    releaseShader(handle: number): void;
}

// =============================================================================
// WASM Module Interface
// =============================================================================

export interface ESEngineModule {
    Registry: new () => CppRegistry;
    HEAPU8: Uint8Array;

    initRenderer(): void;
    shutdownRenderer(): void;
    renderFrame(registry: CppRegistry, width: number, height: number): void;
    getResourceManager(): CppResourceManager;

    _malloc(size: number): number;
    _free(ptr: number): void;
}
