import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { uiRectBoundsProvider } from '../bounds/UIRectBoundsProvider';
import { COMPONENT_SCHEMA, BOUNDS_PROVIDER } from '../container/tokens';

const UIRectSchema: ComponentSchema = {
    name: 'UIRect',
    category: 'ui',
    properties: [
        { name: '*', type: 'uirect' },
    ],
};

const UIMaskSchema: ComponentSchema = {
    name: 'UIMask',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'mode', type: 'enum', options: [{ label: 'Scissor', value: 0 }, { label: 'Stencil', value: 1 }] },
    ],
};

const InteractableSchema: ComponentSchema = {
    name: 'Interactable',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'blockRaycast', type: 'boolean' },
        { name: 'raycastTarget', type: 'boolean' },
    ],
};

const UIInteractionSchema: ComponentSchema = {
    name: 'UIInteraction',
    category: 'tag',
    removable: false,
    properties: [],
};

const ButtonSchema: ComponentSchema = {
    name: 'Button',
    category: 'ui',
    properties: [
        { name: 'state', type: 'enum', options: [{ label: 'Normal', value: 0 }, { label: 'Hovered', value: 1 }, { label: 'Pressed', value: 2 }, { label: 'Disabled', value: 3 }] },
        { name: 'transition', type: 'button-transition' },
    ],
};

const TextInputSchema: ComponentSchema = {
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

const ImageSchema: ComponentSchema = {
    name: 'Image',
    category: 'ui',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'imageType', type: 'enum', options: [{ label: 'Simple', value: 0 }, { label: 'Sliced', value: 1 }, { label: 'Tiled', value: 2 }, { label: 'Filled', value: 3 }] },
        { name: 'fillMethod', type: 'enum', options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
        { name: 'fillOrigin', type: 'enum', options: [{ label: 'Left', value: 0 }, { label: 'Right', value: 1 }, { label: 'Bottom', value: 2 }, { label: 'Top', value: 3 }] },
        { name: 'fillAmount', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'preserveAspect', type: 'boolean' },
        { name: 'tileSize', type: 'vec2' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
    ],
};

const ToggleSchema: ComponentSchema = {
    name: 'Toggle',
    category: 'ui',
    properties: [
        { name: 'isOn', type: 'boolean' },
        { name: 'graphicEntity', type: 'entity' },
        { name: 'transition', type: 'button-transition' },
    ],
};

const ToggleGroupSchema: ComponentSchema = {
    name: 'ToggleGroup',
    category: 'ui',
    properties: [{ name: 'allowSwitchOff', type: 'boolean' }],
};

const ProgressBarSchema: ComponentSchema = {
    name: 'ProgressBar',
    category: 'ui',
    properties: [
        { name: 'value', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'fillEntity', type: 'entity' },
        { name: 'direction', type: 'enum', options: [{ label: 'LeftToRight', value: 0 }, { label: 'RightToLeft', value: 1 }, { label: 'BottomToTop', value: 2 }, { label: 'TopToBottom', value: 3 }] },
    ],
};

const DraggableSchema: ComponentSchema = {
    name: 'Draggable',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'dragThreshold', type: 'number', min: 0, step: 1 },
        { name: 'lockX', type: 'boolean' },
        { name: 'lockY', type: 'boolean' },
    ],
};

const ScrollViewSchema: ComponentSchema = {
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

const SliderSchema: ComponentSchema = {
    name: 'Slider',
    category: 'ui',
    properties: [
        { name: 'value', type: 'number', step: 0.01 },
        { name: 'minValue', type: 'number', step: 0.01 },
        { name: 'maxValue', type: 'number', step: 0.01 },
        { name: 'direction', type: 'enum', options: [{ label: 'LeftToRight', value: 0 }, { label: 'RightToLeft', value: 1 }, { label: 'BottomToTop', value: 2 }, { label: 'TopToBottom', value: 3 }] },
        { name: 'fillEntity', type: 'entity' },
        { name: 'handleEntity', type: 'entity' },
        { name: 'wholeNumbers', type: 'boolean' },
    ],
};

const FocusableSchema: ComponentSchema = {
    name: 'Focusable',
    category: 'ui',
    properties: [{ name: 'tabIndex', type: 'number', min: 0, step: 1 }],
};

const SafeAreaSchema: ComponentSchema = {
    name: 'SafeArea',
    category: 'ui',
    properties: [
        { name: 'applyTop', type: 'boolean' },
        { name: 'applyBottom', type: 'boolean' },
        { name: 'applyLeft', type: 'boolean' },
        { name: 'applyRight', type: 'boolean' },
    ],
};

const ListViewSchema: ComponentSchema = {
    name: 'ListView',
    category: 'ui',
    properties: [
        { name: 'itemHeight', type: 'number', min: 1, step: 1 },
        { name: 'itemCount', type: 'number', min: 0, step: 1 },
        { name: 'overscan', type: 'number', min: 0, step: 1 },
    ],
};

const DropdownSchema: ComponentSchema = {
    name: 'Dropdown',
    category: 'ui',
    properties: [
        { name: 'options', type: 'string-array' },
        { name: 'selectedIndex', type: 'number', min: -1, step: 1 },
        { name: 'listEntity', type: 'entity' },
        { name: 'labelEntity', type: 'entity' },
    ],
};

const FlexContainerSchema: ComponentSchema = {
    name: 'FlexContainer',
    category: 'ui',
    properties: [
        { name: 'direction', type: 'enum', options: [{ label: 'Row', value: 0 }, { label: 'Column', value: 1 }, { label: 'RowReverse', value: 2 }, { label: 'ColumnReverse', value: 3 }] },
        { name: 'wrap', type: 'enum', options: [{ label: 'NoWrap', value: 0 }, { label: 'Wrap', value: 1 }] },
        { name: 'justifyContent', type: 'enum', options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'SpaceBetween', value: 3 }, { label: 'SpaceAround', value: 4 }, { label: 'SpaceEvenly', value: 5 }] },
        { name: 'alignItems', type: 'enum', options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'Stretch', value: 3 }] },
        { name: 'gap', type: 'vec2' },
        { name: 'padding', type: 'padding' },
    ],
};

const FlexItemSchema: ComponentSchema = {
    name: 'FlexItem',
    category: 'ui',
    properties: [
        { name: 'flexGrow', type: 'number', min: 0, step: 0.1 },
        { name: 'flexShrink', type: 'number', min: 0, step: 0.1 },
        { name: 'flexBasis', type: 'number', step: 1 },
        { name: 'order', type: 'number', step: 1 },
    ],
};

const LayoutGroupSchema: ComponentSchema = {
    name: 'LayoutGroup',
    category: 'ui',
    properties: [
        { name: 'direction', type: 'enum', options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
        { name: 'spacing', type: 'number', step: 1 },
        { name: 'padding', type: 'padding' },
        { name: 'childAlignment', type: 'enum', options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }] },
        { name: 'reverseOrder', type: 'boolean' },
    ],
};

const UI_SCHEMAS: ComponentSchema[] = [
    UIRectSchema, UIMaskSchema, InteractableSchema, UIInteractionSchema,
    ButtonSchema, TextInputSchema, ImageSchema,
    ToggleSchema, ToggleGroupSchema, ProgressBarSchema,
    DraggableSchema, ScrollViewSchema, SliderSchema, FocusableSchema,
    SafeAreaSchema, ListViewSchema, DropdownSchema,
    FlexContainerSchema, FlexItemSchema, LayoutGroupSchema,
];

export const uiPlugin: EditorPlugin = {
    name: 'ui',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        for (const schema of UI_SCHEMAS) {
            ctx.registrar.provide(COMPONENT_SCHEMA, schema.name, schema);
        }
        ctx.registrar.provide(BOUNDS_PROVIDER, 'UIRect', uiRectBoundsProvider);
    },
};
