import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';

const RigidBodySchema: ComponentSchema = {
    name: 'RigidBody',
    category: 'physics',
    properties: [
        { name: 'bodyType', type: 'enum', options: [{ label: 'Static', value: 0 }, { label: 'Kinematic', value: 1 }, { label: 'Dynamic', value: 2 }] },
        { name: 'gravityScale', type: 'number', step: 0.1 },
        { name: 'linearDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'angularDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'fixedRotation', type: 'boolean' },
        { name: 'bullet', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

const BoxColliderSchema: ComponentSchema = {
    name: 'BoxCollider',
    category: 'physics',
    properties: [
        { name: 'halfExtents', type: 'vec2' },
        { name: 'offset', type: 'vec2' },
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const CircleColliderSchema: ComponentSchema = {
    name: 'CircleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const CapsuleColliderSchema: ComponentSchema = {
    name: 'CapsuleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'halfHeight', type: 'number', min: 0, step: 0.01 },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const SegmentColliderSchema: ComponentSchema = {
    name: 'SegmentCollider',
    category: 'physics',
    properties: [
        { name: 'point1', type: 'vec2' },
        { name: 'point2', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const PolygonColliderSchema: ComponentSchema = {
    name: 'PolygonCollider',
    category: 'physics',
    properties: [
        { name: 'vertices', type: 'vec2-array', max: 8 },
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const ChainColliderSchema: ComponentSchema = {
    name: 'ChainCollider',
    category: 'physics',
    properties: [
        { name: 'points', type: 'vec2-array' },
        { name: 'isLoop', type: 'boolean' },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

const RevoluteJointSchema: ComponentSchema = {
    name: 'RevoluteJoint',
    category: 'physics',
    properties: [
        { name: 'connectedEntity', type: 'entity' },
        { name: 'anchorA', type: 'vec2' },
        { name: 'anchorB', type: 'vec2' },
        { name: 'enableMotor', type: 'boolean' },
        { name: 'motorSpeed', type: 'number', step: 0.1 },
        { name: 'maxMotorTorque', type: 'number', min: 0, step: 1 },
        { name: 'enableLimit', type: 'boolean' },
        { name: 'lowerAngle', type: 'number', step: 0.01 },
        { name: 'upperAngle', type: 'number', step: 0.01 },
        { name: 'collideConnected', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

const PHYSICS_SCHEMAS: ComponentSchema[] = [
    RigidBodySchema, BoxColliderSchema, CircleColliderSchema,
    CapsuleColliderSchema, SegmentColliderSchema, PolygonColliderSchema,
    ChainColliderSchema, RevoluteJointSchema,
];

export const physicsPlugin: EditorPlugin = {
    name: 'physics',
    register() {
        for (const schema of PHYSICS_SCHEMAS) {
            registerComponentSchema(schema);
        }
    },
};
