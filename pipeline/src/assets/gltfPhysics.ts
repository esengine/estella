// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { MeshChannel, MeshChannelType, packChannels, q, type Vec3, type Quat } from 'esengine';
import type { ImportedMesh, ImportedNode, Trs } from './modelImport';
import type { CompoundColliderPart3D } from 'esengine/physics3d';

interface BodySource {
    motion?: { type?: string; mass?: number; [key: string]: unknown };
    collider?: { shape?: number };
    trigger?: { shape?: number; nodes?: number[] } | null;
}
interface PhysicsSource {
    nodes?: { extensions?: Record<string, unknown>; extras?: unknown }[];
    extensions?: Record<string, unknown>;
}
const IDENTITY: Trs = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const vector = (a: readonly number[]): Vec3 => ({ x: a[0]!, y: a[1]!, z: a[2]! });
const rotation = (a: readonly number[]): Quat => ({ x: a[0]!, y: a[1]!, z: a[2]!, w: a[3]! });
function compose(a: Trs, b: Trs): Trs {
    const p = q.rotate(rotation(a.rotation), vector(b.translation.map((v, i) => v * a.scale[i]!)));
    const r = q.mul(rotation(a.rotation), rotation(b.rotation));
    return { translation: [a.translation[0] + p.x, a.translation[1] + p.y, a.translation[2] + p.z],
        rotation: [r.x, r.y, r.z, r.w], scale: [a.scale[0] * b.scale[0], a.scale[1] * b.scale[1], a.scale[2] * b.scale[2]] };
}

/** OMI geometry stays in model-local units; CompoundCollider3D applies placement scale once. */
export function readGltfPhysics(source: PhysicsSource, nodes: ImportedNode[], meshes: ImportedMesh[],
    meshIndexOf: ReadonlyMap<string, number>, stem: string, warnings: string[]): void {
    const shapes = (source.extensions?.OMI_physics_shape as { shapes?: Record<string, any>[] } | undefined)?.shapes ?? [];
    const meshParts = new Map<ImportedNode, { mesh: ImportedMesh; trs: Trs }[]>();
    const owners = new Set<ImportedNode>();
    const groupedTriggers = new Map<ImportedNode, Set<number>>();
    const visit = (node: ImportedNode, inherited: ImportedNode | undefined, relative: Trs): void => {
        const body = source.nodes?.[node.index]?.extensions?.OMI_physics_body as BodySource | undefined;
        let owner = inherited, trs = compose(relative, node);
        // A trigger is its own non-solid body; a child motion starts an independent body.
        const trigger = body?.trigger;
        if (body?.motion || (trigger && !groupedTriggers.get(inherited!)?.has(node.index) && (trigger.shape !== undefined || trigger.nodes?.length)) || (!owner && body?.collider)) {
            owner = node; trs = IDENTITY;
            const kind = body?.motion?.type ?? (trigger && inherited ? 'kinematic' : 'static');
            if (!['static', 'kinematic', 'dynamic'].includes(kind)) warnings.push(`${node.name}: unsupported OMI motion "${kind}"; using static`);
            const mass = body?.motion?.mass ?? 1;
            node.physics = { bodyType: kind === 'dynamic' ? 2 : kind === 'kinematic' ? 1 : 0,
                mass: Number.isFinite(mass) && mass > 0 ? mass : 1, isSensor: !!trigger, parts: [] };
            const authored = (source.nodes?.[node.index]?.extras as any)?.estella?.rigidBody;
            if (authored && typeof authored === 'object') {
                const settings: Record<string, unknown> = {};
                for (const key of ['fixedRotation', 'continuousCollision']) if (typeof authored[key] === 'boolean') settings[key] = authored[key];
                for (const key of ['gravityScale', 'linearDamping', 'angularDamping'])
                    if (Number.isFinite(authored[key]) && authored[key] >= 0) settings[key] = authored[key];
                node.physics.settings = settings;
            }
            owners.add(node);
            if (trigger?.nodes) groupedTriggers.set(node, new Set(trigger.nodes));
            for (const key of Object.keys(body?.motion ?? {})) {
                if (key !== 'type' && key !== 'mass') warnings.push(`${node.name}: OMI motion ${key} is not imported`);
            }
        }
        const shapeIndex = trigger?.shape ?? body?.collider?.shape;
        if (shapeIndex !== undefined && owner?.physics) {
            const shape = shapes[shapeIndex];
            const reject = (reason: string) => warnings.push(`${node.name}: OMI collision ${reason}`);
            if (!shape) reject(`shape ${shapeIndex} is missing`);
            else {
                const sx = Math.abs(trs.scale[0]), sy = Math.abs(trs.scale[1]), sz = Math.abs(trs.scale[2]);
                const base = { position: vector(trs.translation), rotation: rotation(trs.rotation) };
                let part: CompoundColliderPart3D | undefined;
                if (shape.type === 'box') {
                    const size = shape.box?.size ?? [1, 1, 1];
                    if (Array.isArray(size) && size.length === 3 && size.every(v => Number.isFinite(v) && v > 0)) {
                        part = { ...base, kind: 'box', halfExtents: { x: size[0] * sx / 2, y: size[1] * sy / 2, z: size[2] * sz / 2 } };
                    } else reject('box size must contain three positive numbers');
                } else if (shape.type === 'sphere' || shape.type === 'capsule') {
                    const radius = shape[shape.type]?.radius ?? .5, height = shape.capsule?.height ?? 2;
                    if (!Number.isFinite(radius) || radius <= 0 || (shape.type === 'capsule' && (!Number.isFinite(height) || height < radius * 2))) {
                        reject('radius / capsule height is invalid');
                    } else part = shape.type === 'sphere'
                        ? { ...base, kind: 'sphere', radius: radius * Math.max(sx, sy, sz) }
                        : { ...base, kind: 'capsule', radius: radius * Math.max(sx, sz), halfHeight: (height / 2 - radius) * sy };
                } else if (shape.type === 'convex' || shape.type === 'trimesh') {
                    if (owner.physics.bodyType !== 0 || owner.physics.isSensor) reject(`${shape.type} in a moving or sensor compound is not supported`);
                    else {
                        const index = shape[shape.type]?.mesh;
                        const parts = meshParts.get(owner) ?? [];
                        let added = 0;
                        for (let primitive = 0; meshIndexOf.has(`${index}_${primitive}`); primitive++) {
                            const mesh = meshes[meshIndexOf.get(`${index}_${primitive}`)!];
                            if (mesh) { parts.push({ mesh, trs }); added++; }
                        }
                        if (!added) reject(`mesh ${index} is missing`);
                        meshParts.set(owner, parts);
                    }
                } else reject(`shape type "${shape.type}" is not supported`);
                if (part) owner.physics.parts.push(part);
            }
        } else if (body && Object.hasOwn(body, 'trigger') && trigger === null) {
            warnings.push(`${node.name}: OMI trigger has no shape (the source exporter wrote null)`);
        }
        for (const child of node.children) visit(child, owner, trs);
    };
    for (const node of nodes) visit(node, undefined, IDENTITY);

    // A static region's detailed collision meshes are one triangle body. This
    // avoids thousands of solver bodies for GridMap cells and keeps authored faces.
    for (const [owner, pieces] of meshParts) {
        if (!pieces.length) continue;
        const positions: number[] = [], indices: number[] = [];
        for (const { mesh, trs } of pieces) {
            const channel = mesh.data.channels.find(c => c.semantic === MeshChannel.Position && c.type === MeshChannelType.Float32);
            if (!channel) continue;
            const data = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset, mesh.data.vertices.byteLength);
            const start = positions.length / 3;
            for (let i = 0; i < mesh.vertexCount; i++) {
                const at = i * mesh.data.vertexStride + channel.offset;
                const p = q.rotate(rotation(trs.rotation), { x: data.getFloat32(at, true) * trs.scale[0],
                    y: data.getFloat32(at + 4, true) * trs.scale[1], z: data.getFloat32(at + 8, true) * trs.scale[2] });
                positions.push(p.x + trs.translation[0], p.y + trs.translation[1], p.z + trs.translation[2]);
            }
            const mirror = trs.scale[0] * trs.scale[1] * trs.scale[2] < 0;
            for (let i = 0; i < mesh.data.indices.length; i += 3) {
                indices.push(start + mesh.data.indices[i]!, start + mesh.data.indices[i + (mirror ? 2 : 1)]!, start + mesh.data.indices[i + (mirror ? 1 : 2)]!);
            }
        }
        if (!indices.length) continue;
        const packed = packChannels([{ semantic: MeshChannel.Position, type: MeshChannelType.Float32, components: 3 }]);
        const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        positions.forEach((v, i) => { const a = i % 3; min[a] = Math.min(min[a]!, v); max[a] = Math.max(max[a]!, v); });
        const vertices = new Float32Array(positions);
        owner.physics!.triangleMesh = meshes.length;
        meshes.push({ name: `${stem}_collision_${owner.index}`, vertexCount: positions.length / 3, triangleCount: indices.length / 3,
            data: { ...packed, vertices: new Uint8Array(vertices.buffer), indices: new Uint32Array(indices), vertexCount: positions.length / 3, aabbMin: min, aabbMax: max } });
    }
    for (const owner of owners) {
        if (!owner.physics!.parts.length && owner.physics!.triangleMesh === undefined) {
            warnings.push(`${owner.name}: no supported collision shape belongs to this body`);
            delete owner.physics;
        }
    }
}
