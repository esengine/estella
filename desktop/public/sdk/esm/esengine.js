/**
 * @file    base.ts
 * @brief   Base platform adapter - no platform-specific code
 */
// =============================================================================
// Platform Instance (set by entry point)
// =============================================================================
let currentPlatform = null;
/**
 * Set the platform adapter (called by entry point)
 */
function setPlatform(adapter) {
    currentPlatform = adapter;
    console.log(`[ESEngine] Platform: ${adapter.name}`);
}
/**
 * Get the current platform adapter
 * @throws Error if platform not initialized
 */
function getPlatform() {
    if (!currentPlatform) {
        throw new Error('[ESEngine] Platform not initialized. ' +
            'Import from "esengine" (web) or "esengine/wechat" (WeChat) instead of direct imports.');
    }
    return currentPlatform;
}
/**
 * Check if platform is initialized
 */
function isPlatformInitialized() {
    return currentPlatform !== null;
}
/**
 * Get platform type
 */
function getPlatformType() {
    return currentPlatform?.name ?? null;
}
/**
 * Check if running on WeChat
 */
function isWeChat() {
    return currentPlatform?.name === 'wechat';
}
/**
 * Check if running on Web
 */
function isWeb() {
    return currentPlatform?.name === 'web';
}
// =============================================================================
// Convenience Functions
// =============================================================================
async function platformFetch(url, options) {
    return getPlatform().fetch(url, options);
}
async function platformReadFile(path) {
    return getPlatform().readFile(path);
}
async function platformReadTextFile(path) {
    return getPlatform().readTextFile(path);
}
async function platformFileExists(path) {
    return getPlatform().fileExists(path);
}
async function platformInstantiateWasm(pathOrBuffer, imports) {
    return getPlatform().instantiateWasm(pathOrBuffer, imports);
}

/**
 * @file    web.ts
 * @brief   Web platform adapter implementation
 */
// =============================================================================
// Web Platform Adapter
// =============================================================================
class WebPlatformAdapter {
    constructor() {
        this.name = 'web';
    }
    async fetch(url, options) {
        const response = await globalThis.fetch(url, {
            method: options?.method ?? 'GET',
            headers: options?.headers,
            body: options?.body,
        });
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            json: () => response.json(),
            text: () => response.text(),
            arrayBuffer: () => response.arrayBuffer(),
        };
    }
    async readFile(path) {
        const response = await this.fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to read file: ${path} (${response.status})`);
        }
        return response.arrayBuffer();
    }
    async readTextFile(path) {
        const response = await this.fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to read file: ${path} (${response.status})`);
        }
        return response.text();
    }
    async fileExists(path) {
        try {
            const response = await globalThis.fetch(path, { method: 'HEAD' });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async instantiateWasm(pathOrBuffer, imports) {
        let buffer;
        if (typeof pathOrBuffer === 'string') {
            buffer = await this.readFile(pathOrBuffer);
        }
        else {
            buffer = pathOrBuffer;
        }
        const result = await WebAssembly.instantiate(buffer, imports);
        return {
            instance: result.instance,
            module: result.module,
        };
    }
}
// =============================================================================
// Export Singleton
// =============================================================================
const webAdapter = new WebPlatformAdapter();

/**
 * @file    types.ts
 * @brief   Core type definitions for ESEngine SDK
 */
const INVALID_ENTITY = 0;
const INVALID_TEXTURE = 0xFFFFFFFF;
// =============================================================================
// Factory Functions
// =============================================================================
const vec2 = (x = 0, y = 0) => ({ x, y });
const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const vec4 = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
const color = (r = 1, g = 1, b = 1, a = 1) => ({ x: r, y: g, z: b, w: a });
const quat = (w = 1, x = 0, y = 0, z = 0) => ({ w, x, y, z });

/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */
let componentCounter = 0;
function createComponentDef(name, defaults) {
    const id = ++componentCounter;
    return {
        _id: Symbol(`Component_${id}_${name}`),
        _name: name,
        _default: defaults,
        _builtin: false,
        create(data) {
            return { ...defaults, ...data };
        }
    };
}
function defineComponent(name, defaults) {
    const def = createComponentDef(name, defaults);
    registerToEditor(name, defaults, false);
    return def;
}
function defineTag(name) {
    const def = createComponentDef(name, {});
    registerToEditor(name, {}, true);
    return def;
}
function registerToEditor(name, defaults, isTag) {
    if (typeof window !== 'undefined' && window.__esengine_registerComponent) {
        window.__esengine_registerComponent(name, defaults, isTag);
    }
}
function defineBuiltin(name, defaults) {
    return {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _cppName: name,
        _builtin: true,
        _default: defaults
    };
}
function isBuiltinComponent(comp) {
    return comp._builtin === true;
}
// =============================================================================
// Builtin Component Instances
// =============================================================================
const LocalTransform = defineBuiltin('LocalTransform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
});
const WorldTransform = defineBuiltin('WorldTransform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
});
const Sprite = defineBuiltin('Sprite', {
    texture: INVALID_TEXTURE,
    color: { x: 1, y: 1, z: 1, w: 1 },
    size: { x: 32, y: 32 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0
});
const Camera = defineBuiltin('Camera', {
    projectionType: 0,
    fov: 60,
    orthoSize: 5,
    nearPlane: 0.1,
    farPlane: 1000,
    aspectRatio: 1.77,
    isActive: true,
    priority: 0
});
const Canvas = defineBuiltin('Canvas', {
    designResolution: { x: 1920, y: 1080 },
    pixelsPerUnit: 100,
    scaleMode: 0,
    matchWidthOrHeight: 0.5,
    backgroundColor: { x: 0, y: 0, z: 0, w: 1 }
});
const Velocity = defineBuiltin('Velocity', {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 }
});
const Parent = defineBuiltin('Parent', {
    entity: 0
});
const Children = defineBuiltin('Children', {
    entities: []
});
const SpineAnimation = defineBuiltin('SpineAnimation', {
    skeletonPath: '',
    atlasPath: '',
    skin: '',
    animation: '',
    timeScale: 1.0,
    loop: true,
    playing: true,
    flipX: false,
    flipY: false,
    color: { x: 1, y: 1, z: 1, w: 1 },
    layer: 0,
    skeletonScale: 1.0,
    material: 0
});
// =============================================================================
// Component Defaults Registry
// =============================================================================
const builtinComponents = {
    LocalTransform,
    WorldTransform,
    Sprite,
    Camera,
    Canvas,
    Velocity,
    Parent,
    Children,
    SpineAnimation,
};
function getComponentDefaults(typeName) {
    const component = builtinComponents[typeName];
    if (component) {
        return { ...component._default };
    }
    return null;
}

/**
 * @file    resource.ts
 * @brief   Resource system for global singleton data
 */
let resourceCounter = 0;
function defineResource(defaultValue, name) {
    const id = ++resourceCounter;
    return {
        _id: Symbol(`Resource_${id}_${name ?? ''}`),
        _name: name ?? `Resource_${id}`,
        _default: defaultValue
    };
}
function Res(resource) {
    return { _type: 'res', _resource: resource };
}
function ResMut(resource) {
    return { _type: 'res_mut', _resource: resource };
}
// =============================================================================
// Resource Instances (Runtime)
// =============================================================================
class ResMutInstance {
    constructor(value, setter) {
        this.value_ = value;
        this.setter_ = setter;
    }
    get() {
        return this.value_;
    }
    set(value) {
        this.value_ = value;
        this.setter_(value);
    }
    modify(fn) {
        fn(this.value_);
        this.setter_(this.value_);
    }
}
// =============================================================================
// Resource Storage
// =============================================================================
class ResourceStorage {
    constructor() {
        this.resources_ = new Map();
    }
    insert(resource, value) {
        this.resources_.set(resource._id, value);
    }
    get(resource) {
        if (!this.resources_.has(resource._id)) {
            this.resources_.set(resource._id, resource._default);
        }
        return this.resources_.get(resource._id);
    }
    set(resource, value) {
        this.resources_.set(resource._id, value);
    }
    has(resource) {
        return this.resources_.has(resource._id);
    }
    remove(resource) {
        this.resources_.delete(resource._id);
    }
    getResMut(resource) {
        return new ResMutInstance(this.get(resource), (v) => this.set(resource, v));
    }
}
const Time = defineResource({
    delta: 0,
    elapsed: 0,
    frameCount: 0
}, 'Time');
const Input = defineResource({
    keysDown: new Set(),
    keysPressed: new Set(),
    keysReleased: new Set(),
    mouseX: 0,
    mouseY: 0,
    mouseButtons: new Set()
}, 'Input');

/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */
function Mut(component) {
    return { _type: 'mut', _component: component };
}
function isMutWrapper(value) {
    return typeof value === 'object' && value !== null && value._type === 'mut';
}
function createQueryDescriptor(components, withFilters = [], withoutFilters = []) {
    const mutIndices = [];
    components.forEach((comp, i) => {
        if (isMutWrapper(comp)) {
            mutIndices.push(i);
        }
    });
    return {
        _type: 'query',
        _components: components,
        _mutIndices: mutIndices,
        _with: withFilters,
        _without: withoutFilters
    };
}
// =============================================================================
// Query Factory
// =============================================================================
function Query(...components) {
    return createQueryDescriptor(components);
}
class QueryInstance {
    constructor(world, descriptor) {
        this.pendingMutations_ = [];
        this.world_ = world;
        this.descriptor_ = descriptor;
    }
    getActualComponent(arg) {
        return isMutWrapper(arg) ? arg._component : arg;
    }
    commitPending() {
        for (const mutation of this.pendingMutations_) {
            this.world_.insert(mutation.entity, mutation.component, mutation.data);
        }
        this.pendingMutations_ = [];
    }
    *[Symbol.iterator]() {
        const { _components, _mutIndices, _with, _without } = this.descriptor_;
        const actualComponents = _components.map(c => this.getActualComponent(c));
        const allRequired = [...actualComponents, ..._with];
        const entities = this.world_.getEntitiesWithComponents(allRequired);
        let prevEntity = null;
        let prevMutData = [];
        try {
            for (const entity of entities) {
                // Commit previous entity's mutations before moving to next
                if (prevEntity !== null) {
                    for (const mut of prevMutData) {
                        this.world_.insert(prevEntity, mut.component, mut.data);
                    }
                }
                prevMutData = [];
                let excluded = false;
                for (const comp of _without) {
                    if (this.world_.has(entity, comp)) {
                        excluded = true;
                        break;
                    }
                }
                if (excluded)
                    continue;
                const components = actualComponents.map(comp => this.world_.get(entity, comp));
                // Track mutable components for write-back
                for (const idx of _mutIndices) {
                    prevMutData.push({
                        component: actualComponents[idx],
                        data: components[idx]
                    });
                }
                prevEntity = entity;
                yield [entity, ...components];
            }
        }
        finally {
            // Commit last entity's mutations
            if (prevEntity !== null) {
                for (const mut of prevMutData) {
                    this.world_.insert(prevEntity, mut.component, mut.data);
                }
            }
        }
    }
    forEach(callback) {
        for (const [entity, ...components] of this) {
            callback(entity, ...components);
        }
    }
    single() {
        for (const result of this) {
            return result;
        }
        return null;
    }
    isEmpty() {
        return this.single() === null;
    }
    count() {
        let n = 0;
        for (const _ of this) {
            n++;
        }
        return n;
    }
    toArray() {
        return [...this];
    }
}

/**
 * @file    commands.ts
 * @brief   Deferred entity/component operations
 */
function Commands() {
    return { _type: 'commands' };
}
// =============================================================================
// Entity Commands (Builder for spawning)
// =============================================================================
class EntityCommands {
    constructor(commands, entity) {
        this.components_ = [];
        this.commands_ = commands;
        if (entity === null) {
            this.entityRef_ = { entity: 0 };
            this.isNew_ = true;
        }
        else {
            this.entityRef_ = { entity };
            this.isNew_ = false;
        }
    }
    insert(component, data) {
        let instance;
        if (isBuiltinComponent(component)) {
            instance = { ...component._default, ...data };
        }
        else {
            instance = component.create(data);
        }
        if (this.isNew_) {
            this.components_.push({ component, data: instance });
        }
        else {
            this.commands_.queueInsert(this.entityRef_.entity, component, instance);
        }
        return this;
    }
    remove(component) {
        if (!this.isNew_) {
            this.commands_.queueRemove(this.entityRef_.entity, component);
        }
        return this;
    }
    id() {
        if (this.isNew_ && this.entityRef_.entity === 0) {
            this.finalize();
        }
        return this.entityRef_.entity;
    }
    finalize() {
        if (this.isNew_) {
            this.commands_.spawnImmediate(this.components_, this.entityRef_);
            this.isNew_ = false;
        }
    }
}
// =============================================================================
// Commands Instance (Runtime)
// =============================================================================
class CommandsInstance {
    constructor(world, resources) {
        this.pending_ = [];
        this.world_ = world;
        this.resources_ = resources;
    }
    spawn() {
        return new EntityCommands(this, null);
    }
    entity(entity) {
        return new EntityCommands(this, entity);
    }
    despawn(entity) {
        this.pending_.push({ type: 'despawn', entity });
        return this;
    }
    insertResource(resource, value) {
        this.pending_.push({
            type: 'insert_resource',
            resource: resource,
            value
        });
        return this;
    }
    queueInsert(entity, component, data) {
        this.pending_.push({ type: 'insert', entity, component, data });
    }
    queueRemove(entity, component) {
        this.pending_.push({ type: 'remove', entity, component });
    }
    spawnImmediate(components, entityRef) {
        const entity = this.world_.spawn();
        entityRef.entity = entity;
        for (const entry of components) {
            this.world_.insert(entity, entry.component, entry.data);
        }
    }
    flush() {
        for (const cmd of this.pending_) {
            this.executeCommand(cmd);
        }
        this.pending_ = [];
    }
    executeCommand(cmd) {
        switch (cmd.type) {
            case 'spawn': {
                const entity = this.world_.spawn();
                cmd.entityRef.entity = entity;
                for (const entry of cmd.components) {
                    this.world_.insert(entity, entry.component, entry.data);
                }
                break;
            }
            case 'despawn':
                this.world_.despawn(cmd.entity);
                break;
            case 'insert':
                this.world_.insert(cmd.entity, cmd.component, cmd.data);
                break;
            case 'remove':
                this.world_.remove(cmd.entity, cmd.component);
                break;
            case 'insert_resource':
                this.resources_.insert(cmd.resource, cmd.value);
                break;
        }
    }
}

/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */
// =============================================================================
// Schedule Phases
// =============================================================================
var Schedule;
(function (Schedule) {
    Schedule[Schedule["Startup"] = 0] = "Startup";
    Schedule[Schedule["First"] = 1] = "First";
    Schedule[Schedule["PreUpdate"] = 2] = "PreUpdate";
    Schedule[Schedule["Update"] = 3] = "Update";
    Schedule[Schedule["PostUpdate"] = 4] = "PostUpdate";
    Schedule[Schedule["Last"] = 5] = "Last";
    Schedule[Schedule["FixedPreUpdate"] = 10] = "FixedPreUpdate";
    Schedule[Schedule["FixedUpdate"] = 11] = "FixedUpdate";
    Schedule[Schedule["FixedPostUpdate"] = 12] = "FixedPostUpdate";
})(Schedule || (Schedule = {}));
let systemCounter = 0;
function defineSystem(params, fn, options) {
    const id = ++systemCounter;
    return {
        _id: Symbol(`System_${id}_${options?.name ?? ''}`),
        _params: params,
        _fn: fn,
        _name: options?.name ?? `System_${id}`
    };
}
// =============================================================================
// System Runner
// =============================================================================
class SystemRunner {
    constructor(world, resources) {
        this.world_ = world;
        this.resources_ = resources;
    }
    run(system) {
        const args = system._params.map(param => this.resolveParam(param));
        system._fn(...args);
        for (const arg of args) {
            if (arg instanceof CommandsInstance) {
                arg.flush();
            }
        }
    }
    resolveParam(param) {
        switch (param._type) {
            case 'query':
                return new QueryInstance(this.world_, param);
            case 'res':
                return this.resources_.get(param._resource);
            case 'res_mut':
                return this.resources_.getResMut(param._resource);
            case 'commands':
                return new CommandsInstance(this.world_, this.resources_);
            default:
                throw new Error('Unknown system parameter type');
        }
    }
}

/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */
// =============================================================================
// World
// =============================================================================
class World {
    constructor() {
        this.cppRegistry_ = null;
        this.entities_ = new Set();
        this.tsStorage_ = new Map();
    }
    connectCpp(cppRegistry) {
        this.cppRegistry_ = cppRegistry;
    }
    get hasCpp() {
        return this.cppRegistry_ !== null;
    }
    // =========================================================================
    // Entity Management
    // =========================================================================
    spawn() {
        let entity;
        if (this.cppRegistry_) {
            entity = this.cppRegistry_.create();
        }
        else {
            entity = (this.entities_.size + 1);
        }
        this.entities_.add(entity);
        return entity;
    }
    despawn(entity) {
        if (this.cppRegistry_) {
            this.cppRegistry_.destroy(entity);
        }
        this.entities_.delete(entity);
        for (const storage of this.tsStorage_.values()) {
            storage.delete(entity);
        }
    }
    valid(entity) {
        if (this.cppRegistry_) {
            return this.cppRegistry_.valid(entity);
        }
        return this.entities_.has(entity);
    }
    entityCount() {
        return this.entities_.size;
    }
    getAllEntities() {
        return Array.from(this.entities_);
    }
    setParent(child, parent) {
        if (this.cppRegistry_) {
            this.cppRegistry_.setParent(child, parent);
        }
    }
    removeParent(entity) {
        if (this.cppRegistry_) {
            this.cppRegistry_.removeParent(entity);
        }
    }
    // =========================================================================
    // Component Management
    // =========================================================================
    insert(entity, component, data) {
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin(entity, component, data);
        }
        return this.insertScript(entity, component, data);
    }
    get(entity, component) {
        if (isBuiltinComponent(component)) {
            return this.getBuiltin(entity, component);
        }
        return this.getScript(entity, component);
    }
    has(entity, component) {
        if (isBuiltinComponent(component)) {
            return this.hasBuiltin(entity, component);
        }
        return this.hasScript(entity, component);
    }
    remove(entity, component) {
        if (isBuiltinComponent(component)) {
            this.removeBuiltin(entity, component);
        }
        else {
            this.removeScript(entity, component);
        }
    }
    // =========================================================================
    // Builtin Component Operations (C++ Registry)
    // =========================================================================
    insertBuiltin(entity, component, data) {
        const merged = { ...component._default, ...data };
        if (this.cppRegistry_) {
            const adder = `add${component._cppName}`;
            const fn = this.cppRegistry_[adder];
            fn.call(this.cppRegistry_, entity, merged);
        }
        return merged;
    }
    getBuiltin(entity, component) {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }
        const getter = `get${component._cppName}`;
        const fn = this.cppRegistry_[getter];
        return fn.call(this.cppRegistry_, entity);
    }
    hasBuiltin(entity, component) {
        if (!this.cppRegistry_) {
            return false;
        }
        const checker = `has${component._cppName}`;
        const fn = this.cppRegistry_[checker];
        return fn.call(this.cppRegistry_, entity);
    }
    removeBuiltin(entity, component) {
        if (!this.cppRegistry_) {
            return;
        }
        const remover = `remove${component._cppName}`;
        const fn = this.cppRegistry_[remover];
        fn.call(this.cppRegistry_, entity);
    }
    // =========================================================================
    // Script Component Operations (TypeScript storage)
    // =========================================================================
    insertScript(entity, component, data) {
        const value = component.create(data);
        this.getStorage(component).set(entity, value);
        return value;
    }
    getScript(entity, component) {
        const storage = this.tsStorage_.get(component._id);
        if (!storage) {
            throw new Error(`Component not found: ${component._name}`);
        }
        return storage.get(entity);
    }
    hasScript(entity, component) {
        const storage = this.tsStorage_.get(component._id);
        return storage?.has(entity) ?? false;
    }
    removeScript(entity, component) {
        const storage = this.tsStorage_.get(component._id);
        storage?.delete(entity);
    }
    getStorage(component) {
        let storage = this.tsStorage_.get(component._id);
        if (!storage) {
            storage = new Map();
            this.tsStorage_.set(component._id, storage);
        }
        return storage;
    }
    // =========================================================================
    // Query Support
    // =========================================================================
    getEntitiesWithComponents(components) {
        if (components.length === 0) {
            return this.getAllEntities();
        }
        const entities = [];
        for (const entity of this.entities_) {
            let hasAll = true;
            for (const comp of components) {
                if (!this.has(entity, comp)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) {
                entities.push(entity);
            }
        }
        return entities;
    }
}

/**
 * @file    text.ts
 * @brief   Text component definition for UI text rendering
 */
// =============================================================================
// Text Alignment Enums
// =============================================================================
var TextAlign;
(function (TextAlign) {
    TextAlign[TextAlign["Left"] = 0] = "Left";
    TextAlign[TextAlign["Center"] = 1] = "Center";
    TextAlign[TextAlign["Right"] = 2] = "Right";
})(TextAlign || (TextAlign = {}));
var TextVerticalAlign;
(function (TextVerticalAlign) {
    TextVerticalAlign[TextVerticalAlign["Top"] = 0] = "Top";
    TextVerticalAlign[TextVerticalAlign["Middle"] = 1] = "Middle";
    TextVerticalAlign[TextVerticalAlign["Bottom"] = 2] = "Bottom";
})(TextVerticalAlign || (TextVerticalAlign = {}));
var TextOverflow;
(function (TextOverflow) {
    TextOverflow[TextOverflow["Visible"] = 0] = "Visible";
    TextOverflow[TextOverflow["Clip"] = 1] = "Clip";
    TextOverflow[TextOverflow["Ellipsis"] = 2] = "Ellipsis";
})(TextOverflow || (TextOverflow = {}));
// =============================================================================
// Text Component Definition
// =============================================================================
const Text = defineComponent('Text', {
    content: '',
    fontFamily: 'Arial',
    fontSize: 24,
    color: { x: 1, y: 1, z: 1, w: 1 },
    align: TextAlign.Left,
    verticalAlign: TextVerticalAlign.Top,
    wordWrap: true,
    overflow: TextOverflow.Visible,
    lineHeight: 1.2,
    dirty: true,
});

/**
 * @file    TextRenderer.ts
 * @brief   Renders text to GPU textures using Canvas 2D API
 */
// =============================================================================
// Text Renderer
// =============================================================================
class TextRenderer {
    constructor(module) {
        this.cache = new Map();
        this.module = module;
        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas = new OffscreenCanvas(512, 512);
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        }
        else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = 512;
            this.canvas.height = 512;
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        }
    }
    /**
     * Renders text to a texture and returns the handle
     */
    renderText(text, uiRect) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        const hasContainer = uiRect && uiRect.size.x > 0 && uiRect.size.y > 0;
        const containerWidth = hasContainer ? uiRect.size.x : 0;
        const containerHeight = hasContainer ? uiRect.size.y : 0;
        const shouldWrap = text.wordWrap && hasContainer;
        let lines = this.wrapText(text.content, shouldWrap ? containerWidth : 0);
        const lineHeightPx = Math.ceil(text.fontSize * text.lineHeight);
        const padding = Math.ceil(text.fontSize * 0.2);
        const measuredWidth = Math.ceil(this.measureWidth(lines));
        const measuredHeight = Math.ceil(lines.length * lineHeightPx);
        const width = hasContainer ? Math.ceil(containerWidth) : measuredWidth + padding * 2;
        const height = hasContainer ? Math.ceil(containerHeight) : measuredHeight + padding * 2;
        // Handle overflow ellipsis
        if (hasContainer && text.overflow === TextOverflow.Ellipsis && measuredHeight > containerHeight) {
            const maxLines = Math.floor(containerHeight / lineHeightPx);
            if (maxLines > 0 && lines.length > maxLines) {
                lines = lines.slice(0, maxLines);
                const lastLine = lines[maxLines - 1];
                lines[maxLines - 1] = this.truncateWithEllipsis(lastLine, containerWidth);
            }
        }
        if (canvas.width < width || canvas.height < height) {
            const newWidth = Math.max(canvas.width, this.nextPowerOf2(width));
            const newHeight = Math.max(canvas.height, this.nextPowerOf2(height));
            canvas.width = newWidth;
            canvas.height = newHeight;
        }
        const r = Math.round(text.color.x * 255);
        const g = Math.round(text.color.y * 255);
        const b = Math.round(text.color.z * 255);
        const a = text.color.w;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        ctx.textAlign = this.mapAlign(text.align);
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        // Handle overflow clip
        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, width, height);
            ctx.clip();
        }
        const textBlockHeight = lines.length * lineHeightPx;
        let startY;
        if (hasContainer) {
            switch (text.verticalAlign) {
                case TextVerticalAlign.Top:
                    startY = padding;
                    break;
                case TextVerticalAlign.Middle:
                    startY = (height - textBlockHeight) / 2;
                    break;
                case TextVerticalAlign.Bottom:
                    startY = height - textBlockHeight - padding;
                    break;
                default: startY = padding;
            }
        }
        else {
            startY = padding;
        }
        let y = startY;
        for (const line of lines) {
            let x;
            switch (text.align) {
                case TextAlign.Left:
                    x = padding;
                    break;
                case TextAlign.Center:
                    x = width / 2;
                    break;
                case TextAlign.Right:
                    x = width - padding;
                    break;
                default:
                    x = padding;
            }
            ctx.fillText(line, x, y);
            y += lineHeightPx;
        }
        if (hasContainer && text.overflow === TextOverflow.Clip) {
            ctx.restore();
        }
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        const flipped = this.flipVertically(pixels, width, height);
        const rm = this.module.getResourceManager();
        const ptr = this.module._malloc(flipped.length);
        this.module.HEAPU8.set(flipped, ptr);
        const textureHandle = rm.createTexture(width, height, ptr, flipped.length, 1);
        this.module._free(ptr);
        return { textureHandle, width, height };
    }
    truncateWithEllipsis(text, maxWidth) {
        const ellipsis = '...';
        if (this.ctx.measureText(text).width <= maxWidth) {
            return text;
        }
        let truncated = text;
        while (truncated.length > 0 && this.ctx.measureText(truncated + ellipsis).width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + ellipsis;
    }
    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity, text, uiRect) {
        const existing = this.cache.get(entity);
        if (existing) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }
        const result = this.renderText(text, uiRect);
        this.cache.set(entity, result);
        return result;
    }
    /**
     * Gets cached render result for entity
     */
    getCached(entity) {
        return this.cache.get(entity);
    }
    /**
     * Releases texture for entity
     */
    release(entity) {
        const cached = this.cache.get(entity);
        if (cached) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(cached.textureHandle);
            this.cache.delete(entity);
        }
    }
    /**
     * Releases all cached textures
     */
    releaseAll() {
        const rm = this.module.getResourceManager();
        for (const result of this.cache.values()) {
            rm.releaseTexture(result.textureHandle);
        }
        this.cache.clear();
    }
    // =========================================================================
    // Private Methods
    // =========================================================================
    wrapText(text, maxWidth) {
        if (!text)
            return [''];
        if (maxWidth <= 0)
            return text.split('\n');
        const paragraphs = text.split('\n');
        const lines = [];
        for (const paragraph of paragraphs) {
            if (!paragraph) {
                lines.push('');
                continue;
            }
            let currentLine = '';
            for (const char of paragraph) {
                const testLine = currentLine + char;
                const metrics = this.ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                }
                else {
                    currentLine = testLine;
                }
            }
            if (currentLine) {
                lines.push(currentLine);
            }
        }
        return lines.length > 0 ? lines : [''];
    }
    measureWidth(lines) {
        let maxWidth = 0;
        for (const line of lines) {
            const metrics = this.ctx.measureText(line);
            const width = metrics.actualBoundingBoxLeft !== undefined
                ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
                : metrics.width;
            maxWidth = Math.max(maxWidth, width);
        }
        return maxWidth;
    }
    mapAlign(align) {
        switch (align) {
            case TextAlign.Left:
                return 'left';
            case TextAlign.Center:
                return 'center';
            case TextAlign.Right:
                return 'right';
        }
    }
    nextPowerOf2(n) {
        let p = 1;
        while (p < n)
            p *= 2;
        return p;
    }
    flipVertically(pixels, width, height) {
        const rowSize = width * 4;
        const flipped = new Uint8Array(pixels.length);
        for (let y = 0; y < height; y++) {
            const srcOffset = y * rowSize;
            const dstOffset = (height - 1 - y) * rowSize;
            flipped.set(pixels.subarray(srcOffset, srcOffset + rowSize), dstOffset);
        }
        return flipped;
    }
}

/**
 * @file    UIRect.ts
 * @brief   UIRect component for UI layout with anchor and pivot
 */
// =============================================================================
// UIRect Component Definition
// =============================================================================
const UIRect = defineComponent('UIRect', {
    size: { x: 100, y: 100 },
    anchor: { x: 0.5, y: 0.5 },
    pivot: { x: 0.5, y: 0.5 },
});

/**
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */
// =============================================================================
// Text Plugin
// =============================================================================
class TextPlugin {
    build(app) {
        const module = app.wasmModule;
        if (!module) {
            console.warn('TextPlugin: No WASM module available');
            return;
        }
        const renderer = new TextRenderer(module);
        const world = app.world;
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            const entities = world.getEntitiesWithComponents([Text]);
            for (const entity of entities) {
                const text = world.get(entity, Text);
                if (!text.dirty)
                    continue;
                if (!world.has(entity, Sprite)) {
                    world.insert(entity, Sprite, {
                        texture: INVALID_TEXTURE,
                        size: { x: 0, y: 0 },
                        color: { x: 1, y: 1, z: 1, w: 1 },
                        anchor: { x: 0.5, y: 0.5 },
                        flip: { x: false, y: false }
                    });
                }
                const uiRect = world.has(entity, UIRect)
                    ? world.get(entity, UIRect)
                    : null;
                const result = renderer.renderForEntity(entity, text, uiRect);
                const sprite = world.get(entity, Sprite);
                sprite.texture = result.textureHandle;
                sprite.size = { x: result.width, y: result.height };
                sprite.uvOffset = { x: 0, y: 0 };
                sprite.uvScale = { x: 1, y: 1 };
                world.insert(entity, Sprite, sprite);
                text.dirty = false;
            }
        }));
    }
}
const textPlugin = new TextPlugin();

/**
 * @file    blend.ts
 * @brief   Blend mode definitions for rendering
 */
var BlendMode;
(function (BlendMode) {
    BlendMode[BlendMode["Normal"] = 0] = "Normal";
    BlendMode[BlendMode["Additive"] = 1] = "Additive";
    BlendMode[BlendMode["Multiply"] = 2] = "Multiply";
    BlendMode[BlendMode["Screen"] = 3] = "Screen";
    BlendMode[BlendMode["PremultipliedAlpha"] = 4] = "PremultipliedAlpha";
})(BlendMode || (BlendMode = {}));

/**
 * @file    material.ts
 * @brief   Material and Shader API for custom rendering
 * @details Provides shader creation and material management for custom visual effects.
 */
// =============================================================================
// Internal State
// =============================================================================
let module$5 = null;
let resourceManager = null;
let nextMaterialId = 1;
const materials = new Map();
// =============================================================================
// Initialization
// =============================================================================
function initMaterialAPI(wasmModule) {
    module$5 = wasmModule;
    resourceManager = wasmModule.getResourceManager();
    registerMaterialCallback();
}
function shutdownMaterialAPI() {
    if (uniformBuffer$1 !== 0 && module$5) {
        module$5._free(uniformBuffer$1);
        uniformBuffer$1 = 0;
    }
    materials.clear();
    nextMaterialId = 1;
    materialCallbackRegistered = false;
    resourceManager = null;
    module$5 = null;
}
// =============================================================================
// Shader API
// =============================================================================
function getResourceManager() {
    if (!resourceManager) {
        throw new Error('Material API not initialized. Call initMaterialAPI() first.');
    }
    return resourceManager;
}
const Material = {
    /**
     * Creates a shader from vertex and fragment source code.
     * @param vertexSrc GLSL vertex shader source
     * @param fragmentSrc GLSL fragment shader source
     * @returns Shader handle, or 0 on failure
     */
    createShader(vertexSrc, fragmentSrc) {
        return getResourceManager().createShader(vertexSrc, fragmentSrc);
    },
    /**
     * Releases a shader.
     * @param shader Shader handle to release
     */
    releaseShader(shader) {
        if (shader > 0) {
            getResourceManager().releaseShader(shader);
        }
    },
    /**
     * Creates a material with a shader and optional settings.
     * @param options Material creation options
     * @returns Material handle
     */
    create(options) {
        const handle = nextMaterialId++;
        const data = {
            shader: options.shader,
            uniforms: new Map(),
            blendMode: options.blendMode ?? BlendMode.Normal,
            depthTest: options.depthTest ?? false,
        };
        if (options.uniforms) {
            for (const [key, value] of Object.entries(options.uniforms)) {
                data.uniforms.set(key, value);
            }
        }
        materials.set(handle, data);
        return handle;
    },
    /**
     * Gets material data by handle.
     * @param material Material handle
     * @returns Material data or undefined
     */
    get(material) {
        return materials.get(material);
    },
    /**
     * Sets a uniform value on a material.
     * @param material Material handle
     * @param name Uniform name
     * @param value Uniform value
     */
    setUniform(material, name, value) {
        const data = materials.get(material);
        if (data) {
            data.uniforms.set(name, value);
        }
    },
    /**
     * Gets a uniform value from a material.
     * @param material Material handle
     * @param name Uniform name
     * @returns Uniform value or undefined
     */
    getUniform(material, name) {
        const data = materials.get(material);
        return data?.uniforms.get(name);
    },
    /**
     * Sets the blend mode for a material.
     * @param material Material handle
     * @param mode Blend mode
     */
    setBlendMode(material, mode) {
        const data = materials.get(material);
        if (data) {
            data.blendMode = mode;
        }
    },
    /**
     * Gets the blend mode of a material.
     * @param material Material handle
     * @returns Blend mode
     */
    getBlendMode(material) {
        const data = materials.get(material);
        return data?.blendMode ?? BlendMode.Normal;
    },
    /**
     * Sets depth test enabled for a material.
     * @param material Material handle
     * @param enabled Whether depth test is enabled
     */
    setDepthTest(material, enabled) {
        const data = materials.get(material);
        if (data) {
            data.depthTest = enabled;
        }
    },
    /**
     * Gets the shader handle for a material.
     * @param material Material handle
     * @returns Shader handle
     */
    getShader(material) {
        const data = materials.get(material);
        return data?.shader ?? 0;
    },
    /**
     * Releases a material (does not release the shader).
     * @param material Material handle
     */
    release(material) {
        materials.delete(material);
    },
    /**
     * Checks if a material exists.
     * @param material Material handle
     * @returns True if material exists
     */
    isValid(material) {
        return materials.has(material);
    },
    /**
     * Creates a material from asset data.
     * @param data Material asset data (properties object)
     * @param shaderHandle Pre-loaded shader handle
     * @returns Material handle
     */
    createFromAsset(data, shaderHandle) {
        const uniforms = {};
        for (const [key, value] of Object.entries(data.properties)) {
            if (typeof value === 'number') {
                uniforms[key] = value;
            }
            else if (typeof value === 'object' && value !== null) {
                const obj = value;
                if ('w' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0, w: obj.w ?? 0 };
                }
                else if ('z' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0 };
                }
                else if ('y' in obj) {
                    uniforms[key] = { x: obj.x ?? 0, y: obj.y ?? 0 };
                }
            }
        }
        return this.create({
            shader: shaderHandle,
            uniforms,
            blendMode: data.blendMode ?? BlendMode.Normal,
            depthTest: data.depthTest ?? false,
        });
    },
    /**
     * Creates a material instance that shares the shader with source.
     * @param source Source material handle
     * @returns New material handle with copied settings
     */
    createInstance(source) {
        const sourceData = materials.get(source);
        if (!sourceData) {
            throw new Error(`Invalid source material: ${source}`);
        }
        const handle = nextMaterialId++;
        const data = {
            shader: sourceData.shader,
            uniforms: new Map(sourceData.uniforms),
            blendMode: sourceData.blendMode,
            depthTest: sourceData.depthTest,
        };
        materials.set(handle, data);
        return handle;
    },
    /**
     * Exports material to serializable asset data.
     * @param material Material handle
     * @param shaderPath Shader file path for asset reference
     * @returns Material asset data
     */
    toAssetData(material, shaderPath) {
        const data = materials.get(material);
        if (!data)
            return null;
        const properties = {};
        for (const [key, value] of data.uniforms) {
            properties[key] = value;
        }
        return {
            version: '1.0',
            type: 'material',
            shader: shaderPath,
            blendMode: data.blendMode,
            depthTest: data.depthTest,
            properties,
        };
    },
    /**
     * Gets all uniforms from a material.
     * @param material Material handle
     * @returns Map of uniform names to values
     */
    getUniforms(material) {
        const data = materials.get(material);
        return data ? new Map(data.uniforms) : new Map();
    },
};
// =============================================================================
// Material Callback Registration
// =============================================================================
let materialCallbackRegistered = false;
let uniformBuffer$1 = 0;
const UNIFORM_BUFFER_SIZE = 4096;
function ensureUniformBuffer() {
    if (uniformBuffer$1 === 0 && module$5) {
        uniformBuffer$1 = module$5._malloc(UNIFORM_BUFFER_SIZE);
    }
    return uniformBuffer$1;
}
function serializeUniforms(uniforms) {
    const bufferPtr = ensureUniformBuffer();
    if (bufferPtr === 0 || !module$5)
        return { ptr: 0, count: 0 };
    let offset = 0;
    let count = 0;
    const heap8 = module$5.HEAPU8;
    const heap32 = module$5.HEAPU32;
    const heapF32 = module$5.HEAPF32;
    for (const [name, value] of uniforms) {
        if (offset + 128 > UNIFORM_BUFFER_SIZE)
            break;
        const nameBytes = new TextEncoder().encode(name);
        const nameLen = nameBytes.length;
        const namePadded = Math.ceil(nameLen / 4) * 4;
        heap32[(bufferPtr + offset) >> 2] = nameLen;
        offset += 4;
        heap8.set(nameBytes, bufferPtr + offset);
        offset += namePadded;
        let type = 0;
        let values = [0, 0, 0, 0];
        if (typeof value === 'number') {
            type = 0;
            values[0] = value;
        }
        else if (Array.isArray(value)) {
            type = Math.min(value.length - 1, 3);
            for (let i = 0; i < Math.min(value.length, 4); i++) {
                values[i] = value[i];
            }
        }
        else if ('w' in value) {
            type = 3;
            values = [value.x, value.y, value.z, value.w];
        }
        else if ('z' in value) {
            type = 2;
            values = [value.x, value.y, value.z, 0];
        }
        else if ('y' in value) {
            type = 1;
            values = [value.x, value.y, 0, 0];
        }
        heap32[(bufferPtr + offset) >> 2] = type;
        offset += 4;
        for (let i = 0; i < 4; i++) {
            heapF32[(bufferPtr + offset) >> 2] = values[i];
            offset += 4;
        }
        count++;
    }
    return { ptr: bufferPtr, count };
}
function registerMaterialCallback() {
    if (!module$5 || materialCallbackRegistered)
        return;
    if (!module$5.addFunction || !module$5.setMaterialCallback) {
        console.warn('[Material] Callback registration not available (requires -sALLOW_TABLE_GROWTH)');
        return;
    }
    const callback = (materialId, outShaderIdPtr, outBlendModePtr, outUniformBufferPtr, outUniformCountPtr) => {
        const data = materials.get(materialId);
        if (!data) {
            module$5.HEAPU32[outShaderIdPtr >> 2] = 0;
            module$5.HEAPU32[outBlendModePtr >> 2] = 0;
            module$5.HEAPU32[outUniformBufferPtr >> 2] = 0;
            module$5.HEAPU32[outUniformCountPtr >> 2] = 0;
            return;
        }
        module$5.HEAPU32[outShaderIdPtr >> 2] = data.shader;
        module$5.HEAPU32[outBlendModePtr >> 2] = data.blendMode;
        const { ptr, count } = serializeUniforms(data.uniforms);
        module$5.HEAPU32[outUniformBufferPtr >> 2] = ptr;
        module$5.HEAPU32[outUniformCountPtr >> 2] = count;
    };
    const callbackPtr = module$5.addFunction(callback, 'viiiii');
    module$5.setMaterialCallback(callbackPtr);
    materialCallbackRegistered = true;
}
// =============================================================================
// Built-in Shader Sources
// =============================================================================
const ShaderSources = {
    SPRITE_VERTEX: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;

uniform mat4 u_projection;
uniform mat4 u_model;

out vec4 v_color;
out vec2 v_texCoord;

void main() {
    v_color = a_color;
    v_texCoord = a_texCoord;
    gl_Position = u_projection * u_model * vec4(a_position, 1.0);
}
`,
    SPRITE_FRAGMENT: `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_texture;

out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord) * v_color;
}
`,
    COLOR_VERTEX: `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;

uniform mat4 u_projection;
uniform mat4 u_model;

out vec4 v_color;

void main() {
    v_color = a_color;
    gl_Position = u_projection * u_model * vec4(a_position, 1.0);
}
`,
    COLOR_FRAGMENT: `#version 300 es
precision highp float;

in vec4 v_color;

out vec4 fragColor;

void main() {
    fragColor = v_color;
}
`,
};

/**
 * @file    draw.ts
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple drawing primitives (lines, rectangles, circles)
 *          with automatic batching. All draw commands are cleared each frame.
 */
// =============================================================================
// Internal State
// =============================================================================
let module$4 = null;
let viewProjectionPtr$1 = 0;
let transformPtr = 0;
let uniformsPtr = 0;
const UNIFORMS_BUFFER_SIZE = 256;
const uniformBuffer = new Float32Array(UNIFORMS_BUFFER_SIZE);
// =============================================================================
// Initialization
// =============================================================================
function initDrawAPI(wasmModule) {
    module$4 = wasmModule;
    viewProjectionPtr$1 = module$4._malloc(16 * 4);
    transformPtr = module$4._malloc(16 * 4);
    uniformsPtr = module$4._malloc(UNIFORMS_BUFFER_SIZE * 4);
}
function shutdownDrawAPI() {
    if (module$4) {
        if (viewProjectionPtr$1) {
            module$4._free(viewProjectionPtr$1);
            viewProjectionPtr$1 = 0;
        }
        if (transformPtr) {
            module$4._free(transformPtr);
            transformPtr = 0;
        }
        if (uniformsPtr) {
            module$4._free(uniformsPtr);
            uniformsPtr = 0;
        }
    }
    module$4 = null;
}
// =============================================================================
// Draw Implementation
// =============================================================================
function getModule$2() {
    if (!module$4) {
        throw new Error('Draw API not initialized. Call initDrawAPI() first.');
    }
    return module$4;
}
const WHITE = { x: 1, y: 1, z: 1, w: 1 };
const Draw = {
    begin(viewProjection) {
        const m = getModule$2();
        m.HEAPF32.set(viewProjection, viewProjectionPtr$1 / 4);
        m.draw_begin(viewProjectionPtr$1);
    },
    end() {
        getModule$2().draw_end();
    },
    line(from, to, color, thickness = 1) {
        getModule$2().draw_line(from.x, from.y, to.x, to.y, color.x, color.y, color.z, color.w, thickness);
    },
    rect(position, size, color, filled = true) {
        getModule$2().draw_rect(position.x, position.y, size.x, size.y, color.x, color.y, color.z, color.w, filled);
    },
    rectOutline(position, size, color, thickness = 1) {
        getModule$2().draw_rectOutline(position.x, position.y, size.x, size.y, color.x, color.y, color.z, color.w, thickness);
    },
    circle(center, radius, color, filled = true, segments = 32) {
        getModule$2().draw_circle(center.x, center.y, radius, color.x, color.y, color.z, color.w, filled, segments);
    },
    circleOutline(center, radius, color, thickness = 1, segments = 32) {
        getModule$2().draw_circleOutline(center.x, center.y, radius, color.x, color.y, color.z, color.w, thickness, segments);
    },
    texture(position, size, textureHandle, tint = WHITE) {
        getModule$2().draw_texture(position.x, position.y, size.x, size.y, textureHandle, tint.x, tint.y, tint.z, tint.w);
    },
    textureRotated(position, size, rotation, textureHandle, tint = WHITE) {
        getModule$2().draw_textureRotated(position.x, position.y, size.x, size.y, rotation, textureHandle, tint.x, tint.y, tint.z, tint.w);
    },
    setLayer(layer) {
        getModule$2().draw_setLayer(layer);
    },
    setDepth(depth) {
        getModule$2().draw_setDepth(depth);
    },
    getDrawCallCount() {
        if (!module$4)
            return 0;
        return module$4.draw_getDrawCallCount();
    },
    getPrimitiveCount() {
        if (!module$4)
            return 0;
        return module$4.draw_getPrimitiveCount();
    },
    setBlendMode(mode) {
        getModule$2().draw_setBlendMode(mode);
    },
    setDepthTest(enabled) {
        getModule$2().draw_setDepthTest(enabled);
    },
    drawMesh(geometry, shader, transform) {
        const m = getModule$2();
        m.HEAPF32.set(transform, transformPtr / 4);
        m.draw_mesh(geometry, shader, transformPtr);
    },
    drawMeshWithMaterial(geometry, material, transform) {
        const m = getModule$2();
        const matData = Material.get(material);
        if (!matData)
            return;
        Draw.setBlendMode(matData.blendMode);
        Draw.setDepthTest(matData.depthTest);
        if (matData.uniforms.size === 0) {
            Draw.drawMesh(geometry, matData.shader, transform);
            return;
        }
        m.HEAPF32.set(transform, transformPtr / 4);
        let idx = 0;
        for (const [name, value] of matData.uniforms) {
            const nameId = getUniformNameId(name);
            if (nameId < 0)
                continue;
            if (typeof value === 'number') {
                uniformBuffer[idx++] = 1;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value;
            }
            else if (Array.isArray(value)) {
                uniformBuffer[idx++] = value.length;
                uniformBuffer[idx++] = nameId;
                for (let i = 0; i < value.length; i++) {
                    uniformBuffer[idx++] = value[i];
                }
            }
            else if ('w' in value) {
                uniformBuffer[idx++] = 4;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
                uniformBuffer[idx++] = value.z;
                uniformBuffer[idx++] = value.w;
            }
            else if ('z' in value) {
                uniformBuffer[idx++] = 3;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
                uniformBuffer[idx++] = value.z;
            }
            else {
                uniformBuffer[idx++] = 2;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
            }
            if (idx > UNIFORMS_BUFFER_SIZE - 6) {
                console.warn('Uniform buffer overflow, some uniforms will be ignored');
                break;
            }
        }
        if (idx === 0) {
            m.draw_mesh(geometry, matData.shader, transformPtr);
            return;
        }
        m.HEAPF32.set(uniformBuffer.subarray(0, idx), uniformsPtr / 4);
        m.draw_meshWithUniforms(geometry, matData.shader, transformPtr, uniformsPtr, idx);
    },
};
const UNIFORM_NAME_MAP = {
    'u_time': 0,
    'u_color': 1,
    'u_intensity': 2,
    'u_scale': 3,
    'u_offset': 4,
    'u_param0': 5,
    'u_param1': 6,
    'u_param2': 7,
    'u_param3': 8,
    'u_param4': 9,
    'u_vec0': 10,
    'u_vec1': 11,
    'u_vec2': 12,
    'u_vec3': 13,
    'u_texture0': 14,
    'u_texture1': 15,
    'u_texture2': 16,
    'u_texture3': 17,
};
function getUniformNameId(name) {
    return UNIFORM_NAME_MAP[name] ?? -1;
}

/**
 * @file    geometry.ts
 * @brief   Geometry API for custom mesh rendering
 * @details Provides geometry creation and management for custom shapes,
 *          particles, trails, and other procedural meshes.
 */
var DataType;
(function (DataType) {
    DataType[DataType["Float"] = 1] = "Float";
    DataType[DataType["Float2"] = 2] = "Float2";
    DataType[DataType["Float3"] = 3] = "Float3";
    DataType[DataType["Float4"] = 4] = "Float4";
    DataType[DataType["Int"] = 5] = "Int";
    DataType[DataType["Int2"] = 6] = "Int2";
    DataType[DataType["Int3"] = 7] = "Int3";
    DataType[DataType["Int4"] = 8] = "Int4";
})(DataType || (DataType = {}));
// =============================================================================
// Internal State
// =============================================================================
let module$3 = null;
let vertexPtr = 0;
let indexPtr = 0;
let layoutPtr = 0;
const VERTEX_BUFFER_SIZE = 64 * 1024;
const INDEX_BUFFER_SIZE = 16 * 1024;
const LAYOUT_BUFFER_SIZE = 64;
// =============================================================================
// Initialization
// =============================================================================
function initGeometryAPI(wasmModule) {
    module$3 = wasmModule;
    vertexPtr = module$3._malloc(VERTEX_BUFFER_SIZE * 4);
    indexPtr = module$3._malloc(INDEX_BUFFER_SIZE * 4);
    layoutPtr = module$3._malloc(LAYOUT_BUFFER_SIZE * 4);
}
function shutdownGeometryAPI() {
    if (module$3) {
        if (vertexPtr)
            module$3._free(vertexPtr);
        if (indexPtr)
            module$3._free(indexPtr);
        if (layoutPtr)
            module$3._free(layoutPtr);
        vertexPtr = 0;
        indexPtr = 0;
        layoutPtr = 0;
    }
    module$3 = null;
}
// =============================================================================
// Geometry API
// =============================================================================
function getModule$1() {
    if (!module$3) {
        throw new Error('Geometry API not initialized. Call initGeometryAPI() first.');
    }
    return module$3;
}
const Geometry = {
    /**
     * Creates a new geometry with vertices and optional indices.
     * @param options Geometry creation options
     * @returns Geometry handle
     */
    create(options) {
        const m = getModule$1();
        const handle = m.geometry_create();
        if (handle === 0) {
            throw new Error('Failed to create geometry');
        }
        const vertexCount = options.vertices.length;
        if (vertexCount * 4 > VERTEX_BUFFER_SIZE * 4) {
            throw new Error(`Vertex data too large: ${vertexCount} floats (max ${VERTEX_BUFFER_SIZE})`);
        }
        m.HEAPF32.set(options.vertices, vertexPtr / 4);
        const layoutCount = options.layout.length;
        const layoutArray = new Int32Array(layoutCount);
        for (let i = 0; i < layoutCount; i++) {
            layoutArray[i] = options.layout[i].type;
        }
        const heap32 = new Int32Array(m.HEAPU8.buffer, layoutPtr, layoutCount);
        heap32.set(layoutArray);
        m.geometry_init(handle, vertexPtr, vertexCount, layoutPtr, layoutCount, options.dynamic ?? false);
        if (options.indices) {
            const indexCount = options.indices.length;
            if (indexCount * 4 > INDEX_BUFFER_SIZE * 4) {
                throw new Error(`Index data too large: ${indexCount} indices (max ${INDEX_BUFFER_SIZE})`);
            }
            if (options.indices instanceof Uint16Array) {
                const heap16 = new Uint16Array(m.HEAPU8.buffer, indexPtr, indexCount);
                heap16.set(options.indices);
                m.geometry_setIndices16(handle, indexPtr, indexCount);
            }
            else {
                const heap32 = new Uint32Array(m.HEAPU8.buffer, indexPtr, indexCount);
                heap32.set(options.indices);
                m.geometry_setIndices32(handle, indexPtr, indexCount);
            }
        }
        return handle;
    },
    /**
     * Updates vertices of a dynamic geometry.
     * @param handle Geometry handle
     * @param vertices New vertex data
     * @param offset Offset in floats
     */
    updateVertices(handle, vertices, offset = 0) {
        const m = getModule$1();
        const vertexCount = vertices.length;
        if (vertexCount * 4 > VERTEX_BUFFER_SIZE * 4) {
            throw new Error(`Vertex data too large: ${vertexCount} floats (max ${VERTEX_BUFFER_SIZE})`);
        }
        m.HEAPF32.set(vertices, vertexPtr / 4);
        m.geometry_updateVertices(handle, vertexPtr, vertexCount, offset);
    },
    /**
     * Releases a geometry.
     * @param handle Geometry handle
     */
    release(handle) {
        if (handle > 0) {
            getModule$1().geometry_release(handle);
        }
    },
    /**
     * Checks if a geometry handle is valid.
     * @param handle Geometry handle
     * @returns True if valid
     */
    isValid(handle) {
        if (!module$3 || handle <= 0)
            return false;
        return module$3.geometry_isValid(handle);
    },
    // =========================================================================
    // Helper Functions
    // =========================================================================
    /**
     * Creates a unit quad geometry (1x1, centered at origin).
     * @returns Geometry handle
     */
    createQuad(width = 1, height = 1) {
        const hw = width / 2;
        const hh = height / 2;
        return Geometry.create({
            vertices: new Float32Array([
                // x, y, u, v
                -hw, -hh, 0, 0,
                hw, -hh, 1, 0,
                hw, hh, 1, 1,
                -hw, hh, 0, 1,
            ]),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array([0, 1, 2, 2, 3, 0]),
        });
    },
    /**
     * Creates a circle geometry.
     * @param radius Circle radius
     * @param segments Number of segments
     * @returns Geometry handle
     */
    createCircle(radius = 1, segments = 32) {
        const vertices = [];
        const indices = [];
        vertices.push(0, 0, 0.5, 0.5);
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const u = (Math.cos(angle) + 1) / 2;
            const v = (Math.sin(angle) + 1) / 2;
            vertices.push(x, y, u, v);
        }
        for (let i = 1; i <= segments; i++) {
            indices.push(0, i, i + 1);
        }
        return Geometry.create({
            vertices: new Float32Array(vertices),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array(indices),
        });
    },
    /**
     * Creates a polygon geometry from vertices.
     * @param points Array of {x, y} points
     * @returns Geometry handle
     */
    createPolygon(points) {
        if (points.length < 3) {
            throw new Error('Polygon must have at least 3 points');
        }
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        const vertices = [];
        for (const p of points) {
            const u = (p.x - minX) / (maxX - minX);
            const v = (p.y - minY) / (maxY - minY);
            vertices.push(p.x, p.y, u, v);
        }
        const indices = [];
        for (let i = 1; i < points.length - 1; i++) {
            indices.push(0, i, i + 1);
        }
        return Geometry.create({
            vertices: new Float32Array(vertices),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array(indices),
        });
    },
};

/**
 * @file    postprocess.ts
 * @brief   Post-processing effects API
 * @details Provides full-screen post-processing effects like blur, vignette, etc.
 */
// =============================================================================
// Internal State
// =============================================================================
let module$2 = null;
// =============================================================================
// Initialization
// =============================================================================
function initPostProcessAPI(wasmModule) {
    module$2 = wasmModule;
}
function shutdownPostProcessAPI() {
    if (module$2 && PostProcess.isInitialized()) {
        PostProcess.shutdown();
    }
    module$2 = null;
}
// =============================================================================
// PostProcess API
// =============================================================================
function getModule() {
    if (!module$2) {
        throw new Error('PostProcess API not initialized. Call initPostProcessAPI() first.');
    }
    return module$2;
}
const PostProcess = {
    /**
     * Initializes the post-processing pipeline.
     * @param width Framebuffer width
     * @param height Framebuffer height
     * @returns True on success
     */
    init(width, height) {
        return getModule().postprocess_init(width, height);
    },
    /**
     * Shuts down the post-processing pipeline.
     */
    shutdown() {
        getModule().postprocess_shutdown();
    },
    /**
     * Resizes the framebuffers.
     * @param width New width
     * @param height New height
     */
    resize(width, height) {
        getModule().postprocess_resize(width, height);
    },
    /**
     * Adds a post-processing pass.
     * @param name Unique name for the pass
     * @param shader Shader handle
     * @returns Pass index
     */
    addPass(name, shader) {
        return getModule().postprocess_addPass(name, shader);
    },
    /**
     * Removes a pass by name.
     * @param name Pass name
     */
    removePass(name) {
        getModule().postprocess_removePass(name);
    },
    /**
     * Enables or disables a pass.
     * @param name Pass name
     * @param enabled Whether to enable the pass
     */
    setEnabled(name, enabled) {
        getModule().postprocess_setPassEnabled(name, enabled);
    },
    /**
     * Checks if a pass is enabled.
     * @param name Pass name
     * @returns True if enabled
     */
    isEnabled(name) {
        return getModule().postprocess_isPassEnabled(name);
    },
    /**
     * Sets a float uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Float value
     */
    setUniform(passName, uniform, value) {
        getModule().postprocess_setUniformFloat(passName, uniform, value);
    },
    /**
     * Sets a vec4 uniform on a pass.
     * @param passName Pass name
     * @param uniform Uniform name
     * @param value Vec4 value
     */
    setUniformVec4(passName, uniform, value) {
        getModule().postprocess_setUniformVec4(passName, uniform, value.x, value.y, value.z, value.w);
    },
    /**
     * Begins rendering to the post-process pipeline.
     * Call this before rendering your scene.
     */
    begin() {
        getModule().postprocess_begin();
    },
    /**
     * Ends and processes all passes.
     * Call this after rendering your scene.
     */
    end() {
        getModule().postprocess_end();
    },
    /**
     * Gets the number of passes.
     */
    getPassCount() {
        return getModule().postprocess_getPassCount();
    },
    /**
     * Checks if the pipeline is initialized.
     */
    isInitialized() {
        if (!module$2)
            return false;
        return module$2.postprocess_isInitialized();
    },
    /**
     * Sets bypass mode to skip FBO rendering entirely.
     * When bypassed, begin()/end() become no-ops and scene renders directly to screen.
     * Use this when no post-processing passes are needed for maximum performance.
     * @param bypass Whether to bypass the pipeline
     */
    setBypass(bypass) {
        getModule().postprocess_setBypass(bypass);
    },
    /**
     * Checks if bypass mode is enabled.
     * @returns True if bypassed
     */
    isBypassed() {
        if (!module$2)
            return true;
        return module$2.postprocess_isBypassed();
    },
    // =========================================================================
    // Built-in Effects
    // =========================================================================
    /**
     * Creates a blur effect shader.
     * @returns Shader handle
     */
    createBlur() {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float offset = u_intensity;

    vec4 color = vec4(0.0);
    color += texture(u_texture, v_texCoord + vec2(-offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,   -offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2(-offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord)                                     * 0.25;
    color += texture(u_texture, v_texCoord + vec2( offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2(-offset,  offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,    offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset,  offset) * texelSize) * 0.0625;

    fragColor = color;
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },
    /**
     * Creates a vignette effect shader.
     * @returns Shader handle
     */
    createVignette() {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_intensity;
uniform float u_softness;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);
    float vignette = smoothstep(u_intensity, u_intensity - u_softness, dist);
    fragColor = vec4(color.rgb * vignette, color.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },
    /**
     * Creates a grayscale effect shader.
     * @returns Shader handle
     */
    createGrayscale() {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },
    /**
     * Creates a chromatic aberration effect shader.
     * @returns Shader handle
     */
    createChromaticAberration() {
        const fragmentSrc = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_intensity;
out vec4 fragColor;

void main() {
    vec2 offset = u_intensity / u_resolution;
    float r = texture(u_texture, v_texCoord + offset).r;
    float g = texture(u_texture, v_texCoord).g;
    float b = texture(u_texture, v_texCoord - offset).b;
    float a = texture(u_texture, v_texCoord).a;
    fragColor = vec4(r, g, b, a);
}
`;
        return Material.createShader(POSTPROCESS_VERTEX, fragmentSrc);
    },
};
// =============================================================================
// Shared Vertex Shader
// =============================================================================
const POSTPROCESS_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

var RenderStage;
(function (RenderStage) {
    RenderStage[RenderStage["Background"] = 0] = "Background";
    RenderStage[RenderStage["Opaque"] = 1] = "Opaque";
    RenderStage[RenderStage["Transparent"] = 2] = "Transparent";
    RenderStage[RenderStage["Overlay"] = 3] = "Overlay";
})(RenderStage || (RenderStage = {}));
let module$1 = null;
let viewProjectionPtr = 0;
function initRendererAPI(wasmModule) {
    module$1 = wasmModule;
    viewProjectionPtr = module$1._malloc(16 * 4);
}
function shutdownRendererAPI() {
    if (module$1 && viewProjectionPtr) {
        module$1._free(viewProjectionPtr);
        viewProjectionPtr = 0;
    }
    module$1 = null;
}
const Renderer = {
    init(width, height) {
        module$1?.renderer_init(width, height);
    },
    resize(width, height) {
        module$1?.renderer_resize(width, height);
    },
    begin(viewProjection, target) {
        if (!module$1 || !viewProjectionPtr)
            return;
        module$1.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
        module$1.renderer_begin(viewProjectionPtr, target ?? 0);
    },
    end() {
        module$1?.renderer_end();
    },
    submitSprites(registry) {
        if (!module$1)
            return;
        module$1.renderer_submitSprites(registry._cpp);
    },
    submitSpine(registry) {
        if (!module$1)
            return;
        module$1.renderer_submitSpine(registry._cpp);
    },
    setStage(stage) {
        module$1?.renderer_setStage(stage);
    },
    createRenderTarget(width, height) {
        return module$1?.renderer_createTarget(width, height) ?? 0;
    },
    releaseRenderTarget(handle) {
        module$1?.renderer_releaseTarget(handle);
    },
    getTargetTexture(handle) {
        return module$1?.renderer_getTargetTexture(handle) ?? 0;
    },
    setClearColor(r, g, b, a) {
        module$1?.renderer_setClearColor?.(r, g, b, a);
    },
    getStats() {
        if (!module$1) {
            return { drawCalls: 0, triangles: 0, sprites: 0, spine: 0, meshes: 0, culled: 0 };
        }
        return {
            drawCalls: module$1.renderer_getDrawCalls(),
            triangles: module$1.renderer_getTriangles(),
            sprites: module$1.renderer_getSprites(),
            spine: module$1.renderer_getSpine(),
            meshes: module$1.renderer_getMeshes(),
            culled: module$1.renderer_getCulled(),
        };
    },
};

/**
 * @file    customDraw.ts
 * @brief   Custom draw callback registration for the render pipeline
 */
const callbacks = new Map();
function registerDrawCallback(id, fn) {
    callbacks.set(id, fn);
}
function unregisterDrawCallback(id) {
    callbacks.delete(id);
}
function clearDrawCallbacks() {
    callbacks.clear();
}
function getDrawCallbacks() {
    return callbacks;
}

/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */
class RenderPipeline {
    render(params) {
        const { registry, viewProjection, width, height, elapsed } = params;
        Renderer.resize(width, height);
        const usePostProcess = PostProcess.isInitialized()
            && PostProcess.getPassCount() > 0
            && !PostProcess.isBypassed();
        if (usePostProcess) {
            PostProcess.resize(width, height);
            PostProcess.begin();
        }
        Renderer.begin(viewProjection);
        Renderer.submitSprites(registry);
        Renderer.submitSpine(registry);
        Renderer.end();
        const cbs = getDrawCallbacks();
        if (cbs.size > 0) {
            Draw.begin(viewProjection);
            const failed = [];
            for (const [id, fn] of cbs.entries()) {
                try {
                    fn(elapsed);
                }
                catch (e) {
                    console.error(`[CustomDraw] callback '${id}' error:`, e);
                    failed.push(id);
                }
            }
            Draw.end();
            for (const id of failed) {
                unregisterDrawCallback(id);
            }
        }
        if (usePostProcess) {
            PostProcess.end();
        }
    }
}

/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */
// =============================================================================
// App
// =============================================================================
class App {
    constructor() {
        this.systems_ = new Map();
        this.runner_ = null;
        this.running_ = false;
        this.lastTime_ = 0;
        this.module_ = null;
        this.mainLoop = () => {
            if (!this.running_) {
                return;
            }
            const now = performance.now();
            const deltaMs = now - this.lastTime_;
            this.lastTime_ = now;
            const delta = deltaMs / 1000;
            this.updateTime(delta);
            this.runSchedule(Schedule.First);
            this.runSchedule(Schedule.PreUpdate);
            this.runSchedule(Schedule.Update);
            this.runSchedule(Schedule.PostUpdate);
            this.runSchedule(Schedule.Last);
            requestAnimationFrame(this.mainLoop);
        };
        this.world_ = new World();
        this.resources_ = new ResourceStorage();
        for (const s of Object.values(Schedule)) {
            if (typeof s === 'number') {
                this.systems_.set(s, []);
            }
        }
    }
    static new() {
        return new App();
    }
    // =========================================================================
    // Plugins
    // =========================================================================
    addPlugin(plugin) {
        plugin.build(this);
        return this;
    }
    // =========================================================================
    // Systems
    // =========================================================================
    addSystemToSchedule(schedule, system) {
        this.systems_.get(schedule).push({ system });
        return this;
    }
    addSystem(system) {
        return this.addSystemToSchedule(Schedule.Update, system);
    }
    addStartupSystem(system) {
        return this.addSystemToSchedule(Schedule.Startup, system);
    }
    // =========================================================================
    // C++ Integration
    // =========================================================================
    connectCpp(cppRegistry, module) {
        this.world_.connectCpp(cppRegistry);
        if (module) {
            this.module_ = module;
        }
        return this;
    }
    get wasmModule() {
        return this.module_;
    }
    // =========================================================================
    // World Access
    // =========================================================================
    get world() {
        return this.world_;
    }
    // =========================================================================
    // Resource Access
    // =========================================================================
    insertResource(resource, value) {
        this.resources_.insert(resource, value);
        return this;
    }
    getResource(resource) {
        return this.resources_.get(resource);
    }
    hasResource(resource) {
        return this.resources_.has(resource);
    }
    // =========================================================================
    // Run
    // =========================================================================
    run() {
        if (this.running_) {
            return;
        }
        this.running_ = true;
        this.runner_ = new SystemRunner(this.world_, this.resources_);
        this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0 });
        this.runSchedule(Schedule.Startup);
        this.lastTime_ = performance.now();
        this.mainLoop();
    }
    quit() {
        this.running_ = false;
        shutdownRendererAPI();
        shutdownPostProcessAPI();
        shutdownGeometryAPI();
        shutdownMaterialAPI();
        shutdownDrawAPI();
    }
    // =========================================================================
    // Internal
    // =========================================================================
    runSchedule(schedule) {
        const systems = this.systems_.get(schedule);
        if (!systems || !this.runner_) {
            return;
        }
        for (const entry of systems) {
            this.runner_.run(entry.system);
        }
    }
    updateTime(delta) {
        const time = this.resources_.get(Time);
        const newTime = {
            delta,
            elapsed: time.elapsed + delta,
            frameCount: time.frameCount + 1
        };
        this.resources_.set(Time, newTime);
    }
}
function createWebApp(module, options) {
    const app = App.new();
    const cppRegistry = new module.Registry();
    app.connectCpp(cppRegistry, module);
    if (options?.glContextHandle) {
        module.initRendererWithContext(options.glContextHandle);
    }
    else {
        module.initRenderer();
    }
    initDrawAPI(module);
    initMaterialAPI(module);
    initGeometryAPI(module);
    initPostProcessAPI(module);
    initRendererAPI(module);
    const pipeline = new RenderPipeline();
    let startTime = performance.now();
    const getViewportSize = options?.getViewportSize ?? (() => ({
        width: window.innerWidth * (window.devicePixelRatio || 1),
        height: window.innerHeight * (window.devicePixelRatio || 1)
    }));
    const renderSystem = {
        _id: Symbol('RenderSystem'),
        _name: 'RenderSystem',
        _params: [],
        _fn: () => {
            const { width, height } = getViewportSize();
            const vp = computeViewProjection(cppRegistry, width, height);
            const elapsed = (performance.now() - startTime) / 1000;
            pipeline.render({
                registry: { _cpp: cppRegistry },
                viewProjection: vp,
                width, height, elapsed,
            });
        }
    };
    app.addSystemToSchedule(Schedule.Last, renderSystem);
    app.addPlugin(textPlugin);
    return app;
}
// =============================================================================
// View-Projection Computation
// =============================================================================
const IDENTITY = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);
function computeViewProjection(registry, width, height) {
    const count = registry.entityCount();
    const scanLimit = count + 1000;
    for (let e = 0; e < scanLimit; e++) {
        if (!registry.valid(e) || !registry.hasCamera(e) || !registry.hasLocalTransform(e)) {
            continue;
        }
        const camera = registry.getCamera(e);
        if (!camera.isActive)
            continue;
        const transform = registry.getLocalTransform(e);
        const aspect = width / height;
        let projection;
        if (camera.projectionType === 1) {
            const halfH = camera.orthoSize;
            const halfW = halfH * aspect;
            projection = ortho(-halfW, halfW, -halfH, halfH, camera.nearPlane, camera.farPlane);
        }
        else {
            projection = perspective(camera.fov * Math.PI / 180, aspect, camera.nearPlane, camera.farPlane);
        }
        const view = invertTranslation(transform.position.x, transform.position.y, transform.position.z);
        return multiply(projection, view);
    }
    return IDENTITY;
}
function ortho(left, right, bottom, top, near, far) {
    const m = new Float32Array(16);
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;
    m[0] = 2 / rl;
    m[5] = 2 / tb;
    m[10] = -2 / fn;
    m[12] = -(right + left) / rl;
    m[13] = -(top + bottom) / tb;
    m[14] = -(far + near) / fn;
    m[15] = 1;
    return m;
}
function perspective(fovRad, aspect, near, far) {
    const m = new Float32Array(16);
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = near - far;
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / nf;
    m[11] = -1;
    m[14] = (2 * far * near) / nf;
    return m;
}
function invertTranslation(x, y, z) {
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    m[12] = -x;
    m[13] = -y;
    m[14] = -z;
    return m;
}
function multiply(a, b) {
    const m = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            m[j * 4 + i] =
                a[0 * 4 + i] * b[j * 4 + 0] +
                    a[1 * 4 + i] * b[j * 4 + 1] +
                    a[2 * 4 + i] * b[j * 4 + 2] +
                    a[3 * 4 + i] * b[j * 4 + 3];
        }
    }
    return m;
}

/**
 * @file    MaterialLoader.ts
 * @brief   Material asset loading and caching
 */
// =============================================================================
// MaterialLoader
// =============================================================================
class MaterialLoader {
    constructor(shaderLoader, basePath = '') {
        this.cache_ = new Map();
        this.pending_ = new Map();
        this.shaderLoader_ = shaderLoader;
        this.basePath_ = basePath;
    }
    async load(path) {
        const cached = this.cache_.get(path);
        if (cached) {
            return cached;
        }
        const pending = this.pending_.get(path);
        if (pending) {
            return pending;
        }
        const promise = this.loadInternal(path);
        this.pending_.set(path, promise);
        try {
            const result = await promise;
            this.cache_.set(path, result);
            return result;
        }
        finally {
            this.pending_.delete(path);
        }
    }
    get(path) {
        return this.cache_.get(path);
    }
    has(path) {
        return this.cache_.has(path);
    }
    release(path) {
        const loaded = this.cache_.get(path);
        if (loaded) {
            Material.release(loaded.handle);
            this.cache_.delete(path);
        }
    }
    releaseAll() {
        for (const loaded of this.cache_.values()) {
            Material.release(loaded.handle);
        }
        this.cache_.clear();
    }
    async loadInternal(path) {
        const fullPath = this.resolvePath(path);
        const exists = await platformFileExists(fullPath);
        if (!exists) {
            throw new Error(`Material file not found: ${fullPath}`);
        }
        const content = await platformReadTextFile(fullPath);
        if (!content) {
            throw new Error(`Failed to read material file: ${fullPath}`);
        }
        const data = JSON.parse(content);
        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type}`);
        }
        const shaderPath = this.resolveShaderPath(path, data.shader);
        const shaderHandle = await this.shaderLoader_.load(shaderPath);
        const materialHandle = Material.createFromAsset(data, shaderHandle);
        return {
            handle: materialHandle,
            shaderHandle,
            path,
        };
    }
    resolvePath(path) {
        if (path.startsWith('/') || path.startsWith('http')) {
            return path;
        }
        return this.basePath_ ? `${this.basePath_}/${path}` : path;
    }
    resolveShaderPath(materialPath, shaderPath) {
        if (shaderPath.startsWith('/') || shaderPath.startsWith('http') || shaderPath.startsWith('assets/')) {
            return shaderPath;
        }
        const dir = materialPath.substring(0, materialPath.lastIndexOf('/'));
        return dir ? `${dir}/${shaderPath}` : shaderPath;
    }
}

/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */
// =============================================================================
// Scene Loader
// =============================================================================
function loadSceneData(world, sceneData) {
    const entityMap = new Map();
    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        for (const compData of entityData.components) {
            loadComponent(world, entity, compData);
        }
    }
    // Set parent-child relationships
    for (const entityData of sceneData.entities) {
        if (entityData.parent !== null) {
            const entity = entityMap.get(entityData.id);
            const parentEntity = entityMap.get(entityData.parent);
            if (entity !== undefined && parentEntity !== undefined) {
                world.setParent(entity, parentEntity);
            }
        }
    }
    return entityMap;
}
async function loadSceneWithAssets(world, sceneData, options) {
    const entityMap = new Map();
    const assetServer = options?.assetServer;
    const texturePathToUrl = new Map();
    for (const entityData of sceneData.entities) {
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        for (const compData of entityData.components) {
            if (compData.type === 'Sprite' && assetServer) {
                const data = compData.data;
                if (typeof data.texture === 'string' && data.texture) {
                    const texturePath = data.texture;
                    const isDataUrl = texturePath.startsWith('data:');
                    const url = isDataUrl
                        ? texturePath
                        : options?.assetBaseUrl
                            ? `${options.assetBaseUrl}/${texturePath}`
                            : `/${texturePath}`;
                    try {
                        const info = await assetServer.loadTexture(url);
                        data.texture = info.handle;
                        texturePathToUrl.set(texturePath, url);
                    }
                    catch (err) {
                        console.warn(`Failed to load texture: ${url}`, err);
                        data.texture = 0;
                    }
                }
                if (typeof data.material === 'string' && data.material) {
                    try {
                        const loaded = await assetServer.loadMaterial(data.material, options?.assetBaseUrl);
                        data.material = loaded.handle;
                    }
                    catch (err) {
                        console.warn(`Failed to load material: ${data.material}`, err);
                        data.material = 0;
                    }
                }
            }
            if (compData.type === 'SpineAnimation' && assetServer) {
                const data = compData.data;
                const skeletonPath = data.skeletonPath;
                const atlasPath = data.atlasPath;
                if (skeletonPath && atlasPath) {
                    const result = await assetServer.loadSpine(skeletonPath, atlasPath, options?.assetBaseUrl);
                    if (!result.success) {
                        console.warn(`Failed to load Spine: ${result.error}`);
                    }
                }
                if (typeof data.material === 'string' && data.material) {
                    try {
                        const loaded = await assetServer.loadMaterial(data.material, options?.assetBaseUrl);
                        data.material = loaded.handle;
                    }
                    catch (err) {
                        console.warn(`Failed to load material: ${data.material}`, err);
                        data.material = 0;
                    }
                }
            }
            loadComponent(world, entity, compData);
        }
    }
    for (const entityData of sceneData.entities) {
        if (entityData.parent !== null) {
            const entity = entityMap.get(entityData.id);
            const parentEntity = entityMap.get(entityData.parent);
            if (entity !== undefined && parentEntity !== undefined) {
                world.setParent(entity, parentEntity);
            }
        }
    }
    if (assetServer && sceneData.textureMetadata) {
        for (const [texturePath, metadata] of Object.entries(sceneData.textureMetadata)) {
            const url = texturePathToUrl.get(texturePath);
            if (url && metadata.sliceBorder) {
                assetServer.setTextureMetadataByPath(url, metadata.sliceBorder);
            }
        }
    }
    return entityMap;
}
function loadComponent(world, entity, compData) {
    const data = compData.data;
    switch (compData.type) {
        case 'LocalTransform':
            world.insert(entity, LocalTransform, data);
            break;
        case 'Sprite':
            world.insert(entity, Sprite, data);
            break;
        case 'Camera':
            world.insert(entity, Camera, data);
            break;
        case 'Canvas':
            world.insert(entity, Canvas, data);
            break;
        case 'Text':
            world.insert(entity, Text, data);
            break;
        case 'SpineAnimation':
            world.insert(entity, SpineAnimation, data);
            break;
        case 'UIRect':
            world.insert(entity, UIRect, data);
            break;
        default:
            console.warn(`Unknown component type: ${compData.type}`);
    }
}
function updateCameraAspectRatio(world, aspectRatio) {
    const cameraEntities = world.getEntitiesWithComponents([Camera]);
    for (const entity of cameraEntities) {
        const camera = world.get(entity, Camera);
        if (camera) {
            camera.aspectRatio = aspectRatio;
            world.insert(entity, Camera, camera);
        }
    }
}

class AsyncCache {
    constructor() {
        this.cache_ = new Map();
        this.pending_ = new Map();
    }
    async getOrLoad(key, loader) {
        const cached = this.cache_.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const pending = this.pending_.get(key);
        if (pending) {
            return pending;
        }
        const promise = loader();
        this.pending_.set(key, promise);
        try {
            const result = await promise;
            this.cache_.set(key, result);
            return result;
        }
        finally {
            this.pending_.delete(key);
        }
    }
    get(key) {
        return this.cache_.get(key);
    }
    has(key) {
        return this.cache_.has(key);
    }
    delete(key) {
        return this.cache_.delete(key);
    }
    clear() {
        this.cache_.clear();
    }
    values() {
        return this.cache_.values();
    }
}

/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */
// =============================================================================
// AssetServer
// =============================================================================
class AssetServer {
    constructor(module) {
        this.textureCache_ = new AsyncCache();
        this.shaderCache_ = new AsyncCache();
        this.jsonCache_ = new AsyncCache();
        this.textCache_ = new AsyncCache();
        this.binaryCache_ = new AsyncCache();
        this.loadedSpines_ = new Set();
        this.virtualFSPaths_ = new Set();
        this.module_ = module;
        this.canvas_ = this.createCanvas(512, 512);
        this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true });
        const shaderLoader = {
            load: (path) => this.loadShader(path),
            get: (path) => this.shaderCache_.get(path),
        };
        this.materialLoader_ = new MaterialLoader(shaderLoader);
    }
    // =========================================================================
    // Texture
    // =========================================================================
    /**
     * Load texture with vertical flip (for Sprite/UI).
     * OpenGL UV origin is bottom-left, so standard images need flipping.
     */
    async loadTexture(source) {
        return this.loadTextureWithFlip(source, true);
    }
    /**
     * Load texture without flip (for Spine).
     * Spine runtime handles UV coordinates internally.
     */
    async loadTextureRaw(source) {
        return this.loadTextureWithFlip(source, false);
    }
    getTexture(source) {
        return this.textureCache_.get(this.textureCacheKey(source, true));
    }
    hasTexture(source) {
        return this.textureCache_.has(this.textureCacheKey(source, true));
    }
    releaseTexture(source) {
        const rm = this.module_.getResourceManager();
        for (const flip of [true, false]) {
            const key = this.textureCacheKey(source, flip);
            const info = this.textureCache_.get(key);
            if (info) {
                rm.releaseTexture(info.handle);
                this.textureCache_.delete(key);
            }
        }
    }
    releaseAll() {
        const rm = this.module_.getResourceManager();
        for (const info of this.textureCache_.values()) {
            rm.releaseTexture(info.handle);
        }
        this.textureCache_.clear();
        this.jsonCache_.clear();
        this.textCache_.clear();
        this.binaryCache_.clear();
    }
    setTextureMetadata(handle, border) {
        const rm = this.module_.getResourceManager();
        rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
    }
    setTextureMetadataByPath(source, border) {
        const info = this.textureCache_.get(this.textureCacheKey(source, true));
        if (info) {
            this.setTextureMetadata(info.handle, border);
            return true;
        }
        return false;
    }
    // =========================================================================
    // Spine
    // =========================================================================
    async loadSpine(skeletonPath, atlasPath, baseUrl) {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        if (this.loadedSpines_.has(cacheKey)) {
            return { success: true };
        }
        try {
            const atlasUrl = this.resolveUrl(atlasPath, baseUrl);
            const atlasResponse = await fetch(atlasUrl);
            if (!atlasResponse.ok) {
                return { success: false, error: `Failed to fetch atlas: ${atlasUrl}` };
            }
            const atlasContent = await atlasResponse.text();
            if (!this.writeToVirtualFS(atlasPath, atlasContent)) {
                return { success: false, error: `Failed to write atlas to virtual FS: ${atlasPath}` };
            }
            const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
            const textureNames = this.parseAtlasTextures(atlasContent);
            for (const texName of textureNames) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
                const texUrl = this.resolveUrl(texPath, baseUrl);
                try {
                    const info = await this.loadTextureRaw(texUrl);
                    const rm = this.module_.getResourceManager();
                    rm.registerTextureWithPath(info.handle, texPath);
                }
                catch (err) {
                    console.warn(`[AssetServer] Failed to load Spine texture: ${texPath}`, err);
                }
            }
            const skelUrl = this.resolveUrl(skeletonPath, baseUrl);
            const skelResponse = await fetch(skelUrl);
            if (!skelResponse.ok) {
                return { success: false, error: `Failed to fetch skeleton: ${skelUrl}` };
            }
            const isBinary = skeletonPath.endsWith('.skel');
            const skelData = isBinary
                ? new Uint8Array(await skelResponse.arrayBuffer())
                : await skelResponse.text();
            if (!this.writeToVirtualFS(skeletonPath, skelData)) {
                return { success: false, error: `Failed to write skeleton to virtual FS: ${skeletonPath}` };
            }
            this.loadedSpines_.add(cacheKey);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    }
    isSpineLoaded(skeletonPath, atlasPath) {
        return this.loadedSpines_.has(`${skeletonPath}:${atlasPath}`);
    }
    // =========================================================================
    // Material & Shader
    // =========================================================================
    async loadMaterial(path, baseUrl) {
        return this.materialLoader_.load(this.resolveUrl(path, baseUrl));
    }
    getMaterial(path, baseUrl) {
        return this.materialLoader_.get(this.resolveUrl(path, baseUrl));
    }
    hasMaterial(path, baseUrl) {
        return this.materialLoader_.has(this.resolveUrl(path, baseUrl));
    }
    async loadShader(path) {
        return this.shaderCache_.getOrLoad(path, () => this.loadShaderInternal(path));
    }
    // =========================================================================
    // Generic File Loading
    // =========================================================================
    async loadJson(path, options) {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchJson(url);
        }
        return this.jsonCache_.getOrLoad(url, () => this.fetchJson(url));
    }
    async loadText(path, options) {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchText(url);
        }
        return this.textCache_.getOrLoad(url, () => this.fetchText(url));
    }
    async loadBinary(path, options) {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchBinary(url);
        }
        return this.binaryCache_.getOrLoad(url, () => this.fetchBinary(url));
    }
    // =========================================================================
    // Scene & Batch
    // =========================================================================
    async loadScene(world, sceneData) {
        return loadSceneWithAssets(world, sceneData, { assetServer: this });
    }
    async loadAll(manifest) {
        const bundle = {
            textures: new Map(),
            materials: new Map(),
            spine: new Map(),
            json: new Map(),
            text: new Map(),
            binary: new Map(),
        };
        const promises = [];
        if (manifest.textures) {
            for (const path of manifest.textures) {
                promises.push(this.loadTexture(path).then(info => { bundle.textures.set(path, info); }));
            }
        }
        if (manifest.materials) {
            for (const path of manifest.materials) {
                promises.push(this.loadMaterial(path).then(mat => { bundle.materials.set(path, mat); }));
            }
        }
        if (manifest.spine) {
            for (const desc of manifest.spine) {
                const key = `${desc.skeleton}:${desc.atlas}`;
                promises.push(this.loadSpine(desc.skeleton, desc.atlas, desc.baseUrl).then(result => {
                    bundle.spine.set(key, result);
                }));
            }
        }
        if (manifest.json) {
            for (const path of manifest.json) {
                promises.push(this.loadJson(path).then(data => { bundle.json.set(path, data); }));
            }
        }
        if (manifest.text) {
            for (const path of manifest.text) {
                promises.push(this.loadText(path).then(data => { bundle.text.set(path, data); }));
            }
        }
        if (manifest.binary) {
            for (const path of manifest.binary) {
                promises.push(this.loadBinary(path).then(data => { bundle.binary.set(path, data); }));
            }
        }
        await Promise.all(promises);
        return bundle;
    }
    // =========================================================================
    // Private - Texture
    // =========================================================================
    textureCacheKey(source, flip) {
        return `${source}:${flip ? 'f' : 'n'}`;
    }
    async loadTextureWithFlip(source, flip) {
        const cacheKey = this.textureCacheKey(source, flip);
        return this.textureCache_.getOrLoad(cacheKey, () => this.loadTextureInternal(source, flip));
    }
    async loadTextureInternal(source, flip) {
        const img = await this.loadImage(source);
        return this.createTextureFromImage(img, flip);
    }
    async loadImage(source) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        const bitmap = await createImageBitmap(img, {
                            premultiplyAlpha: 'none',
                            colorSpaceConversion: 'none'
                        });
                        resolve(bitmap);
                        return;
                    }
                    catch {
                        // Fall back to Image element
                    }
                }
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${source}`));
            img.src = source;
        });
    }
    createTextureFromImage(img, flip) {
        const { width, height } = img;
        if (this.canvas_.width < width || this.canvas_.height < height) {
            this.canvas_.width = Math.max(this.canvas_.width, this.nextPowerOf2(width));
            this.canvas_.height = Math.max(this.canvas_.height, this.nextPowerOf2(height));
        }
        this.ctx_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
        this.ctx_.save();
        if (flip) {
            this.ctx_.translate(0, height);
            this.ctx_.scale(1, -1);
        }
        this.ctx_.drawImage(img, 0, 0);
        this.ctx_.restore();
        const imageData = this.ctx_.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);
        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(pixels.length);
        this.module_.HEAPU8.set(pixels, ptr);
        const handle = rm.createTexture(width, height, ptr, pixels.length, 1);
        this.module_._free(ptr);
        return { handle, width, height };
    }
    unpremultiplyAlpha(pixels) {
        for (let i = 0; i < pixels.length; i += 4) {
            const a = pixels[i + 3];
            if (a > 0 && a < 255) {
                const scale = 255 / a;
                pixels[i] = Math.min(255, Math.round(pixels[i] * scale));
                pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * scale));
                pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * scale));
            }
        }
    }
    // =========================================================================
    // Private - Shader
    // =========================================================================
    async loadShaderInternal(path) {
        const exists = await platformFileExists(path);
        if (!exists) {
            throw new Error(`Shader file not found: ${path}`);
        }
        const content = await platformReadTextFile(path);
        if (!content) {
            throw new Error(`Failed to read shader file: ${path}`);
        }
        const { vertex, fragment } = this.parseEsShader(content);
        if (!vertex || !fragment) {
            throw new Error(`Invalid shader format: ${path}`);
        }
        return Material.createShader(vertex, fragment);
    }
    parseEsShader(content) {
        const vertexMatch = content.match(/#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/);
        const fragmentMatch = content.match(/#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/);
        return {
            vertex: vertexMatch?.[1].trim() ?? null,
            fragment: fragmentMatch?.[1].trim() ?? null,
        };
    }
    // =========================================================================
    // Private - Generic Fetch
    // =========================================================================
    async fetchJson(url) {
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch JSON: ${url} (${response.status})`);
        }
        return response.json();
    }
    async fetchText(url) {
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch text: ${url} (${response.status})`);
        }
        return response.text();
    }
    async fetchBinary(url) {
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch binary: ${url} (${response.status})`);
        }
        return response.arrayBuffer();
    }
    // =========================================================================
    // Private - Virtual FS
    // =========================================================================
    writeToVirtualFS(virtualPath, data) {
        if (this.virtualFSPaths_.has(virtualPath)) {
            return true;
        }
        const fs = this.module_.FS;
        if (!fs) {
            return false;
        }
        try {
            this.ensureVirtualDir(virtualPath);
            fs.writeFile(virtualPath, data);
            this.virtualFSPaths_.add(virtualPath);
            return true;
        }
        catch (e) {
            console.error(`[AssetServer] Failed to write to virtual FS: ${virtualPath}`, e);
            return false;
        }
    }
    ensureVirtualDir(virtualPath) {
        const fs = this.module_.FS;
        if (!fs)
            return;
        const dir = virtualPath.substring(0, virtualPath.lastIndexOf('/'));
        if (!dir)
            return;
        const parts = dir.split('/').filter(p => p);
        let currentPath = '';
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try {
                const analysis = fs.analyzePath(currentPath);
                if (!analysis.exists) {
                    fs.mkdir(currentPath);
                }
            }
            catch {
                try {
                    fs.mkdir(currentPath);
                }
                catch {
                    // Directory might already exist
                }
            }
        }
    }
    // =========================================================================
    // Private - Utilities
    // =========================================================================
    resolveUrl(path, baseUrl) {
        if (path.startsWith('/') || path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        const base = baseUrl ?? this.baseUrl;
        return base ? `${base}/${path}` : `/${path}`;
    }
    createCanvas(width, height) {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    nextPowerOf2(n) {
        let p = 1;
        while (p < n)
            p *= 2;
        return p;
    }
    parseAtlasTextures(atlasContent) {
        const textures = [];
        for (const line of atlasContent.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.includes(':') &&
                (trimmed.endsWith('.png') || trimmed.endsWith('.jpg'))) {
                textures.push(trimmed);
            }
        }
        return textures;
    }
}

/**
 * @file    AssetPlugin.ts
 * @brief   Plugin that provides asset loading capabilities
 */
const Assets = defineResource(null, 'Assets');
// =============================================================================
// Asset Plugin
// =============================================================================
class AssetPlugin {
    build(app) {
        const module = app.wasmModule;
        if (!module) {
            console.warn('AssetPlugin: No WASM module available');
            return;
        }
        app.insertResource(Assets, new AssetServer(module));
    }
}
const assetPlugin = new AssetPlugin();

/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */
// =============================================================================
// PreviewPlugin
// =============================================================================
class PreviewPlugin {
    constructor(sceneUrl) {
        this.app_ = null;
        this.loadPromise_ = null;
        this.sceneUrl_ = sceneUrl;
    }
    build(app) {
        this.app_ = app;
        if (!app.hasResource(Assets)) {
            app.addPlugin(assetPlugin);
        }
        this.loadPromise_ = this.loadScene();
    }
    /**
     * @brief Wait for scene loading to complete
     */
    async waitForReady() {
        if (this.loadPromise_) {
            await this.loadPromise_;
        }
    }
    async loadScene() {
        if (!this.app_)
            return;
        try {
            const response = await platformFetch(this.sceneUrl_);
            if (!response.ok) {
                throw new Error(`Failed to fetch scene: ${response.status}`);
            }
            const sceneData = await response.json();
            const assets = this.app_.getResource(Assets);
            await assets.loadScene(this.app_.world, sceneData);
            this.ensureCamera();
        }
        catch (err) {
            console.error('[PreviewPlugin] Failed to load scene:', err);
        }
    }
    ensureCamera() {
        if (!this.app_)
            return;
        const world = this.app_.world;
        let hasActiveCamera = false;
        const cameraEntities = world.getEntitiesWithComponents([Camera]);
        for (const entity of cameraEntities) {
            const camera = world.get(entity, Camera);
            if (camera.isActive) {
                hasActiveCamera = true;
                break;
            }
        }
        if (!hasActiveCamera) {
            console.warn('[PreviewPlugin] No active camera found, creating default camera');
            const cameraEntity = world.spawn();
            const transformData = {
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            };
            world.insert(cameraEntity, LocalTransform, transformData);
            const cameraData = {
                isActive: true,
                projectionType: 0,
                fov: 60,
                orthoSize: 540,
                nearPlane: 0.1,
                farPlane: 1000,
                aspectRatio: 1.77,
                priority: 0,
            };
            world.insert(cameraEntity, Camera, cameraData);
        }
    }
}

/**
 * @file    spine.ts
 * @brief   Spine animation control API
 */
// =============================================================================
// SpineController
// =============================================================================
/**
 * Controller for Spine skeletal animations
 *
 * @example
 * ```typescript
 * const spine = new SpineController(wasmModule);
 *
 * // Play animation
 * spine.play(entity, 'run', true);
 *
 * // Queue next animation
 * spine.addAnimation(entity, 'idle', true, 0.2);
 *
 * // Change skin
 * spine.setSkin(entity, 'warrior');
 *
 * // Get bone position for effects
 * const pos = spine.getBonePosition(entity, 'weapon');
 * if (pos) {
 *     spawnEffect(pos.x, pos.y);
 * }
 *
 * // Listen for events
 * spine.on(entity, 'event', (e) => {
 *     if (e.eventName === 'footstep') {
 *         playSound('footstep');
 *     }
 * });
 * ```
 */
class SpineController {
    constructor(wasmModule) {
        this.module_ = wasmModule;
        this.listeners_ = new Map();
        this.setupEventBridge();
    }
    // =========================================================================
    // Animation Control
    // =========================================================================
    /**
     * Plays an animation, replacing any current animation on the track
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop the animation
     * @param track Animation track (default 0)
     * @returns True if animation was set
     */
    play(entity, animation, loop = true, track = 0) {
        if (!this.module_.spinePlayAnimation)
            return false;
        return this.module_.spinePlayAnimation(entity, animation, loop, track);
    }
    /**
     * Adds an animation to the queue
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop
     * @param delay Delay before starting (seconds)
     * @param track Animation track (default 0)
     * @returns True if animation was queued
     */
    addAnimation(entity, animation, loop = true, delay = 0, track = 0) {
        if (!this.module_.spineAddAnimation)
            return false;
        return this.module_.spineAddAnimation(entity, animation, loop, delay, track);
    }
    /**
     * Sets an empty animation to mix out the current animation
     * @param entity Target entity
     * @param mixDuration Duration of the mix out
     * @param track Animation track (default 0)
     */
    setEmptyAnimation(entity, mixDuration = 0.2, track = 0) {
        if (!this.module_.spineSetEmptyAnimation)
            return;
        this.module_.spineSetEmptyAnimation(entity, mixDuration, track);
    }
    /**
     * Clears all animations on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     */
    clearTrack(entity, track = 0) {
        if (!this.module_.spineClearTrack)
            return;
        this.module_.spineClearTrack(entity, track);
    }
    /**
     * Clears all tracks
     * @param entity Target entity
     */
    clearTracks(entity) {
        if (!this.module_.spineClearTracks)
            return;
        this.module_.spineClearTracks(entity);
    }
    // =========================================================================
    // Skin Control
    // =========================================================================
    /**
     * Sets the current skin
     * @param entity Target entity
     * @param skinName Skin name
     * @returns True if skin was set
     */
    setSkin(entity, skinName) {
        if (!this.module_.spineSetSkin)
            return false;
        return this.module_.spineSetSkin(entity, skinName);
    }
    /**
     * Gets available skin names
     * @param entity Target entity
     * @returns Array of skin names
     */
    getSkins(entity) {
        if (!this.module_.spineGetSkins)
            return [];
        return this.module_.spineGetSkins(entity) || [];
    }
    // =========================================================================
    // Queries
    // =========================================================================
    /**
     * Gets available animation names
     * @param entity Target entity
     * @returns Array of animation names
     */
    getAnimations(entity) {
        if (!this.module_.spineGetAnimations)
            return [];
        return this.module_.spineGetAnimations(entity) || [];
    }
    /**
     * Gets the current animation on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Animation name or null
     */
    getCurrentAnimation(entity, track = 0) {
        if (!this.module_.spineGetCurrentAnimation)
            return null;
        return this.module_.spineGetCurrentAnimation(entity, track);
    }
    /**
     * Gets the duration of an animation
     * @param entity Target entity
     * @param animation Animation name
     * @returns Duration in seconds, or 0 if not found
     */
    getAnimationDuration(entity, animation) {
        if (!this.module_.spineGetAnimationDuration)
            return 0;
        return this.module_.spineGetAnimationDuration(entity, animation);
    }
    /**
     * Gets detailed track entry info
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Track entry info or null
     */
    getTrackEntry(entity, track = 0) {
        if (!this.module_.spineGetTrackEntry)
            return null;
        return this.module_.spineGetTrackEntry(entity, track);
    }
    // =========================================================================
    // Bone/Slot Access
    // =========================================================================
    /**
     * Gets world position of a bone
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Position or null if not found
     */
    getBonePosition(entity, boneName) {
        if (!this.module_.spineGetBonePosition)
            return null;
        const result = this.module_.spineGetBonePosition(entity, boneName);
        if (!result)
            return null;
        return { x: result.x, y: result.y };
    }
    /**
     * Gets world rotation of a bone in degrees
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Rotation in degrees or null
     */
    getBoneRotation(entity, boneName) {
        if (!this.module_.spineGetBoneRotation)
            return null;
        return this.module_.spineGetBoneRotation(entity, boneName);
    }
    /**
     * Sets the attachment for a slot
     * @param entity Target entity
     * @param slotName Slot name
     * @param attachmentName Attachment name (null to clear)
     */
    setAttachment(entity, slotName, attachmentName) {
        if (!this.module_.spineSetAttachment)
            return;
        this.module_.spineSetAttachment(entity, slotName, attachmentName || '');
    }
    // =========================================================================
    // Events
    // =========================================================================
    /**
     * Registers an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    on(entity, type, callback) {
        if (!this.listeners_.has(entity)) {
            this.listeners_.set(entity, new Map());
        }
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners.has(type)) {
            entityListeners.set(type, new Set());
        }
        entityListeners.get(type).add(callback);
    }
    /**
     * Unregisters an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    off(entity, type, callback) {
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners)
            return;
        const typeListeners = entityListeners.get(type);
        if (!typeListeners)
            return;
        typeListeners.delete(callback);
    }
    /**
     * Removes all event listeners for an entity
     * @param entity Target entity
     */
    removeAllListeners(entity) {
        this.listeners_.delete(entity);
    }
    // =========================================================================
    // Private
    // =========================================================================
    setupEventBridge() {
        if (typeof window !== 'undefined') {
            window.__esengine_spineEvent = (entity, eventData) => {
                this.dispatchEvent(entity, eventData);
            };
        }
    }
    dispatchEvent(entity, eventData) {
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners)
            return;
        const event = {
            type: eventData.type,
            entity,
            track: eventData.track ?? 0,
            animation: eventData.animation ?? null,
            eventName: eventData.eventName,
            intValue: eventData.intValue,
            floatValue: eventData.floatValue,
            stringValue: eventData.stringValue,
        };
        const typeListeners = entityListeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(callback => {
                try {
                    callback(event);
                }
                catch (e) {
                    console.error('Error in Spine event callback:', e);
                }
            });
        }
    }
}
// =============================================================================
// Factory Function
// =============================================================================
/**
 * Creates a SpineController instance
 * @param wasmModule The ESEngine WASM module
 * @returns SpineController instance
 */
function createSpineController(wasmModule) {
    return new SpineController(wasmModule);
}

let editorMode = false;
function setEditorMode(active) {
    editorMode = active;
}
function isEditor() {
    return editorMode;
}
function isRuntime() {
    return !editorMode;
}

/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 */
// Initialize Web platform
setPlatform(webAdapter);

export { App, AssetPlugin, AssetServer, Assets, AsyncCache, BlendMode, Camera, Canvas, Children, Commands, CommandsInstance, DataType, Draw, EntityCommands, Geometry, INVALID_ENTITY, INVALID_TEXTURE, Input, LocalTransform, Material, MaterialLoader, Mut, Parent, PostProcess, PreviewPlugin, Query, QueryInstance, RenderPipeline, RenderStage, Renderer, Res, ResMut, Schedule, ShaderSources, SpineAnimation, SpineController, Sprite, SystemRunner, Text, TextAlign, TextOverflow, TextPlugin, TextRenderer, TextVerticalAlign, Time, UIRect, Velocity, World, WorldTransform, assetPlugin, clearDrawCallbacks, color, createSpineController, createWebApp, defineComponent, defineResource, defineSystem, defineTag, getComponentDefaults, getPlatform, getPlatformType, initDrawAPI, initGeometryAPI, initMaterialAPI, initPostProcessAPI, initRendererAPI, isBuiltinComponent, isEditor, isPlatformInitialized, isRuntime, isWeChat, isWeb, loadComponent, loadSceneData, loadSceneWithAssets, platformFetch, platformFileExists, platformInstantiateWasm, platformReadFile, platformReadTextFile, quat, registerDrawCallback, registerMaterialCallback, setEditorMode, shutdownDrawAPI, shutdownGeometryAPI, shutdownMaterialAPI, shutdownPostProcessAPI, shutdownRendererAPI, textPlugin, unregisterDrawCallback, updateCameraAspectRatio, vec2, vec3, vec4 };
//# sourceMappingURL=index.js.map
