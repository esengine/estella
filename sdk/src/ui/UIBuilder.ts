import { Name, Transform, Children } from '../component';
import type { AnyComponentDef, TransformData, ChildrenData } from '../component';
import type { Entity, Color, Vec2 } from '../types';
import type { World } from '../world';
import type { ColorTransition } from './uiTypes';
import { FillDirection } from './uiTypes';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { UIRenderer, UIVisualType } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { Text, TextAlign, TextVerticalAlign } from './text';
import type { TextData } from './text';
import { Image } from './Image';
import type { ImageData } from './Image';
import { FlexContainer, FlexDirection, JustifyContent, AlignItems } from './FlexContainer';
import type { FlexContainerData, JustifyContent as JustifyContentType, AlignItems as AlignItemsType } from './FlexContainer';
import { FlexItem } from './FlexItem';
import type { FlexItemData } from './FlexItem';
import { UIMask, MaskMode } from './UIMask';
import type { UIMaskData } from './UIMask';
import { Button } from './Button';
import { Slider } from './Slider';
import { Toggle } from './Toggle';
import { ProgressBar } from './ProgressBar';
import { ScrollView } from './ScrollView';
import type { ScrollViewData } from './ScrollView';
import { Dropdown } from './Dropdown';
import { TextInput } from './TextInput';
import { Focusable } from './Focusable';
import { Draggable } from './Draggable';
import type { UIEventQueue } from './UIEvents';
import type { SliderData } from './Slider';
import type { ToggleData } from './Toggle';
import type { TextInputData } from './TextInput';
import type { DropdownData } from './Dropdown';
import { FlexWrap } from './FlexContainer';
import type { App } from '../app';
import { UIThemeRes, DARK_THEME } from './UITheme';
import type { UITheme } from './UITheme';

let activeTheme: UITheme | null = null;

export function initUIBuilder(app: App): void {
    if (app.hasResource(UIThemeRes)) {
        activeTheme = app.getResource(UIThemeRes) as UITheme | null;
    }
}

function getTheme(): UITheme {
    return activeTheme ?? DARK_THEME;
}

export interface UIEntityDef {
    name?: string;
    parent?: Entity;
    rect?: Partial<UIRectData>;
    transform?: Partial<TransformData>;
    renderer?: Partial<UIRendererData>;
    interactable?: Partial<InteractableData>;
    text?: Partial<TextData>;
    image?: Partial<ImageData>;
    flex?: Partial<FlexContainerData>;
    flexItem?: Partial<FlexItemData>;
    mask?: Partial<UIMaskData>;
    components?: Array<[AnyComponentDef, Record<string, unknown>?]>;
}

function spawnUI(world: World, def: UIEntityDef): Entity {
    const entity = world.spawn();

    if (def.name) {
        world.insert(entity, Name, { value: def.name });
    }

    world.insert(entity, Transform, {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        ...def.transform,
    });

    if (def.rect) {
        world.insert(entity, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
            ...def.rect,
        });
    }

    if (def.renderer) {
        world.insert(entity, UIRenderer, {
            visualType: UIVisualType.SolidColor,
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
            material: 0,
            enabled: true,
            ...def.renderer,
        });
    }

    if (def.interactable) {
        world.insert(entity, Interactable, {
            enabled: true,
            blockRaycast: true,
            raycastTarget: true,
            ...def.interactable,
        });
    }

    if (def.text) {
        const theme = getTheme();
        world.insert(entity, Text, {
            content: '',
            fontFamily: theme.fontFamily,
            fontSize: theme.fontSize.md,
            color: { r: 1, g: 1, b: 1, a: 1 },
            align: TextAlign.Left,
            verticalAlign: TextVerticalAlign.Top,
            wordWrap: false,
            overflow: 0,
            lineHeight: 1.2,
            ...def.text,
        });
    }

    if (def.image) {
        world.insert(entity, Image, { ...Image._default, ...def.image });
    }

    if (def.flex) {
        world.insert(entity, FlexContainer, {
            direction: FlexDirection.Row,
            wrap: FlexWrap.NoWrap,
            justifyContent: JustifyContent.Start,
            alignItems: AlignItems.Stretch,
            gap: { x: 0, y: 0 },
            padding: { left: 0, top: 0, right: 0, bottom: 0 },
            ...def.flex,
        });
    }

    if (def.flexItem) {
        world.insert(entity, FlexItem, {
            flexGrow: 0,
            flexShrink: 1,
            flexBasis: -1,
            order: 0,
            ...def.flexItem,
        });
    }

    if (def.mask) {
        world.insert(entity, UIMask, {
            enabled: true,
            mode: MaskMode.Scissor,
            ...def.mask,
        });
    }

    if (def.components) {
        for (const [comp, data] of def.components) {
            world.insert(entity, comp, data);
        }
    }

    if (def.parent) {
        world.setParent(entity, def.parent);
    }

    return entity;
}

function destroyUI(world: World, entity: Entity): void {
    if (!world.valid(entity)) return;

    if (world.has(entity, Children)) {
        const children = world.get(entity, Children) as ChildrenData;
        const childList = [...children.entities];
        for (const child of childList) {
            destroyUI(world, child);
        }
    }

    world.despawn(entity);
}

// --- Widget Factories ---

export interface ButtonOptions {
    text?: string;
    fontSize?: number;
    size?: Vec2;
    color?: Color;
    textColor?: Color;
    transition?: ColorTransition | null;
    parent?: Entity;
    events?: UIEventQueue;
    onClick?: (entity: Entity) => void;
    onHover?: (entity: Entity) => void;
}

function createButton(world: World, options: ButtonOptions = {}): Entity {
    const theme = getTheme();
    const {
        text = 'Button',
        fontSize = theme.fontSize.md,
        size = { x: 120, y: theme.button.height },
        color = theme.button.color,
        textColor = theme.button.textColor,
        transition = null,
        parent,
    } = options;

    const label = spawnUI(world, {
        name: 'ButtonLabel',
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        text: {
            content: text,
            fontSize,
            color: textColor,
            align: TextAlign.Center,
            verticalAlign: TextVerticalAlign.Middle,
        },
    });

    const btn = spawnUI(world, {
        name: 'Button',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color },
        interactable: { enabled: true },
        components: [
            [Button, { state: 0, transition }],
        ],
    });

    world.setParent(label, btn);

    if (options.events) {
        if (options.onClick) {
            const cb = options.onClick;
            options.events.on(btn, 'click', () => cb(btn));
        }
        if (options.onHover) {
            const cb = options.onHover;
            options.events.on(btn, 'hover_enter', () => cb(btn));
        }
    }

    return btn;
}

export interface SliderOptions {
    value?: number;
    minValue?: number;
    maxValue?: number;
    direction?: FillDirection;
    size?: Vec2;
    trackColor?: Color;
    fillColor?: Color;
    handleSize?: Vec2;
    handleColor?: Color;
    wholeNumbers?: boolean;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (value: number, entity: Entity) => void;
}

function createSlider(world: World, options: SliderOptions = {}): Entity {
    const theme = getTheme();
    const {
        value = 0,
        minValue = 0,
        maxValue = 1,
        direction = FillDirection.LeftToRight,
        size = { x: 200, y: theme.slider.trackHeight },
        trackColor = theme.slider.trackColor,
        fillColor = theme.slider.fillColor,
        handleSize = { x: theme.slider.handleSize, y: theme.slider.handleSize },
        handleColor = theme.slider.handleColor,
        wholeNumbers = false,
        parent,
    } = options;

    const fill = spawnUI(world, {
        name: 'SliderFill',
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        renderer: { visualType: UIVisualType.SolidColor, color: fillColor },
    });

    const handle = spawnUI(world, {
        name: 'SliderHandle',
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size: handleSize,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: handleColor },
        interactable: { enabled: true, blockRaycast: true },
        components: [
            [Draggable, { enabled: true, dragThreshold: 5, lockX: false, lockY: true }],
        ],
    });

    const root = spawnUI(world, {
        name: 'Slider',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: trackColor },
        interactable: { enabled: true, blockRaycast: true },
        components: [
            [Slider, { value, minValue, maxValue, direction, wholeNumbers, fillEntity: fill, handleEntity: handle }],
        ],
    });

    world.setParent(fill, root);
    world.setParent(handle, root);

    if (options.onChange && options.events) {
        const cb = options.onChange;
        options.events.on(root, 'change', () => {
            const s = world.get(root, Slider) as SliderData;
            cb(s.value, root);
        });
    }

    return root;
}

export interface ToggleOptions {
    isOn?: boolean;
    size?: Vec2;
    onColor?: Color;
    offColor?: Color;
    checkSize?: Vec2;
    checkColor?: Color;
    group?: Entity;
    transition?: ColorTransition | null;
    label?: string;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (isOn: boolean, entity: Entity) => void;
}

function createToggle(world: World, options: ToggleOptions = {}): Entity {
    const theme = getTheme();
    const {
        isOn = true,
        size = theme.toggle.size,
        onColor = theme.toggle.onColor,
        offColor = theme.toggle.offColor,
        checkSize = { x: theme.toggle.size.x * 0.58, y: theme.toggle.size.y * 0.58 },
        checkColor = theme.toggle.checkColor,
        group = 0 as Entity,
        transition = null,
        label,
        parent,
    } = options;

    const graphic = spawnUI(world, {
        name: 'ToggleCheck',
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size: checkSize,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: checkColor },
    });

    const toggle = spawnUI(world, {
        name: 'Toggle',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: isOn ? onColor : offColor },
        interactable: { enabled: true },
        components: [
            [Toggle, { isOn, graphicEntity: graphic, group, transition, onColor, offColor }],
        ],
    });

    world.setParent(graphic, toggle);

    if (label) {
        spawnUI(world, {
            name: 'ToggleLabel',
            parent: toggle,
            rect: {
                anchorMin: { x: 1, y: 0 },
                anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 8, y: 0 },
                size: { x: 100, y: 0 },
            },
            text: { content: label, fontSize: theme.fontSize.md, align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle },
        });
    }

    if (options.onChange && options.events) {
        const cb = options.onChange;
        options.events.on(toggle, 'change', () => {
            const t = world.get(toggle, Toggle) as ToggleData;
            cb(t.isOn, toggle);
        });
    }

    return toggle;
}

export interface ProgressBarOptions {
    value?: number;
    size?: Vec2;
    direction?: FillDirection;
    trackColor?: Color;
    fillColor?: Color;
    parent?: Entity;
}

function createProgressBar(world: World, options: ProgressBarOptions = {}): Entity {
    const theme = getTheme();
    const {
        value = 0,
        size = { x: 200, y: theme.slider.trackHeight },
        direction = FillDirection.LeftToRight,
        trackColor = theme.slider.trackColor,
        fillColor = theme.primary,
        parent,
    } = options;

    const fill = spawnUI(world, {
        name: 'ProgressFill',
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        renderer: { visualType: UIVisualType.SolidColor, color: fillColor },
    });

    const root = spawnUI(world, {
        name: 'ProgressBar',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: trackColor },
        components: [
            [ProgressBar, { value, fillEntity: fill, direction }],
        ],
    });

    world.setParent(fill, root);
    return root;
}

export interface ScrollViewOptions {
    size?: Vec2;
    contentSize?: Vec2;
    horizontal?: boolean;
    vertical?: boolean;
    elastic?: boolean;
    mask?: boolean;
    parent?: Entity;
}

function createScrollView(world: World, options: ScrollViewOptions = {}): Entity {
    const theme = getTheme();
    const {
        size = { x: 300, y: 400 },
        contentSize = { x: 300, y: 800 },
        horizontal = false,
        vertical = true,
        elastic = true,
        mask = true,
        parent,
    } = options;

    const content = spawnUI(world, {
        name: 'ScrollContent',
        rect: {
            anchorMin: { x: 0, y: 1 },
            anchorMax: { x: 1, y: 1 },
            size: { x: contentSize.x, y: contentSize.y },
            pivot: { x: 0.5, y: 1 },
        },
    });

    const root = spawnUI(world, {
        name: 'ScrollView',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: theme.scrollView.backgroundColor },
        mask: mask ? { mode: MaskMode.Scissor, enabled: true } : undefined,
        components: [
            [ScrollView, {
                contentEntity: content,
                horizontalEnabled: horizontal,
                verticalEnabled: vertical,
                contentWidth: contentSize.x,
                contentHeight: contentSize.y,
                elastic,
                scrollX: 0, scrollY: 0,
                inertia: true,
                decelerationRate: 0.135,
                wheelSensitivity: 0.1,
            }],
        ],
    });

    world.setParent(content, root);
    return root;
}

export interface TextInputOptions {
    placeholder?: string;
    value?: string;
    size?: Vec2;
    fontSize?: number;
    backgroundColor?: Color;
    textColor?: Color;
    maxLength?: number;
    multiline?: boolean;
    password?: boolean;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (value: string, entity: Entity) => void;
    onSubmit?: (value: string, entity: Entity) => void;
}

function createTextInput(world: World, options: TextInputOptions = {}): Entity {
    const theme = getTheme();
    const {
        placeholder = '',
        value = '',
        size = { x: 200, y: theme.input.height },
        fontSize = theme.input.fontSize,
        backgroundColor = theme.input.backgroundColor,
        textColor = theme.input.textColor,
        maxLength = 0,
        multiline = false,
        password = false,
        parent,
    } = options;

    const entity = spawnUI(world, {
        name: 'TextInput',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: backgroundColor },
        interactable: { enabled: true },
        components: [
            [TextInput, {
                value, placeholder, fontSize,
                fontFamily: theme.fontFamily,
                color: textColor,
                backgroundColor,
                placeholderColor: theme.input.placeholderColor,
                padding: theme.input.padding,
                maxLength, multiline, password,
                readOnly: false,
                focused: false,
                cursorPos: value.length,
                dirty: true,
            }],
            [Focusable, { tabIndex: 0, isFocused: false }],
        ],
    });

    if (options.events) {
        if (options.onChange) {
            const cb = options.onChange;
            options.events.on(entity, 'change', () => {
                const ti = world.get(entity, TextInput) as TextInputData;
                cb(ti.value, entity);
            });
        }
        if (options.onSubmit) {
            const cb = options.onSubmit;
            options.events.on(entity, 'submit', () => {
                const ti = world.get(entity, TextInput) as TextInputData;
                cb(ti.value, entity);
            });
        }
    }

    return entity;
}

export interface DropdownOptions {
    options: string[];
    selectedIndex?: number;
    size?: Vec2;
    fontSize?: number;
    parent?: Entity;
    events?: UIEventQueue;
    onChange?: (selectedIndex: number, entity: Entity) => void;
}

function createDropdown(world: World, options: DropdownOptions): Entity {
    const theme = getTheme();
    const {
        options: items,
        selectedIndex = -1,
        size = { x: 160, y: theme.dropdown.height },
        fontSize = theme.fontSize.md,
        parent,
    } = options;

    const label = spawnUI(world, {
        name: 'DropdownLabel',
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        text: {
            content: (selectedIndex >= 0 ? items[selectedIndex] : items[0]) ?? '',
            fontSize,
            align: TextAlign.Left,
            verticalAlign: TextVerticalAlign.Middle,
        },
    });

    const list = spawnUI(world, {
        name: 'DropdownList',
        rect: {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 0 },
            size: { x: size.x, y: Math.min(items.length * theme.dropdown.itemHeight, 200) },
            pivot: { x: 0.5, y: 1 },
        },
        renderer: { visualType: UIVisualType.SolidColor, color: theme.surface },
        mask: { mode: MaskMode.Scissor, enabled: true },
    });

    const root = spawnUI(world, {
        name: 'Dropdown',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: theme.dropdown.backgroundColor },
        interactable: { enabled: true },
        components: [
            [Dropdown, {
                options: items,
                selectedIndex,
                isOpen: false,
                listEntity: list,
                labelEntity: label,
            }],
        ],
    });

    world.setParent(label, root);
    world.setParent(list, root);

    if (options.onChange && options.events) {
        const cb = options.onChange;
        options.events.on(root, 'change', () => {
            const dd = world.get(root, Dropdown) as DropdownData;
            cb(dd.selectedIndex, root);
        });
    }

    return root;
}

export interface LabelOptions {
    text: string;
    fontSize?: number;
    color?: Color;
    align?: TextAlign;
    verticalAlign?: TextVerticalAlign;
    size?: Vec2;
    parent?: Entity;
}

function createLabel(world: World, options: LabelOptions): Entity {
    const theme = getTheme();
    return spawnUI(world, {
        name: 'Label',
        parent: options.parent,
        rect: options.size
            ? { anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 }, size: options.size }
            : { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        text: {
            content: options.text,
            fontSize: options.fontSize ?? theme.fontSize.md,
            color: options.color ?? theme.text,
            align: options.align ?? TextAlign.Left,
            verticalAlign: options.verticalAlign ?? TextVerticalAlign.Middle,
        },
    });
}

export interface PanelOptions {
    size?: Vec2;
    color?: Color;
    parent?: Entity;
}

function createPanel(world: World, options: PanelOptions = {}): Entity {
    const theme = getTheme();
    return spawnUI(world, {
        name: 'Panel',
        parent: options.parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size: options.size ?? { x: 300, y: 200 },
        },
        renderer: {
            visualType: UIVisualType.SolidColor,
            color: options.color ?? theme.panel.backgroundColor,
        },
    });
}

export interface FlexOptions {
    gap?: number;
    padding?: { left: number; top: number; right: number; bottom: number };
    wrap?: boolean;
    justifyContent?: JustifyContentType;
    alignItems?: AlignItemsType;
    parent?: Entity;
}

function createFlexRow(world: World, options: FlexOptions = {}): Entity {
    return spawnUI(world, {
        name: 'FlexRow',
        parent: options.parent,
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        flex: {
            direction: FlexDirection.Row,
            wrap: options.wrap ? FlexWrap.Wrap : FlexWrap.NoWrap,
            justifyContent: options.justifyContent ?? JustifyContent.Start,
            alignItems: options.alignItems ?? AlignItems.Start,
            gap: { x: options.gap ?? 0, y: options.gap ?? 0 },
            padding: options.padding ?? { left: 0, top: 0, right: 0, bottom: 0 },
        },
    });
}

function createFlexColumn(world: World, options: FlexOptions = {}): Entity {
    return spawnUI(world, {
        name: 'FlexColumn',
        parent: options.parent,
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        flex: {
            direction: FlexDirection.Column,
            wrap: options.wrap ? FlexWrap.Wrap : FlexWrap.NoWrap,
            justifyContent: options.justifyContent ?? JustifyContent.Start,
            alignItems: options.alignItems ?? AlignItems.Start,
            gap: { x: options.gap ?? 0, y: options.gap ?? 0 },
            padding: options.padding ?? { left: 0, top: 0, right: 0, bottom: 0 },
        },
    });
}

// --- Declarative Tree Builder (Layer 3) ---

interface UINodeBase {
    ref?: (entity: Entity) => void;
}

export interface UIElementNode extends UINodeBase {
    type: 'element';
    name?: string;
    rect?: Partial<UIRectData>;
    renderer?: Partial<UIRendererData>;
    text?: Partial<TextData>;
    image?: Partial<ImageData>;
    interactable?: Partial<InteractableData>;
    flex?: Partial<FlexContainerData>;
    flexItem?: Partial<FlexItemData>;
    mask?: Partial<UIMaskData>;
    components?: Array<[AnyComponentDef, Record<string, unknown>?]>;
    children?: UINode[];
}

export interface UIButtonNode extends UINodeBase { type: 'button'; options?: ButtonOptions; }
export interface UISliderNode extends UINodeBase { type: 'slider'; options?: SliderOptions; }
export interface UIToggleNode extends UINodeBase { type: 'toggle'; options?: ToggleOptions; }
export interface UITextInputNode extends UINodeBase { type: 'textInput'; options?: TextInputOptions; }
export interface UIDropdownNode extends UINodeBase { type: 'dropdown'; options: DropdownOptions; }
export interface UIProgressBarNode extends UINodeBase { type: 'progressBar'; options?: ProgressBarOptions; }
export interface UILabelNode extends UINodeBase { type: 'label'; options: LabelOptions; }
export interface UIPanelNode extends UINodeBase { type: 'panel'; options?: PanelOptions; children?: UINode[]; }
export interface UIFlexRowNode extends UINodeBase { type: 'flexRow'; options?: FlexOptions; children?: UINode[]; }
export interface UIFlexColumnNode extends UINodeBase { type: 'flexColumn'; options?: FlexOptions; children?: UINode[]; }
export interface UIScrollViewNode extends UINodeBase { type: 'scrollView'; options?: ScrollViewOptions; children?: UINode[]; }

export type UINode =
    | UIElementNode | UIButtonNode | UISliderNode | UIToggleNode
    | UIScrollViewNode | UITextInputNode | UIDropdownNode | UIProgressBarNode
    | UILabelNode | UIPanelNode | UIFlexRowNode | UIFlexColumnNode;

type WidgetFactory = (world: World, options: any) => Entity;

const widgetFactories: Record<string, WidgetFactory> = {
    button: createButton,
    slider: createSlider,
    toggle: createToggle,
    textInput: createTextInput,
    dropdown: createDropdown,
    progressBar: createProgressBar,
    label: createLabel,
    panel: createPanel,
    flexRow: createFlexRow,
    flexColumn: createFlexColumn,
    scrollView: createScrollView,
};

function buildUI(world: World, node: UINode, parent?: Entity): Entity {
    let entity: Entity;
    let childrenTarget: Entity | undefined;

    if (node.type === 'element') {
        entity = spawnUI(world, { ...node, parent });
        childrenTarget = entity;
    } else {
        const factory = widgetFactories[node.type];
        const opts = (node as any).options ?? {};
        entity = factory(world, { ...opts, parent });

        if (node.type === 'scrollView') {
            const sv = world.get(entity, ScrollView) as ScrollViewData;
            childrenTarget = sv.contentEntity;
        } else {
            childrenTarget = entity;
        }
    }

    const children = (node as any).children as UINode[] | undefined;
    if (children && childrenTarget) {
        for (const child of children) {
            buildUI(world, child, childrenTarget);
        }
    }

    if (node.ref) {
        node.ref(entity);
    }

    return entity;
}

// --- Public API ---

export const UI = {
    spawn: spawnUI,
    destroy: destroyUI,
    build: buildUI,

    label: createLabel,
    panel: createPanel,

    button: createButton,
    slider: createSlider,
    toggle: createToggle,
    scrollView: createScrollView,
    textInput: createTextInput,
    dropdown: createDropdown,
    progressBar: createProgressBar,

    flexRow: createFlexRow,
    flexColumn: createFlexColumn,
};
