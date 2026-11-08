// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { importGltfMeshes } from '../src/assets/gltfImport';
import { assembleModelPrefab, materialProducts } from '../src/assets/modelImport';
import { plainTriangle } from './fixtures/gltfFixtures.mjs';

function doc() {
    const source = JSON.parse(new TextDecoder().decode(plainTriangle()));
    source.materials = [{ pbrMetallicRoughness: { baseColorFactor: [.2, .4, .6, .8] } }];
    source.meshes[0].primitives[0].material = 0;
    source.nodes = [{ name: 'Root', children: [1] }, { name: 'Object', mesh: 0 }];
    source.scenes = [{ nodes: [0] }]; source.scene = 0;
    return source;
}
function animation(source: any, pointer: string, values: number[] = [1, 0]) {
    const time = new Float32Array([0, 1]), data = new Float32Array(values);
    const bytes = Buffer.concat([Buffer.from(time.buffer), Buffer.from(data.buffer)]);
    const buffer = source.buffers.length, view = source.bufferViews.length, accessor = source.accessors.length;
    source.buffers.push({ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + bytes.toString('base64') });
    source.bufferViews.push({ buffer, byteLength: time.byteLength }, { buffer, byteOffset: time.byteLength, byteLength: data.byteLength });
    source.accessors.push({ bufferView: view, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: view + 1, componentType: 5126, count: values.length, type: 'SCALAR' });
    source.animations = [{ name: 'Toggle', channels: [{ sampler: 0, target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer } } } }],
        samplers: [{ input: accessor, output: accessor + 1, interpolation: 'STEP' }] }];
}
const read = (source: any) => importGltfMeshes(new TextEncoder().encode(JSON.stringify(source)), 'scene');

describe('glTF scene semantics', () => {
    it.each(['OPAQUE', 'MASK', 'BLEND'])('imports unlit %s without applying PBR fallbacks', async alphaMode => {
        const source = doc();
        source.materials[0] = { ...source.materials[0], name: 'skin', alphaMode, alphaCutoff: .35, doubleSided: true,
            emissiveFactor: [1, 0, 0], extensions: { KHR_materials_unlit: {}, KHR_materials_transmission: { transmissionFactor: 1 } } };
        const imported = await read(source), products = materialProducts(imported.meshes, 'scene', { characters: true });
        expect(imported.warnings).not.toContainEqual(expect.stringContaining('KHR_materials_unlit not imported'));
        expect(products[0].data).toMatchObject({ shader: 'builtin:sprite-unlit', depthTest: true, depthWrite: alphaMode !== 'BLEND',
            properties: { u_alphaCutoff: alphaMode === 'MASK' ? .35 : 0 } });
        expect(products[0].data.properties).not.toHaveProperty('u_emissive');
        const prefab = assembleModelPrefab('scene', imported.meshes, { nodes: imported.nodes, refs: { characters: true } });
        expect(prefab.entities.flatMap(e => e.components).find(c => c.type === 'MeshRenderer')?.data)
            .toMatchObject({ lit: false, color: { r: .2, g: .4, b: .6, a: .8 }, material: 'scene_m0.esmaterial' });
    });

    it('keeps initial hidden state and visibility pointer keys on a native subtree gate', async () => {
        const source = doc();
        source.nodes[0].extensions = { KHR_node_visibility: { visible: false } };
        animation(source, '/nodes/1/extensions/KHR_node_visibility/visible');
        const imported = await read(source);
        expect(imported.animations).toHaveLength(1);
        expect(imported.animations![0].document.tracks).toMatchObject([{ component: 'NodeVisibility', childPath: 'Object',
            channels: [{ property: 'visible', keyframes: [{ time: 0, value: 1, interpolation: 'step' }, { time: 1, value: 0, interpolation: 'step' }] }] }]);
        const prefab = assembleModelPrefab('scene', imported.meshes, { nodes: imported.nodes });
        expect(prefab.entities[0].components).toContainEqual({ type: 'NodeVisibility', data: { visible: false } });
        expect(prefab.entities[1].components).toContainEqual({ type: 'NodeVisibility', data: { visible: true } });
    });

    it('reports unsupported pointer paths and malformed visibility samplers explicitly', async () => {
        const source = doc(); animation(source, '/nodes/1/extras/unknown');
        expect((await read(source)).warnings).toContainEqual(expect.stringContaining('/nodes/1/extras/unknown'));
        const invalid = doc(); animation(invalid, '/nodes/1/extensions/KHR_node_visibility/visible', [1]);
        expect((await read(invalid)).warnings).toContainEqual(expect.stringContaining('one scalar per key'));
    });
});

describe('glTF OMI physics', () => {
    it('preserves one dynamic body, mass and rotated offset primitives', async () => {
        const source = doc();
        source.extensions = { OMI_physics_shape: { shapes: [{ type: 'box', box: { size: [2,4,6] } }, { type:'capsule',capsule:{radius:.4,height:2.1} }] } };
        source.nodes = [{ name:'Body',children:[1,2],extensions:{OMI_physics_body:{motion:{type:'dynamic',mass:12}}} },
            { name:'Box',translation:[2,3,4],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],extensions:{OMI_physics_body:{collider:{shape:0}}} },
            { name:'Capsule',extensions:{OMI_physics_body:{collider:{shape:1}}} }];
        source.nodes[0].extras = { estella: { rigidBody: { fixedRotation: true, continuousCollision: true, linearDamping: .2, angularDamping: -2 } } };
        const imported = await read(source), physics = imported.nodes[0].physics!;
        expect(physics).toMatchObject({ bodyType:2,mass:12,isSensor:false });
        expect(physics.parts).toHaveLength(2);
        expect(physics.parts[0]).toMatchObject({ kind:'box',halfExtents:{x:1,y:2,z:3},position:{x:2,y:3,z:4},rotation:{z:Math.SQRT1_2} });
        expect(physics.parts[1].halfHeight).toBeCloseTo(.65);
        const prefab = assembleModelPrefab('scene', imported.meshes, { nodes: imported.nodes });
        expect(prefab.entities.flatMap(e=>e.components).filter(c=>c.type==='RigidBody3D')).toHaveLength(1);
        const rigid = prefab.entities[0].components.find(c=>c.type==='RigidBody3D')!.data;
        expect(rigid).toMatchObject({ fixedRotation: true, continuousCollision: true, linearDamping: .2 });
        expect(rigid.angularDamping).not.toBe(-2);
    });
    it('keeps a compound trigger as one sensor and reports missing source shapes', async () => {
        const source = doc(); source.extensions={OMI_physics_shape:{shapes:[{type:'sphere',sphere:{radius:.4}}]}};
        source.nodes[0].extensions={OMI_physics_body:{trigger:{nodes:[1]}}};
        source.nodes[1].extensions={OMI_physics_body:{trigger:{shape:0}}};
        const imported=await read(source);
        expect(imported.nodes[0].physics).toMatchObject({isSensor:true,parts:[{kind:'sphere',radius:.4}]});
        expect(imported.nodes[0].children[0].physics).toBeUndefined();
        source.nodes[1].extensions.OMI_physics_body.trigger=null;
        expect((await read(source)).warnings).toContainEqual(expect.stringContaining('source exporter wrote null'));
    });
    it('merges static authored collision triangles with their local transforms', async () => {
        const source=doc();source.extensions={OMI_physics_shape:{shapes:[{type:'trimesh',trimesh:{mesh:0}}]}};
        source.nodes[0].extensions={OMI_physics_body:{motion:{type:'static'}}};
        source.nodes[1].translation=[3,4,5];source.nodes[1].extensions={OMI_physics_body:{collider:{shape:0}}};
        const imported=await read(source), index=imported.nodes[0].physics!.triangleMesh!;
        expect(index).toBe(1);expect(imported.meshes[index].data.vertexCount).toBe(3);
        expect(imported.meshes[index].data.aabbMin).toEqual([3,4,5]);
        const prefab=assembleModelPrefab('scene',imported.meshes,{nodes:imported.nodes});
        expect(prefab.entities.flatMap(e=>e.components).filter(c=>c.type==='MeshCollider3D')).toHaveLength(1);
    });
});

function particle() {
    return {
        emitter: { maxParticles: 16, rate: 0, duration: .3, lifetimeMin: .4, lifetimeMax: .6,
            shape: 1, shapeRadius: .1, renderMode: 1, blendMode: 1, enabled: true, looping: false, playOnStart: false,
            shapeSize: { x: 1, y: 1, z: 1 }, startColor: { r: 1, g: .5, b: 0, a: 1 }, endColor: { r: 1, g: .5, b: 0, a: 0 },
            bursts: [{ time: 0, count: 16 }] },
        units: { startSizeMin: .2, startSizeMax: .3, endSizeMin: 0, endSizeMax: 0,
            speedMin: 1, speedMax: 2, gravity: { x: 0, y: -1, z: 0 } }, texture: 0,
    };
}

describe('data-only scene bridge', () => {
    it('imports textured native emitters, particle-only clips and additive billboards', async () => {
        const source = doc();
        source.images = [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }]; source.textures = [{ source: 0 }];
        source.nodes[1].extras = { estella: { particle: particle(), billboard: 0 } };
        source.materials[0].extensions = { KHR_materials_unlit: {} };
        source.materials[0].extras = { estella: { blendMode: 1 } }; source.materials[0].alphaMode = 'BLEND';
        source.animations = [{ name: 'burst', channels: [], samplers: [], extras: { estella: {
            particles: [{ node: 1, events: [{ time: 0, action: 'play' }, { time: .5, action: 'stop' }] }],
        } } }];
        const imported = await read(source);
        expect(imported.animations![0].document).toMatchObject({ duration: .5,
            tracks: [{ type: 'particle', childPath: 'Object', events: [{ time: 0, action: 'play' }, { time: .5, action: 'stop' }] }] });
        const prefab = assembleModelPrefab('scene', imported.meshes, { nodes: imported.nodes, refs: { prefix: 'assets/fx/' } });
        const components = prefab.entities[1].components;
        expect(components).toContainEqual({ type: 'Billboard', data: { mode: 0, enabled: true } });
        expect(components.find(c=>c.type==='ParticleEmitter')!.data).toMatchObject({ maxParticles: 16, texture: expect.stringContaining('scene_') });
        expect(components.find(c=>c.type==='ParticleModelUnits')!.data).toMatchObject({ startSizeMin: .2, speedMax: 2 });
        expect(materialProducts(imported.meshes,'scene')[0].data.blendMode).toBe(1);
    });
    it('skips malformed bridge input with diagnostics instead of aborting geometry import', async () => {
        const source = doc(); source.nodes[1].extras = { estella: { particle: particle() } };
        source.nodes[1].extras.estella.particle.emitter.bursts = [null];
        source.animations = [{ name: 'bad', channels: [], samplers: [], extras: { estella: { particles: {} } } }];
        const imported = await read(source);
        expect(imported.meshes).toHaveLength(1);
        expect(imported.nodes[0].children[0].particle).toBeUndefined();
        expect(imported.warnings).toContainEqual(expect.stringContaining('invalid estella particle data'));
        expect(imported.warnings).toContainEqual(expect.stringContaining('invalid estella particle tracks'));
        source.nodes[1].extras.estella.particle = particle();
        source.animations[0].extras.estella.particles = [{ node: 1, events: [null, { time: 0, action: 'play' }] }, null];
        const recovered = await read(source);
        expect(recovered.animations).toHaveLength(1);
        expect(recovered.warnings).toContainEqual(expect.stringContaining('invalid particle events'));
        expect(recovered.warnings).toContainEqual(expect.stringContaining('invalid estella particle track'));
    });
});
