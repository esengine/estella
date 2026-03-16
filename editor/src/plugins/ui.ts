import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { uiRectBoundsProvider } from '../bounds/UIRectBoundsProvider';
import { COMPONENT_SCHEMA, BOUNDS_PROVIDER } from '../container/tokens';
import { Constraints } from '../schemas/schemaConstants';

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
    requires: ['Interactable'],
    properties: [
        { name: 'transition', type: 'button-transition' },
    ],
};

const TextInputSchema: ComponentSchema = {
    name: 'TextInput',
    category: 'ui',
    editorDefaults: () => ({ placeholder: 'Enter text...' }),
    properties: [
        { name: 'value', type: 'string', group: 'Content' },
        { name: 'placeholder', type: 'string', group: 'Content' },
        { name: 'maxLength', type: 'number', ...Constraints.positiveInt, displayName: 'Max Length', group: 'Content',
          tooltip: '0 = no limit' },
        { name: 'fontFamily', type: 'font', displayName: 'Font', group: 'Appearance' },
        { name: 'fontSize', type: 'number', ...Constraints.fontSize, displayName: 'Font Size', group: 'Appearance' },
        { name: 'color', type: 'color', displayName: 'Text Color', group: 'Appearance' },
        { name: 'backgroundColor', type: 'color', displayName: 'Background', group: 'Appearance' },
        { name: 'placeholderColor', type: 'color', displayName: 'Placeholder Color', group: 'Appearance' },
        { name: 'padding', type: 'number', ...Constraints.positiveInt, group: 'Appearance' },
        { name: 'multiline', type: 'boolean', group: 'Behavior' },
        { name: 'password', type: 'boolean', group: 'Behavior' },
        { name: 'readOnly', type: 'boolean', displayName: 'Read Only', group: 'Behavior' },
    ],
};

const ImageSchema: ComponentSchema = {
    name: 'Image',
    category: 'ui',
    requires: ['UIRect'],
    description: 'Displays a texture with slicing, tiling, or fill modes',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'imageType', type: 'enum', displayName: 'Type',
          options: [{ label: 'Simple', value: 0 }, { label: 'Sliced', value: 1 }, { label: 'Tiled', value: 2 }, { label: 'Filled', value: 3 }] },
        { name: 'preserveAspect', type: 'boolean', displayName: 'Preserve Aspect' },
        { name: 'layer', type: 'number', ...Constraints.layer },
        { name: 'fillMethod', type: 'enum', displayName: 'Fill Method', group: 'Fill',
          visibleWhen: { field: 'imageType', equals: 3 },
          options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
        { name: 'fillOrigin', type: 'enum', displayName: 'Fill Origin', group: 'Fill',
          visibleWhen: { field: 'imageType', equals: 3 },
          options: [{ label: 'Left', value: 0 }, { label: 'Right', value: 1 }, { label: 'Bottom', value: 2 }, { label: 'Top', value: 3 }] },
        { name: 'fillAmount', type: 'number', ...Constraints.percentage, displayName: 'Fill Amount', group: 'Fill',
          visibleWhen: { field: 'imageType', equals: 3 } },
        { name: 'tileSize', type: 'vec2', displayName: 'Tile Size', group: 'Tiling',
          visibleWhen: { field: 'imageType', equals: 2 } },
    ],
};

const ToggleSchema: ComponentSchema = {
    name: 'Toggle',
    category: 'ui',
    properties: [
        { name: 'isOn', type: 'boolean', displayName: 'Is On' },
        { name: 'onColor', type: 'color', displayName: 'On Color', group: 'Appearance' },
        { name: 'offColor', type: 'color', displayName: 'Off Color', group: 'Appearance' },
        { name: 'transition', type: 'button-transition', group: 'Appearance' },
        { name: 'graphicEntity', type: 'entity', displayName: 'Graphic', advanced: true },
        { name: 'group', type: 'entity', displayName: 'Toggle Group', advanced: true },
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
        { name: 'value', type: 'number', ...Constraints.percentage },
        { name: 'direction', type: 'enum', options: [{ label: 'LeftToRight', value: 0 }, { label: 'RightToLeft', value: 1 }, { label: 'BottomToTop', value: 2 }, { label: 'TopToBottom', value: 3 }] },
        { name: 'fillEntity', type: 'entity', displayName: 'Fill', advanced: true },
    ],
};

const DraggableSchema: ComponentSchema = {
    name: 'Draggable',
    category: 'ui',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'dragThreshold', type: 'number', ...Constraints.positiveInt, displayName: 'Threshold' },
        { name: 'lockX', type: 'boolean' },
        { name: 'lockY', type: 'boolean' },
    ],
};

const ScrollViewSchema: ComponentSchema = {
    name: 'ScrollView',
    category: 'ui',
    requires: ['UIRect'],
    description: 'Scrollable container with inertia and elastic bounce',
    properties: [
        { name: 'horizontalEnabled', type: 'boolean', displayName: 'Horizontal' },
        { name: 'verticalEnabled', type: 'boolean', displayName: 'Vertical' },
        { name: 'contentWidth', type: 'number', ...Constraints.positiveInt, displayName: 'Content Width', group: 'Content' },
        { name: 'contentHeight', type: 'number', ...Constraints.positiveInt, displayName: 'Content Height', group: 'Content' },
        { name: 'inertia', type: 'boolean', group: 'Physics' },
        { name: 'decelerationRate', type: 'number', ...Constraints.percentage, displayName: 'Deceleration', group: 'Physics',
          visibleWhen: { field: 'inertia', equals: true } },
        { name: 'elastic', type: 'boolean', group: 'Physics' },
        { name: 'wheelSensitivity', type: 'number', ...Constraints.percentage, displayName: 'Wheel Speed', group: 'Physics' },
        { name: 'contentEntity', type: 'entity', displayName: 'Content', advanced: true },
    ],
};

const SliderSchema: ComponentSchema = {
    name: 'Slider',
    category: 'ui',
    properties: [
        { name: 'value', type: 'number', step: 0.01 },
        { name: 'minValue', type: 'number', step: 0.01, displayName: 'Min' },
        { name: 'maxValue', type: 'number', step: 0.01, displayName: 'Max' },
        { name: 'direction', type: 'enum', options: [{ label: 'LeftToRight', value: 0 }, { label: 'RightToLeft', value: 1 }, { label: 'BottomToTop', value: 2 }, { label: 'TopToBottom', value: 3 }] },
        { name: 'wholeNumbers', type: 'boolean', displayName: 'Whole Numbers' },
        { name: 'fillEntity', type: 'entity', displayName: 'Fill', advanced: true },
        { name: 'handleEntity', type: 'entity', displayName: 'Handle', advanced: true },
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
        { name: 'selectedIndex', type: 'number', min: -1, step: 1, displayName: 'Selected' },
        { name: 'listEntity', type: 'entity', displayName: 'List', advanced: true },
        { name: 'labelEntity', type: 'entity', displayName: 'Label', advanced: true },
    ],
};

const FlexContainerSchema: ComponentSchema = {
    name: 'FlexContainer',
    category: 'ui',
    requires: ['UIRect'],
    conflicts: ['LayoutGroup'],
    description: 'Flexbox layout powered by Yoga engine',
    properties: [
        { name: 'direction', type: 'enum', displayName: 'Direction',
          options: [{ label: 'Row', value: 0 }, { label: 'Column', value: 1 }, { label: 'RowReverse', value: 2 }, { label: 'ColumnReverse', value: 3 }] },
        { name: 'wrap', type: 'enum', displayName: 'Wrap',
          options: [{ label: 'NoWrap', value: 0 }, { label: 'Wrap', value: 1 }] },
        { name: 'justifyContent', type: 'enum', displayName: 'Justify Content',
          options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'SpaceBetween', value: 3 }, { label: 'SpaceAround', value: 4 }, { label: 'SpaceEvenly', value: 5 }] },
        { name: 'alignItems', type: 'enum', displayName: 'Align Items',
          options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'Stretch', value: 3 }] },
        { name: 'alignContent', type: 'enum', displayName: 'Align Content',
          options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'Stretch', value: 3 }, { label: 'SpaceBetween', value: 4 }, { label: 'SpaceAround', value: 5 }] },
        { name: 'gap', type: 'vec2', displayName: 'Gap' },
        { name: 'padding', type: 'padding', displayName: 'Padding' },
    ],
};

const FlexItemSchema: ComponentSchema = {
    name: 'FlexItem',
    category: 'ui',
    properties: [
        { name: 'flexGrow', type: 'number', min: 0, step: 0.1, displayName: 'Grow' },
        { name: 'flexShrink', type: 'number', min: 0, step: 0.1, displayName: 'Shrink' },
        { name: 'flexBasis', type: 'number', step: 1, displayName: 'Basis' },
        { name: 'order', type: 'number', step: 1 },
        { name: 'alignSelf', type: 'enum', displayName: 'Align Self',
          options: [{ label: 'Auto', value: 0 }, { label: 'Start', value: 1 }, { label: 'Center', value: 2 }, { label: 'End', value: 3 }, { label: 'Stretch', value: 4 }] },
        { name: 'margin', type: 'padding', displayName: 'Margin' },
        { name: 'minWidth', type: 'number', step: 1, displayName: 'Min Width', group: 'Constraints' },
        { name: 'minHeight', type: 'number', step: 1, displayName: 'Min Height', group: 'Constraints' },
        { name: 'maxWidth', type: 'number', step: 1, displayName: 'Max Width', group: 'Constraints' },
        { name: 'maxHeight', type: 'number', step: 1, displayName: 'Max Height', group: 'Constraints' },
        { name: 'widthPercent', type: 'number', step: 1, displayName: 'Width %', group: 'Percentage', advanced: true },
        { name: 'heightPercent', type: 'number', step: 1, displayName: 'Height %', group: 'Percentage', advanced: true },
    ],
};

const LayoutGroupSchema: ComponentSchema = {
    name: 'LayoutGroup',
    category: 'ui',
    requires: ['UIRect'],
    conflicts: ['FlexContainer'],
    description: 'Simple horizontal or vertical layout for children',
    properties: [
        { name: 'direction', type: 'enum', options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
        { name: 'spacing', type: 'number', step: 1 },
        { name: 'padding', type: 'padding' },
        { name: 'childAlignment', type: 'enum', options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }] },
        { name: 'reverseOrder', type: 'boolean' },
    ],
};

const StateMachineSchema: ComponentSchema = {
    name: 'StateMachine',
    category: 'ui',
    properties: [
        { name: '*', type: 'state-machine' },
    ],
};

const DragStateSchema: ComponentSchema = {
    name: 'DragState',
    category: 'ui',
    hidden: true,
    properties: [],
};

const UIRendererSchema: ComponentSchema = {
    name: 'UIRenderer',
    category: 'ui',
    hidden: true,
    properties: [],
};

const UI_SCHEMAS: ComponentSchema[] = [
    UIRectSchema, UIMaskSchema, InteractableSchema, UIInteractionSchema,
    ButtonSchema, TextInputSchema, ImageSchema,
    ToggleSchema, ToggleGroupSchema, ProgressBarSchema,
    DraggableSchema, ScrollViewSchema, SliderSchema, FocusableSchema,
    SafeAreaSchema, DropdownSchema,
    FlexContainerSchema, FlexItemSchema, LayoutGroupSchema,
    StateMachineSchema,
    DragStateSchema,
    UIRendererSchema,
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
