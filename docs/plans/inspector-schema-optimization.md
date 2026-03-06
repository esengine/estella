# Inspector Schema 优化方案

## 0. 架构设计模式

本章从设计模式和架构框架层面，系统性地提出改进方向。

### 0.1 当前架构分析

```
┌─────────────────────────────────────────────────────────┐
│ EditorPlugin.register(ctx)                              │
│   ctx.registrar.provide(COMPONENT_SCHEMA, name, schema) │
│   ctx.registrar.provide(PROPERTY_EDITOR, type, factory) │
│   ctx.registrar.provide(COMPONENT_INSPECTOR, name, desc)│
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌──────────────────────────────────────┐
│ EditorContainer (Service Locator/DI) │
│   COMPONENT_SCHEMA   → Map<name, ComponentSchema>       │
│   PROPERTY_EDITOR    → Map<type, EditorFactory>         │
│   COMPONENT_INSPECTOR→ Map<name, CustomInspector>       │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌──────────────────────────────────────┐
│ EntityInspector (Render Pipeline)    │
│   1. getComponentSchema(type)        │
│   2. if customInspector → delegate   │
│   3. else → forEach property:        │
│      a. hiddenWhen check             │
│      b. group sorting                │
│      c. createPropertyEditor(meta)   │
│         → lookup factory by type     │
│         → factory(container, ctx)    │
│   4. onChange → Command → World      │
└──────────────────────────────────────┘
```

**当前模式**：Plugin Registration → Service Locator → Type-Indexed Factory → Command Pattern

**核心问题**：这个管线是**线性单层**的——schema 是扁平属性列表，渲染是逐属性遍历，没有中间的规则引擎层。所有的条件逻辑（hiddenWhen、dependsOn）硬编码在渲染管线中而非 schema 声明中。

### 0.2 目标架构：声明式 Schema 驱动

引入 **Schema → Rules → Render** 三层架构：

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1: Schema Declaration (数据层)                      │
│   ComponentSchema + PropertyMeta                         │
│   - 属性定义、类型、约束、分组                               │
│   - 组件级元数据（description, icon, composition rules）    │
│   - 纯数据，无逻辑                                        │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 2: Rules Engine (规则层)                             │
│   VisibilityResolver   - 属性条件显隐                      │
│   ConstraintValidator  - 值约束校验                        │
│   DependencyResolver   - 属性间依赖                        │
│   CompositionChecker   - 组件间兼容性                      │
│   纯函数，schema + entity state → 渲染指令                  │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 3: Render Pipeline (渲染层)                          │
│   PropertyEditorFactory - 按类型分发编辑器                  │
│   InspectorLayout      - 分组、折叠、排序                   │
│   HybridInspector      - schema 段 + 自定义段可混合         │
│   只关心 UI，不做业务判断                                    │
└──────────────────────────────────────────────────────────┘
```

### 0.3 设计模式一：Schema Composition（组合式 Schema）

**问题**：6 个 Collider 组件重复定义 density/friction/restitution 等字段，无复用机制。

**模式**：Property Mixins — 可组合的属性片段。

```typescript
// 定义可复用属性片段
const ColliderMaterial = definePropertyGroup('Material', [
    { name: 'density', type: 'number', min: 0, step: 0.1 },
    { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
    { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
    { name: 'isSensor', type: 'boolean', tooltip: 'Detects overlaps without collision' },
]);

const ColliderFiltering = definePropertyGroup('Filtering', [
    { name: 'categoryBits', type: 'collision-layer' },
]);

// 组合使用
const BoxColliderSchema = defineSchema('BoxCollider', {
    category: 'physics',
    properties: [
        { name: 'halfExtents', type: 'vec2' },
        { name: 'offset', type: 'vec2' },
        ...ColliderMaterial,
        ...ColliderFiltering,
    ],
});
```

**实现**：`definePropertyGroup` 只是返回带 `group` 的 `PropertyMeta[]`，零运行时开销。

### 0.4 设计模式二：Visibility Rules Engine（可见性规则引擎）

**问题**：`hiddenWhen` 只支持 `{ hasComponent }` 一种条件，Camera/Image/AudioSource 等需要基于字段值的条件显隐。`dependsOn` 在 spine editor 中硬编码处理。

**模式**：声明式 Predicate 系统，将条件逻辑从渲染层提升到 schema 数据层。

```typescript
// 1. 基于字段值（最常见）
{ name: 'fov', visibleWhen: { field: 'projectionType', equals: 0 } }

// 2. 基于组件存在
{ name: 'size', hiddenWhen: { hasComponent: 'UIRect' } }

// 3. 复合条件（AND）
{ name: 'rolloff', visibleWhen: [
    { field: 'spatial', equals: true },
    { field: 'attenuationModel', notEquals: 0 },
] }

// 4. 自定义谓词（逃生通道，用于无法声明化的复杂逻辑）
{ name: 'advanced', visibleWhen: (data, entity, world) => data.mode === 'expert' }
```

**VisibilityResolver 实现**：

```typescript
class VisibilityResolver {
    isVisible(meta: PropertyMeta, componentData: Record<string, unknown>,
              entityComponents: string[]): boolean {
        // 1. hiddenWhen 检查
        if (meta.hiddenWhen?.hasComponent &&
            entityComponents.includes(meta.hiddenWhen.hasComponent)) return false;

        // 2. visibleWhen 检查
        const vw = meta.visibleWhen;
        if (!vw) return true;
        if (typeof vw === 'function') return vw(componentData);
        if (Array.isArray(vw)) return vw.every(rule => this.evalRule(rule, componentData));
        return this.evalRule(vw, componentData);
    }

    private evalRule(rule: VisibilityRule, data: Record<string, unknown>): boolean {
        const val = data[rule.field];
        if ('equals' in rule) return val === rule.equals;
        if ('notEquals' in rule) return val !== rule.notEquals;
        if ('oneOf' in rule) return rule.oneOf!.includes(val);
        return true;
    }
}
```

**优势**：EntityInspector 渲染循环只调 `resolver.isVisible(meta, data, siblings)`，不再内联条件判断。新增条件类型只改 Resolver，不改渲染层。

### 0.5 设计模式三：Constraint Descriptors（约束描述符）

**问题**：当前约束是松散的 `min/max/step` 字段，无法表达"正整数"、"百分比"、"像素值"等语义约束。validation.ts 中的校验与 schema 定义分离。

**模式**：Constraint 作为一等公民嵌入 PropertyMeta，validation 从 Constraint 自动派生。

```typescript
// 预定义约束模板
const Constraints = {
    percentage:  { min: 0, max: 1, step: 0.01 },
    positiveInt: { min: 0, step: 1 },
    angle:       { min: -360, max: 360, step: 1 },
    fontSize:    { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1 },
    layer:       { min: LAYER_MIN, max: LAYER_MAX, step: 1 },
    opacity:     { min: 0, max: 1, step: 0.05 },
    normalizedVec: { min: 0, max: 1 },
} as const;

// 使用
{ name: 'value', type: 'number', ...Constraints.percentage }
{ name: 'fontSize', type: 'number', ...Constraints.fontSize }
{ name: 'fillAmount', type: 'number', ...Constraints.percentage, displayName: 'Fill Amount' }
```

**优势**：约束语义化、集中管理、可复用、自文档化。

### 0.6 设计模式四：Component Composition Rules（组件组合规则）

**问题**：当前 AddComponentPopup 不知道哪些组件可以共存、哪些互斥、哪些有依赖。用户可以在同一 entity 上添加多个互斥的 layout 组件或遗漏必要依赖。

**模式**：在 ComponentSchema 中声明组件间关系。

```typescript
interface ComponentSchema {
    // ...existing
    requires?: string[];        // 自动添加依赖组件
    conflicts?: string[];       // 互斥组件（阻止添加）
    description?: string;       // AddComponentPopup 中的说明文字
    icon?: string;              // 组件图标（可选）
}

// 示例
const FlexContainerSchema: ComponentSchema = {
    name: 'FlexContainer',
    category: 'ui',
    requires: ['UIRect'],
    conflicts: ['LayoutGroup'],   // 两种布局互斥
    description: 'CSS-like flexbox layout for child elements',
    properties: [...],
};

const ScrollViewSchema: ComponentSchema = {
    name: 'ScrollView',
    category: 'ui',
    requires: ['UIRect', 'UIMask'],
    description: 'Scrollable container with inertia and elastic bounce',
    properties: [...],
};
```

**CompositionChecker 实现**：

```typescript
class CompositionChecker {
    canAdd(componentName: string, existingComponents: string[]): {
        allowed: boolean;
        reason?: string;
        autoAdd?: string[];     // 需要自动添加的依赖
    } {
        const schema = getComponentSchema(componentName);
        if (!schema) return { allowed: true };

        // 互斥检查
        for (const conflict of schema.conflicts ?? []) {
            if (existingComponents.includes(conflict)) {
                return { allowed: false, reason: `Conflicts with ${conflict}` };
            }
        }

        // 依赖收集
        const autoAdd = (schema.requires ?? [])
            .filter(dep => !existingComponents.includes(dep));

        return { allowed: true, autoAdd };
    }
}
```

### 0.7 设计模式五：Hybrid Inspector（混合式 Inspector）

**问题**：当前自定义 Inspector 是 all-or-nothing，PostProcessVolume 完全绕过 schema。无法让一个组件部分属性用 schema 渲染、部分用自定义 UI。

**模式**：Inspector Section 切片 — 一个组件的 Inspector 可以由多个 section 组成，每个 section 独立声明。

```typescript
interface ComponentSchema {
    // ...existing
    sections?: InspectorSection[];   // 自定义 UI 段落，可与 properties 混合
}

interface InspectorSection {
    id: string;
    title?: string;
    order?: number;              // 控制在 properties 列表中的位置
    insertAfterGroup?: string;   // 插入到某个 group 之后
    render: (container: HTMLElement, ctx: SectionContext) => SectionInstance;
}

// 示例：ParticleEmitter 的曲线编辑器
const ParticleEmitterSchema: ComponentSchema = {
    name: 'ParticleEmitter',
    properties: [...standardProps],
    sections: [
        {
            id: 'size-curve',
            title: 'Size Over Lifetime',
            insertAfterGroup: 'Size',
            render: (container, ctx) => createCurveEditor(container, ctx, 'sizeOverLifetime'),
        },
    ],
};
```

**渲染流程改进**：

```
EntityInspector:
  1. 渲染 ungrouped properties
  2. for each group:
     a. 渲染 group header
     b. 渲染 group 内 properties
     c. 渲染 insertAfterGroup === groupName 的 sections
  3. 渲染剩余 sections
```

### 0.8 设计模式六：Schema Registry + Validation（注册时校验）

**问题**：Schema 定义中的 typo（字段名不匹配组件默认值、type 不匹配注册的 editor）完全静默失败，排查困难。

**模式**：注册时校验 + 开发模式警告。

```typescript
function registerComponentSchema(schema: ComponentSchema): void {
    if (__DEV__) {
        const defaults = getDefaultComponentData(schema.name);
        if (defaults) {
            for (const prop of schema.properties) {
                if (prop.name === '*') continue;
                if (!(prop.name in defaults)) {
                    console.warn(`[Schema] ${schema.name}.${prop.name}: field not found in defaults`);
                }
                if (!getPropertyEditorFactory(prop.type)) {
                    console.warn(`[Schema] ${schema.name}.${prop.name}: unknown editor type '${prop.type}'`);
                }
            }
        }
    }
    container.provide(COMPONENT_SCHEMA, schema.name, schema);
}
```

### 0.9 设计模式七：Schema-Derived Serialization Guard（Schema 驱动的序列化守卫）

**问题**：场景反序列化时不经过 schema 校验。损坏的场景文件中无效的属性值会静默进入 ECS world。Asset 字段元数据在 SDK（`COMPONENT_ASSET_FIELDS`）和 C++ 两处定义，没有 single source of truth。

**模式**：序列化/反序列化时用 schema 做 guard。

```typescript
function validateComponentData(
    typeName: string,
    data: Record<string, unknown>,
): { valid: boolean; warnings: string[]; sanitized: Record<string, unknown> } {
    const schema = getComponentSchema(typeName);
    if (!schema) return { valid: true, warnings: [], sanitized: data };

    const warnings: string[] = [];
    const sanitized = { ...data };

    for (const prop of schema.properties) {
        if (prop.name === '*') continue;
        const val = sanitized[prop.name];

        // 类型校验
        if (val !== undefined && !isTypeCompatible(val, prop.type)) {
            warnings.push(`${typeName}.${prop.name}: type mismatch`);
            delete sanitized[prop.name];  // 回退到默认值
        }

        // 范围约束
        if (typeof val === 'number') {
            if (prop.min !== undefined && val < prop.min) sanitized[prop.name] = prop.min;
            if (prop.max !== undefined && val > prop.max) sanitized[prop.name] = prop.max;
        }
    }

    return { valid: warnings.length === 0, warnings, sanitized };
}
```

### 0.10 架构模式总结

| # | 模式 | 解决的问题 | 影响范围 |
|---|---|---|---|
| 1 | **Schema Composition** | Collider 等重复字段 | schema 定义文件 |
| 2 | **Visibility Rules Engine** | hiddenWhen 只支持 hasComponent | PropertyMeta + EntityInspector |
| 3 | **Constraint Descriptors** | min/max/step 分散无语义 | PropertyMeta + validation.ts |
| 4 | **Composition Rules** | 组件间无依赖/互斥声明 | ComponentSchema + AddComponentPopup |
| 5 | **Hybrid Inspector** | 自定义 Inspector all-or-nothing | ComponentSchema + EntityInspector |
| 6 | **Schema Validation** | 注册时 typo 静默失败 | registerComponentSchema |
| 7 | **Serialization Guard** | 反序列化无校验 | SceneSerializer |

**实施优先级**：
- **Phase 0（基础设施）**：模式 2 (Visibility) + 模式 3 (Constraints) + 模式 6 (Validation) — 改 PropertyMeta 接口和 EntityInspector 渲染循环
- **Phase 1（Schema 重写）**：模式 1 (Composition) — 重写各 plugin 的 schema 定义
- **Phase 2（组件智能）**：模式 4 (Composition Rules) — AddComponentPopup 集成
- **Phase 3（高级功能）**：模式 5 (Hybrid Inspector) + 模式 7 (Serialization Guard)

---

## 1. 现状分析

### 1.1 架构概览

```
ComponentSchema { name, category, properties[], removable?, hidden?, displayName?, editorDefaults? }
    |
PropertyMeta { name, type, group?, min?, max?, step?, options?, hiddenWhen?, dependsOn? }
    |
PropertyEditor (按 type 分发: number, string, boolean, vec2, vec3, color, enum, entity, texture, ...)
```

Schema 分布在 7 个 editor plugin 文件中，通过 `EditorContainer` DI 注册。

### 1.2 当前数据流

```
PropertyEditor onChange(newValue)
  → EntityInspector.renderPropertyRow → store.updateProperty()
    → SceneOperations → PropertyCommand (merge window: 1000ms)
      → CommandHistory.execute()
        → setPropertyValue() → ECS world
          → PropertyWritePipeline.handlePropertyNotification()
            ├─ transformHooks (Transform↔UIRect, Button color, etc.)
            └─ syncHooks (sync to preview runtime)
              → Inspector re-render via subscriptions
```

### 1.3 现有扩展机制

| 扩展点 | Token | 用途 |
|---|---|---|
| 组件 Schema | `COMPONENT_SCHEMA` | 声明组件属性列表 |
| 属性编辑器 | `PROPERTY_EDITOR` | 按 type 注册编辑器工厂 |
| 自定义 Inspector | `COMPONENT_INSPECTOR` | 完全替换某组件的 Inspector |
| Inspector Section | `INSPECTOR_SECTION` | entity/asset 级别的额外面板 |
| Property Hook | `registerTransformHook/SyncHook` | 属性变更时的副作用处理 |

### 1.2 当前组件清单

| Plugin 文件 | 组件 | 数量 |
|---|---|---|
| `coreComponents.ts` | Name, Parent, Children, Transform, Velocity, SceneOwner, Canvas, Camera | 8 |
| `sprite.ts` | Sprite | 1 |
| `text.ts` | Text, BitmapText | 2 |
| `ui.ts` | UIRect, UIMask, Interactable, UIInteraction, Button, TextInput, Image, Toggle, ToggleGroup, ProgressBar, Draggable, ScrollView, Slider, Focusable, SafeArea, ListView, Dropdown, FlexContainer, FlexItem, LayoutGroup | 20 |
| `physics.ts` | RigidBody, BoxCollider, CircleCollider, CapsuleCollider, SegmentCollider, PolygonCollider, ChainCollider, RevoluteJoint | 8 |
| `spine.ts` | SpineAnimation | 1 |
| `animation.ts` | SpriteAnimator | 1 |
| `particle.ts` | ParticleEmitter | 1 |
| `audio.ts` | AudioSource, AudioListener | 2 |
| `tilemap.ts` | Tilemap, TilemapLayer | 2 |
| `shapeRenderer.ts` | ShapeRenderer | 1 |
| `postProcess.ts` | PostProcessVolume | 1 |
| **总计** | | **48** |

### 1.3 PropertyMeta 能力

当前 `PropertyMeta` 接口：

```typescript
interface PropertyMeta {
    name: string;          // 字段名，'*' 表示自定义全组件编辑器
    type: string;          // 编辑器类型
    group?: string;        // 分组名（折叠组）
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: unknown }[];
    fileFilter?: string[];
    dependsOn?: string;    // 仅用于 spine skin/animation 依赖 skeletonPath
    hiddenWhen?: { hasComponent: string };  // 仅支持 "存在某组件时隐藏"
}
```

---

## 2. 问题清单

### P0 - 架构缺陷

#### 2.1 缺少基于字段值的条件显示

**现状**：`hiddenWhen` 仅支持 `{ hasComponent: string }`，无法根据同组件内字段值动态隐藏。

**影响组件**：
- **Camera**: `fov` 仅 Perspective 有效，`orthoSize` 仅 Orthographic 有效，两者同时显示
- **Image**: `fillMethod`/`fillOrigin`/`fillAmount` 仅当 `imageType=Filled` 有意义；`tileSize` 仅当 `imageType=Tiled` 有意义
- **AudioSource**: `minDistance`/`maxDistance`/`attenuationModel`/`rolloff` 仅当 `spatial=true` 有意义
- **ParticleEmitter**: `shapeRadius` 仅 Circle/Cone 有意义，`shapeSize` 仅 Rectangle 有意义，`shapeAngle` 仅 Cone 有意义

**方案**：扩展 `hiddenWhen`

```typescript
hiddenWhen?: {
    hasComponent?: string;
    field?: string;        // 同组件内的字段名
    equals?: unknown;      // 等于某值时隐藏
    notEquals?: unknown;   // 不等于某值时隐藏
    oneOf?: unknown[];     // 在某些值中时隐藏
    notOneOf?: unknown[];  // 不在某些值中时隐藏
};
// 或改用 visibleWhen 语义更直观
visibleWhen?: {
    field: string;
    equals?: unknown;
    oneOf?: unknown[];
};
```

#### 2.2 复合组件属性未分组

**现状**：大部分 UI 组件的属性平铺显示，无 `group` 分组。

**参考**：`ParticleEmitter` 已有良好分组（Emission, Lifetime, Shape, Velocity, Size, Color, Rotation, Forces, Texture, Rendering），是正确模式。

**需要分组的组件**：

| 组件 | 建议分组 |
|---|---|
| Camera | General(isActive, priority), Projection(projectionType, fov, orthoSize, nearPlane, farPlane), Viewport(viewportX/Y/W/H, clearFlags), Debug(showFrustum) |
| Slider | Value(value, minValue, maxValue, direction, wholeNumbers), Entities(fillEntity, handleEntity) |
| ScrollView | Scroll(horizontalEnabled, verticalEnabled, contentWidth, contentHeight), Physics(inertia, decelerationRate, elastic, wheelSensitivity), Entity(contentEntity) |
| TextInput | Content(value, placeholder), Appearance(fontFamily, fontSize, color, backgroundColor, placeholderColor, padding), Behavior(maxLength, multiline, password, readOnly) |
| SpineAnimation | Asset(skeletonPath, atlasPath, material, skin, animation), Playback(timeScale, loop, playing), Appearance(flipX, flipY, color, layer, skeletonScale) |
| AudioSource | Clip(clip, bus), Playback(volume, pitch, loop, playOnAwake, priority, enabled), Spatial(spatial, minDistance, maxDistance, attenuationModel, rolloff) |

#### 2.3 内部 Entity 引用暴露给用户

**现状**：以下字段是组件内部的子 entity 引用，不应直接暴露给普通用户编辑（误操作会导致 widget 断裂）：

| 组件 | 内部字段 |
|---|---|
| Slider | `fillEntity`, `handleEntity` |
| ProgressBar | `fillEntity` |
| ScrollView | `contentEntity` |
| Toggle | `graphicEntity` |
| Dropdown | `listEntity`, `labelEntity` |

**方案**：新增 `advanced?: boolean` 标记，默认折叠在"Advanced"分组内，或标记为 `readOnly`。

```typescript
{ name: 'fillEntity', type: 'entity', group: 'References', advanced: true, readOnly: true }
```

### P1 - 缺失功能

#### 2.4 缺少 displayName

大部分属性使用原始字段名显示。建议关键字段添加 `displayName`：

| 组件 | 字段 | 当前显示 | 建议 displayName |
|---|---|---|---|
| Toggle | `isOn` | isOn | Is On |
| ScrollView | `contentEntity` | contentEntity | Content |
| ScrollView | `horizontalEnabled` | horizontalEnabled | Horizontal |
| ScrollView | `verticalEnabled` | verticalEnabled | Vertical |
| ScrollView | `decelerationRate` | decelerationRate | Deceleration |
| ScrollView | `wheelSensitivity` | wheelSensitivity | Wheel Speed |
| Slider | `wholeNumbers` | wholeNumbers | Whole Numbers |
| Slider | `minValue` | minValue | Min |
| Slider | `maxValue` | maxValue | Max |
| Draggable | `dragThreshold` | dragThreshold | Threshold |
| ProgressBar | `fillEntity` | fillEntity | Fill |
| Camera | `orthoSize` | orthoSize | Size |
| Camera | `nearPlane` | nearPlane | Near |
| Camera | `farPlane` | farPlane | Far |

**方案**：`PropertyMeta` 添加 `displayName?: string`

```typescript
interface PropertyMeta {
    // ...existing
    displayName?: string;  // Inspector 中显示的标签名，默认用 name
}
```

#### 2.5 Button `state` 不该手动编辑

`Button.state` 是运行时计算值（Normal/Hovered/Pressed/Disabled），不应出现在 Inspector 中。

**方案**：从 ButtonSchema 的 properties 中移除 `state`，或标为 `hidden: true`（属性级别）。

#### 2.6 Toggle 缺少颜色字段

`Toggle` 组件有 `onColor`/`offColor` 字段但 schema 未暴露。用户无法在 Inspector 中修改切换颜色。

**方案**：在 ToggleSchema 中添加：
```typescript
{ name: 'onColor', type: 'color', group: 'Appearance' },
{ name: 'offColor', type: 'color', group: 'Appearance' },
```

#### 2.7 缺少 readOnly 标记

某些字段是运行时状态，展示有用但不应编辑：
- `Button.state` — 运行时交互状态
- `ScrollView.scrollX/scrollY` — 当前滚动位置
- `Dropdown.isOpen` — 当前打开状态

**方案**：`PropertyMeta` 添加 `readOnly?: boolean`

#### 2.8 缺少 tooltip

`PropertyMeta` 没有 `tooltip` 字段。复杂属性（如 `decelerationRate`, `elastic`, `wheelSensitivity`, `bullet`, `isSensor`）无说明文字。

**方案**：
```typescript
interface PropertyMeta {
    // ...existing
    tooltip?: string;
}
```

### P2 - 体验优化

#### 2.9 Collider 共享字段重复定义

Box/Circle/Capsule/Segment/Polygon/Chain Collider 共享以下字段：
- `density`, `friction`, `restitution`, `isSensor`, `categoryBits`

当前每个 schema 独立定义这些字段。

**方案**：抽取 `COLLIDER_COMMON_PROPS`：

```typescript
const COLLIDER_COMMON_PROPS: PropertyMeta[] = [
    { name: 'density', type: 'number', min: 0, step: 0.1, group: 'Material' },
    { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01, group: 'Material' },
    { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01, group: 'Material' },
    { name: 'isSensor', type: 'boolean', group: 'Material' },
    { name: 'categoryBits', type: 'collision-layer', group: 'Filtering' },
];
```

#### 2.10 schemaConstants 不完整

当前 `schemaConstants.ts` 仅有 7 个常量。分散在各 schema 中的 magic number 如 `max: 179`(fov), `max: 512`(tileSize), `max: 8`(polygon vertices) 应统一收录。

---

## 3. 接口扩展

### 3.1 PropertyMeta 完整定义

```typescript
// === 条件可见性规则 ===
interface VisibilityRule {
    field: string;
    equals?: unknown;
    notEquals?: unknown;
    oneOf?: unknown[];
}

type VisibilityPredicate = VisibilityRule | VisibilityRule[] | ((data: Record<string, unknown>) => boolean);

interface PropertyMeta {
    // === 已有 ===
    name: string;
    type: string;
    group?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: unknown }[];
    fileFilter?: string[];
    dependsOn?: string;
    hiddenWhen?: { hasComponent?: string };

    // === 新增 ===
    displayName?: string;               // Inspector 显示名（默认用 name）
    tooltip?: string;                   // 悬停提示文字
    readOnly?: boolean;                 // 只读展示
    advanced?: boolean;                 // 折叠到 Advanced 组
    visibleWhen?: VisibilityPredicate;  // 声明式条件显隐
}
```

### 3.2 ComponentSchema 完整定义

```typescript
interface InspectorSection {
    id: string;
    title?: string;
    order?: number;
    insertAfterGroup?: string;
    render: (container: HTMLElement, ctx: SectionContext) => SectionInstance;
}

interface ComponentSchema {
    // === 已有 ===
    name: string;
    category: 'builtin' | 'ui' | 'physics' | 'script' | 'tag';
    properties: PropertyMeta[];
    removable?: boolean;
    hidden?: boolean;
    displayName?: string;
    editorDefaults?: () => Record<string, unknown> | null;

    // === 新增 ===
    description?: string;           // 组件说明（AddComponentPopup 中显示）
    icon?: string;                  // 组件图标标识
    requires?: string[];            // 依赖组件（自动添加）
    conflicts?: string[];           // 互斥组件（阻止添加）
    sections?: InspectorSection[];  // 混合式 Inspector 自定义段
}
```

### 3.3 预设约束（Constraint Descriptors）

```typescript
// schemaConstants.ts
export const Constraints = {
    percentage:   { min: 0, max: 1, step: 0.01 },
    positiveInt:  { min: 0, step: 1 },
    angle:        { min: -360, max: 360, step: 1 },
    fontSize:     { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1 },
    layer:        { min: LAYER_MIN, max: LAYER_MAX, step: 1 },
    opacity:      { min: 0, max: 1, step: 0.05 },
    physDensity:  { min: 0, step: 0.1 },
    physFriction: { min: 0, max: 1, step: 0.01 },
    physBounce:   { min: 0, max: 1, step: 0.01 },
} as const;
```

### 3.4 可复用属性片段（Schema Composition）

```typescript
// 定义
function definePropertyGroup(group: string, props: PropertyMeta[]): PropertyMeta[] {
    return props.map(p => ({ ...p, group }));
}

// physics.ts 中使用
const ColliderMaterial = definePropertyGroup('Material', [
    { name: 'density', type: 'number', ...Constraints.physDensity },
    { name: 'friction', type: 'number', ...Constraints.physFriction },
    { name: 'restitution', type: 'number', ...Constraints.physBounce, displayName: 'Bounciness' },
    { name: 'isSensor', type: 'boolean', displayName: 'Is Sensor',
      tooltip: 'Detects overlaps without physical collision' },
]);
```

---

## 4. 逐组件优化方案

### 4.1 Core

#### Transform
当前：良好，已有 euler 类型。无需改动。

#### Camera
```typescript
properties: [
    { name: 'isActive', type: 'boolean' },
    { name: 'priority', type: 'number', step: 1 },
    { name: 'projectionType', type: 'enum', displayName: 'Projection', options: [...] },
    { name: 'fov', type: 'number', min: 1, max: 179, displayName: 'Field of View',
      visibleWhen: { field: 'projectionType', equals: 0 } },
    { name: 'orthoSize', type: 'number', min: 0.1, displayName: 'Size',
      visibleWhen: { field: 'projectionType', equals: 1 } },
    { name: 'nearPlane', type: 'number', step: 0.1, displayName: 'Near', group: 'Clipping' },
    { name: 'farPlane', type: 'number', step: 1, displayName: 'Far', group: 'Clipping' },
    { name: 'viewportX', ..., group: 'Viewport' },
    { name: 'viewportY', ..., group: 'Viewport' },
    { name: 'viewportW', ..., group: 'Viewport' },
    { name: 'viewportH', ..., group: 'Viewport' },
    { name: 'clearFlags', ..., group: 'Viewport' },
    { name: 'showFrustum', type: 'boolean', group: 'Debug' },
]
```

#### Canvas
当前：良好。无需改动。

### 4.2 Rendering

#### Sprite
当前：良好。`hiddenWhen: { hasComponent: 'UIRect' }` 已处理。无需改动。

#### ShapeRenderer
当前：可接受。`cornerRadius` 可加 `visibleWhen: { field: 'shapeType', equals: 2 }`（仅 RoundedRect）。

#### Image
```typescript
properties: [
    { name: 'texture', type: 'texture' },
    { name: 'material', type: 'material-file' },
    { name: 'color', type: 'color' },
    { name: 'imageType', type: 'enum', displayName: 'Type', options: [...] },
    { name: 'preserveAspect', type: 'boolean', displayName: 'Preserve Aspect' },
    { name: 'layer', type: 'number', min: -1000, max: 1000 },
    // Filled 专属
    { name: 'fillMethod', type: 'enum', displayName: 'Fill Method', group: 'Fill',
      visibleWhen: { field: 'imageType', equals: 3 } },
    { name: 'fillOrigin', type: 'enum', displayName: 'Fill Origin', group: 'Fill',
      visibleWhen: { field: 'imageType', equals: 3 } },
    { name: 'fillAmount', type: 'number', min: 0, max: 1, step: 0.01, displayName: 'Fill Amount', group: 'Fill',
      visibleWhen: { field: 'imageType', equals: 3 } },
    // Tiled 专属
    { name: 'tileSize', type: 'vec2', displayName: 'Tile Size', group: 'Tiling',
      visibleWhen: { field: 'imageType', equals: 2 } },
]
```

### 4.3 UI Widgets

#### Button
```typescript
properties: [
    // state 移除 — 运行时状态，不应手动编辑
    { name: 'transition', type: 'button-transition' },
]
```

#### Toggle
```typescript
properties: [
    { name: 'isOn', type: 'boolean', displayName: 'Is On' },
    { name: 'onColor', type: 'color', displayName: 'On Color', group: 'Appearance' },
    { name: 'offColor', type: 'color', displayName: 'Off Color', group: 'Appearance' },
    { name: 'transition', type: 'button-transition', group: 'Appearance' },
    { name: 'graphicEntity', type: 'entity', displayName: 'Graphic', group: 'References', advanced: true },
    { name: 'group', type: 'entity', displayName: 'Toggle Group', group: 'References', advanced: true },
]
```

#### Slider
```typescript
properties: [
    { name: 'value', type: 'number', step: 0.01 },
    { name: 'minValue', type: 'number', step: 0.01, displayName: 'Min' },
    { name: 'maxValue', type: 'number', step: 0.01, displayName: 'Max' },
    { name: 'direction', type: 'enum', options: [...] },
    { name: 'wholeNumbers', type: 'boolean', displayName: 'Whole Numbers' },
    { name: 'fillEntity', type: 'entity', displayName: 'Fill', group: 'References', advanced: true },
    { name: 'handleEntity', type: 'entity', displayName: 'Handle', group: 'References', advanced: true },
]
```

#### ProgressBar
```typescript
properties: [
    { name: 'value', type: 'number', min: 0, max: 1, step: 0.01 },
    { name: 'direction', type: 'enum', options: [...] },
    { name: 'fillEntity', type: 'entity', displayName: 'Fill', group: 'References', advanced: true },
]
```

#### ScrollView
```typescript
properties: [
    { name: 'horizontalEnabled', type: 'boolean', displayName: 'Horizontal' },
    { name: 'verticalEnabled', type: 'boolean', displayName: 'Vertical' },
    { name: 'contentWidth', type: 'number', min: 0, step: 1, displayName: 'Content Width', group: 'Content' },
    { name: 'contentHeight', type: 'number', min: 0, step: 1, displayName: 'Content Height', group: 'Content' },
    { name: 'inertia', type: 'boolean', group: 'Physics' },
    { name: 'decelerationRate', type: 'number', min: 0, max: 1, step: 0.01,
      displayName: 'Deceleration', group: 'Physics',
      visibleWhen: { field: 'inertia', equals: true } },
    { name: 'elastic', type: 'boolean', group: 'Physics' },
    { name: 'wheelSensitivity', type: 'number', min: 0, max: 1, step: 0.01,
      displayName: 'Wheel Speed', group: 'Physics' },
    { name: 'contentEntity', type: 'entity', displayName: 'Content', group: 'References', advanced: true },
]
```

#### TextInput
```typescript
properties: [
    { name: 'value', type: 'string', group: 'Content' },
    { name: 'placeholder', type: 'string', group: 'Content' },
    { name: 'maxLength', type: 'number', min: 0, step: 1, displayName: 'Max Length', group: 'Content',
      tooltip: '0 = no limit' },
    { name: 'fontFamily', type: 'font', displayName: 'Font', group: 'Appearance' },
    { name: 'fontSize', type: 'number', min: 8, max: 200, displayName: 'Font Size', group: 'Appearance' },
    { name: 'color', type: 'color', displayName: 'Text Color', group: 'Appearance' },
    { name: 'backgroundColor', type: 'color', displayName: 'Background', group: 'Appearance' },
    { name: 'placeholderColor', type: 'color', displayName: 'Placeholder Color', group: 'Appearance' },
    { name: 'padding', type: 'number', min: 0, step: 1, group: 'Appearance' },
    { name: 'multiline', type: 'boolean', group: 'Behavior' },
    { name: 'password', type: 'boolean', group: 'Behavior' },
    { name: 'readOnly', type: 'boolean', displayName: 'Read Only', group: 'Behavior' },
]
```

#### Dropdown
```typescript
properties: [
    { name: 'options', type: 'string-array' },
    { name: 'selectedIndex', type: 'number', min: -1, step: 1, displayName: 'Selected' },
    { name: 'listEntity', type: 'entity', displayName: 'List', group: 'References', advanced: true },
    { name: 'labelEntity', type: 'entity', displayName: 'Label', group: 'References', advanced: true },
]
```

### 4.4 Audio

#### AudioSource
```typescript
properties: [
    { name: 'clip', type: 'audio-file' },
    { name: 'bus', type: 'enum', options: [...] },
    { name: 'volume', type: 'number', min: 0, max: 1, step: 0.05 },
    { name: 'pitch', type: 'number', min: 0.1, max: 3, step: 0.1 },
    { name: 'loop', type: 'boolean' },
    { name: 'playOnAwake', type: 'boolean', displayName: 'Play On Awake' },
    { name: 'priority', type: 'number', min: 0, step: 1 },
    { name: 'enabled', type: 'boolean' },
    { name: 'spatial', type: 'boolean', group: 'Spatial' },
    { name: 'minDistance', type: 'number', min: 0, step: 10, displayName: 'Min Distance', group: 'Spatial',
      visibleWhen: { field: 'spatial', equals: true } },
    { name: 'maxDistance', type: 'number', min: 0, step: 10, displayName: 'Max Distance', group: 'Spatial',
      visibleWhen: { field: 'spatial', equals: true } },
    { name: 'attenuationModel', type: 'enum', displayName: 'Attenuation', group: 'Spatial',
      visibleWhen: { field: 'spatial', equals: true }, options: [...] },
    { name: 'rolloff', type: 'number', min: 0, max: 5, step: 0.1, group: 'Spatial',
      visibleWhen: { field: 'spatial', equals: true } },
]
```

### 4.5 Physics

Collider 共享字段统一：

```typescript
const COLLIDER_MATERIAL_PROPS: PropertyMeta[] = [
    { name: 'density', type: 'number', min: 0, step: 0.1, group: 'Material' },
    { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01, group: 'Material' },
    { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01, group: 'Material' },
    { name: 'isSensor', type: 'boolean', displayName: 'Is Sensor', group: 'Material',
      tooltip: 'Detects overlaps without physical collision' },
    { name: 'categoryBits', type: 'collision-layer', displayName: 'Layer', group: 'Filtering' },
];

// BoxCollider
properties: [
    { name: 'halfExtents', type: 'vec2', displayName: 'Half Extents' },
    { name: 'offset', type: 'vec2' },
    { name: 'radius', type: 'number', min: 0, step: 0.01, tooltip: 'Corner rounding radius' },
    ...COLLIDER_MATERIAL_PROPS,
]
```

### 4.6 ParticleEmitter

当前已有良好分组，是最佳实践参考。无需改动。

---

## 5. 实施步骤

### Phase 0: 基础设施 — PropertyMeta 扩展 + Rules Engine (2 batches)

**Batch 0a: PropertyMeta 接口扩展 + VisibilityResolver**

改动文件：`PropertyEditor.ts`, `EntityInspector.ts`（新建 `VisibilityResolver.ts`）

1. 扩展 `PropertyMeta` 接口：
   - `displayName?: string` — Inspector 显示名
   - `tooltip?: string` — 悬停提示
   - `readOnly?: boolean` — 只读展示
   - `advanced?: boolean` — 折叠到 Advanced 组
   - `visibleWhen?: VisibilityRule | VisibilityRule[] | ((data) => boolean)` — 条件显隐
2. 新建 `VisibilityResolver` 类，处理 `hiddenWhen` + `visibleWhen` 逻辑
3. `EntityInspector.renderPropertyRow` 改为调用 `VisibilityResolver.isVisible()`
4. 支持 `displayName` 显示、`readOnly` 渲染、`advanced` 折叠、`tooltip` 悬停
5. 构建验证

**Batch 0b: Constraint Descriptors + Schema Validation**

改动文件：`schemaConstants.ts`, `ComponentSchemas.ts`

1. 在 `schemaConstants.ts` 中定义 `Constraints` 预设（percentage, positiveInt, angle, fontSize, layer, opacity）
2. 收录分散在各 schema 中的 magic number 为命名常量
3. `registerComponentSchema` 添加 `__DEV__` 模式校验（字段名 vs defaults、type vs editor registry）
4. 构建验证

### Phase 1: Schema Composition + 组件 Schema 重写 (3 batches)

**Batch 1a: Core + Rendering schemas**

改动文件：`coreComponents.ts`, `sprite.ts`, `shapeRenderer.ts`

1. Camera: `visibleWhen` 条件显示 + Clipping/Viewport/Debug 分组
2. ShapeRenderer: `cornerRadius` 添加 `visibleWhen`
3. 构建验证

**Batch 1b: UI Widget schemas**

改动文件：`ui.ts`

1. Button: 移除 `state`
2. Toggle: 添加 `onColor`/`offColor`，entity 字段标 `advanced`
3. Slider: 分组 + entity 字段标 `advanced` + Constraints 使用
4. ProgressBar: entity 字段标 `advanced`
5. ScrollView: 分组 + `visibleWhen`(decelerationRate 依赖 inertia) + `displayName`
6. TextInput: Content/Appearance/Behavior 三组
7. Dropdown: entity 字段标 `advanced`
8. Image: `visibleWhen` 条件显示 Filled/Tiled 专属字段
9. 构建验证

**Batch 1c: Audio + Physics schemas**

改动文件：`audio.ts`, `physics.ts`

1. 定义 `ColliderMaterial` + `ColliderFiltering` 可复用属性片段
2. 6 个 Collider schema 改为 `...ColliderMaterial, ...ColliderFiltering`
3. AudioSource: Spatial 组 `visibleWhen` 条件显示
4. 构建验证

### Phase 2: Component Composition Rules (1 batch)

改动文件：`ComponentSchemas.ts`, `AddComponentPopup.ts`, 各 plugin schema 文件

1. `ComponentSchema` 添加 `requires?`, `conflicts?`, `description?`
2. 新建 `CompositionChecker` 类
3. `AddComponentPopup` 集成：显示 description、依赖自动添加、互斥阻止
4. 关键组件添加 composition rules：
   - FlexContainer: `requires: ['UIRect']`, `conflicts: ['LayoutGroup']`
   - ScrollView: `requires: ['UIRect', 'UIMask']`
   - Image: `requires: ['UIRect']`
   - All Colliders: `requires: ['RigidBody']`（或 auto-add）
5. 构建验证

### Phase 3: 高级功能 (2 batches)

**Batch 3a: Hybrid Inspector**

改动文件：`ComponentSchema` 接口, `EntityInspector.ts`

1. `ComponentSchema` 添加 `sections?: InspectorSection[]`
2. EntityInspector 渲染流程支持 sections 混合插入
3. PostProcessVolume 迁移为 hybrid 模式（保留自定义段 + 启用 schema 基础属性）
4. 构建验证

**Batch 3b: editorInitialOverrides 迁移 + 内部组件隐藏**

改动文件：`ComponentSchemas.ts`, 各 plugin schema 文件

1. 将 `editorInitialOverrides` Map 中的覆盖值迁移到各组件 `editorDefaults` 中
2. 删除 `editorInitialOverrides` Map
3. `DragState`, `UIRenderer` 等内部组件注册 `hidden: true` schema
4. 构建验证

---

## 6. 补充发现

### 6.1 ComponentSchema 缺少 `description` 字段

**现状**：`AddComponentPopup` 组件选择器只显示组件名和 category，没有描述信息。用户添加组件时无法快速了解组件功能。

**方案**：`ComponentSchema` 添加 `description?: string`，在 `AddComponentPopup` 中悬停或展开时显示。

```typescript
interface ComponentSchema {
    // ...existing
    description?: string;  // 组件用途简述，用于 AddComponentPopup
}
```

示例：
- ScrollView: "Scrollable container with inertia and elastic bounce"
- FlexContainer: "CSS-like flexbox layout for child elements"
- Interactable: "Makes this entity respond to pointer events"

### 6.2 AddComponentPopup 不使用 displayName

**现状**：`AddComponentPopup` 组件选择器使用 `schema.name`（内部标识符如 `RigidBody`）而非 `displayName`。如果未来某些组件需要更友好的显示名（如 `UIRect` → "Rect Transform"），当前无法支持。

**方案**：组件选择器改为优先使用 `schema.displayName ?? schema.name`。

### 6.3 内部运行时组件应显式隐藏

**现状**：以下组件是运行时内部状态，不应出现在 AddComponentPopup 或 Inspector 中，但部分未标记 `hidden: true`：

| 组件 | 说明 | 当前是否 hidden |
|---|---|---|
| `UIInteraction` | 运行时交互状态（hovered/pressed） | ✅ hidden |
| `DragState` | 拖拽运行时状态 | ❌ 无 schema，但也未隐藏 |
| `SceneOwner` | 场景归属标记 | ✅ hidden |

**方案**：为 `DragState` 注册一个 `hidden: true` 的空 schema，防止它出现在 Inspector 的 "Unknown Component" fallback 中。

### 6.4 `editorInitialOverrides` 硬编码在 ComponentSchemas.ts

**现状**：`ComponentSchemas.ts` 中有一个 `editorInitialOverrides` Map，为特定组件提供非默认初始值（如 `Sprite` 添加时默认 `size: {x:100, y:100}`）。这些覆盖值硬编码在基础设施文件中，违反了 schema 分散注册的原则。

```typescript
// 当前：硬编码在 ComponentSchemas.ts
const editorInitialOverrides = new Map([
    ['Sprite', { size: { x: 100, y: 100 } }],
    // ...
]);
```

**方案**：将初始值覆盖移入各组件的 `ComponentSchema.editorDefaults` 中（此字段已存在但未充分利用），然后删除 `editorInitialOverrides` Map。

### 6.5 PostProcessVolume 自定义 Inspector 模式应文档化

**现状**：`PostProcessVolume` 使用 `registerPostProcessVolumeInspector` 注册完全自定义的 Inspector 面板，绕过了标准 schema 属性渲染。这是处理复杂嵌套数据（多个 effect 各有参数）的正确模式，但没有文档说明何时应该用自定义 Inspector vs schema 属性。

**方案**：在本文档中记录两种模式的适用场景：

| 模式 | 适用场景 | 示例 |
|---|---|---|
| Schema Properties | 扁平或浅层嵌套属性，标准编辑器类型可覆盖 | Transform, Button, Slider |
| Custom Inspector | 动态结构、深层嵌套、需要特殊交互（预览、曲线编辑） | PostProcessVolume, ParticleEmitter(未来) |

### 6.6 `inferPropertyType` 对脚本组件的 UX 改进

**现状**：用户自定义脚本组件没有手写 schema，`inferPropertyType` 从运行时数据自动推断属性类型。推断结果是无分组的平铺列表，对字段较多的脚本组件体验较差。

**方案**：
1. 支持脚本组件通过 `static schema` 静态属性声明 schema（可选）
2. 自动推断时，按类型自动分组（数值类、布尔类、引用类各一组），避免长平铺列表

```typescript
// 用户脚本可选声明
class PlayerController extends ScriptComponent {
    static schema: PropertyMeta[] = [
        { name: 'speed', type: 'number', min: 0, max: 100 },
        { name: 'jumpForce', type: 'number', min: 0 },
    ];
    speed = 5;
    jumpForce = 10;
}
```

### 6.7 UIRenderer 无 schema（设计意图确认）

**现状**：`UIRenderer` 是 builtin 组件（C++ 侧注册），在 SDK 中有定义但在编辑器 schema 中无注册。它由 Image/Text 等高层组件自动管理，用户不应直接操作。

**确认**：这是正确的设计意图。`UIRenderer` 不需要 schema，但建议在组件 hidden 列表中显式标注，避免在 "Unknown Component" fallback 中意外显示。

---

## 7. 优先级排序总结

### 架构模式（§0）

| Phase | 模式 | 改动范围 | 依赖 |
|---|---|---|---|
| **Phase 0** | Visibility Rules Engine | PropertyMeta + EntityInspector + 新 Resolver | 无 |
| **Phase 0** | Constraint Descriptors | schemaConstants + 各 schema | 无 |
| **Phase 0** | Schema Validation (注册时校验) | ComponentSchemas.ts | 无 |
| **Phase 1** | Schema Composition (属性片段复用) | physics.ts 等 schema 文件 | Phase 0 |
| **Phase 2** | Component Composition Rules | ComponentSchema + AddComponentPopup | Phase 0 |
| **Phase 3** | Hybrid Inspector | ComponentSchema + EntityInspector | Phase 0 |
| **Phase 3** | Serialization Guard | SceneSerializer | Phase 0 |

### 具体问题（§2 + §6）

| 优先级 | 问题 | 解决模式 | 影响面 |
|---|---|---|---|
| **P0** | 2.1 基于字段值的条件显示 | Visibility Rules Engine | Camera, Image, AudioSource, ParticleEmitter |
| **P0** | 2.2 复合组件属性分组 | Schema 重写 | Camera, Slider, ScrollView, TextInput, AudioSource |
| **P0** | 2.3 内部 Entity 引用折叠 | `advanced` 标记 | Slider, ProgressBar, ScrollView, Toggle, Dropdown |
| **P1** | 2.4 displayName | PropertyMeta 扩展 | 全局 ~15 个字段 |
| **P1** | 2.5 Button state 移除 | Schema 重写 | Button |
| **P1** | 2.6 Toggle 缺少颜色字段 | Schema 重写 | Toggle |
| **P1** | 2.7 readOnly 标记 | PropertyMeta 扩展 | Button, ScrollView, Dropdown |
| **P1** | 2.8 tooltip | PropertyMeta 扩展 | 全局 ~10 个字段 |
| **P1** | 6.4 editorInitialOverrides 迁移 | editorDefaults 统一 | ComponentSchemas.ts |
| **P2** | 2.9 Collider 共享字段 | Schema Composition | 6 个 Collider schema |
| **P2** | 2.10 schemaConstants 整理 | Constraint Descriptors | 全局 |
| **P2** | 6.1 ComponentSchema description | Composition Rules | AddComponentPopup |
| **P2** | 6.2 AddComponentPopup displayName | ComponentSchema 扩展 | AddComponentPopup |
| **P2** | 6.3 DragState/UIRenderer 显式隐藏 | hidden schema | Inspector fallback |
| **P2** | 6.5 自定义 Inspector → Hybrid | Hybrid Inspector | PostProcessVolume |
| **P2** | 6.6 脚本组件 schema 声明 | static schema + 推断分组 | 用户脚本 UX |
| **P2** | 6.7 Schema 驱动序列化守卫 | Serialization Guard | SceneSerializer |
