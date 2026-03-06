import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';
import { Constraints, definePropertyGroup, POLYGON_VERTICES_MAX } from '../schemas/schemaConstants';

const ColliderMaterial = definePropertyGroup('Material', [
    { name: 'density', type: 'number', ...Constraints.physDensity },
    { name: 'friction', type: 'number', ...Constraints.physFriction },
    { name: 'restitution', type: 'number', ...Constraints.physBounce, displayName: 'Bounciness' },
    { name: 'isSensor', type: 'boolean', displayName: 'Is Sensor',
      tooltip: 'Detects overlaps without physical collision' },
]);

const ColliderFiltering = definePropertyGroup('Filtering', [
    { name: 'categoryBits', type: 'collision-layer', displayName: 'Layer' },
]);

const RigidBodySchema: ComponentSchema = {
    name: 'RigidBody',
    category: 'physics',
    properties: [
        { name: 'bodyType', type: 'enum', displayName: 'Type',
          options: [{ label: 'Static', value: 0 }, { label: 'Kinematic', value: 1 }, { label: 'Dynamic', value: 2 }] },
        { name: 'gravityScale', type: 'number', step: 0.1, displayName: 'Gravity Scale' },
        { name: 'linearDamping', type: 'number', min: 0, step: 0.1, displayName: 'Linear Damping' },
        { name: 'angularDamping', type: 'number', min: 0, step: 0.1, displayName: 'Angular Damping' },
        { name: 'fixedRotation', type: 'boolean', displayName: 'Fixed Rotation' },
        { name: 'bullet', type: 'boolean', tooltip: 'Enable continuous collision detection for fast-moving objects' },
        { name: 'enabled', type: 'boolean' },
    ],
};

const BoxColliderSchema: ComponentSchema = {
    name: 'BoxCollider',
    category: 'physics',
    properties: [
        { name: 'halfExtents', type: 'vec2', displayName: 'Half Extents' },
        { name: 'offset', type: 'vec2' },
        { name: 'radius', type: 'number', min: 0, step: 0.01, tooltip: 'Corner rounding radius' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
};

const CircleColliderSchema: ComponentSchema = {
    name: 'CircleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'offset', type: 'vec2' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
};

const CapsuleColliderSchema: ComponentSchema = {
    name: 'CapsuleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'halfHeight', type: 'number', min: 0, step: 0.01, displayName: 'Half Height' },
        { name: 'offset', type: 'vec2' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
};

const SegmentColliderSchema: ComponentSchema = {
    name: 'SegmentCollider',
    category: 'physics',
    properties: [
        { name: 'point1', type: 'vec2' },
        { name: 'point2', type: 'vec2' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
};

const PolygonColliderSchema: ComponentSchema = {
    name: 'PolygonCollider',
    category: 'physics',
    properties: [
        { name: 'vertices', type: 'vec2-array', max: POLYGON_VERTICES_MAX },
        { name: 'radius', type: 'number', min: 0, step: 0.01, tooltip: 'Corner rounding radius' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
};

const ChainColliderSchema: ComponentSchema = {
    name: 'ChainCollider',
    category: 'physics',
    properties: [
        { name: 'points', type: 'vec2-array' },
        { name: 'isLoop', type: 'boolean', displayName: 'Is Loop' },
        { name: 'friction', type: 'number', ...Constraints.physFriction, group: 'Material' },
        { name: 'restitution', type: 'number', ...Constraints.physBounce, displayName: 'Bounciness', group: 'Material' },
        ...ColliderFiltering,
    ],
};

const RevoluteJointSchema: ComponentSchema = {
    name: 'RevoluteJoint',
    category: 'physics',
    properties: [
        { name: 'connectedEntity', type: 'entity', displayName: 'Connected Entity' },
        { name: 'anchorA', type: 'vec2', displayName: 'Anchor A' },
        { name: 'anchorB', type: 'vec2', displayName: 'Anchor B' },
        { name: 'enableMotor', type: 'boolean', displayName: 'Enable Motor', group: 'Motor' },
        { name: 'motorSpeed', type: 'number', step: 0.1, displayName: 'Speed', group: 'Motor',
          visibleWhen: { field: 'enableMotor', equals: true } },
        { name: 'maxMotorTorque', type: 'number', min: 0, step: 1, displayName: 'Max Torque', group: 'Motor',
          visibleWhen: { field: 'enableMotor', equals: true } },
        { name: 'enableLimit', type: 'boolean', displayName: 'Enable Limit', group: 'Limits' },
        { name: 'lowerAngle', type: 'number', step: 0.01, displayName: 'Lower Angle', group: 'Limits',
          visibleWhen: { field: 'enableLimit', equals: true } },
        { name: 'upperAngle', type: 'number', step: 0.01, displayName: 'Upper Angle', group: 'Limits',
          visibleWhen: { field: 'enableLimit', equals: true } },
        { name: 'collideConnected', type: 'boolean', displayName: 'Collide Connected' },
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
    register(ctx: EditorPluginContext) {
        for (const schema of PHYSICS_SCHEMAS) {
            ctx.registrar.provide(COMPONENT_SCHEMA, schema.name, schema);
        }
    },
};
