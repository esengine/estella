import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { Constraints, POLYGON_VERTICES_MAX } from '../schemas/schemaConstants';

const COLLIDER_MATERIAL_OVERRIDES = {
    density: { ...Constraints.physDensity, group: 'Material' },
    friction: { ...Constraints.physFriction, group: 'Material' },
    restitution: { ...Constraints.physBounce, displayName: 'Bounciness', group: 'Material' },
    isSensor: { displayName: 'Is Sensor', tooltip: 'Detects overlaps without physical collision', group: 'Material' },
} as const;

const COLLIDER_FILTERING_OVERRIDES = {
    categoryBits: { type: 'collision-layer', displayName: 'Layer', group: 'Filtering' },
    maskBits: { type: 'collision-layer', displayName: 'Mask', group: 'Filtering' },
} as const;

const SPRING_VISIBLE = { field: 'enableSpring', equals: true } as const;
const MOTOR_VISIBLE = { field: 'enableMotor', equals: true } as const;
const LIMIT_VISIBLE = { field: 'enableLimit', equals: true } as const;

function registerPhysicsSchemas(): void {
    defineSchema('RigidBody', {
        category: 'physics',
        overrides: {
            bodyType: { type: 'enum', displayName: 'Type',
                options: [{ label: 'Static', value: 0 }, { label: 'Kinematic', value: 1 }, { label: 'Dynamic', value: 2 }] },
            gravityScale: { step: 0.1, displayName: 'Gravity Scale' },
            linearDamping: { min: 0, step: 0.1, displayName: 'Linear Damping' },
            angularDamping: { min: 0, step: 0.1, displayName: 'Angular Damping' },
            fixedRotation: { displayName: 'Fixed Rotation' },
            bullet: { tooltip: 'Enable continuous collision detection for fast-moving objects' },
        },
    });

    defineSchema('BoxCollider', {
        category: 'physics',
        overrides: {
            halfExtents: { displayName: 'Half Extents' },
            radius: { min: 0, step: 0.01, tooltip: 'Corner rounding radius' },
            ...COLLIDER_MATERIAL_OVERRIDES,
            ...COLLIDER_FILTERING_OVERRIDES,
        },
        exclude: ['enabled'],
    });

    defineSchema('CircleCollider', {
        category: 'physics',
        overrides: {
            radius: { min: 0, step: 0.01 },
            ...COLLIDER_MATERIAL_OVERRIDES,
            ...COLLIDER_FILTERING_OVERRIDES,
        },
        exclude: ['enabled'],
    });

    defineSchema('CapsuleCollider', {
        category: 'physics',
        overrides: {
            radius: { min: 0, step: 0.01 },
            halfHeight: { min: 0, step: 0.01, displayName: 'Half Height' },
            ...COLLIDER_MATERIAL_OVERRIDES,
            ...COLLIDER_FILTERING_OVERRIDES,
        },
        exclude: ['enabled'],
    });

    defineSchema('SegmentCollider', {
        category: 'physics',
        overrides: {
            ...COLLIDER_MATERIAL_OVERRIDES,
            ...COLLIDER_FILTERING_OVERRIDES,
        },
        exclude: ['enabled'],
    });

    defineSchema('PolygonCollider', {
        category: 'physics',
        overrides: {
            vertices: { max: POLYGON_VERTICES_MAX },
            radius: { min: 0, step: 0.01, tooltip: 'Corner rounding radius' },
            ...COLLIDER_MATERIAL_OVERRIDES,
            ...COLLIDER_FILTERING_OVERRIDES,
        },
    });

    defineSchema('ChainCollider', {
        category: 'physics',
        overrides: {
            isLoop: { displayName: 'Is Loop' },
            friction: { ...Constraints.physFriction, group: 'Material' },
            restitution: { ...Constraints.physBounce, displayName: 'Bounciness', group: 'Material' },
            ...COLLIDER_FILTERING_OVERRIDES,
        },
    });

    defineSchema('RevoluteJoint', {
        category: 'physics',
        overrides: {
            connectedEntity: { displayName: 'Connected Entity' },
            anchorA: { displayName: 'Anchor A' },
            anchorB: { displayName: 'Anchor B' },
            enableMotor: { displayName: 'Enable Motor', group: 'Motor' },
            motorSpeed: { step: 0.1, displayName: 'Speed', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            maxMotorTorque: { min: 0, step: 1, displayName: 'Max Torque', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            enableLimit: { displayName: 'Enable Limit', group: 'Limits' },
            lowerAngle: { step: 0.01, displayName: 'Lower Angle', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            upperAngle: { step: 0.01, displayName: 'Upper Angle', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            collideConnected: { displayName: 'Collide Connected' },
        },
    });

    defineSchema('DistanceJoint', {
        category: 'physics',
        overrides: {
            connectedEntity: { displayName: 'Connected Entity' },
            anchorA: { displayName: 'Anchor A' },
            anchorB: { displayName: 'Anchor B' },
            length: { min: 0, step: 0.1, displayName: 'Rest Length' },
            enableSpring: { displayName: 'Enable Spring', group: 'Spring' },
            hertz: { min: 0, step: 0.1, group: 'Spring', visibleWhen: SPRING_VISIBLE },
            dampingRatio: { min: 0, step: 0.1, displayName: 'Damping Ratio', group: 'Spring', visibleWhen: SPRING_VISIBLE },
            enableLimit: { displayName: 'Enable Limit', group: 'Limits' },
            minLength: { min: 0, step: 0.1, displayName: 'Min Length', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            maxLength: { min: 0, step: 0.1, displayName: 'Max Length', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            enableMotor: { displayName: 'Enable Motor', group: 'Motor' },
            maxMotorForce: { min: 0, step: 1, displayName: 'Max Force', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            motorSpeed: { step: 0.1, displayName: 'Speed', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            collideConnected: { displayName: 'Collide Connected' },
        },
    });

    defineSchema('PrismaticJoint', {
        category: 'physics',
        overrides: {
            connectedEntity: { displayName: 'Connected Entity' },
            anchorA: { displayName: 'Anchor A' },
            anchorB: { displayName: 'Anchor B' },
            axis: { displayName: 'Axis' },
            enableSpring: { displayName: 'Enable Spring', group: 'Spring' },
            hertz: { min: 0, step: 0.1, group: 'Spring', visibleWhen: SPRING_VISIBLE },
            dampingRatio: { min: 0, step: 0.1, displayName: 'Damping Ratio', group: 'Spring', visibleWhen: SPRING_VISIBLE },
            enableLimit: { displayName: 'Enable Limit', group: 'Limits' },
            lowerTranslation: { step: 0.1, displayName: 'Lower', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            upperTranslation: { step: 0.1, displayName: 'Upper', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            enableMotor: { displayName: 'Enable Motor', group: 'Motor' },
            maxMotorForce: { min: 0, step: 1, displayName: 'Max Force', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            motorSpeed: { step: 0.1, displayName: 'Speed', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            collideConnected: { displayName: 'Collide Connected' },
        },
    });

    defineSchema('WeldJoint', {
        category: 'physics',
        overrides: {
            connectedEntity: { displayName: 'Connected Entity' },
            anchorA: { displayName: 'Anchor A' },
            anchorB: { displayName: 'Anchor B' },
            linearHertz: { min: 0, step: 0.1, displayName: 'Linear Hertz', group: 'Stiffness' },
            angularHertz: { min: 0, step: 0.1, displayName: 'Angular Hertz', group: 'Stiffness' },
            linearDampingRatio: { min: 0, step: 0.1, displayName: 'Linear Damping', group: 'Stiffness' },
            angularDampingRatio: { min: 0, step: 0.1, displayName: 'Angular Damping', group: 'Stiffness' },
            collideConnected: { displayName: 'Collide Connected' },
        },
    });

    defineSchema('WheelJoint', {
        category: 'physics',
        overrides: {
            connectedEntity: { displayName: 'Connected Entity' },
            anchorA: { displayName: 'Anchor A' },
            anchorB: { displayName: 'Anchor B' },
            axis: { displayName: 'Axis' },
            enableSpring: { displayName: 'Enable Spring', group: 'Spring' },
            hertz: { min: 0, step: 0.1, group: 'Spring', visibleWhen: SPRING_VISIBLE },
            dampingRatio: { min: 0, step: 0.1, displayName: 'Damping Ratio', group: 'Spring', visibleWhen: SPRING_VISIBLE },
            enableLimit: { displayName: 'Enable Limit', group: 'Limits' },
            lowerTranslation: { step: 0.1, displayName: 'Lower', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            upperTranslation: { step: 0.1, displayName: 'Upper', group: 'Limits', visibleWhen: LIMIT_VISIBLE },
            enableMotor: { displayName: 'Enable Motor', group: 'Motor' },
            maxMotorTorque: { min: 0, step: 1, displayName: 'Max Torque', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            motorSpeed: { step: 0.1, displayName: 'Speed', group: 'Motor', visibleWhen: MOTOR_VISIBLE },
            collideConnected: { displayName: 'Collide Connected' },
        },
    });
}

export const physicsPlugin: EditorPlugin = {
    name: 'physics',
    register(_ctx: EditorPluginContext) {
        registerPhysicsSchemas();
    },
};
