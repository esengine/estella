// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/meshRenderer.ts
 * @brief   `MeshRenderer`, `ModelRenderer` and `UIMeshRenderer`: views on the engine's mesh renderer, and the material calls scripts make through it.
 *
 * What a script does with a mesh renderer is almost always its material: `getSharedMaterial(0)` to set a property for every renderer that
 * shares it, `getMaterialInstance(0)` to set one for this renderer alone. The engine's renderer holds one material handle, so a
 * renderer has one material; an instance is the engine's own (`Material.createInstance`), made once and kept on the renderer.
 */
import { MeshRenderer as EngineMeshRenderer } from '../ecs/component';
import { Material as EngineMaterial } from '../render/material';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Material } from './assets';
import { Component } from './component';
import { registerBuiltinComponent } from './builtins';
import { viewAdapter } from './ui/view';

/** The layer's material objects, one per engine material, so the same material is the same object. */
const wrappers = new Map<number, Material>();
function wrap(handle: number): Material | null {
    if (handle <= 0) return null;
    let m = wrappers.get(handle);
    if (!m) {
        m = new Material();
        m._handle = handle;
        wrappers.set(handle, m);
    }
    return m;
}

/** The base of every renderer that draws a model. */
export class ModelRenderer extends Component {}

export class MeshRenderer extends ModelRenderer {
    private instance_ = 0;

    private data_() { return this._world.get(this._entity, EngineMeshRenderer); }
    private patch_(fields: Record<string, unknown>): void {
        this._world.set(this._entity, EngineMeshRenderer, { ...this.data_(), ...fields } as never);
    }

    /** Whether the renderer draws. */
    get enabled(): boolean { return this.data_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }

    /** The material every renderer sharing it draws with. */
    get sharedMaterial(): Material | null { return wrap(this.instance_ > 0 ? this.sourceOf_() : this.data_().material); }
    get sharedMaterials(): Material[] { const m = this.sharedMaterial; return m ? [m] : []; }
    /** This renderer's own material: the instance when one was made, else the shared one. */
    get material(): Material | null { return wrap(this.data_().material); }
    set material(m: Material | null) { this.setMaterial(m, 0); }
    get materials(): Material[] { const m = this.material; return m ? [m] : []; }
    set materials(list: Material[]) { this.setMaterial(list[0] ?? null, 0); }

    getSharedMaterial(index: number): Material | null { return index === 0 ? this.sharedMaterial : null; }
    getRenderMaterial(index: number): Material | null { return index === 0 ? this.material : null; }

    /** A material of this renderer alone, made from the shared one the first time and kept after. */
    getMaterialInstance(index: number): Material | null {
        if (index !== 0) return null;
        const current = this.data_().material;
        if (current <= 0) return null;
        if (this.instance_ <= 0 || this.instance_ !== current) {
            this.instance_ = EngineMaterial.createInstance(current);
            this.patch_({ material: this.instance_ });
            this.source_ = current;
        }
        return wrap(this.instance_);
    }

    setMaterial(material: Material | null, index: number): void {
        if (index !== 0) return;
        this.instance_ = 0;
        this.source_ = 0;
        this.patch_({ material: material ? material._handle : 0 });
    }
    setSharedMaterial(material: Material | null, index: number): void { this.setMaterial(material, index); }
    setMaterialInstance(material: Material | null, index: number): void { this.setMaterial(material, index); }

    get receiveShadow(): boolean { return true; }
    set receiveShadow(_v: boolean) { /* shadows are the scene's lighting, not a renderer's switch */ }
    get shadowCastingMode(): number { return this.data_().castShadows ? 1 : 0; }
    set shadowCastingMode(v: number) { this.patch_({ castShadows: v !== 0 }); }

    private source_ = 0;
    private sourceOf_(): number { return this.source_; }
}

/** `UIMeshRenderer`: draws a mesh inside the UI. The engine's UI draws meshes as part of the scene, so this is a place for the call to land. */
export class UIMeshRenderer extends ModelRenderer {}

const hasMesh = (world: World, entity: Entity): boolean => world.has(entity, EngineMeshRenderer);
const addMesh = (world: World, entity: Entity): void => { world.insert(entity, EngineMeshRenderer, {}); };
registerBuiltinComponent(MeshRenderer, ['cc.MeshRenderer', 'MeshRenderer'], viewAdapter(MeshRenderer, hasMesh, addMesh));
registerBuiltinComponent(UIMeshRenderer, ['cc.UIMeshRenderer', 'UIMeshRenderer'], viewAdapter(UIMeshRenderer, () => true, () => { /* nothing stands behind it */ }));
