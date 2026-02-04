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
    texture: 0,
    color: { x: 1, y: 1, z: 1, w: 1 },
    size: { x: 32, y: 32 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false
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
            console.log(`[World] Calling cppRegistry_.setParent(${child}, ${parent})`);
            this.cppRegistry_.setParent(child, parent);
        }
        else {
            console.warn('[World] setParent called but cppRegistry_ is null!');
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
    module.initRenderer();
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
            module.renderFrame(cppRegistry, width, height);
        }
    };
    app.addSystemToSchedule(Schedule.Last, renderSystem);
    return app;
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
var TextBaseline;
(function (TextBaseline) {
    TextBaseline[TextBaseline["Top"] = 0] = "Top";
    TextBaseline[TextBaseline["Middle"] = 1] = "Middle";
    TextBaseline[TextBaseline["Bottom"] = 2] = "Bottom";
})(TextBaseline || (TextBaseline = {}));
// =============================================================================
// Text Component Definition
// =============================================================================
const Text = defineComponent('Text', {
    content: '',
    fontFamily: 'Arial',
    fontSize: 24,
    color: { x: 1, y: 1, z: 1, w: 1 },
    align: TextAlign.Left,
    baseline: TextBaseline.Top,
    maxWidth: 0,
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
            this.ctx = this.canvas.getContext('2d');
        }
        else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = 512;
            this.canvas.height = 512;
            this.ctx = this.canvas.getContext('2d');
        }
    }
    /**
     * Renders text to a texture and returns the handle
     */
    renderText(text) {
        const ctx = this.ctx;
        const canvas = this.canvas;
        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        const lines = this.wrapText(text.content, text.maxWidth);
        const lineHeight = Math.ceil(text.fontSize * text.lineHeight);
        const padding = Math.ceil(text.fontSize * 0.2);
        const width = Math.ceil(this.measureWidth(lines)) + padding * 2;
        const height = Math.ceil(lines.length * lineHeight) + padding * 2;
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
        // Clear with text color but alpha=0 to avoid black fringing
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${text.fontSize}px ${text.fontFamily}`;
        ctx.textAlign = this.mapAlign(text.align);
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        let y = padding;
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
            }
            ctx.fillText(line, x, y);
            y += lineHeight;
        }
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);
        const flipped = this.flipVertically(pixels, width, height);
        const rm = this.module.getResourceManager();
        const ptr = this.module._malloc(flipped.length);
        this.module.HEAPU8.set(flipped, ptr);
        const textureHandle = rm.createTexture(width, height, ptr, flipped.length, 1);
        this.module._free(ptr);
        return { textureHandle, width, height };
    }
    /**
     * Renders text for an entity and caches the result
     */
    renderForEntity(entity, text) {
        const existing = this.cache.get(entity);
        if (existing) {
            const rm = this.module.getResourceManager();
            rm.releaseTexture(existing.textureHandle);
        }
        const result = this.renderText(text);
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
            const words = paragraph.split(' ');
            let currentLine = '';
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const metrics = this.ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                }
                else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine);
        }
        return lines;
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
 * @file    TextPlugin.ts
 * @brief   Plugin that automatically syncs Text components to Sprite textures
 */
defineResource({ renderer: null }, 'TextRenderer');
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
        app.addSystemToSchedule(Schedule.Startup, defineSystem([], () => {
            // Initialization if needed
        }));
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([Query(Text, Mut(Sprite))], (query) => {
            for (const [entity, text, sprite] of query) {
                const textData = text;
                const spriteData = sprite;
                if (!textData.dirty)
                    continue;
                const result = renderer.renderForEntity(entity, textData);
                console.log(`Text texture size: ${result.width}x${result.height}`);
                spriteData.texture = result.textureHandle;
                spriteData.size = { x: result.width, y: result.height };
                spriteData.color = { x: 1, y: 1, z: 1, w: 1 };
                spriteData.uvOffset = { x: 0, y: 0 };
                spriteData.uvScale = { x: 1, y: 1 };
                textData.dirty = false;
            }
        }));
    }
}
const textPlugin = new TextPlugin();

/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */
// =============================================================================
// AssetServer
// =============================================================================
class AssetServer {
    constructor(module) {
        this.cache_ = new Map();
        this.pending_ = new Map();
        this.module_ = module;
        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas_ = new OffscreenCanvas(512, 512);
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true });
        }
        else {
            this.canvas_ = document.createElement('canvas');
            this.canvas_.width = 512;
            this.canvas_.height = 512;
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true });
        }
    }
    // =========================================================================
    // Public API
    // =========================================================================
    async loadTexture(source) {
        const cached = this.cache_.get(source);
        if (cached) {
            return cached;
        }
        const pending = this.pending_.get(source);
        if (pending) {
            return pending;
        }
        const promise = this.loadTextureInternal(source);
        this.pending_.set(source, promise);
        try {
            const result = await promise;
            this.cache_.set(source, result);
            return result;
        }
        finally {
            this.pending_.delete(source);
        }
    }
    getTexture(source) {
        return this.cache_.get(source);
    }
    hasTexture(source) {
        return this.cache_.has(source);
    }
    releaseTexture(source) {
        const info = this.cache_.get(source);
        if (info) {
            const rm = this.module_.getResourceManager();
            rm.releaseTexture(info.handle);
            this.cache_.delete(source);
        }
    }
    releaseAll() {
        const rm = this.module_.getResourceManager();
        for (const info of this.cache_.values()) {
            rm.releaseTexture(info.handle);
        }
        this.cache_.clear();
    }
    setTextureMetadata(handle, border) {
        const rm = this.module_.getResourceManager();
        rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
    }
    setTextureMetadataByPath(source, border) {
        const info = this.cache_.get(source);
        if (info) {
            this.setTextureMetadata(info.handle, border);
            return true;
        }
        return false;
    }
    // =========================================================================
    // Private Methods
    // =========================================================================
    async loadTextureInternal(source) {
        const img = await this.loadImage(source);
        return this.createTextureFromImage(img);
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
    createTextureFromImage(img) {
        const { width, height } = img;
        if (this.canvas_.width < width || this.canvas_.height < height) {
            this.canvas_.width = Math.max(this.canvas_.width, this.nextPowerOf2(width));
            this.canvas_.height = Math.max(this.canvas_.height, this.nextPowerOf2(height));
        }
        this.ctx_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
        this.ctx_.globalCompositeOperation = 'copy';
        this.ctx_.drawImage(img, 0, 0);
        this.ctx_.globalCompositeOperation = 'source-over';
        const imageData = this.ctx_.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);
        const flipped = this.flipVertically(pixels, width, height);
        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(flipped.length);
        this.module_.HEAPU8.set(flipped, ptr);
        const handle = rm.createTexture(width, height, ptr, flipped.length, 1);
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
    nextPowerOf2(n) {
        let p = 1;
        while (p < n)
            p *= 2;
        return p;
    }
}

/**
 * @file    AssetPlugin.ts
 * @brief   Plugin that provides asset loading capabilities
 */
const Assets = defineResource({ server: null }, 'Assets');
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
        const server = new AssetServer(module);
        app.insertResource(Assets, { server });
    }
}
const assetPlugin = new AssetPlugin();

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
                    const url = options?.assetBaseUrl
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
            }
            loadComponent(world, entity, compData);
        }
    }
    for (const entityData of sceneData.entities) {
        if (entityData.parent !== null) {
            const entity = entityMap.get(entityData.id);
            const parentEntity = entityMap.get(entityData.parent);
            if (entity !== undefined && parentEntity !== undefined) {
                console.log(`[SceneLoader] setParent: entity ${entity} -> parent ${parentEntity}`);
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
        default:
            console.warn(`Unknown component type: ${compData.type}`);
    }
}

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
            const response = await fetch(this.sceneUrl_);
            if (!response.ok) {
                throw new Error(`Failed to fetch scene: ${response.status}`);
            }
            const sceneData = await response.json();
            const assets = this.app_.getResource(Assets);
            await loadSceneWithAssets(this.app_.world, sceneData, {
                assetServer: assets.server
            });
            this.ensureCamera();
            this.debugCamera();
            // 延迟检查，等渲染循环开始后
            setTimeout(() => {
                console.log('[PreviewPlugin] === Delayed Check (after render loop) ===');
                this.debugCamera();
            }, 1000);
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
    debugCamera() {
        if (!this.app_)
            return;
        const world = this.app_.world;
        const cameraEntities = world.getEntitiesWithComponents([Camera]);
        console.log('[PreviewPlugin] === Camera Debug ===');
        console.log(`[PreviewPlugin] Found ${cameraEntities.length} camera entities`);
        for (const entity of cameraEntities) {
            const camera = world.get(entity, Camera);
            const hasTransform = world.has(entity, LocalTransform);
            console.log(`[PreviewPlugin] Camera Entity ${entity}:`);
            console.log(`  - isActive: ${camera.isActive}`);
            console.log(`  - projectionType: ${camera.projectionType} (0=Ortho, 1=Persp)`);
            console.log(`  - orthoSize: ${camera.orthoSize}`);
            console.log(`  - hasLocalTransform: ${hasTransform}`);
            if (hasTransform) {
                const transform = world.get(entity, LocalTransform);
                console.log(`  - position: (${transform.position.x}, ${transform.position.y}, ${transform.position.z})`);
            }
        }
        console.log('[PreviewPlugin] === Sprite Debug ===');
        const spriteEntities = world.getEntitiesWithComponents([Sprite, LocalTransform]);
        console.log(`[PreviewPlugin] Found ${spriteEntities.length} sprite entities with transform`);
        for (const entity of spriteEntities.slice(0, 5)) {
            const sprite = world.get(entity, Sprite);
            const localTransform = world.get(entity, LocalTransform);
            const hasWorld = world.has(entity, WorldTransform);
            console.log(`[PreviewPlugin] Sprite Entity ${entity}:`);
            console.log(`  - texture: ${sprite.texture}`);
            console.log(`  - size: (${sprite.size.x}, ${sprite.size.y})`);
            console.log(`  - localPosition: (${localTransform.position.x}, ${localTransform.position.y}, ${localTransform.position.z})`);
            console.log(`  - hasWorldTransform: ${hasWorld}`);
            if (hasWorld) {
                const worldTransform = world.get(entity, WorldTransform);
                console.log(`  - worldPosition: (${worldTransform.position.x}, ${worldTransform.position.y}, ${worldTransform.position.z})`);
            }
        }
    }
}

export { App, AssetPlugin, AssetServer, Assets, Camera, Canvas, Children, Commands, CommandsInstance, EntityCommands, INVALID_ENTITY, INVALID_TEXTURE, Input, LocalTransform, Mut, Parent, PreviewPlugin, Query, QueryInstance, Res, ResMut, Schedule, Sprite, SystemRunner, Text, TextAlign, TextBaseline, TextPlugin, TextRenderer, Time, Velocity, World, WorldTransform, assetPlugin, color, createWebApp, defineComponent, defineResource, defineSystem, defineTag, isBuiltinComponent, loadSceneData, loadSceneWithAssets, quat, textPlugin, vec2, vec3, vec4 };
