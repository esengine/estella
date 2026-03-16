import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { uiRectBoundsProvider } from '../bounds/UIRectBoundsProvider';
import { BOUNDS_PROVIDER } from '../container/tokens';
import { Constraints } from '../schemas/schemaConstants';

const FILL_DIRECTION_OPTIONS = [
    { label: 'LeftToRight', value: 0 },
    { label: 'RightToLeft', value: 1 },
    { label: 'BottomToTop', value: 2 },
    { label: 'TopToBottom', value: 3 },
];

function registerUISchemas(): void {
    defineSchema('UIRect', {
        category: 'ui',
        overrides: { '*': { type: 'uirect' } },
        exclude: ['anchorMin', 'anchorMax', 'offsetMin', 'offsetMax', 'size', 'pivot'],
        extraProperties: [{ name: '*', type: 'uirect' }],
    });

    defineSchema('UIMask', {
        category: 'ui',
        overrides: {
            mode: { type: 'enum', options: [{ label: 'Scissor', value: 0 }, { label: 'Stencil', value: 1 }] },
        },
    });

    defineSchema('Interactable', { category: 'ui' });

    defineSchema('UIInteraction', { category: 'tag', removable: false, exclude: ['hovered', 'pressed', 'justPressed', 'justReleased'] });

    defineSchema('Button', {
        category: 'ui',
        requires: ['Interactable'],
        overrides: {
            transition: { type: 'button-transition' },
        },
        exclude: ['state'],
    });

    defineSchema('TextInput', {
        category: 'ui',
        editorDefaults: () => ({ placeholder: 'Enter text...' }),
        overrides: {
            value: { group: 'Content' },
            placeholder: { group: 'Content' },
            maxLength: { ...Constraints.positiveInt, displayName: 'Max Length', group: 'Content', tooltip: '0 = no limit' },
            fontFamily: { type: 'font', displayName: 'Font', group: 'Appearance' },
            fontSize: { ...Constraints.fontSize, displayName: 'Font Size', group: 'Appearance' },
            color: { displayName: 'Text Color', group: 'Appearance' },
            backgroundColor: { displayName: 'Background', group: 'Appearance' },
            placeholderColor: { displayName: 'Placeholder Color', group: 'Appearance' },
            padding: { ...Constraints.positiveInt, group: 'Appearance' },
            multiline: { group: 'Behavior' },
            password: { group: 'Behavior' },
            readOnly: { displayName: 'Read Only', group: 'Behavior' },
        },
    });

    defineSchema('Image', {
        category: 'ui',
        requires: ['UIRect'],
        description: 'Displays a texture with slicing, tiling, or fill modes',
        overrides: {
            imageType: { type: 'enum', displayName: 'Type',
                options: [{ label: 'Simple', value: 0 }, { label: 'Sliced', value: 1 }, { label: 'Tiled', value: 2 }, { label: 'Filled', value: 3 }] },
            preserveAspect: { displayName: 'Preserve Aspect' },
            layer: Constraints.layer,
            fillMethod: { type: 'enum', displayName: 'Fill Method', group: 'Fill',
                visibleWhen: { field: 'imageType', equals: 3 },
                options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
            fillOrigin: { type: 'enum', displayName: 'Fill Origin', group: 'Fill',
                visibleWhen: { field: 'imageType', equals: 3 },
                options: [{ label: 'Left', value: 0 }, { label: 'Right', value: 1 }, { label: 'Bottom', value: 2 }, { label: 'Top', value: 3 }] },
            fillAmount: { ...Constraints.percentage, displayName: 'Fill Amount', group: 'Fill',
                visibleWhen: { field: 'imageType', equals: 3 } },
            tileSize: { displayName: 'Tile Size', group: 'Tiling',
                visibleWhen: { field: 'imageType', equals: 2 } },
        },
    });

    defineSchema('Toggle', {
        category: 'ui',
        overrides: {
            isOn: { displayName: 'Is On' },
            onColor: { displayName: 'On Color', group: 'Appearance' },
            offColor: { displayName: 'Off Color', group: 'Appearance' },
            transition: { type: 'button-transition', group: 'Appearance' },
            graphicEntity: { displayName: 'Graphic', advanced: true },
            group: { displayName: 'Toggle Group', advanced: true },
        },
    });

    defineSchema('ToggleGroup', { category: 'ui' });

    defineSchema('ProgressBar', {
        category: 'ui',
        overrides: {
            value: Constraints.percentage,
            direction: { type: 'enum', options: FILL_DIRECTION_OPTIONS },
            fillEntity: { displayName: 'Fill', advanced: true },
        },
    });

    defineSchema('Draggable', {
        category: 'ui',
        overrides: {
            dragThreshold: { ...Constraints.positiveInt, displayName: 'Threshold' },
        },
        exclude: ['lockX', 'lockY', 'constraintMin', 'constraintMax'],
        extraProperties: [
            { name: 'lockX', type: 'boolean' },
            { name: 'lockY', type: 'boolean' },
        ],
    });

    defineSchema('ScrollView', {
        category: 'ui',
        requires: ['UIRect'],
        description: 'Scrollable container with inertia and elastic bounce',
        overrides: {
            horizontalEnabled: { displayName: 'Horizontal' },
            verticalEnabled: { displayName: 'Vertical' },
            contentWidth: { ...Constraints.positiveInt, displayName: 'Content Width', group: 'Content' },
            contentHeight: { ...Constraints.positiveInt, displayName: 'Content Height', group: 'Content' },
            inertia: { group: 'Physics' },
            decelerationRate: { ...Constraints.percentage, displayName: 'Deceleration', group: 'Physics',
                visibleWhen: { field: 'inertia', equals: true } },
            elastic: { group: 'Physics' },
            wheelSensitivity: { ...Constraints.percentage, displayName: 'Wheel Speed', group: 'Physics' },
            contentEntity: { displayName: 'Content', advanced: true },
        },
    });

    defineSchema('Slider', {
        category: 'ui',
        overrides: {
            value: { step: 0.01 },
            minValue: { step: 0.01, displayName: 'Min' },
            maxValue: { step: 0.01, displayName: 'Max' },
            direction: { type: 'enum', options: FILL_DIRECTION_OPTIONS },
            wholeNumbers: { displayName: 'Whole Numbers' },
            fillEntity: { displayName: 'Fill', advanced: true },
            handleEntity: { displayName: 'Handle', advanced: true },
        },
    });

    defineSchema('Focusable', {
        category: 'ui',
        overrides: { tabIndex: { min: 0, step: 1 } },
    });

    defineSchema('SafeArea', { category: 'ui' });

    defineSchema('ListView', {
        category: 'ui',
        overrides: {
            itemHeight: { min: 1, step: 1 },
            itemCount: { min: 0, step: 1 },
            overscan: { min: 0, step: 1 },
        },
    });

    defineSchema('Dropdown', {
        category: 'ui',
        overrides: {
            selectedIndex: { min: -1, step: 1, displayName: 'Selected' },
            listEntity: { displayName: 'List', advanced: true },
            labelEntity: { displayName: 'Label', advanced: true },
        },
    });

    defineSchema('FlexContainer', {
        category: 'ui',
        requires: ['UIRect'],
        conflicts: ['LayoutGroup'],
        description: 'Flexbox layout powered by Yoga engine',
        overrides: {
            direction: { type: 'enum', displayName: 'Direction',
                options: [{ label: 'Row', value: 0 }, { label: 'Column', value: 1 }, { label: 'RowReverse', value: 2 }, { label: 'ColumnReverse', value: 3 }] },
            wrap: { type: 'enum', displayName: 'Wrap',
                options: [{ label: 'NoWrap', value: 0 }, { label: 'Wrap', value: 1 }] },
            justifyContent: { type: 'enum', displayName: 'Justify Content',
                options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'SpaceBetween', value: 3 }, { label: 'SpaceAround', value: 4 }, { label: 'SpaceEvenly', value: 5 }] },
            alignItems: { type: 'enum', displayName: 'Align Items',
                options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'Stretch', value: 3 }] },
            alignContent: { type: 'enum', displayName: 'Align Content',
                options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }, { label: 'Stretch', value: 3 }, { label: 'SpaceBetween', value: 4 }, { label: 'SpaceAround', value: 5 }] },
        },
    });

    defineSchema('FlexItem', {
        category: 'ui',
        overrides: {
            flexGrow: { min: 0, step: 0.1, displayName: 'Grow' },
            flexShrink: { min: 0, step: 0.1, displayName: 'Shrink' },
            flexBasis: { step: 1, displayName: 'Basis' },
            order: { step: 1 },
            alignSelf: { type: 'enum', displayName: 'Align Self',
                options: [{ label: 'Auto', value: 0 }, { label: 'Start', value: 1 }, { label: 'Center', value: 2 }, { label: 'End', value: 3 }, { label: 'Stretch', value: 4 }] },
            margin: { displayName: 'Margin' },
            minWidth: { step: 1, displayName: 'Min Width', group: 'Constraints' },
            minHeight: { step: 1, displayName: 'Min Height', group: 'Constraints' },
            maxWidth: { step: 1, displayName: 'Max Width', group: 'Constraints' },
            maxHeight: { step: 1, displayName: 'Max Height', group: 'Constraints' },
            widthPercent: { step: 1, displayName: 'Width %', group: 'Percentage', advanced: true },
            heightPercent: { step: 1, displayName: 'Height %', group: 'Percentage', advanced: true },
        },
    });

    defineSchema('LayoutGroup', {
        category: 'ui',
        requires: ['UIRect'],
        conflicts: ['FlexContainer'],
        description: 'Simple horizontal or vertical layout for children',
        overrides: {
            direction: { type: 'enum', options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }] },
            spacing: { step: 1 },
            childAlignment: { type: 'enum', options: [{ label: 'Start', value: 0 }, { label: 'Center', value: 1 }, { label: 'End', value: 2 }] },
        },
    });

    defineSchema('StateMachine', {
        category: 'ui',
        exclude: ['states', 'inputs', 'listeners', 'initialState', 'layers'],
        extraProperties: [{ name: '*', type: 'state-machine' }],
    });

    defineSchema('DragState', { category: 'ui', hidden: true, exclude: ['isDragging', 'startWorldPos', 'currentWorldPos', 'deltaWorld', 'totalDeltaWorld'] });

    defineSchema('UIRenderer', { category: 'ui', hidden: true, exclude: ['visualType', 'texture', 'color', 'uvOffset', 'uvScale', 'sliceBorder', 'material', 'enabled'] });

    defineSchema('Selectable', { category: 'ui' });

    defineSchema('CollectionView', {
        category: 'ui',
        overrides: {
            layout: { type: 'enum', options: [{ label: 'Linear', value: 'linear' }, { label: 'Grid', value: 'grid' }, { label: 'Fan', value: 'fan' }] },
            overscan: { min: 0, step: 1 },
        },
    });

    defineSchema('CollectionItem', { category: 'ui', hidden: true });

    defineSchema('GridLayout', {
        category: 'ui',
        overrides: {
            direction: { type: 'enum', options: [{ label: 'Vertical', value: 0 }, { label: 'Horizontal', value: 1 }] },
            crossAxisCount: { min: 1, step: 1, displayName: 'Cross Axis Count' },
            itemSize: { displayName: 'Item Size' },
        },
    });

    defineSchema('FanLayout', {
        category: 'ui',
        overrides: {
            radius: { min: 0, step: 10 },
            maxSpreadAngle: { min: 0, max: 180, step: 1, displayName: 'Max Spread Angle' },
            maxCardAngle: { min: 0, max: 90, step: 1, displayName: 'Max Card Angle' },
            tiltFactor: { step: 0.1, displayName: 'Tilt Factor' },
            cardSpacing: { min: 0, step: 1, displayName: 'Card Spacing' },
            direction: { type: 'enum', options: [{ label: 'Left', value: 0 }, { label: 'Right', value: 1 }] },
        },
    });

    defineSchema('LinearLayout', {
        category: 'ui',
        overrides: {
            direction: { type: 'enum', options: [{ label: 'Vertical', value: 0 }, { label: 'Horizontal', value: 1 }] },
            itemSize: { min: 1, step: 1, displayName: 'Item Size' },
        },
    });
}

export const uiPlugin: EditorPlugin = {
    name: 'ui',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        registerUISchemas();
        ctx.registrar.provide(BOUNDS_PROVIDER, 'UIRect', uiRectBoundsProvider);
    },
};
