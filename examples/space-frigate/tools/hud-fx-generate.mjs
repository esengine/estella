import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fx');
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

const spark = {
    version: 1, size: 64,
    layers: [{ shape: 'circle', at: [32, 32], radius: 30, fill: { type: 'radial', at: [32, 32], radius: 30, stops: [[0, '#ffffffff'], [0.18, '#ffffffd0'], [0.5, '#ffffff38'], [1, '#ffffff00']] } }],
};

const beam = {
    version: '1.0', type: 'material', shader: '../materials/plume.esshader', blendMode: 5, depthTest: true, depthWrite: false, cull: 0,
    properties: { u_core: { r: 1.0, g: 0.96, b: 0.82, a: 1 }, u_edge: { r: 1.0, g: 0.42, b: 0.08, a: 1 }, u_strength: 9, u_length: 60, u_flicker: 0.3 },
};

const emitter = (over) => ({
    enabled: true, looping: true, playOnStart: true, simulationSpace: 0, rate: 0, burstCount: 0, duration: 1000, shape: 4, shapeRadius: 1,
    speedMin: 10, speedMax: 40, gravity: { x: 0, y: 0, z: 0 }, damping: 0.6, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0,
    startColor: WHITE, endColor: { r: 1, g: 1, b: 1, a: 0 }, blendMode: 1, texture: 'assets/fx/spark.esimage', lifetimeMin: 0.4, lifetimeMax: 1.1, maxParticles: 400,
    startSizeMin: 1, startSizeMax: 2, endSizeMin: 0.2, endSizeMax: 0.5, renderMode: 0, intensity: 6, collisionEnabled: false,
    ...over,
});

const hot = { stops: [{ t: 0, color: { r: 1, g: 0.95, b: 0.8, a: 1 } }, { t: 0.3, color: { r: 1, g: 0.6, b: 0.18, a: 1 } }, { t: 0.75, color: { r: 1, g: 0.25, b: 0.05, a: 0.8 } }, { t: 1, color: { r: 0.5, g: 0.06, b: 0, a: 0 } }] };

const entity = (id, name, components, children = []) => ({
    prefabEntityId: String(id), name, parent: id === 0 ? null : '0', children: children.map(String), visible: true,
    components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }, ...components],
});

const prefab = {
    version: '2', name: 'MiningFx', rootEntityId: '0',
    entities: [
        entity(0, 'MiningFx', [], [1, 2, 3, 4, 5, 6]),
        entity(1, 'MiningBeam', [{ type: 'MeshRenderer', data: { mesh: 'assets/models/plume.esmesh', color: WHITE, enabled: false, lit: false, opaque: false, cullBackfaces: false, castShadows: false, material: 'assets/fx/beam.esmaterial' } }]),
        entity(2, 'MiningMuzzle', [{ type: 'Light', data: { type: 0, color: { r: 1, g: 0.62, b: 0.25, a: 1 }, intensity: 0, radius: 16, enabled: true, meshShadows: false } }]),
        entity(3, 'MiningImpact', [{ type: 'Light', data: { type: 0, color: { r: 1, g: 0.55, b: 0.2, a: 1 }, intensity: 0, radius: 90, enabled: true, meshShadows: false } }]),
        entity(4, 'MiningGlow', [{ type: 'ParticleEmitter', data: emitter({ shapeRadius: 0.6, speedMin: 0, speedMax: 3, lifetimeMin: 0.12, lifetimeMax: 0.3, maxParticles: 120, startSizeMin: 9, startSizeMax: 16, endSizeMin: 3, endSizeMax: 6, intensity: 9, colorGradient: hot }) }]),
        entity(5, 'MiningSparks', [{ type: 'ParticleEmitter', data: emitter({ shapeRadius: 1.5, speedMin: 18, speedMax: 70, lifetimeMin: 0.5, lifetimeMax: 1.4, maxParticles: 500, startSizeMin: 0.9, startSizeMax: 2.2, endSizeMin: 0.2, endSizeMax: 0.5, renderMode: 1, velocityScale: 0.05, lengthScale: 2.4, intensity: 7, colorGradient: hot }) }]),
        entity(6, 'MiningDebris', [{ type: 'ParticleEmitter', data: emitter({ shapeRadius: 5, speedMin: 12, speedMax: 60, damping: 0.25, lifetimeMin: 1.2, lifetimeMax: 3.2, maxParticles: 600, startSizeMin: 1.5, startSizeMax: 5, endSizeMin: 0.4, endSizeMax: 1.2, intensity: 5, colorGradient: hot }) }]),
    ],
};

mkdirSync(OUT, { recursive: true });
for (const [name, doc] of [['spark.esimage', spark], ['beam.esmaterial', beam], ['mining.esprefab', prefab]]) {
    writeFileSync(path.join(OUT, name), `${JSON.stringify(doc, null, name.endsWith('.esimage') ? 0 : 2)}\n`);
    console.log(`assets/fx/${name}`);
}
