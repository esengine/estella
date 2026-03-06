# Editor Architecture Refactoring Roadmap

## Current State

EditorContainer IoC 已管理 16 类 token（ComponentSchema、Panel、Gizmo、Menu 等），24 个 plugin 通过 `PluginRegistrar` 注册。但 8 个核心服务仍用 `let instance; export function getXxx()` 单例模式绕过 IoC。

## Phase 1: Service Token 化（Singleton → IoC）

**目标**：将 8 个 singleton 服务迁移到 EditorContainer，统一生命周期管理。

### 依赖关系图

```
GlobalPathResolver ─────────────────────────┐
AssetEventBus ──────────────────────────────┤
AssetDependencyGraph ───────────────────────┤ 无依赖（叶子节点）
ImporterRegistry ───────────────────────────┘
EditorStore ────────────────────────────────── 无依赖
SharedRenderContext ────────────────────────── 无依赖（async init 需要 WASM module）
AssetDatabase ──────────────────────────────── 无依赖（async init 需要 projectDir + fs）
PlayModeService ────────────────────────────── 依赖 EditorStore + SharedRenderContext + AssetDatabase
```

### 迁移顺序（按依赖 + 影响范围排序）

| 批次 | 服务 | 消费者数 | 难度 | 说明 |
|------|------|----------|------|------|
| 1a | AssetEventBus | 3 | 低 | 无依赖，有 reset，消费者少 |
| 1b | AssetDependencyGraph | 3 | 低 | 无依赖，有 reset，消费者少 |
| 1c | ImporterRegistry | 3 | 低 | 无依赖，已在 plugin 中注册 |
| 2a | GlobalPathResolver | 9 | 中 | 无依赖，但消费者多 |
| 2b | EditorStore | 3 | 中 | 构造时创建 5 个内部服务，无 dispose |
| 3 | SharedRenderContext | 5 | 中 | 需要 async init，有完整 dispose |
| 4 | AssetDatabase | 11 | 高 | 消费者最多，需要 async init |
| 5 | PlayModeService | 7 | 高 | 依赖其余 3 个服务，最后迁移 |

### 迁移模式

```typescript
// tokens.ts 新增
export const EDITOR_STORE = new ServiceToken<EditorStore>('EditorStore');
export const SHARED_RENDER_CTX = new ServiceToken<SharedRenderContext>('SharedRenderContext');
// ... 其余 6 个

// plugin 中注册
export const coreServicesPlugin: EditorPlugin = {
    name: 'core-services',
    register(ctx) {
        ctx.registrar.provide(ASSET_EVENT_BUS, 'default', new AssetEventBus());
        ctx.registrar.provide(ASSET_DEP_GRAPH, 'default', new AssetDependencyGraph());
        // ...
    },
};

// 消费端：getAssetEventBus() 内部改为 getEditorContainer().get(ASSET_EVENT_BUS, 'default')
// 保留 getter 函数作为便捷 API，但底层走 IoC
```

### 关键决策

- **保留 getter 函数**：`getEditorStore()` 等不删除，改为内部调用 `getEditorContainer().get()`。这样不破坏现有消费端，但 lifecycle 由 IoC 管理。
- **Dispose 统一**：EditorContainer 增加 `dispose()` 方法，LIFO 顺序清理所有注册的服务（类似 DisposableStore）。
- **AsyncInit 服务**：AssetDatabase 和 SharedRenderContext 需要 async 初始化。Token 注册时只创建实例，`init()` 由 Editor bootstrap 序列显式调用。

---

## Phase 2: 组件类型 Switch → Registry

**目标**：消除 `EditorSceneManager.removeComponentFromEntity()` 的 20+ case switch。

### 现状

| 位置 | 类型 | Cases | 改造价值 |
|------|------|-------|----------|
| `EditorSceneManager.removeComponentFromEntity()` | switch | 8 (Transform, Sprite, BitmapText, UIRect, UIMask, Text, TextInput, SpineAnimation) | 高 — 新组件必须散修改 |
| `ComponentSchemas.getDynamicOverrides()` | switch | 2 (Sprite, Canvas) | 低 — 极少变动 |

### 方案

新增 `COMPONENT_LIFECYCLE` token：

```typescript
interface ComponentLifecycle {
    add?: (world: World, entity: Entity, data: Record<string, unknown>) => void;
    remove?: (world: World, entity: Entity) => void;
    sync?: (world: World, entity: Entity, data: Record<string, unknown>) => void;
}

// tokens.ts
export const COMPONENT_LIFECYCLE = new ServiceToken<ComponentLifecycle>('ComponentLifecycle');

// sprite plugin 中注册
ctx.registrar.provide(COMPONENT_LIFECYCLE, 'Sprite', {
    add: (world, entity, data) => { world.insert(entity, Sprite, data); },
    remove: (world, entity) => { if (world.has(entity, Sprite)) world.remove(entity, Sprite); },
});

// TextInput plugin - 级联删除 Text
ctx.registrar.provide(COMPONENT_LIFECYCLE, 'TextInput', {
    remove: (world, entity) => {
        if (world.has(entity, TextInput)) world.remove(entity, TextInput);
        if (world.has(entity, Text)) world.remove(entity, Text);
    },
});
```

**EditorSceneManager** 改造后：
```typescript
removeComponentFromEntity(entityId: number, componentType: string): void {
    const lifecycle = getEditorContainer().get(COMPONENT_LIFECYCLE, componentType);
    if (lifecycle?.remove) {
        lifecycle.remove(this.world_, entity);
    }
}
```

### getDynamicOverrides 改造

合并到 `COMPONENT_SCHEMA` token 中：给 `ComponentSchema` 接口增加可选的 `editorDefaults?: () => Record<string, unknown>` 字段。

```typescript
// sprite plugin
const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    defaults: { ... },
    editorDefaults: () => ({
        size: {
            x: getSettingsValue('rendering.defaultSpriteWidth') ?? 100,
            y: getSettingsValue('rendering.defaultSpriteHeight') ?? 100,
        },
    }),
};
```

---

## Phase 3: 清理模块级状态泄漏

**目标**：项目切换时不残留旧状态。

### 问题清单

| 文件 | 状态 | 影响 |
|------|------|------|
| `io/SceneSerializer.ts` | `currentFileHandle` | 切换项目后可能指向旧文件 |
| `settings/SettingsDialog.ts` | `lastActiveSectionId_` | 低影响，UI 偏好 |
| `builder/BuildSettingsDialog.ts` | `activeDialog` | 对话框未关闭时切换 |

### 方案

Phase 1 完成后，这些状态可以挂在 IoC 容器上。容器 `dispose()` 时统一清理。对于仅是 UI 偏好的状态（如 lastActiveSectionId），可以保留模块级变量。

---

## Phase 4: 统一 Registry Query API

**目标**：消除各 Registry 模块（PanelRegistry、MenuRegistry、GizmoRegistry、InspectorRegistry、SettingsRegistry）中重复的 filter/sort 逻辑。

### 现状

每个 Registry 模块都实现了类似的模式：
```typescript
export function getAllXxx(): XxxDescriptor[] {
    return Array.from(getEditorContainer().getAll(XXX_TOKEN).values())
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export function getXxx(id: string): XxxDescriptor | undefined {
    return getEditorContainer().get(XXX_TOKEN, id);
}
```

### 方案

给 EditorContainer 增加泛型查询方法：
```typescript
class EditorContainer {
    getOrdered<V extends { order?: number }>(token: ServiceToken<V>): V[] {
        return Array.from(this.getAll(token).values())
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    filter<V>(token: ServiceToken<V>, pred: (v: V) => boolean): V[] {
        return Array.from(this.getAll(token).values()).filter(pred);
    }
}
```

这样各 Registry 的 `getAllXxx()` 函数可以简化为一行。

---

## 实施优先级

```
Phase 1（Singleton → IoC）
├── Batch 1: AssetEventBus + AssetDependencyGraph + ImporterRegistry  [≤3 文件/服务]
├── Batch 2: GlobalPathResolver + EditorStore                        [中等]
├── Batch 3: SharedRenderContext                                      [中等]
├── Batch 4: AssetDatabase                                            [高影响]
└── Batch 5: PlayModeService                                          [最后]

Phase 2（Switch → Registry）
├── COMPONENT_LIFECYCLE token + plugin 注册                           [新 token]
├── 迁移 removeComponentFromEntity                                    [核心改造]
└── 合并 getDynamicOverrides 到 ComponentSchema                      [小改动]

Phase 3（状态泄漏清理）                                                [依赖 Phase 1]

Phase 4（统一 Registry Query）                                        [独立，可随时做]
```

## 风险与约束

1. **Phase 1 的 getter 兼容层**：保留 `getXxx()` 函数避免大面积改动，但需确保 IoC 容器已初始化才能调用。在 Editor 构造前调用会 throw。
2. **Async init 服务**：AssetDatabase 和 SharedRenderContext 的 init 是异步的，注册到 IoC 时只创建空壳，需要 Editor bootstrap 显式调用 init。
3. **测试影响**：迁移后单测需要 mock EditorContainer 而非直接 mock 单例 getter。
4. **Phase 2 的 SpineAnimation**：destroySpineInstance 有复杂生命周期（C++ 资源释放），需要确保 COMPONENT_LIFECYCLE.remove 能访问 EditorSceneManager 的 spine 管理器。
