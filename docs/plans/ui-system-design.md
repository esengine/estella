# UI System Evolution Design

## 1. Problem Statement

ESEngine 的 UI 系统已经拥有完整的原子组件（Button、Slider、Toggle、ScrollView、Dropdown、ListView、TextInput 等），但在**组合复用**层面存在显著缺陷：

1. **创建一个复合控件需要大量样板代码** — 以 Slider 为例，用户需要手动 spawn 3 个实体（背景、fill bar、handle），逐个 insert 5-8 个组件，手动建立父子关系，再把子实体 ID 赋给 Slider 组件。约 40-60 行代码才能创建一个功能完整的 Slider。

2. **没有声明式描述 UI 结构的能力** — 所有 UI 都是命令式 spawn/insert/setParent，无法一眼看出最终的 UI 树形结构。

3. **没有样式/主题系统** — 颜色、字号、间距全部硬编码在每个实体上，换一套配色需要逐个修改。

4. **组件间状态同步靠手写** — 想让 Slider 值显示在 Text 上，需要写一个自定义 System 手动同步。

5. **插件内部存在大量重复模式** — child entity 校验、颜色更新、状态 Map 清理等代码在 14 个插件中重复出现。

### 设计目标

- **降低 UI 创建门槛**：一行代码创建一个完整的复合控件
- **支持声明式 UI 树**：用数据结构描述 UI 层级，自动创建实体
- **统一视觉风格**：主题系统管理全局配色和样式
- **保持 ECS 纯粹性**：所有方案必须兼容现有的 ECS 架构，不引入 OOP 继承体系
- **渐进式采用**：新 API 与现有手动方式完全兼容，不破坏已有代码

---

## 2. Current Architecture Analysis

### 2.1 现有组件清单

| 类别 | 组件 | 复合度 | 子实体引用 |
|------|------|--------|-----------|
| 布局 | UIRect, FlexContainer, FlexItem, LayoutGroup | 单实体 | - |
| 视觉 | UIRenderer, Image, Text | 单实体 | - |
| 交互 | Interactable, UIInteraction, Focusable, Draggable | 单实体 | - |
| 控件 | Button | 单实体 | - |
| 控件 | Slider | **复合** | fillEntity, handleEntity |
| 控件 | ProgressBar | **复合** | fillEntity |
| 控件 | Toggle | **复合** | graphicEntity |
| 控件 | ScrollView | **复合** | contentEntity |
| 控件 | Dropdown | **复合** | listEntity, labelEntity |
| 控件 | ListView | **复合** | 动态子实体 (Map) |
| 输入 | TextInput | 单实体 | - |
| 容器 | UIMask, SafeArea | 单实体 | - |

### 2.2 现有创建模式

**模式 A：场景加载（编辑器 -> 运行时）**
```
Scene JSON -> Phase 1: Spawn All -> Phase 2: Load Components + Remap Entity IDs -> Phase 3: Set Hierarchy
```

**模式 B：Prefab 实例化**
```
PrefabData -> Flatten Nested -> Convert to SceneData -> Standard Scene Loading
```

**模式 C：运行时动态创建（如 DropdownPlugin）**
```typescript
const entity = world.spawn();
world.insert(entity, Name, { value: 'Option_0' });
world.insert(entity, UIRect, { anchorMin: {x:0,y:1}, anchorMax: {x:1,y:1}, ... });
world.insert(entity, Transform, { position: {x:0,y:0,z:0}, ... });
world.insert(entity, UIRenderer, { visualType: 1, color: {r:1,g:1,b:1,a:1}, ... });
world.insert(entity, Interactable, { enabled: true, blockRaycast: true });
world.setParent(entity, parent);
```

### 2.3 插件内部的重复模式

经分析 14 个 UI 插件，以下模式出现 10+ 次：

| 模式 | 出现次数 | 典型代码 |
|------|---------|---------|
| Child entity 校验 (`!== 0 && world.valid()`) | 20+ | `if (slider.fillEntity !== 0 && world.valid(slider.fillEntity))` |
| 双渲染器颜色更新 (UIRenderer \|\| Sprite) | 10+ | `if (world.has(e, UIRenderer)) ... else if (world.has(e, Sprite)) ...` |
| State Map 清理 | 8 | `for (const [e] of states) { if (!world.valid(e)) states.delete(e); }` |
| First-time 初始化追踪 | 6 | `if (!initialized.has(entity)) { initialized.add(entity); ... }` |
| 实体创建 + 组件批量插入 | 15+ | `spawn() + insert(Name) + insert(UIRect) + insert(Transform) + ...` |

---

## 3. Design: Layer 1 — UI Helpers (Internal Refactor)

**目标**：消除插件内部的重复代码，不影响公开 API。

### 3.1 `withChildEntity` — 安全访问子实体

```typescript
function withChildEntity(
    world: World,
    childId: Entity,
    callback: (entity: Entity) => void
): void {
    if (childId !== 0 && world.valid(childId)) {
        callback(childId);
    }
}
```

**Before:**
```typescript
if (slider.fillEntity !== 0 && world.valid(slider.fillEntity)) {
    applyDirectionalFill(world, slider.fillEntity, slider.direction, value);
}
if (slider.handleEntity !== 0 && world.valid(slider.handleEntity)) {
    ensureComponent(world, slider.handleEntity, Interactable, { enabled: true });
}
```

**After:**
```typescript
withChildEntity(world, slider.fillEntity, (e) => {
    applyDirectionalFill(world, e, slider.direction, value);
});
withChildEntity(world, slider.handleEntity, (e) => {
    ensureComponent(world, e, Interactable, { enabled: true });
});
```

### 3.2 `setEntityColor` — 统一颜色更新

```typescript
function setEntityColor(world: World, entity: Entity, color: Color): void {
    if (world.has(entity, UIRenderer)) {
        const r = world.get(entity, UIRenderer) as UIRendererData;
        r.color = color;
        world.insert(entity, UIRenderer, r);
    } else if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite) as SpriteData;
        s.color = color;
        world.insert(entity, Sprite, s);
    }
}
```

### 3.3 `colorScale` / `colorBrighten` — 颜色工具函数

SDK 中 `applyDefaultTint` 使用乘法系数调整颜色，但没有暴露独立的工具函数。新增：

```typescript
function colorScale(c: Color, factor: number): Color {
    return {
        r: Math.min(1, c.r * factor),
        g: Math.min(1, c.g * factor),
        b: Math.min(1, c.b * factor),
        a: c.a,
    };
}

function colorWithAlpha(c: Color, alpha: number): Color {
    return { r: c.r, g: c.g, b: c.b, a: alpha };
}
```

### 3.4 `EntityStateMap<T>` — 自动清理的状态管理

```typescript
class EntityStateMap<T> {
    private map_ = new Map<Entity, T>();

    get(entity: Entity): T | undefined { return this.map_.get(entity); }
    set(entity: Entity, state: T): void { this.map_.set(entity, state); }
    delete(entity: Entity): void { this.map_.delete(entity); }
    has(entity: Entity): boolean { return this.map_.has(entity); }

    cleanup(world: World): void {
        for (const [e] of this.map_) {
            if (!world.valid(e)) this.map_.delete(e);
        }
    }

    ensureInit(entity: Entity, init: () => T): T {
        let state = this.map_.get(entity);
        if (!state) {
            state = init();
            this.map_.set(entity, state);
        }
        return state;
    }

    [Symbol.iterator]() { return this.map_[Symbol.iterator](); }
}
```

### 3.5 Impact

- 纯内部重构，不改变任何公开 API
- 预计减少 ~200 行重复代码
- 降低新插件的编写成本

---

## 4. Design: Layer 2 — UI Builder (Factory Functions)

**目标**：一行代码创建完整的复合控件。

### 4.1 Constraints & API Design Decisions

**调用时机约束**：`world.spawn()` 在 System query 迭代期间禁止调用（会抛异常）。因此 Factory 函数只能在以下场景使用：
- Startup 系统中
- System 外部（如 App 初始化、场景加载回调）
- 通过 `Commands` 延迟执行（未来可扩展）

**参数设计**：Factory 函数只接受 `world`，不接受 `app`。事件绑定通过返回的 Entity 由调用者自行完成，保持 Factory 的纯粹性（只负责创建实体结构）。事件回调作为可选的便捷 API 在 Layer 5 引入，需要额外传入 `UIEventQueue`。

### 4.2 Core: `spawnUI`

所有 UI 实体创建的基础函数。

**关于 UIRect 默认值**：`spawnUI` 中 UIRect 的默认 anchor 设为 `{0,0}` - `{1,1}`（拉伸填充父容器），这与 UIRect 组件自身的默认值 `{0.5,0.5}` - `{0.5,0.5}`（居中固定大小）有意不同。UI 子元素在大多数场景下需要跟随父容器缩放，因此 spawnUI 选择拉伸作为默认行为。当传入 `size` 时，调用者通常会同时设置相同的 anchorMin/Max 来覆盖。

```typescript
interface UIEntityDef {
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
    components?: Array<[AnyComponentDef, Record<string, unknown>]>;
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
        world.insert(entity, Text, { ...Text._default, ...def.text });
    }

    if (def.image) {
        world.insert(entity, Image, { ...Image._default, ...def.image });
    }

    if (def.flex) {
        world.insert(entity, FlexContainer, { ...FlexContainer._default, ...def.flex });
    }

    if (def.flexItem) {
        world.insert(entity, FlexItem, { ...FlexItem._default, ...def.flexItem });
    }

    if (def.mask) {
        world.insert(entity, UIMask, { enabled: true, mode: MaskMode.Scissor, ...def.mask });
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
```

### 4.3 Composite Widget Factories

#### `UI.button`

```typescript
interface ButtonOptions {
    text?: string;
    fontSize?: number;
    size?: Vec2;
    color?: Color;
    textColor?: Color;
    transition?: ColorTransition;
    parent?: Entity;
}

function createButton(world: World, options: ButtonOptions = {}): Entity {
    const {
        text = 'Button',
        fontSize = 16,
        size = { x: 120, y: 40 },
        color = { r: 0.25, g: 0.25, b: 0.25, a: 1 },
        textColor = { r: 1, g: 1, b: 1, a: 1 },
        parent,
    } = options;

    const transition = options.transition ?? {
        normalColor: color,
        hoveredColor: colorScale(color, 1.15),
        pressedColor: colorScale(color, 0.75),
        disabledColor: colorWithAlpha(colorScale(color, 0.5), color.a * 0.6),
    };

    const button = spawnUI(world, {
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
            [Button, { state: ButtonState.Normal, transition }],
        ],
    });

    spawnUI(world, {
        name: 'ButtonText',
        parent: button,
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        text: {
            content: text,
            fontSize,
            color: textColor,
            align: TextAlign.Center,
            verticalAlign: TextVerticalAlign.Middle,
        },
    });

    return button;
}
```

**Usage:**
```typescript
const btn = UI.button(world, {
    text: 'Play',
    size: { x: 200, y: 50 },
    color: { r: 0.2, g: 0.6, b: 0.9, a: 1 },
});
events.on(btn, 'click', () => startGame());
```

#### `UI.slider`

```typescript
interface SliderOptions {
    value?: number;
    min?: number;
    max?: number;
    size?: Vec2;
    direction?: FillDirection;
    trackColor?: Color;
    fillColor?: Color;
    handleColor?: Color;
    handleSize?: number;
    wholeNumbers?: boolean;
    parent?: Entity;
}

function createSlider(world: World, options: SliderOptions = {}): Entity {
    const {
        value = 0.5, min = 0, max = 1,
        size = { x: 200, y: 20 },
        direction = FillDirection.LeftToRight,
        trackColor = { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        fillColor = { r: 0.2, g: 0.6, b: 0.9, a: 1 },
        handleColor = { r: 1, g: 1, b: 1, a: 1 },
        handleSize = 24,
        wholeNumbers = false,
        parent,
    } = options;

    const isHorizontal = direction <= 1;

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
            size: { x: handleSize, y: handleSize },
        },
        renderer: { visualType: UIVisualType.SolidColor, color: handleColor },
        interactable: { enabled: true },
        components: [
            [Draggable, {
                enabled: true,
                dragThreshold: 5,
                lockX: !isHorizontal,
                lockY: isHorizontal,
                constraintMin: null,
                constraintMax: null,
            }],
        ],
    });

    const slider = spawnUI(world, {
        name: 'Slider',
        parent,
        rect: {
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            size,
        },
        renderer: { visualType: UIVisualType.SolidColor, color: trackColor },
        interactable: { enabled: true },
        components: [
            [Slider, {
                value, minValue: min, maxValue: max,
                direction, wholeNumbers,
                fillEntity: fill,
                handleEntity: handle,
            }],
        ],
    });

    world.setParent(fill, slider);
    world.setParent(handle, slider);

    return slider;
}
```

#### `UI.toggle`

```typescript
interface ToggleOptions {
    isOn?: boolean;
    size?: Vec2;
    checkSize?: Vec2;
    onColor?: Color;
    offColor?: Color;
    checkColor?: Color;
    transition?: ColorTransition;
    label?: string;
    group?: Entity;
    parent?: Entity;
}

function createToggle(world: World, options: ToggleOptions = {}): Entity {
    const {
        isOn = false,
        size = { x: 24, y: 24 },
        checkSize = { x: 16, y: 16 },
        offColor = { r: 0.4, g: 0.4, b: 0.4, a: 1 },
        onColor = { r: 0.2, g: 0.6, b: 1, a: 1 },
        checkColor = { r: 1, g: 1, b: 1, a: 1 },
        transition = null,
        label,
        group = 0 as Entity,
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
            text: { content: label, fontSize: 14, align: TextAlign.Left },
        });
    }

    return toggle;
}
```

#### `UI.scrollView`

```typescript
interface ScrollViewOptions {
    size?: Vec2;
    contentSize?: Vec2;
    horizontal?: boolean;
    vertical?: boolean;
    elastic?: boolean;
    mask?: boolean;
    parent?: Entity;
}

function createScrollView(world: World, options: ScrollViewOptions = {}): Entity {
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
        renderer: { visualType: UIVisualType.SolidColor, color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } },
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
```

> **Note**: 需要访问 contentEntity 时，通过 `world.get(root, ScrollView).contentEntity` 获取。所有 Factory 统一返回根 Entity，保持 API 一致性。

#### `UI.textInput`

```typescript
interface TextInputOptions {
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
}

function createTextInput(world: World, options: TextInputOptions = {}): Entity {
    const {
        placeholder = '',
        value = '',
        size = { x: 200, y: 36 },
        fontSize = 16,
        backgroundColor = { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        textColor = { r: 1, g: 1, b: 1, a: 1 },
        maxLength = 0,
        multiline = false,
        password = false,
        parent,
    } = options;

    return spawnUI(world, {
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
                fontFamily: 'Arial',
                color: textColor,
                backgroundColor,
                placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
                padding: 6,
                maxLength, multiline, password,
                readOnly: false,
                focused: false,
                cursorPos: value.length,
                dirty: true,
            }],
            [Focusable, { tabIndex: 0, isFocused: false }],
        ],
    });
}
```

#### `UI.dropdown`

```typescript
interface DropdownOptions {
    options: string[];
    selectedIndex?: number;
    size?: Vec2;
    fontSize?: number;
    parent?: Entity;
}

function createDropdown(world: World, options: DropdownOptions): Entity {
    const {
        options: items,
        selectedIndex = -1,
        size = { x: 160, y: 32 },
        fontSize = 14,
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
            size: { x: size.x, y: Math.min(items.length * 28, 200) },
            pivot: { x: 0.5, y: 1 },
        },
        renderer: { visualType: UIVisualType.SolidColor, color: { r: 0.18, g: 0.18, b: 0.18, a: 1 } },
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
        renderer: { visualType: UIVisualType.SolidColor, color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } },
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

    return root;
}
```

#### `UI.progressBar`

```typescript
interface ProgressBarOptions {
    value?: number;
    size?: Vec2;
    direction?: FillDirection;
    trackColor?: Color;
    fillColor?: Color;
    parent?: Entity;
}

function createProgressBar(world: World, options: ProgressBarOptions = {}): Entity {
    const {
        value = 0,
        size = { x: 200, y: 16 },
        direction = FillDirection.LeftToRight,
        trackColor = { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        fillColor = { r: 0.2, g: 0.8, b: 0.3, a: 1 },
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
```

#### `UI.label`

最常用的 UI 元素，独立快捷函数：

```typescript
interface LabelOptions {
    text: string;
    fontSize?: number;
    color?: Color;
    align?: TextAlign;
    verticalAlign?: TextVerticalAlign;
    size?: Vec2;
    parent?: Entity;
}

function createLabel(world: World, options: LabelOptions): Entity {
    return spawnUI(world, {
        name: 'Label',
        parent: options.parent,
        rect: options.size
            ? { anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 }, size: options.size }
            : { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        text: {
            content: options.text,
            fontSize: options.fontSize ?? 14,
            color: options.color ?? { r: 1, g: 1, b: 1, a: 1 },
            align: options.align ?? TextAlign.Left,
            verticalAlign: options.verticalAlign ?? TextVerticalAlign.Middle,
        },
    });
}
```

#### `UI.panel` / `UI.flexRow` / `UI.flexColumn`

```typescript
interface PanelOptions {
    size?: Vec2;
    color?: Color;
    parent?: Entity;
}

function createPanel(world: World, options: PanelOptions = {}): Entity {
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
            color: options.color ?? { r: 0.14, g: 0.14, b: 0.14, a: 1 },
        },
    });
}

interface FlexOptions {
    gap?: number;
    padding?: { left: number; top: number; right: number; bottom: number };
    wrap?: boolean;
    justifyContent?: number;
    alignItems?: number;
    parent?: Entity;
}

function createFlexRow(world: World, options: FlexOptions = {}): Entity {
    return spawnUI(world, {
        name: 'FlexRow',
        parent: options.parent,
        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 } },
        flex: {
            direction: FlexDirection.Row,
            wrap: options.wrap ?? false,
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
            wrap: options.wrap ?? false,
            justifyContent: options.justifyContent ?? JustifyContent.Start,
            alignItems: options.alignItems ?? AlignItems.Start,
            gap: { x: options.gap ?? 0, y: options.gap ?? 0 },
            padding: options.padding ?? { left: 0, top: 0, right: 0, bottom: 0 },
        },
    });
}
```

### 4.4 Entity Lifecycle: Destroy

当前 `world.despawn(entity)` 不会级联删除子实体。Factory 创建的复合控件需要提供递归销毁函数：

```typescript
function destroyUI(world: World, entity: Entity): void {
    if (!world.valid(entity)) return;

    // 递归销毁所有子实体
    const children = world.getChildren(entity);
    if (children) {
        for (const child of [...children]) {
            destroyUI(world, child);
        }
    }

    world.despawn(entity);
}
```

> **Note**: 需要确认 `world.getChildren()` 是否可用。如果 C++ Registry 不暴露 Children 查询，则需要在 World 上新增此方法，或者在 Factory 返回时记录子实体列表。

### 4.5 Public API Surface

```typescript
export const UI = {
    spawn: spawnUI,
    destroy: destroyUI,

    // Atomic
    label: createLabel,
    panel: createPanel,

    // Composite widgets
    button: createButton,
    slider: createSlider,
    toggle: createToggle,
    scrollView: createScrollView,
    textInput: createTextInput,
    dropdown: createDropdown,
    progressBar: createProgressBar,

    // Layout helpers
    flexRow: createFlexRow,
    flexColumn: createFlexColumn,
};
```

### 4.6 Before/After Comparison

**Before (手动创建 Slider，~55 行):**
```typescript
const slider = world.spawn();
world.insert(slider, Name, { value: 'VolumeSlider' });
world.insert(slider, Transform, { position: {x:0,y:0,z:0}, rotation: {w:1,x:0,y:0,z:0}, scale: {x:1,y:1,z:1} });
world.insert(slider, UIRect, { anchorMin: {x:0.5,y:0.5}, anchorMax: {x:0.5,y:0.5}, size: {x:200,y:16}, offsetMin: {x:0,y:0}, offsetMax: {x:0,y:0}, pivot: {x:0.5,y:0.5} });
world.insert(slider, UIRenderer, { visualType: 1, texture: 0, color: {r:0.15,g:0.15,b:0.15,a:1}, uvOffset: {x:0,y:0}, uvScale: {x:1,y:1}, sliceBorder: {x:0,y:0,z:0,w:0}, material: 0, enabled: true });
world.insert(slider, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });

const fill = world.spawn();
world.insert(fill, Name, { value: 'SliderFill' });
world.insert(fill, Transform, { ... });
world.insert(fill, UIRect, { anchorMin: {x:0,y:0}, anchorMax: {x:1,y:1}, ... });
world.insert(fill, UIRenderer, { visualType: 1, color: {r:0.2,g:0.6,b:0.9,a:1}, ... });
world.setParent(fill, slider);

const handle = world.spawn();
world.insert(handle, Name, { value: 'SliderHandle' });
world.insert(handle, Transform, { ... });
world.insert(handle, UIRect, { anchorMin: {x:0.5,y:0.5}, anchorMax: {x:0.5,y:0.5}, size: {x:24,y:24}, ... });
world.insert(handle, UIRenderer, { visualType: 1, color: {r:1,g:1,b:1,a:1}, ... });
world.insert(handle, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
world.insert(handle, Draggable, { enabled: true, dragThreshold: 5, lockX: false, lockY: true });
world.setParent(handle, slider);

world.insert(slider, Slider, {
    value: 0.7, minValue: 0, maxValue: 1,
    direction: 0, wholeNumbers: false,
    fillEntity: fill, handleEntity: handle,
});
```

**After (Factory，1 行):**
```typescript
const slider = UI.slider(world, { value: 0.7, size: { x: 200, y: 16 } });
```

### 4.7 与编辑器 Prefab 系统的互操作

Factory 创建的实体与手动创建的实体完全等价——同样的组件、同样的父子层级、同样的 entity 引用字段。因此：

- **序列化**：Factory 产出的实体可以被场景序列化系统正常保存为 Scene JSON，无需特殊处理
- **Entity 引用 remap**：`COMPONENT_ENTITY_FIELDS` 中已注册的字段（Slider.fillEntity、ScrollView.contentEntity 等）在序列化/反序列化时自动 remap
- **编辑器 Create UI 菜单**：Phase 6 中编辑器可以调用 Factory 函数创建 UI，然后立即将结果转为 EntityData 保存到 Scene

---

## 5. Design: Layer 3 — Declarative UI Tree

**目标**：用数据结构描述 UI 层级，自动递归创建。

### 5.1 UINode 描述格式

使用 discriminated union 保持完整类型安全：

```typescript
type UINode = UIElementNode | UIButtonNode | UISliderNode | UIToggleNode
    | UIScrollViewNode | UITextInputNode | UIDropdownNode | UIProgressBarNode
    | UILabelNode | UIPanelNode | UIFlexRowNode | UIFlexColumnNode;

interface UINodeBase {
    ref?: (entity: Entity) => void;
}

interface UIElementNode extends UINodeBase {
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
    components?: Array<[AnyComponentDef, Record<string, unknown>]>;
    children?: UINode[];
}

// Leaf widgets (no children)
interface UIButtonNode extends UINodeBase {
    type: 'button';
    options?: ButtonOptions;
}

interface UISliderNode extends UINodeBase {
    type: 'slider';
    options?: SliderOptions;
}

interface UIToggleNode extends UINodeBase {
    type: 'toggle';
    options?: ToggleOptions;
}

interface UITextInputNode extends UINodeBase {
    type: 'textInput';
    options?: TextInputOptions;
}

interface UIDropdownNode extends UINodeBase {
    type: 'dropdown';
    options: DropdownOptions;
}

interface UIProgressBarNode extends UINodeBase {
    type: 'progressBar';
    options?: ProgressBarOptions;
}

interface UILabelNode extends UINodeBase {
    type: 'label';
    options: LabelOptions;
}

// Container widgets (accept children)
interface UIPanelNode extends UINodeBase {
    type: 'panel';
    options?: PanelOptions;
    children?: UINode[];
}

interface UIFlexRowNode extends UINodeBase {
    type: 'flexRow';
    options?: FlexOptions;
    children?: UINode[];
}

interface UIFlexColumnNode extends UINodeBase {
    type: 'flexColumn';
    options?: FlexOptions;
    children?: UINode[];
}

interface UIScrollViewNode extends UINodeBase {
    type: 'scrollView';
    options?: ScrollViewOptions;
    children?: UINode[];
}
```

### 5.2 `UI.build` — 递归构建器

```typescript
const containerTypes = new Set(['element', 'panel', 'flexRow', 'flexColumn', 'scrollView']);

function buildUI(world: World, node: UINode, parent?: Entity): Entity {
    let entity: Entity;
    let childrenTarget: Entity | undefined;

    if (node.type === 'element') {
        entity = spawnUI(world, { ...node, parent });
        childrenTarget = entity;
    } else {
        const factory = widgetFactories[node.type];
        entity = factory(world, { ...(node as any).options, parent });

        // ScrollView: children 应该添加到 contentEntity 而非 root
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
```

### 5.3 Usage Examples

**Settings Panel:**
```typescript
let volumeSlider: Entity;
let muteToggle: Entity;

UI.build(world, {
    type: 'panel',
    options: { size: { x: 400, y: 300 } },
    children: [
        {
            type: 'flexColumn',
            options: { gap: 12, padding: { left: 16, top: 16, right: 16, bottom: 16 } },
            children: [
                {
                    type: 'flexRow',
                    options: { gap: 8, alignItems: AlignItems.Center },
                    children: [
                        { type: 'label', options: { text: 'Volume', size: { x: 80, y: 24 } } },
                        { type: 'slider', options: { value: 0.7, size: { x: 200, y: 16 } },
                          ref: (e) => { volumeSlider = e; } },
                    ],
                },
                {
                    type: 'flexRow',
                    options: { gap: 8, alignItems: AlignItems.Center },
                    children: [
                        { type: 'label', options: { text: 'Mute', size: { x: 80, y: 24 } } },
                        { type: 'toggle', options: { isOn: false },
                          ref: (e) => { muteToggle = e; } },
                    ],
                },
                {
                    type: 'button',
                    options: { text: 'Apply', size: { x: 120, y: 36 } },
                    ref: (e) => { events.on(e, 'click', () => applySettings()); },
                },
            ],
        },
    ],
});
```

**Inventory Grid:**
```typescript
UI.build(world, {
    type: 'scrollView',
    options: { size: { x: 320, y: 480 }, vertical: true },
    children: [
        {
            type: 'flexRow',
            options: { wrap: true, gap: 4 },
            children: inventory.map((item) => ({
                type: 'element' as const,
                name: `Slot_${item.id}`,
                rect: { size: { x: 72, y: 72 } },
                renderer: { visualType: UIVisualType.SolidColor, color: SLOT_BG },
                interactable: { enabled: true },
                children: [
                    {
                        type: 'element' as const,
                        rect: { anchorMin: { x: 0.1, y: 0.1 }, anchorMax: { x: 0.9, y: 0.9 } },
                        image: { texture: item.iconHandle },
                    },
                    {
                        type: 'element' as const,
                        rect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 0 },
                                size: { x: 0, y: 16 } },
                        text: { content: `x${item.count}`, fontSize: 10,
                                align: TextAlign.Right },
                    },
                ],
            })),
        },
    ],
});
```

---

## 6. Design: Layer 4 — Theme System

**目标**：定义一套视觉风格，所有 UI 组件自动应用。

### 6.1 UITheme Resource

```typescript
interface UITheme {
    // Base palette
    primary: Color;
    secondary: Color;
    background: Color;
    surface: Color;
    error: Color;
    text: Color;
    textSecondary: Color;
    border: Color;

    // Typography
    fontFamily: string;
    fontSize: {
        xs: number;    // 10
        sm: number;    // 12
        md: number;    // 14
        lg: number;    // 18
        xl: number;    // 24
    };

    // Spacing scale
    spacing: {
        xs: number;    // 4
        sm: number;    // 8
        md: number;    // 12
        lg: number;    // 16
        xl: number;    // 24
    };

    // Component-level defaults
    button: {
        height: number;
        color: Color;
        textColor: Color;
        transition: ColorTransition;
    };
    slider: {
        trackHeight: number;
        trackColor: Color;
        fillColor: Color;
        handleSize: number;
        handleColor: Color;
    };
    toggle: {
        size: Vec2;
        onColor: Color;
        offColor: Color;
        checkColor: Color;
    };
    input: {
        height: number;
        backgroundColor: Color;
        textColor: Color;
        placeholderColor: Color;
        fontSize: number;
        padding: number;
    };
    dropdown: {
        height: number;
        backgroundColor: Color;
        itemHeight: number;
    };
    panel: {
        backgroundColor: Color;
        padding: number;
    };
    scrollView: {
        backgroundColor: Color;
    };
}

export const UIThemeRes = defineResource<UITheme | null>(null, 'UITheme');
```

### 6.2 Theme Integration

Factory 函数通过 App resource 读取 theme。由于 Factory 只接受 `world`，需要一个模块级的 theme 引用，在 plugin 初始化时设置：

```typescript
let activeTheme: UITheme | null = null;

export function initUIBuilder(app: App): void {
    if (app.hasResource(UIThemeRes)) {
        activeTheme = app.getResource(UIThemeRes);
    }
}

function getTheme(): UITheme {
    return activeTheme ?? DEFAULT_THEME;
}

// Factory 使用
function createButton(world: World, options: ButtonOptions = {}): Entity {
    const theme = getTheme();

    const {
        text = 'Button',
        fontSize = theme.fontSize.md,
        size = { x: 120, y: theme.button.height },
        color = theme.button.color,
        textColor = theme.button.textColor,
        parent,
    } = options;

    const transition = options.transition ?? theme.button.transition;

    // ... rest of creation using themed defaults
}
```

### 6.3 Preset Themes

```typescript
export const DARK_THEME: UITheme = {
    primary: { r: 0.25, g: 0.56, b: 0.96, a: 1 },
    secondary: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
    background: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
    surface: { r: 0.14, g: 0.14, b: 0.14, a: 1 },
    error: { r: 0.9, g: 0.2, b: 0.2, a: 1 },
    text: { r: 0.93, g: 0.93, b: 0.93, a: 1 },
    textSecondary: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    border: { r: 0.3, g: 0.3, b: 0.3, a: 1 },
    fontFamily: 'Arial',
    fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    button: {
        height: 36,
        color: { r: 0.25, g: 0.25, b: 0.25, a: 1 },
        textColor: { r: 0.93, g: 0.93, b: 0.93, a: 1 },
        transition: {
            normalColor: { r: 0.25, g: 0.25, b: 0.25, a: 1 },
            hoveredColor: { r: 0.30, g: 0.30, b: 0.30, a: 1 },
            pressedColor: { r: 0.18, g: 0.18, b: 0.18, a: 1 },
            disabledColor: { r: 0.15, g: 0.15, b: 0.15, a: 0.6 },
        },
    },
    slider: {
        trackHeight: 16,
        trackColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        fillColor: { r: 0.25, g: 0.56, b: 0.96, a: 1 },
        handleSize: 24,
        handleColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    toggle: {
        size: { x: 24, y: 24 },
        onColor: { r: 0.2, g: 0.6, b: 1, a: 1 },
        offColor: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
        checkColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    input: {
        height: 36,
        backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        textColor: { r: 1, g: 1, b: 1, a: 1 },
        placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
        fontSize: 16,
        padding: 6,
    },
    dropdown: {
        height: 32,
        backgroundColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
        itemHeight: 28,
    },
    panel: {
        backgroundColor: { r: 0.14, g: 0.14, b: 0.14, a: 1 },
        padding: 12,
    },
    scrollView: {
        backgroundColor: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    },
};
```

### 6.4 Usage

```typescript
const app = App.new()
    .insertResource(UIThemeRes, DARK_THEME)
    .addPlugin(...uiPlugins)
    .run();

// All UI.button(), UI.slider() etc. automatically use DARK_THEME
// Override per-widget:
UI.button(world, { color: { r: 1, g: 0, b: 0, a: 1 } }); // explicit red overrides theme
```

---

## 7. Design: Layer 5 — Events & Callbacks

**目标**：简化事件绑定，支持 widget-level 回调。

### 7.1 Factory 内联回调

事件回调需要 `UIEventQueue` 实例，因此带回调的 Factory 需要额外传入 events 参数。为了不改变基本签名，采用 Options 字段携带 events 引用的方式：

```typescript
interface ButtonOptions {
    // ... existing fields
    events?: UIEventQueue;
    onClick?: (entity: Entity) => void;
    onHover?: (entity: Entity) => void;
}

interface SliderOptions {
    // ... existing fields
    events?: UIEventQueue;
    onChange?: (value: number, entity: Entity) => void;
}

interface ToggleOptions {
    // ... existing fields
    events?: UIEventQueue;
    onChange?: (isOn: boolean, entity: Entity) => void;
}

interface TextInputOptions {
    // ... existing fields
    events?: UIEventQueue;
    onChange?: (value: string, entity: Entity) => void;
    onSubmit?: (value: string, entity: Entity) => void;
}

interface DropdownOptions {
    // ... existing fields
    events?: UIEventQueue;
    onChange?: (selectedIndex: number, entity: Entity) => void;
}
```

### 7.2 Implementation

```typescript
function createButton(world: World, options: ButtonOptions = {}): Entity {
    // ... create entities ...

    if (options.onClick && options.events) {
        options.events.on(button, 'click', () => options.onClick!(button));
    }

    return button;
}

function createSlider(world: World, options: SliderOptions = {}): Entity {
    // ... create entities ...

    if (options.onChange && options.events) {
        options.events.on(slider, 'change', () => {
            const s = world.get(slider, Slider) as SliderData;
            options.onChange!(s.value, slider);
        });
    }

    return slider;
}
```

### 7.3 Event Lifecycle

`UIEventQueue` 在 `drain()` 中使用 `entityValidator_` 清理已销毁实体的 handler。`UIInteractionPlugin` 在初始化时通过 `setEntityValidator(e => world.valid(e))` 设置校验器。因此 Factory 注册的回调会在实体被 despawn 后自动清理，无需手动取消订阅。

如果需要提前取消，`events.on()` 返回 `Unsubscribe` 函数：

```typescript
const unsub = events.on(btn, 'click', handler);
// later:
unsub();
```

### 7.4 Usage

```typescript
const events = app.getResource(UIEvents) as UIEventQueue;

UI.slider(world, {
    value: 0.7,
    events,
    onChange: (value) => audio.setVolume(value),
});

UI.button(world, {
    text: 'Start Game',
    events,
    onClick: () => sceneManager.load('gameplay'),
});

UI.toggle(world, {
    label: 'Fullscreen',
    isOn: isFullscreen,
    events,
    onChange: (on) => setFullscreen(on),
});
```

等价于不使用回调的写法：
```typescript
const slider = UI.slider(world, { value: 0.7 });
events.on(slider, 'change', () => {
    const s = world.get(slider, Slider) as SliderData;
    audio.setVolume(s.value);
});
```

---

## 8. Implementation Plan

### Phase 1: Internal Helpers (Layer 1)
- **Scope**: `sdk/src/ui/uiHelpers.ts` + refactor 14 plugins
- **Files changed**: ~18
- **Risk**: Low (internal refactor, no API change)
- **Deliverable**: `withChildEntity`, `setEntityColor`, `colorScale`, `EntityStateMap`

### Phase 2: spawnUI + Widget Factories (Layer 2)
- **Scope**: New file `sdk/src/ui/UIBuilder.ts` + exports
- **Files changed**: 1 new + 2 modified (exports from `ui/index.ts` and `sdk/index.ts`)
- **Risk**: Low (additive, no breaking changes)
- **Deliverable**: `UI.spawn`, `UI.destroy`, `UI.button`, `UI.slider`, `UI.toggle`, `UI.scrollView`, `UI.textInput`, `UI.dropdown`, `UI.progressBar`, `UI.label`, `UI.panel`, `UI.flexRow`, `UI.flexColumn`
- **Prerequisite**: 确认 `world.getChildren()` 可用性，用于 `UI.destroy` 的递归销毁

### Phase 3: Declarative Tree Builder (Layer 3)
- **Scope**: Extend `sdk/src/ui/UIBuilder.ts`
- **Files changed**: 1 modified
- **Risk**: Low (additive)
- **Deliverable**: `UI.build(world, tree)`

### Phase 4: Theme System (Layer 4)
- **Scope**: New file `sdk/src/ui/UITheme.ts` + modify UIBuilder
- **Files changed**: 1 new + 1 modified
- **Risk**: Medium (factories 的默认值来源从硬编码变为 theme lookup)
- **Deliverable**: `UIThemeRes` resource, `DARK_THEME`, `initUIBuilder(app)` theme 注入

### Phase 5: Event Callbacks (Layer 5)
- **Scope**: Extend factory Options types
- **Files changed**: 1 modified (UIBuilder.ts)
- **Risk**: Low (additive)
- **Deliverable**: `onClick`, `onChange`, `onSubmit` + `events` 字段

### Phase 6: Editor Integration
- **Scope**: Editor 的 "Create UI" 菜单使用 Factory 函数
- **Files changed**: Editor layer (`editor/src/panels/hierarchy/`, `editor/src/store/SceneOperations.ts`)
- **Risk**: Medium (editor-runtime 一致性)
- **Deliverable**: 编辑器中可一键创建完整的复合 UI 控件，结果以 EntityData 保存到 Scene

---

## 9. Out of Scope (Future Consideration)

以下特性不在本次设计范围内，但记录为后续方向：

| Feature | Why Deferred | Priority |
|---------|-------------|----------|
| Data binding / Reactivity | 需要更深入的 ECS 变更追踪机制 | P2 |
| Rich text (多样式文本) | 需要重写 TextRenderer | P2 |
| CSS-like style sheets | 复杂度高，theme 系统已覆盖 80% 需求 | P3 |
| Animation / Transition | 需要 tween 系统 | P2 |
| Grid layout | C++ 层需要新增 layout system | P2 |
| Tooltip / Popover | 需要解决 z-order 和定位问题 | P2 |
| Modal / Dialog | 需要 overlay 层管理 | P2 |
| Tabs / Tree / Table | 可用 Phase 2 的 Factory 组合实现 | P1 (Phase 2 之后) |
| Touch gestures (pinch/swipe) | 需要扩展输入系统 | P3 |
| Accessibility (screen reader) | Web 平台可用 ARIA | P3 |

---

## 10. Design Decisions & Rationale

### Q: 为什么选 Factory 函数而不是 Prefab？

Prefab 是编辑器概念，运行时 API 应该是代码级别的。Factory 函数：
- 有 TypeScript 类型检查
- 支持运行时条件逻辑（if/map/filter）
- 可以接受回调参数
- 不需要文件 I/O

Prefab 和 Factory 并不冲突：编辑器可以将 UI 保存为 Prefab，运行时可以用 Factory 创建。Factory 产出的实体结构与 Prefab/Scene 序列化完全兼容。

### Q: 为什么不用 Immediate Mode (ImGui 风格)？

ImGui 适合开发工具，不适合游戏 UI：
- 每帧重建 UI 有 CPU 开销
- 难以做动画和过渡效果
- 样式定制能力弱
- 与 ECS 的 retained mode 理念冲突

我们的编辑器本身已经用了 retained mode DOM，保持一致。

### Q: 为什么声明式 tree 用数据结构而不是 JSX/模板字符串？

- 不需要编译器/转译器
- TypeScript 原生类型推断（discriminated union 提供完整类型检查）
- 可以直接用 `.map()` 生成动态列表
- 可以存储为 JSON 在运行时加载

### Q: Theme 为什么是 Resource 而不是全局变量？

- ECS 惯例：全局状态通过 Resource 管理
- 支持多 App 实例不同 Theme（编辑器 vs 游戏预览）
- 可以在运行时切换 Theme（暗色/亮色模式）
- 与现有的 Resource 读取模式一致

### Q: 事件回调是否违背了 ECS "数据驱动"原则？

回调只是 UIEventQueue 的语法糖，底层仍然是 ECS 事件系统。用户仍然可以选择：
- **方式 A（回调）**：`UI.button(world, { events, onClick: () => ... })`
- **方式 B（System）**：在自定义 System 中查询 Button + UIInteraction 组件
- **方式 C（Events）**：`events.on(entity, 'click', handler)`

三种方式并存，用户按场景选择。

### Q: 为什么 scrollView 返回 Entity 而不是 { root, content }？

所有 Factory 统一返回单个 Entity（根实体），保持 API 一致性。需要访问子结构时通过组件数据获取：

```typescript
const sv = world.get(scrollView, ScrollView) as ScrollViewData;
const content = sv.contentEntity;  // 添加 children 到这里
```

这也符合 ECS 的设计理念——实体关系存储在组件数据中，而非 API 返回值中。

### Q: Factory 能在 System 内调用吗？

不能直接调用。`world.spawn()` 在 System query 迭代期间会抛异常。Factory 应该在以下场景使用：
- Startup 系统
- System 外部（App 初始化、场景回调）
- 未来可通过 `Commands` 封装延迟 Factory 调用
