/**
 * @file    ComponentSchemas.ts
 * @brief   Component property schemas for the inspector
 */

import type { PropertyMeta } from '../property/PropertyEditor';
import { getComponentDefaults } from 'esengine';
import { getSettingsValue } from '../settings/SettingsRegistry';

// =============================================================================
// Types
// =============================================================================

export type ComponentCategory = 'builtin' | 'ui' | 'physics' | 'script' | 'tag';

export interface ComponentSchema {
    name: string;
    category: ComponentCategory;
    properties: PropertyMeta[];
    removable?: boolean;
    hidden?: boolean;
    displayName?: string;
}

// =============================================================================
// Type Inference
// =============================================================================

function isVec2(v: unknown): boolean {
    return typeof v === 'object' && v !== null &&
           'x' in v && 'y' in v && !('z' in v);
}

function isVec3(v: unknown): boolean {
    return typeof v === 'object' && v !== null &&
           'x' in v && 'y' in v && 'z' in v && !('w' in v);
}

function isVec4OrColor(v: unknown): boolean {
    if (typeof v !== 'object' || v === null) return false;
    if ('r' in v && 'g' in v && 'b' in v && 'a' in v) return true;
    return 'x' in v && 'y' in v && 'z' in v && 'w' in v;
}

export function inferPropertyType(value: unknown): string {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'string-array';
    if (isVec2(value)) return 'vec2';
    if (isVec3(value)) return 'vec3';
    if (typeof value === 'object' && value !== null) {
        if ('r' in value && 'g' in value && 'b' in value && 'a' in value) return 'color';
        if ('x' in value && 'y' in value && 'z' in value && 'w' in value) return 'vec4';
    }
    return 'string';
}

// =============================================================================
// Built-in Schemas
// =============================================================================

export const NameSchema: ComponentSchema = {
    name: 'Name',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'value', type: 'string' },
    ],
};

export const ParentSchema: ComponentSchema = {
    name: 'Parent',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'entity', type: 'entity' },
    ],
};

export const ChildrenSchema: ComponentSchema = {
    name: 'Children',
    category: 'tag',
    removable: false,
    properties: [],
};

export const TransformSchema: ComponentSchema = {
    name: 'Transform',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'position', type: 'vec3' },
        { name: 'rotation', type: 'euler' },
        { name: 'scale', type: 'vec3' },
    ],
};

export const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    category: 'builtin',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2', hiddenWhen: { hasComponent: 'UIRect' } },
        { name: 'uvOffset', type: 'vec2' },
        { name: 'uvScale', type: 'vec2' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
    ],
};

export const CameraSchema: ComponentSchema = {
    name: 'Camera',
    category: 'builtin',
    properties: [
        { name: 'isActive', type: 'boolean' },
        {
            name: 'projectionType',
            type: 'enum',
            options: [
                { label: 'Perspective', value: 0 },
                { label: 'Orthographic', value: 1 },
            ],
        },
        { name: 'fov', type: 'number', min: 1, max: 179 },
        { name: 'orthoSize', type: 'number', min: 0.1 },
        { name: 'nearPlane', type: 'number', step: 0.1 },
        { name: 'farPlane', type: 'number', step: 1 },
        { name: 'priority', type: 'number', step: 1 },
        { name: 'viewportX', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportY', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportW', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportH', type: 'number', min: 0, max: 1, step: 0.01 },
        {
            name: 'clearFlags',
            type: 'enum',
            options: [
                { label: 'None', value: 0 },
                { label: 'Color Only', value: 1 },
                { label: 'Depth Only', value: 2 },
                { label: 'Color + Depth', value: 3 },
            ],
        },
        { name: 'showFrustum', type: 'boolean' },
    ],
};

export const TextSchema: ComponentSchema = {
    name: 'Text',
    category: 'ui',
    properties: [
        { name: 'content', type: 'string' },
        { name: 'fontFamily', type: 'font' },
        { name: 'fontSize', type: 'number', min: 8, max: 200 },
        { name: 'color', type: 'color' },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        {
            name: 'verticalAlign',
            type: 'enum',
            options: [
                { label: 'Top', value: 0 },
                { label: 'Middle', value: 1 },
                { label: 'Bottom', value: 2 },
            ],
        },
        { name: 'wordWrap', type: 'boolean' },
        {
            name: 'overflow',
            type: 'enum',
            options: [
                { label: 'Visible', value: 0 },
                { label: 'Clip', value: 1 },
                { label: 'Ellipsis', value: 2 },
            ],
        },
        { name: 'lineHeight', type: 'number', min: 0.5, max: 3, step: 0.1 },
    ],
};

export const UIRectSchema: ComponentSchema = {
    name: 'UIRect',
    category: 'ui',
    properties: [
        { name: '*', type: 'uirect' },
    ],
};

export const CanvasSchema: ComponentSchema = {
    name: 'Canvas',
    category: 'builtin',
    properties: [
        { name: 'designResolution', type: 'vec2' },
        { name: 'pixelsPerUnit', type: 'number', min: 1, step: 1 },
        {
            name: 'scaleMode',
            type: 'enum',
            options: [
                { label: 'FixedWidth', value: 0 },
                { label: 'FixedHeight', value: 1 },
                { label: 'Expand', value: 2 },
                { label: 'Shrink', value: 3 },
                { label: 'Match', value: 4 },
            ],
        },
        { name: 'matchWidthOrHeight', type: 'number', min: 0, max: 1, step: 0.1 },
        { name: 'backgroundColor', type: 'color' },
    ],
};

export const BitmapTextSchema: ComponentSchema = {
    name: 'BitmapText',
    category: 'ui',
    properties: [
        { name: 'text', type: 'string' },
        { name: 'font', type: 'bitmap-font-file' },
        { name: 'color', type: 'color' },
        { name: 'fontSize', type: 'number', min: 0.1, step: 0.1 },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        { name: 'spacing', type: 'number', step: 0.1 },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
    ],
};

export const UIMaskSchema: ComponentSchema = {
    name: 'UIMask',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        {
            name: 'mode',
            type: 'enum',
            options: [
                { label: 'Scissor', value: 0 },
                { label: 'Stencil', value: 1 },
            ],
        },
    ],
};

export const InteractableSchema: ComponentSchema = {
    name: 'Interactable',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'blockRaycast', type: 'boolean' },
        { name: 'raycastTarget', type: 'boolean' },
    ],
};

export const ButtonSchema: ComponentSchema = {
    name: 'Button',
    category: 'ui',
    properties: [
        {
            name: 'state',
            type: 'enum',
            options: [
                { label: 'Normal', value: 0 },
                { label: 'Hovered', value: 1 },
                { label: 'Pressed', value: 2 },
                { label: 'Disabled', value: 3 },
            ],
        },
        { name: 'transition', type: 'button-transition' },
    ],
};

export const TextInputSchema: ComponentSchema = {
    name: 'TextInput',
    category: 'ui',
    properties: [
        { name: 'value', type: 'string' },
        { name: 'placeholder', type: 'string' },
        { name: 'placeholderColor', type: 'color' },
        { name: 'fontFamily', type: 'font' },
        { name: 'fontSize', type: 'number', min: 8, max: 200 },
        { name: 'color', type: 'color' },
        { name: 'backgroundColor', type: 'color' },
        { name: 'padding', type: 'number', min: 0, step: 1 },
        { name: 'maxLength', type: 'number', min: 0, step: 1 },
        { name: 'multiline', type: 'boolean' },
        { name: 'password', type: 'boolean' },
        { name: 'readOnly', type: 'boolean' },
    ],
};

export const VelocitySchema: ComponentSchema = {
    name: 'Velocity',
    category: 'builtin',
    properties: [
        { name: 'linear', type: 'vec3' },
        { name: 'angular', type: 'vec3' },
    ],
};

export const SceneOwnerSchema: ComponentSchema = {
    name: 'SceneOwner',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'scene', type: 'string' },
        { name: 'persistent', type: 'boolean' },
    ],
};

export const SpineAnimationSchema: ComponentSchema = {
    name: 'SpineAnimation',
    category: 'builtin',
    properties: [
        { name: 'skeletonPath', type: 'spine-file', fileFilter: ['.json', '.skel'] },
        { name: 'atlasPath', type: 'spine-file', fileFilter: ['.atlas'] },
        { name: 'material', type: 'material-file' },
        { name: 'skin', type: 'spine-skin', dependsOn: 'skeletonPath' },
        { name: 'animation', type: 'spine-animation', dependsOn: 'skeletonPath' },
        { name: 'timeScale', type: 'number', min: 0, max: 10, step: 0.1 },
        { name: 'loop', type: 'boolean' },
        { name: 'playing', type: 'boolean' },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
        { name: 'color', type: 'color' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
        { name: 'skeletonScale', type: 'number', min: 0.01, max: 100, step: 0.01 },
    ],
};

export const SpriteAnimatorSchema: ComponentSchema = {
    name: 'SpriteAnimator',
    category: 'builtin',
    properties: [
        { name: 'clip', type: 'anim-file' },
        { name: 'speed', type: 'number', min: 0, max: 10, step: 0.1 },
        { name: 'playing', type: 'boolean' },
        { name: 'loop', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

export const AudioSourceSchema: ComponentSchema = {
    name: 'AudioSource',
    category: 'builtin',
    properties: [
        { name: 'clip', type: 'audio-file' },
        { name: 'bus', type: 'enum', options: [
            { label: 'SFX', value: 'sfx' },
            { label: 'Music', value: 'music' },
            { label: 'UI', value: 'ui' },
            { label: 'Voice', value: 'voice' },
        ]},
        { name: 'volume', type: 'number', min: 0, max: 1, step: 0.05 },
        { name: 'pitch', type: 'number', min: 0.1, max: 3, step: 0.1 },
        { name: 'loop', type: 'boolean' },
        { name: 'playOnAwake', type: 'boolean' },
        { name: 'spatial', type: 'boolean' },
        { name: 'minDistance', type: 'number', min: 0, step: 10 },
        { name: 'maxDistance', type: 'number', min: 0, step: 10 },
        { name: 'attenuationModel', type: 'enum', options: [
            { label: 'Linear', value: 0 },
            { label: 'Inverse', value: 1 },
            { label: 'Exponential', value: 2 },
        ]},
        { name: 'rolloff', type: 'number', min: 0, max: 5, step: 0.1 },
        { name: 'priority', type: 'number', min: 0, step: 1 },
        { name: 'enabled', type: 'boolean' },
    ],
};

export const AudioListenerSchema: ComponentSchema = {
    name: 'AudioListener',
    category: 'builtin',
    properties: [
        { name: 'enabled', type: 'boolean' },
    ],
};

export const RigidBodySchema: ComponentSchema = {
    name: 'RigidBody',
    category: 'physics',
    properties: [
        { name: 'bodyType', type: 'enum', options: [
            { label: 'Static', value: 0 },
            { label: 'Kinematic', value: 1 },
            { label: 'Dynamic', value: 2 },
        ]},
        { name: 'gravityScale', type: 'number', step: 0.1 },
        { name: 'linearDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'angularDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'fixedRotation', type: 'boolean' },
        { name: 'bullet', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

export const BoxColliderSchema: ComponentSchema = {
    name: 'BoxCollider',
    category: 'physics',
    properties: [
        { name: 'halfExtents', type: 'vec2' },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
        { name: 'categoryBits', type: 'collision-layer' },
    ],
};

export const CircleColliderSchema: ComponentSchema = {
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

export const CapsuleColliderSchema: ComponentSchema = {
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

export const ImageSchema: ComponentSchema = {
    name: 'Image',
    category: 'ui',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        {
            name: 'imageType',
            type: 'enum',
            options: [
                { label: 'Simple', value: 0 },
                { label: 'Sliced', value: 1 },
                { label: 'Tiled', value: 2 },
                { label: 'Filled', value: 3 },
            ],
        },
        {
            name: 'fillMethod',
            type: 'enum',
            options: [
                { label: 'Horizontal', value: 0 },
                { label: 'Vertical', value: 1 },
            ],
        },
        {
            name: 'fillOrigin',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Right', value: 1 },
                { label: 'Bottom', value: 2 },
                { label: 'Top', value: 3 },
            ],
        },
        { name: 'fillAmount', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'preserveAspect', type: 'boolean' },
        { name: 'tileSize', type: 'vec2' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
    ],
};

export const ToggleSchema: ComponentSchema = {
    name: 'Toggle',
    category: 'ui',
    properties: [
        { name: 'isOn', type: 'boolean' },
        { name: 'graphicEntity', type: 'entity' },
        { name: 'transition', type: 'button-transition' },
    ],
};

export const ToggleGroupSchema: ComponentSchema = {
    name: 'ToggleGroup',
    category: 'ui',
    properties: [
        { name: 'allowSwitchOff', type: 'boolean' },
    ],
};

export const ProgressBarSchema: ComponentSchema = {
    name: 'ProgressBar',
    category: 'ui',
    properties: [
        { name: 'value', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'fillEntity', type: 'entity' },
        {
            name: 'direction',
            type: 'enum',
            options: [
                { label: 'LeftToRight', value: 0 },
                { label: 'RightToLeft', value: 1 },
                { label: 'BottomToTop', value: 2 },
                { label: 'TopToBottom', value: 3 },
            ],
        },
    ],
};

export const DraggableSchema: ComponentSchema = {
    name: 'Draggable',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'dragThreshold', type: 'number', min: 0, step: 1 },
        { name: 'lockX', type: 'boolean' },
        { name: 'lockY', type: 'boolean' },
    ],
};

export const ScrollViewSchema: ComponentSchema = {
    name: 'ScrollView',
    category: 'ui',
    properties: [
        { name: 'contentEntity', type: 'entity' },
        { name: 'horizontalEnabled', type: 'boolean' },
        { name: 'verticalEnabled', type: 'boolean' },
        { name: 'contentWidth', type: 'number', min: 0, step: 1 },
        { name: 'contentHeight', type: 'number', min: 0, step: 1 },
        { name: 'inertia', type: 'boolean' },
        { name: 'decelerationRate', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'elastic', type: 'boolean' },
        { name: 'wheelSensitivity', type: 'number', min: 0, max: 1, step: 0.01 },
    ],
};

export const SliderSchema: ComponentSchema = {
    name: 'Slider',
    category: 'ui',
    properties: [
        { name: 'value', type: 'number', step: 0.01 },
        { name: 'minValue', type: 'number', step: 0.01 },
        { name: 'maxValue', type: 'number', step: 0.01 },
        {
            name: 'direction',
            type: 'enum',
            options: [
                { label: 'LeftToRight', value: 0 },
                { label: 'RightToLeft', value: 1 },
                { label: 'BottomToTop', value: 2 },
                { label: 'TopToBottom', value: 3 },
            ],
        },
        { name: 'fillEntity', type: 'entity' },
        { name: 'handleEntity', type: 'entity' },
        { name: 'wholeNumbers', type: 'boolean' },
    ],
};

export const FocusableSchema: ComponentSchema = {
    name: 'Focusable',
    category: 'ui',
    properties: [
        { name: 'tabIndex', type: 'number', min: 0, step: 1 },
    ],
};

export const SafeAreaSchema: ComponentSchema = {
    name: 'SafeArea',
    category: 'ui',
    properties: [
        { name: 'applyTop', type: 'boolean' },
        { name: 'applyBottom', type: 'boolean' },
        { name: 'applyLeft', type: 'boolean' },
        { name: 'applyRight', type: 'boolean' },
    ],
};

export const ListViewSchema: ComponentSchema = {
    name: 'ListView',
    category: 'ui',
    properties: [
        { name: 'itemHeight', type: 'number', min: 1, step: 1 },
        { name: 'itemCount', type: 'number', min: 0, step: 1 },
        { name: 'overscan', type: 'number', min: 0, step: 1 },
    ],
};

export const DropdownSchema: ComponentSchema = {
    name: 'Dropdown',
    category: 'ui',
    properties: [
        { name: 'options', type: 'string-array' },
        { name: 'selectedIndex', type: 'number', min: -1, step: 1 },
        { name: 'listEntity', type: 'entity' },
        { name: 'labelEntity', type: 'entity' },
    ],
};

export const FlexContainerSchema: ComponentSchema = {
    name: 'FlexContainer',
    category: 'ui',
    properties: [
        {
            name: 'direction',
            type: 'enum',
            options: [
                { label: 'Row', value: 0 },
                { label: 'Column', value: 1 },
                { label: 'RowReverse', value: 2 },
                { label: 'ColumnReverse', value: 3 },
            ],
        },
        {
            name: 'wrap',
            type: 'enum',
            options: [
                { label: 'NoWrap', value: 0 },
                { label: 'Wrap', value: 1 },
            ],
        },
        {
            name: 'justifyContent',
            type: 'enum',
            options: [
                { label: 'Start', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'End', value: 2 },
                { label: 'SpaceBetween', value: 3 },
                { label: 'SpaceAround', value: 4 },
                { label: 'SpaceEvenly', value: 5 },
            ],
        },
        {
            name: 'alignItems',
            type: 'enum',
            options: [
                { label: 'Start', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'End', value: 2 },
                { label: 'Stretch', value: 3 },
            ],
        },
        { name: 'gap', type: 'vec2' },
        { name: 'padding', type: 'vec4' },
    ],
};

export const FlexItemSchema: ComponentSchema = {
    name: 'FlexItem',
    category: 'ui',
    properties: [
        { name: 'flexGrow', type: 'number', min: 0, step: 0.1 },
        { name: 'flexShrink', type: 'number', min: 0, step: 0.1 },
        { name: 'flexBasis', type: 'number', step: 1 },
        { name: 'order', type: 'number', step: 1 },
    ],
};

export const LayoutGroupSchema: ComponentSchema = {
    name: 'LayoutGroup',
    category: 'ui',
    properties: [
        {
            name: 'direction',
            type: 'enum',
            options: [
                { label: 'Horizontal', value: 0 },
                { label: 'Vertical', value: 1 },
            ],
        },
        { name: 'spacing', type: 'number', step: 1 },
        {
            name: 'childAlignment',
            type: 'enum',
            options: [
                { label: 'Start', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'End', value: 2 },
            ],
        },
        { name: 'reverseOrder', type: 'boolean' },
    ],
};

export const ParticleEmitterSchema: ComponentSchema = {
    name: 'ParticleEmitter',
    category: 'builtin',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'playOnStart', type: 'boolean' },
        { name: 'looping', type: 'boolean' },
        { name: 'duration', type: 'number', min: 0, step: 0.1 },
        { name: 'rate', type: 'number', min: 0, step: 1, group: 'Emission' },
        { name: 'burstCount', type: 'number', min: 0, step: 1, group: 'Emission' },
        { name: 'burstInterval', type: 'number', min: 0, step: 0.1, group: 'Emission' },
        { name: 'maxParticles', type: 'number', min: 1, step: 1, group: 'Emission' },
        { name: 'lifetimeMin', type: 'number', min: 0, step: 0.1, group: 'Lifetime' },
        { name: 'lifetimeMax', type: 'number', min: 0, step: 0.1, group: 'Lifetime' },
        {
            name: 'shape',
            type: 'enum',
            group: 'Shape',
            options: [
                { label: 'Point', value: 0 },
                { label: 'Circle', value: 1 },
                { label: 'Rectangle', value: 2 },
                { label: 'Cone', value: 3 },
            ],
        },
        { name: 'shapeRadius', type: 'number', min: 0, step: 0.1, group: 'Shape' },
        { name: 'shapeSize', type: 'vec2', group: 'Shape' },
        { name: 'shapeAngle', type: 'number', min: 0, max: 360, step: 1, group: 'Shape' },
        { name: 'speedMin', type: 'number', min: 0, step: 0.1, group: 'Velocity' },
        { name: 'speedMax', type: 'number', min: 0, step: 0.1, group: 'Velocity' },
        { name: 'angleSpreadMin', type: 'number', min: 0, max: 360, step: 1, group: 'Velocity' },
        { name: 'angleSpreadMax', type: 'number', min: 0, max: 360, step: 1, group: 'Velocity' },
        { name: 'startSizeMin', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'startSizeMax', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'endSizeMin', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'endSizeMax', type: 'number', min: 0, step: 0.1, group: 'Size' },
        {
            name: 'sizeEasing',
            type: 'enum',
            group: 'Size',
            options: [
                { label: 'Linear', value: 0 },
                { label: 'EaseIn', value: 1 },
                { label: 'EaseOut', value: 2 },
                { label: 'EaseInOut', value: 3 },
            ],
        },
        { name: 'startColor', type: 'color', group: 'Color' },
        { name: 'endColor', type: 'color', group: 'Color' },
        {
            name: 'colorEasing',
            type: 'enum',
            group: 'Color',
            options: [
                { label: 'Linear', value: 0 },
                { label: 'EaseIn', value: 1 },
                { label: 'EaseOut', value: 2 },
                { label: 'EaseInOut', value: 3 },
            ],
        },
        { name: 'rotationMin', type: 'number', step: 1, group: 'Rotation' },
        { name: 'rotationMax', type: 'number', step: 1, group: 'Rotation' },
        { name: 'angularVelocityMin', type: 'number', step: 1, group: 'Rotation' },
        { name: 'angularVelocityMax', type: 'number', step: 1, group: 'Rotation' },
        { name: 'gravity', type: 'vec2', group: 'Forces' },
        { name: 'damping', type: 'number', min: 0, step: 0.01, group: 'Forces' },
        { name: 'texture', type: 'texture', group: 'Texture' },
        { name: 'spriteColumns', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteRows', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteFPS', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteLoop', type: 'boolean', group: 'Texture' },
        {
            name: 'blendMode',
            type: 'enum',
            group: 'Rendering',
            options: [
                { label: 'Normal', value: 0 },
                { label: 'Additive', value: 1 },
            ],
        },
        { name: 'layer', type: 'number', min: -1000, max: 1000, group: 'Rendering' },
        { name: 'material', type: 'material-file', group: 'Rendering' },
        {
            name: 'simulationSpace',
            type: 'enum',
            group: 'Rendering',
            options: [
                { label: 'World', value: 0 },
                { label: 'Local', value: 1 },
            ],
        },
    ],
};

export const UIInteractionSchema: ComponentSchema = {
    name: 'UIInteraction',
    category: 'tag',
    removable: false,
    properties: [],
};

export const TilemapSchema: ComponentSchema = {
    name: 'Tilemap',
    category: 'builtin',
    properties: [
        { name: 'source', type: 'tilemap-file' },
    ],
};

export const TilemapLayerSchema: ComponentSchema = {
    name: 'TilemapLayer',
    category: 'builtin',
    hidden: true,
    properties: [
        { name: 'width', type: 'number', min: 1, max: 1000 },
        { name: 'height', type: 'number', min: 1, max: 1000 },
        { name: 'tileWidth', type: 'number', min: 1, max: 512 },
        { name: 'tileHeight', type: 'number', min: 1, max: 512 },
        { name: 'texture', type: 'number' },
        { name: 'tilesetColumns', type: 'number', min: 1, max: 256 },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
    ],
};

// =============================================================================
// Registry
// =============================================================================

const schemaRegistry = new Map<string, ComponentSchema>();

export function registerComponentSchema(schema: ComponentSchema): void {
    schemaRegistry.set(schema.name, schema);
}

export function getComponentSchema(name: string): ComponentSchema | undefined {
    return schemaRegistry.get(name);
}

export function getAllComponentSchemas(): ComponentSchema[] {
    return Array.from(schemaRegistry.values());
}

export function isComponentRemovable(name: string): boolean {
    const schema = schemaRegistry.get(name);
    return schema?.removable !== false;
}

export interface ComponentsByCategory {
    builtin: ComponentSchema[];
    ui: ComponentSchema[];
    physics: ComponentSchema[];
    script: ComponentSchema[];
    tag: ComponentSchema[];
}

export function getComponentsByCategory(): ComponentsByCategory {
    const result: ComponentsByCategory = { builtin: [], ui: [], physics: [], script: [], tag: [] };
    for (const schema of schemaRegistry.values()) {
        result[schema.category].push(schema);
    }
    result.builtin.sort((a, b) => a.name.localeCompare(b.name));
    result.ui.sort((a, b) => a.name.localeCompare(b.name));
    result.physics.sort((a, b) => a.name.localeCompare(b.name));
    result.script.sort((a, b) => a.name.localeCompare(b.name));
    result.tag.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

const builtinSchemaNames = new Set<string>();

export function lockBuiltinComponentSchemas(): void {
    for (const name of schemaRegistry.keys()) builtinSchemaNames.add(name);
}

export function clearExtensionComponentSchemas(): void {
    for (const name of schemaRegistry.keys()) {
        if (!builtinSchemaNames.has(name)) schemaRegistry.delete(name);
    }
}

export function clearScriptComponents(): void {
    for (const [name, schema] of schemaRegistry.entries()) {
        if (builtinSchemaNames.has(name)) continue;
        if (schema.category === 'script' || schema.category === 'tag') {
            schemaRegistry.delete(name);
        }
    }
}

// =============================================================================
// User Component Registration
// =============================================================================

function registerUserComponent(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    const existing = schemaRegistry.get(name);
    if (existing?.category === 'builtin') {
        return;
    }

    const schema: ComponentSchema = {
        name,
        category: isTag ? 'tag' : 'script',
        properties: isTag ? [] : Object.entries(defaults).map(([key, value]) => ({
            name: key,
            type: inferPropertyType(value),
        })),
    };
    schemaRegistry.set(name, schema);
}

function exposeRegistrationAPI(): void {
    if (typeof window !== 'undefined') {
        window.__esengine_registerComponent = registerUserComponent;
    }
}

export const PostProcessVolumeSchema: ComponentSchema = {
    name: 'PostProcessVolume',
    category: 'builtin',
    properties: [],
};

// =============================================================================
// Initialization
// =============================================================================

export interface BuiltinSchemaOptions {
    enableSpine?: boolean;
}

export function registerBuiltinSchemas(options?: BuiltinSchemaOptions): void {
    const enableSpine = options?.enableSpine ?? true;

    registerComponentSchema(NameSchema);
    registerComponentSchema(ParentSchema);
    registerComponentSchema(ChildrenSchema);
    registerComponentSchema(TransformSchema);
    registerComponentSchema(SpriteSchema);
    registerComponentSchema(CameraSchema);
    registerComponentSchema(VelocitySchema);
    registerComponentSchema(SceneOwnerSchema);
    registerComponentSchema(TextSchema);
    registerComponentSchema(UIRectSchema);
    registerComponentSchema(CanvasSchema);
    registerComponentSchema(BitmapTextSchema);
    registerComponentSchema(UIMaskSchema);
    registerComponentSchema(InteractableSchema);
    registerComponentSchema(UIInteractionSchema);
    registerComponentSchema(ButtonSchema);
    registerComponentSchema(TextInputSchema);
    registerComponentSchema(ImageSchema);
    registerComponentSchema(ToggleSchema);
    registerComponentSchema(ToggleGroupSchema);
    registerComponentSchema(ProgressBarSchema);
    registerComponentSchema(DraggableSchema);
    registerComponentSchema(ScrollViewSchema);
    registerComponentSchema(SliderSchema);
    registerComponentSchema(FocusableSchema);
    registerComponentSchema(SafeAreaSchema);
    registerComponentSchema(ListViewSchema);
    registerComponentSchema(DropdownSchema);
    registerComponentSchema(FlexContainerSchema);
    registerComponentSchema(FlexItemSchema);
    registerComponentSchema(LayoutGroupSchema);
    registerComponentSchema(SpriteAnimatorSchema);
    registerComponentSchema(AudioSourceSchema);
    registerComponentSchema(AudioListenerSchema);
    registerComponentSchema(RigidBodySchema);
    registerComponentSchema(BoxColliderSchema);
    registerComponentSchema(CircleColliderSchema);
    registerComponentSchema(CapsuleColliderSchema);
    registerComponentSchema(ParticleEmitterSchema);
    registerComponentSchema(TilemapSchema);
    registerComponentSchema(TilemapLayerSchema);
    registerComponentSchema(PostProcessVolumeSchema);
    if (enableSpine) {
        registerComponentSchema(SpineAnimationSchema);
    }
    exposeRegistrationAPI();
}

export function registerSpineSchema(): void {
    registerComponentSchema(SpineAnimationSchema);
}

// =============================================================================
// Default Component Data
// =============================================================================

export function getDefaultComponentData(typeName: string): Record<string, unknown> {
    return getComponentDefaults(typeName) ?? {};
}

const editorInitialOverrides: Record<string, Record<string, unknown>> = {
    BitmapText: {
        text: 'BitmapText',
        font: '',
    },
    Text: {
        content: 'Text',
        align: 1,
        verticalAlign: 1,
    },
    TextInput: {
        placeholder: 'Enter text...',
    },
};

function getDynamicOverrides(typeName: string): Record<string, unknown> | null {
    switch (typeName) {
        case 'Sprite': {
            const w = getSettingsValue<number>('rendering.defaultSpriteWidth');
            const h = getSettingsValue<number>('rendering.defaultSpriteHeight');
            if (w != null || h != null) {
                return { size: { x: w ?? 100, y: h ?? 100 } };
            }
            return null;
        }
        case 'Canvas': {
            const ppu = getSettingsValue<number>('rendering.pixelsPerUnit');
            if (ppu != null) {
                return { pixelsPerUnit: ppu };
            }
            return null;
        }
        default:
            return null;
    }
}

export function getInitialComponentData(typeName: string): Record<string, unknown> {
    const defaults = getDefaultComponentData(typeName);
    const overrides = editorInitialOverrides[typeName];
    const dynamic = getDynamicOverrides(typeName);
    if (overrides || dynamic) {
        return { ...defaults, ...overrides, ...dynamic };
    }
    return defaults;
}
