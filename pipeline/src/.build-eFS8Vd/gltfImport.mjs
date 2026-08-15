import { createRequire as __esCreateRequire } from 'node:module';
const require = __esCreateRequire('file:////Users/yhh/projects/estella/pipeline/package.json');


// sdk/dist/shared/resource.js
var e = class {
  constructor() {
    this.componentRegistry = /* @__PURE__ */ new Map(), this.pendingSystems = [], this.pendingPlugins = [], this.editorBridge = null, this.wasmError = { handler: null, lastReportTime: 0, suppressedCount: 0 }, this.editorMode = false, this.playMode = false;
  }
  drainPendingSystems() {
    return this.pendingSystems.splice(0);
  }
  drainPendingPlugins() {
    return this.pendingPlugins.splice(0);
  }
  reset() {
    this.pendingSystems.length = 0, this.pendingPlugins.length = 0, this.componentRegistry.clear(), this.editorBridge = null, this.wasmError.handler = null, this.wasmError.lastReportTime = 0, this.wasmError.suppressedCount = 0, this.editorMode = false, this.playMode = false;
  }
};
var t = null;
function n() {
  return t ||= new e(), t;
}
function a() {
  return n().editorMode;
}
function c() {
  return n().playMode;
}
function l() {
  let e8 = n();
  return !e8.editorMode || e8.playMode;
}
var u = false;
function p() {
  return u || l();
}
var m = false;
function g() {
  return m;
}
var _ = class extends Error {
  constructor(e8, t2, n2) {
    super(`WASM module aborted; refusing to call into it (${e8})` + (t2 ? `: ${t2}` : ``)), this.name = `WasmModuleAborted`, this.context = e8, this.reason = t2, n2 !== void 0 && (this.cause = n2);
  }
};
var v = /* @__PURE__ */ new WeakMap();
function y(e8) {
  let t2 = v.get(e8);
  return t2 || (t2 = { aborted: false }, v.set(e8, t2)), t2;
}
function ee(e8, t2) {
  let n2 = y(e8);
  n2.aborted || (n2.aborted = true, n2.reason = t2);
}
function te(e8) {
  return e8 ? y(e8).aborted : false;
}
function ne(e8, t2) {
  if (!e8) return;
  let n2 = y(e8);
  if (n2.aborted) throw new _(t2, n2.reason);
}
function re(e8) {
  let t2 = y(e8);
  if (t2.guardInstalled) return;
  t2.guardInstalled = true;
  let n2 = e8, r2 = typeof n2.onAbort == `function` ? n2.onAbort.bind(n2) : null;
  n2.onAbort = (t3) => {
    ee(e8, t3 == null ? void 0 : String(t3)), r2 && r2(t3);
  };
}
function ie(e8) {
  return e8 === `_malloc` || e8 === `_free`;
}
var ae = class {
  constructor() {
    this.raw_ = null, this.guarded_ = null, this.health_ = null;
  }
  connect(e8, t2 = e8) {
    this.raw_ = e8, this.health_ = t2, re(t2), this.guarded_ = this.makeGuarded_(e8, t2);
  }
  disconnect() {
    this.raw_ = null, this.guarded_ = null, this.health_ = null;
  }
  get connected() {
    return this.raw_ !== null;
  }
  get module() {
    if (!this.guarded_) throw Error(`${this.label} bridge is not connected to a WASM module`);
    return this.guarded_;
  }
  get raw() {
    return this.raw_;
  }
  makeGuarded_(e8, t2) {
    let n2 = this.label, r2 = /* @__PURE__ */ new Map();
    return new Proxy(e8, { get(e9, i2) {
      let a2 = Reflect.get(e9, i2, e9);
      if (typeof a2 != `function` || ie(i2)) return a2;
      let o2 = r2.get(i2);
      if (!o2) {
        let s2 = a2, c2 = `${n2}.${typeof i2 == `string` ? i2 : String(i2)}`;
        o2 = (...n3) => {
          ne(t2, c2);
          try {
            return s2.apply(e9, n3);
          } catch (e10) {
            throw te(t2) ? new _(c2, void 0, e10) : e10;
          }
        }, r2.set(i2, o2);
      }
      return o2;
    } });
  }
};
var b = new class extends ae {
  constructor(...e8) {
    super(...e8), this.label = `resourceManager`;
  }
}();
var x = null;
var S = /* @__PURE__ */ new Map();
function ce() {
  return x;
}
function le() {
  if (!x) throw Error(`ResourceManager not initialized. Call initResourceManager() first.`);
  return x;
}
function pe(e8) {
  S.delete(e8);
}
function C(e8, t2) {
  let n2 = [], r2 = (t3) => {
    let r3 = e8._malloc(t3);
    return r3 && n2.push(r3), r3;
  };
  try {
    return t2(r2);
  } finally {
    for (let t3 = n2.length - 1; t3 >= 0; t3--) e8._free(n2[t3]);
  }
}
function he(e8, t2, n2) {
  return C(e8, (e9) => n2(e9(t2)));
}
var ge = (function(e8) {
  return e8[e8.Debug = 0] = `Debug`, e8[e8.Info = 1] = `Info`, e8[e8.Warn = 2] = `Warn`, e8[e8.Error = 3] = `Error`, e8;
})({});
var _e = class {
  handle(e8) {
    let t2 = `[${new Date(e8.timestamp).toISOString().substring(11, 23)}] [${ge[e8.level].toUpperCase().padEnd(5)}] [${e8.category}] ${e8.message}`, n2;
    if (e8.data !== void 0) {
      let r3 = e8.data;
      if (e8.data instanceof Error) n2 = e8.data;
      else if (r3 && (typeof r3.stack == `string` || typeof r3.message == `string`)) t2 += ` ${String(r3.stack ?? r3.message)}`;
      else try {
        t2 += ` ${JSON.stringify(e8.data)}`;
      } catch {
        t2 += ` ${String(e8.data)}`;
      }
    }
    let r2 = [t2];
    switch (n2 && r2.push(n2), e8.level) {
      case 0:
        console.debug(...r2);
        break;
      case 1:
        console.log(...r2);
        break;
      case 2:
        console.warn(...r2);
        break;
      case 3:
        console.error(...r2);
    }
  }
};
var ve = class {
  constructor() {
    this.handlers_ = [], this.minLevel_ = 1, this.addHandler(new _e());
  }
  setMinLevel(e8) {
    this.minLevel_ = e8;
  }
  addHandler(e8) {
    this.handlers_.push(e8);
  }
  removeHandler(e8) {
    let t2 = this.handlers_.indexOf(e8);
    t2 !== -1 && this.handlers_.splice(t2, 1);
  }
  clearHandlers() {
    this.handlers_ = [];
  }
  debug(e8, t2, n2) {
    this.log(0, e8, t2, n2);
  }
  info(e8, t2, n2) {
    this.log(1, e8, t2, n2);
  }
  warn(e8, t2, n2) {
    this.log(2, e8, t2, n2);
  }
  error(e8, t2, n2) {
    this.log(3, e8, t2, n2);
  }
  log(e8, t2, n2, r2) {
    if (e8 < this.minLevel_) return;
    let i2 = { timestamp: Date.now(), level: e8, category: t2, message: n2, data: r2 };
    for (let e9 of this.handlers_) try {
      e9.handle(i2);
    } catch (e10) {
      console.error(`[Logger] Handler threw error:`, e10);
    }
  }
};
var w = new ve();
var T = w;
function E(e8) {
  if (typeof e8 != `object` || !e8) return e8;
  if (Array.isArray(e8)) return e8.map(E);
  let t2 = Object.getPrototypeOf(e8);
  if (t2 !== Object.prototype && t2 !== null) return e8;
  let n2 = {};
  for (let t3 in e8) n2[t3] = E(e8[t3]);
  return n2;
}
var Te = `310236a4dffb268f`;
var D = { BitmapText: { defaults: { text: ``, color: { r: 1, g: 1, b: 1, a: 1 }, fontSize: 1, align: 0, spacing: 0, parallax: { x: 1, y: 1 }, layer: 0, font: 0, enabled: true }, renderableField: `enabled`, assetFields: [{ field: `font`, type: `font` }], entityFields: [], colorFields: [`color`], animatableFields: [`color.r`, `color.g`, `color.b`, `color.a`], fields: { fontSize: { min: 1 }, align: { enum: [{ label: `Left`, value: 0 }, { label: `Center`, value: 1 }, { label: `Right`, value: 2 }] }, parallax: { tooltip: `Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).`, advanced: true }, layer: { step: 1 } } }, BoxCollider: { defaults: { halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, Camera: { defaults: { projectionType: 0, fov: 60, orthoSize: 5, nearPlane: 0.1, farPlane: 1e3, aspectRatio: 0, isActive: false, priority: 0, viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: 3, pixelPerfect: false, cullingMask: 4294967295 }, editorDefaults: { projectionType: 1, orthoSize: 540, aspectRatio: 1.77, isActive: true }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [`orthoSize`], fields: { projectionType: { enum: [{ label: `Perspective`, value: 0 }, { label: `Orthographic`, value: 1 }], tooltip: `Orthographic (2D) or Perspective projection.` }, fov: { min: 1, max: 179, unit: `\xB0` }, orthoSize: { min: 0, tooltip: `Half the visible height in world units (Orthographic).` }, nearPlane: { min: 0, advanced: true }, farPlane: { min: 0, advanced: true }, aspectRatio: { advanced: true }, priority: { step: 1, advanced: true }, clearFlags: { tooltip: `Which buffers to clear before rendering this camera.` }, pixelPerfect: { tooltip: `Snap the camera to the pixel grid for crisp pixel-art (Orthographic).`, advanced: true }, cullingMask: { tooltip: `Which sorting layers this camera renders.`, bitmask: { source: `sortingLayers` } } } }, Canvas: { defaults: { designResolution: { x: 1920, y: 1080 }, pixelsPerUnit: 100, scaleMode: 1, matchWidthOrHeight: 0.5, backgroundColor: { r: 0, g: 0, b: 0, a: 1 }, layer: 0 }, assetFields: [], entityFields: [], colorFields: [`backgroundColor`], animatableFields: [], fields: { pixelsPerUnit: { min: 1, tooltip: `World pixels per physics meter (Box2D + tile collider scale).` }, scaleMode: { enum: [{ label: `FixedWidth`, value: 0 }, { label: `FixedHeight`, value: 1 }, { label: `Expand`, value: 2 }, { label: `Shrink`, value: 3 }, { label: `Match`, value: 4 }], tooltip: `How the canvas adapts the design resolution to the screen.` }, matchWidthOrHeight: { min: 0, max: 1, slider: true, tooltip: `0 matches width, 1 matches height (Match mode only).` }, layer: { step: 1, tooltip: `Sorting layer this UI belongs to \u2014 cameras cull by it.`, enumSource: `sortingLayers` } } }, CapsuleCollider: { defaults: { radius: 0.25, halfHeight: 0.5, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, Children: { defaults: { entities: [] }, assetFields: [], entityFields: [`entities`], colorFields: [], animatableFields: [] }, CircleCollider: { defaults: { radius: 0.5, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, DragonBonesAnimation: { defaults: { skeletonPath: ``, atlasPath: ``, armature: ``, animation: ``, timeScale: 1, loop: true, playing: true, fadeInTime: 0, flipX: false, flipY: false, color: { r: 1, g: 1, b: 1, a: 1 }, layer: 0, skeletonScale: 1, material: 0, enabled: true }, renderableField: `enabled`, assetFields: [{ field: `material`, type: `material` }], skeletal: { skeletonField: `skeletonPath`, atlasField: `atlasPath`, runtime: `dragonbones` }, entityFields: [], colorFields: [`color`], animatableFields: [], fields: { armature: { enumSource: `dragonbonesArmatures` }, animation: { enumSource: `dragonbonesAnimations` }, timeScale: { min: 0 }, fadeInTime: { min: 0, step: 0.05 }, layer: { step: 1, enumSource: `sortingLayers` }, skeletonScale: { min: 0 } } }, FlexContainer: { defaults: { direction: 0, wrap: 0, justifyContent: 0, alignItems: 3, alignContent: 0, gap: { x: 0, y: 0 }, padding: { left: 0, top: 0, right: 0, bottom: 0 } }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: { direction: { enum: [{ label: `Row`, value: 0 }, { label: `Column`, value: 1 }, { label: `RowReverse`, value: 2 }, { label: `ColumnReverse`, value: 3 }] }, wrap: { enum: [{ label: `NoWrap`, value: 0 }, { label: `Wrap`, value: 1 }] }, justifyContent: { enum: [{ label: `Start`, value: 0 }, { label: `Center`, value: 1 }, { label: `End`, value: 2 }, { label: `SpaceBetween`, value: 3 }, { label: `SpaceAround`, value: 4 }, { label: `SpaceEvenly`, value: 5 }] }, alignItems: { enum: [{ label: `Start`, value: 0 }, { label: `Center`, value: 1 }, { label: `End`, value: 2 }, { label: `Stretch`, value: 3 }] }, alignContent: { enum: [{ label: `Start`, value: 0 }, { label: `Center`, value: 1 }, { label: `End`, value: 2 }, { label: `Stretch`, value: 3 }, { label: `SpaceBetween`, value: 4 }, { label: `SpaceAround`, value: 5 }] } } }, Interactable: { defaults: { enabled: true, blockRaycast: true, raycastTarget: true }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, Light2D: { defaults: { type: 0, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, radius: 200, direction: { x: 0, y: 0 }, innerAngle: 30, outerAngle: 45, shadowSoftness: 0, shadowDistance: 0, enabled: true }, renderableField: `enabled`, assetFields: [], entityFields: [], colorFields: [`color`], animatableFields: [`color.r`, `color.g`, `color.b`, `color.a`, `intensity`, `radius`, `innerAngle`, `outerAngle`, `shadowSoftness`, `shadowDistance`], fields: { type: { enum: [{ label: `Point`, value: 0 }, { label: `Directional`, value: 1 }, { label: `Ambient`, value: 2 }, { label: `Spot`, value: 3 }], tooltip: `Point, Directional, Ambient, or Spot.` }, intensity: { min: 0, tooltip: `Brightness multiplier of the light.` }, radius: { min: 0, tooltip: `Falloff reach in world units (Point / Spot).` }, direction: { tooltip: `Aim direction (Directional / Spot).`, advanced: true }, innerAngle: { min: 0, max: 180, unit: `\xB0`, advanced: true }, outerAngle: { min: 0, max: 180, unit: `\xB0`, advanced: true }, shadowSoftness: { min: 0, tooltip: `Shadow softness (light-source size); 0 = hard edge.` }, shadowDistance: { min: 0, tooltip: `Directional shadow distance; 0 = no directional shadow.`, advanced: true } } }, Mesh2D: { defaults: { texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, layer: 0, lit: false, parallax: { x: 1, y: 1 }, material: 0, enabled: true, mesh: 0 }, renderableField: `enabled`, assetFields: [{ field: `texture`, type: `texture` }, { field: `material`, type: `material` }, { field: `mesh`, type: `mesh` }], entityFields: [], colorFields: [`color`], animatableFields: [`color.r`, `color.g`, `color.b`, `color.a`], fields: { color: { tooltip: `Tint multiplied into the vertex colors (white = unchanged).` }, layer: { step: 1, tooltip: `Sorting layer \u2014 controls draw order across renderables.`, enumSource: `sortingLayers` }, lit: { tooltip: `Receive 2D lights: Light2D entities light this mesh (flat normal). A custom material overrides this.` }, parallax: { tooltip: `Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).`, advanced: true }, material: { advanced: true } } }, Parent: { defaults: { entity: 0 }, assetFields: [], entityFields: [`entity`], colorFields: [], animatableFields: [] }, ParticleEmitter: { defaults: { rate: 10, burstCount: 0, burstInterval: 1, duration: 5, looping: true, playOnStart: true, maxParticles: 1e3, lifetimeMin: 5, lifetimeMax: 5, shape: 3, shapeRadius: 100, shapeSize: { x: 100, y: 100 }, shapeAngle: 25, speedMin: 500, speedMax: 500, angleSpreadMin: 0, angleSpreadMax: 360, startSizeMin: 100, startSizeMax: 100, endSizeMin: 100, endSizeMax: 100, sizeEasing: 0, startColor: { r: 1, g: 1, b: 1, a: 1 }, endColor: { r: 1, g: 1, b: 1, a: 0 }, colorEasing: 0, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0, gravity: { x: 0, y: 0 }, damping: 0, noiseStrength: 0, noiseFrequency: 0.01, noiseScrollSpeed: 0, noiseOctaves: 1, texture: 0, spriteColumns: 1, spriteRows: 1, spriteFPS: 10, spriteLoop: true, blendMode: 1, layer: 0, material: 0, simulationSpace: 0, enabled: true, subEmitterTrigger: 0, subEmitterChance: 1, subEmitterInheritVelocity: 0, subEmitter: 0, trailEnabled: false, trailWidth: 8, trailPoints: 6, trailMinDistance: 6, collisionEnabled: false, collisionFloor: 0, collisionBounce: 0.5, collisionFriction: 0.1, collisionLifetimeLoss: 0 }, renderableField: `enabled`, assetFields: [{ field: `texture`, type: `texture` }, { field: `material`, type: `material` }], entityFields: [`subEmitter`], colorFields: [`startColor`, `endColor`], animatableFields: [], fields: { rate: { min: 0, category: `Emission` }, burstCount: { min: 0, step: 1, category: `Emission` }, burstInterval: { min: 0, category: `Emission` }, duration: { min: 0, category: `Emission` }, looping: { category: `Emission` }, playOnStart: { category: `Emission` }, maxParticles: { min: 1, step: 1, category: `Emission` }, lifetimeMin: { min: 0, category: `Lifetime` }, lifetimeMax: { min: 0, category: `Lifetime` }, shape: { enum: [{ label: `Point`, value: 0 }, { label: `Circle`, value: 1 }, { label: `Rectangle`, value: 2 }, { label: `Cone`, value: 3 }], category: `Shape` }, shapeRadius: { min: 0, category: `Shape` }, shapeSize: { category: `Shape` }, shapeAngle: { unit: `\xB0`, category: `Shape` }, speedMin: { category: `Velocity` }, speedMax: { category: `Velocity` }, angleSpreadMin: { unit: `\xB0`, category: `Velocity` }, angleSpreadMax: { unit: `\xB0`, category: `Velocity` }, startSizeMin: { min: 0, category: `Size` }, startSizeMax: { min: 0, category: `Size` }, endSizeMin: { min: 0, category: `Size` }, endSizeMax: { min: 0, category: `Size` }, sizeEasing: { enum: [{ label: `Linear`, value: 0 }, { label: `EaseIn`, value: 1 }, { label: `EaseOut`, value: 2 }, { label: `EaseInOut`, value: 3 }], category: `Size` }, startColor: { category: `Color` }, endColor: { category: `Color` }, colorEasing: { enum: [{ label: `Linear`, value: 0 }, { label: `EaseIn`, value: 1 }, { label: `EaseOut`, value: 2 }, { label: `EaseInOut`, value: 3 }], category: `Color` }, rotationMin: { unit: `\xB0`, category: `Rotation` }, rotationMax: { unit: `\xB0`, category: `Rotation` }, angularVelocityMin: { category: `Rotation` }, angularVelocityMax: { category: `Rotation` }, gravity: { category: `Velocity` }, damping: { min: 0, category: `Velocity` }, noiseStrength: { min: 0, category: `Noise` }, noiseFrequency: { min: 0, category: `Noise` }, noiseScrollSpeed: { category: `Noise` }, noiseOctaves: { min: 1, max: 8, step: 1, category: `Noise` }, texture: { category: `Texture` }, spriteColumns: { min: 1, step: 1, category: `Texture` }, spriteRows: { min: 1, step: 1, category: `Texture` }, spriteFPS: { min: 0, category: `Texture` }, spriteLoop: { category: `Texture` }, blendMode: { category: `Rendering` }, layer: { step: 1, category: `Rendering`, enumSource: `sortingLayers` }, material: { category: `Rendering` }, simulationSpace: { enum: [{ label: `World`, value: 0 }, { label: `Local`, value: 1 }], category: `Rendering` }, subEmitterTrigger: { enum: [{ label: `Death`, value: 0 }, { label: `Birth`, value: 1 }], category: `SubEmitter` }, subEmitterChance: { min: 0, max: 1, category: `SubEmitter` }, subEmitterInheritVelocity: { min: 0, max: 1, category: `SubEmitter` }, subEmitter: { category: `SubEmitter` }, trailEnabled: { category: `Trail` }, trailWidth: { min: 0, category: `Trail` }, trailPoints: { min: 2, max: 12, step: 1, category: `Trail` }, trailMinDistance: { min: 0, category: `Trail` }, collisionEnabled: { category: `Collision` }, collisionFloor: { category: `Collision` }, collisionBounce: { min: 0, max: 1, category: `Collision` }, collisionFriction: { min: 0, max: 1, category: `Collision` }, collisionLifetimeLoss: { min: 0, max: 1, category: `Collision` } } }, ParticleForceField: { defaults: { type: 0, strength: 200, radius: 0, direction: { x: 1, y: 0 }, falloff: true, enabled: true }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: { type: { enum: [{ label: `Directional`, value: 0 }, { label: `Point`, value: 1 }, { label: `Vortex`, value: 2 }, { label: `Drag`, value: 3 }], category: `Field` }, strength: { category: `Field` }, radius: { min: 0, category: `Field` }, direction: { category: `Field` }, falloff: { category: `Field` } } }, RigidBody: { defaults: { bodyType: 2, gravityScale: 1, linearDamping: 0, angularDamping: 0, fixedRotation: false, bullet: false, enabled: true }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: { bodyType: { enum: [{ label: `Static`, value: 0 }, { label: `Kinematic`, value: 1 }, { label: `Dynamic`, value: 2 }] } } }, SegmentCollider: { defaults: { point1: { x: -0.5, y: 0 }, point2: { x: 0.5, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, ShadowCaster2D: { defaults: { size: { x: 32, y: 32 }, enabled: true }, renderableField: `enabled`, assetFields: [], entityFields: [], colorFields: [], animatableFields: [`size.x`, `size.y`], fields: { size: { min: 0, tooltip: `Occluder box size in world units (centered on the entity).` } } }, ShapeRenderer: { defaults: { shapeType: 0, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: 100, y: 100 }, cornerRadius: 0, layer: 0, parallax: { x: 1, y: 1 }, enabled: true }, renderableField: `enabled`, assetFields: [], entityFields: [], colorFields: [`color`], animatableFields: [], fields: { shapeType: { enum: [{ label: `Circle`, value: 0 }, { label: `Capsule`, value: 1 }, { label: `RoundedRect`, value: 2 }] }, cornerRadius: { min: 0 }, layer: { step: 1, enumSource: `sortingLayers` }, parallax: { tooltip: `Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).`, advanced: true } } }, SpineAnimation: { defaults: { skeletonPath: ``, atlasPath: ``, skin: ``, animation: ``, timeScale: 1, loop: true, playing: true, flipX: false, flipY: false, color: { r: 1, g: 1, b: 1, a: 1 }, layer: 0, skeletonScale: 1, material: 0, enabled: true }, renderableField: `enabled`, assetFields: [{ field: `material`, type: `material` }], skeletal: { skeletonField: `skeletonPath`, atlasField: `atlasPath`, runtime: `spine` }, entityFields: [], colorFields: [`color`], animatableFields: [], fields: { skin: { enumSource: `spineSkins` }, animation: { enumSource: `spineAnimations` }, timeScale: { min: 0 }, layer: { step: 1, enumSource: `sortingLayers` }, skeletonScale: { min: 0 } } }, Sprite: { defaults: { texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: 1, y: 1 }, pivot: { x: 0.5, y: 0.5 }, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, layer: 0, lit: false, flipX: false, flipY: false, tileSize: { x: 0, y: 0 }, tileSpacing: { x: 0, y: 0 }, parallax: { x: 1, y: 1 }, material: 0, enabled: true }, editorDefaults: { size: { x: 100, y: 100 } }, renderableField: `enabled`, assetFields: [{ field: `texture`, type: `texture` }, { field: `material`, type: `material` }], entityFields: [], colorFields: [`color`], animatableFields: [`color.r`, `color.g`, `color.b`, `color.a`, `size.x`, `size.y`], fields: { color: { tooltip: `Tint multiplied into the texture (white = unchanged).` }, pivot: { tooltip: `Anchor point the sprite rotates and scales about, as a fraction of its size (0.5,0.5 = centre). Values outside 0\u20131 sit off the sprite.`, normalizedOf: `size` }, uvOffset: { advanced: true }, uvScale: { advanced: true }, layer: { step: 1, tooltip: `Sorting layer \u2014 controls draw order across sprites.`, enumSource: `sortingLayers` }, lit: { tooltip: `Receive 2D lights: Light2D entities light this sprite (flat normal). A custom material overrides this.` }, tileSize: { advanced: true }, tileSpacing: { advanced: true }, parallax: { tooltip: `Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).`, advanced: true }, material: { advanced: true } } }, TilemapLayer: { defaults: { cellSize: { x: 32, y: 32 }, orientation: 0, hexSideLength: 0, staggerAxis: 0, staggerIndex: 0, originOffset: { x: 0, y: 0 }, tileset: 0, tilesetColumns: 1, tilesetRows: 1, renderLayer: 0, tintColor: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, parallaxFactor: { x: 1, y: 1 }, visible: true }, renderableField: `visible`, assetFields: [{ field: `tileset`, type: `texture` }], entityFields: [], colorFields: [`tintColor`], animatableFields: [`tintColor.r`, `tintColor.g`, `tintColor.b`, `tintColor.a`, `opacity`], fields: { orientation: { enum: [{ label: `Orthogonal`, value: 0 }, { label: `Isometric`, value: 1 }, { label: `Staggered`, value: 2 }, { label: `Hexagonal`, value: 3 }], tooltip: `Grid layout: orthogonal, isometric, staggered, or hexagonal.` }, hexSideLength: { min: 0, step: 1, tooltip: `Hexagonal side length in px (0 = a regular pointy hex = tileHeight/2). Ignored unless orientation is Hexagonal.` }, staggerAxis: { enum: [{ label: `Y`, value: 0 }, { label: `X`, value: 1 }], tooltip: `Stagger axis (staggered/hex): Y shifts rows, X shifts columns.` }, staggerIndex: { enum: [{ label: `Odd`, value: 0 }, { label: `Even`, value: 1 }], tooltip: `Which lines carry the half-cell shift (staggered/hex).` }, tilesetColumns: { min: 1, step: 1 }, tilesetRows: { min: 1, step: 1 }, renderLayer: { step: 1, enumSource: `sortingLayers` }, opacity: { min: 0, max: 1, slider: true, tooltip: `Layer transparency (0 = invisible, 1 = opaque).` } } }, TrailRenderer: { defaults: { time: 0.5, minVertexDistance: 5, emitting: true, startWidth: 20, endWidth: 0, startColor: { r: 1, g: 1, b: 1, a: 1 }, endColor: { r: 1, g: 1, b: 1, a: 0 }, texture: 0, blendMode: 0, layer: 0, material: 0, enabled: true }, renderableField: `enabled`, assetFields: [{ field: `texture`, type: `texture` }, { field: `material`, type: `material` }], entityFields: [], colorFields: [`startColor`, `endColor`], animatableFields: [`startColor.r`, `startColor.g`, `startColor.b`, `startColor.a`, `endColor.r`, `endColor.g`, `endColor.b`, `endColor.a`], fields: { time: { min: 0, tooltip: `Seconds each trail point lives before it fades out of the tail.`, category: `Trail` }, minVertexDistance: { min: 0, tooltip: `Min world distance moved before a new trail point is recorded.`, category: `Trail` }, emitting: { tooltip: `Record new points. False = freeze and let the streak fade in place.`, category: `Trail` }, startWidth: { min: 0, tooltip: `Full ribbon width at the head (newest point).`, category: `Width` }, endWidth: { min: 0, tooltip: `Full ribbon width at the tail (oldest point).`, category: `Width` }, startColor: { tooltip: `Color at the head (newest point).`, category: `Color` }, endColor: { tooltip: `Color at the tail (oldest point) \u2014 usually alpha 0 to fade out.`, category: `Color` }, texture: { category: `Rendering` }, blendMode: { tooltip: `Blend mode: 0 Normal, 1 Additive (glow), 2 Multiply, \u2026`, category: `Rendering` }, layer: { step: 1, tooltip: `Sorting layer \u2014 controls draw order across renderables.`, category: `Rendering`, enumSource: `sortingLayers` }, material: { category: `Rendering`, advanced: true } } }, Transform: { defaults: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, worldPosition: { x: 0, y: 0, z: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 }, worldScale: { x: 1, y: 1, z: 1 } }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [`position.x`, `position.y`, `position.z`, `rotation.z`, `scale.x`, `scale.y`, `scale.z`], replicatedFields: [`position`, `rotation`, `scale`], readonlyFields: [`worldPosition`, `worldRotation`, `worldScale`], fields: { position: { tooltip: `Local position in world units, relative to the parent.` }, rotation: { tooltip: `Rotation about the Z axis, in degrees.` }, scale: { tooltip: `Local scale per axis (1 = original size; negative flips).` } } }, UIInteraction: { defaults: { hovered: false, pressed: false, justPressed: false, justReleased: false }, transient: true, assetFields: [], entityFields: [], colorFields: [], animatableFields: [] }, UIMask: { defaults: { enabled: true, mode: 0, alphaCutoff: 0 }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: { mode: { enum: [{ label: `Scissor`, value: 0 }, { label: `Stencil`, value: 1 }] }, alphaCutoff: { tooltip: `Stencil only: above 0, clip to the mask sprite's shape instead of its box.` } } }, UINode: { defaults: { position: 0, display: 0, opacity: 1, pointerEvents: 0, width: { value: 0, unit: 2 }, height: { value: 0, unit: 2 }, minWidth: { value: 0, unit: 2 }, minHeight: { value: 0, unit: 2 }, maxWidth: { value: 0, unit: 2 }, maxHeight: { value: 0, unit: 2 }, flexGrow: 0, flexShrink: 1, flexBasis: { value: 0, unit: 2 }, alignSelf: 0, marginLeft: { value: 0, unit: 0 }, marginTop: { value: 0, unit: 0 }, marginRight: { value: 0, unit: 0 }, marginBottom: { value: 0, unit: 0 }, insetLeft: { value: 0, unit: 2 }, insetTop: { value: 0, unit: 2 }, insetRight: { value: 0, unit: 2 }, insetBottom: { value: 0, unit: 2 } }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: { position: { enum: [{ label: `Relative`, value: 0 }, { label: `Absolute`, value: 1 }] }, display: { enum: [{ label: `Flex`, value: 0 }, { label: `None`, value: 1 }], tooltip: `None removes this node and its whole subtree from layout, rendering and input.` }, opacity: { min: 0, max: 1, tooltip: `Subtree opacity, multiplied down the tree. Fades this node and everything under it.` }, pointerEvents: { enum: [{ label: `Auto`, value: 0 }, { label: `None`, value: 1 }], tooltip: `None makes this node and its subtree transparent to the pointer \u2014 hits pass through to what is behind.` }, alignSelf: { enum: [{ label: `Auto`, value: 0 }, { label: `Start`, value: 1 }, { label: `Center`, value: 2 }, { label: `End`, value: 3 }, { label: `Stretch`, value: 4 }] } } }, UIScroll: { defaults: { enabled: true, content: 0, horizontal: false, vertical: true, movement: 0, wheelSpeed: 1, dragScroll: true, decelerationRate: 0.135 }, assetFields: [], entityFields: [`content`], colorFields: [], animatableFields: [], fields: { content: { tooltip: `The child that scrolls inside this node. Leave empty to use the first child.` }, movement: { enum: [{ label: `Clamped`, value: 0 }, { label: `Elastic`, value: 1 }], tooltip: `Clamped stops at the ends; Elastic overshoots and springs back.` }, wheelSpeed: { min: 0 }, decelerationRate: { min: 0, max: 1, tooltip: `Fraction of flick velocity kept per second. 0 stops on release.` } } }, UIVisual: { defaults: { visualType: 0, texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, fit: 0, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 }, fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true }, renderableField: `enabled`, assetFields: [{ field: `texture`, type: `texture` }, { field: `material`, type: `material` }], entityFields: [], colorFields: [`color`], animatableFields: [`color.r`, `color.g`, `color.b`, `color.a`, `fillAmount`], fields: { visualType: { enum: [{ label: `None`, value: 0 }, { label: `SolidColor`, value: 1 }, { label: `Image`, value: 2 }, { label: `NineSlice`, value: 3 }, { label: `Tiled`, value: 4 }, { label: `Filled`, value: 5 }] }, fit: { enum: [{ label: `Fill`, value: 0 }, { label: `Contain`, value: 1 }, { label: `Cover`, value: 2 }], tooltip: `How the image fits its box: Fill stretches, Contain letterboxes it whole, Cover fills and crops.` }, fillMethod: { enum: [{ label: `Horizontal`, value: 0 }, { label: `Vertical`, value: 1 }, { label: `Radial360`, value: 2 }, { label: `Radial90`, value: 3 }, { label: `Radial180`, value: 4 }] }, fillOrigin: { enum: [{ label: `Left`, value: 0 }, { label: `Right`, value: 1 }, { label: `Bottom`, value: 2 }, { label: `Top`, value: 3 }] } } }, Velocity: { defaults: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, assetFields: [], entityFields: [], colorFields: [], animatableFields: [], replicatedFields: [`linear`, `angular`] } };
var Ee = (function(e8) {
  return e8[e8.Auto = 0] = `Auto`, e8[e8.Start = 1] = `Start`, e8[e8.Center = 2] = `Center`, e8[e8.End = 3] = `End`, e8[e8.Stretch = 4] = `Stretch`, e8;
})({});
var De = (function(e8) {
  return e8[e8.Static = 0] = `Static`, e8[e8.Kinematic = 1] = `Kinematic`, e8[e8.Dynamic = 2] = `Dynamic`, e8;
})({});
var Oe = (function(e8) {
  return e8[e8.FixedWidth = 0] = `FixedWidth`, e8[e8.FixedHeight = 1] = `FixedHeight`, e8[e8.Expand = 2] = `Expand`, e8[e8.Shrink = 3] = `Shrink`, e8[e8.Match = 4] = `Match`, e8;
})({});
var ke = (function(e8) {
  return e8[e8.Nothing = 0] = `Nothing`, e8[e8.Color = 1] = `Color`, e8[e8.Depth = 2] = `Depth`, e8[e8.ColorAndDepth = 3] = `ColorAndDepth`, e8;
})({});
var Ae = (function(e8) {
  return e8[e8.Point = 0] = `Point`, e8[e8.Circle = 1] = `Circle`, e8[e8.Rectangle = 2] = `Rectangle`, e8[e8.Cone = 3] = `Cone`, e8;
})({});
var je = (function(e8) {
  return e8[e8.Directional = 0] = `Directional`, e8[e8.Point = 1] = `Point`, e8[e8.Vortex = 2] = `Vortex`, e8[e8.Drag = 3] = `Drag`, e8;
})({});
var Me = (function(e8) {
  return e8[e8.Point = 0] = `Point`, e8[e8.Directional = 1] = `Directional`, e8[e8.Ambient = 2] = `Ambient`, e8[e8.Spot = 3] = `Spot`, e8;
})({});
var Ne = (function(e8) {
  return e8[e8.Linear = 0] = `Linear`, e8[e8.EaseIn = 1] = `EaseIn`, e8[e8.EaseOut = 2] = `EaseOut`, e8[e8.EaseInOut = 3] = `EaseInOut`, e8;
})({});
var Pe = (function(e8) {
  return e8[e8.Perspective = 0] = `Perspective`, e8[e8.Orthographic = 1] = `Orthographic`, e8;
})({});
var Fe = (function(e8) {
  return e8[e8.Circle = 0] = `Circle`, e8[e8.Capsule = 1] = `Capsule`, e8[e8.RoundedRect = 2] = `RoundedRect`, e8;
})({});
var Ie = (function(e8) {
  return e8[e8.World = 0] = `World`, e8[e8.Local = 1] = `Local`, e8;
})({});
var Le = (function(e8) {
  return e8[e8.Death = 0] = `Death`, e8[e8.Birth = 1] = `Birth`, e8;
})({});
var Re = (function(e8) {
  return e8[e8.Flex = 0] = `Flex`, e8[e8.None = 1] = `None`, e8;
})({});
var ze = (function(e8) {
  return e8[e8.Horizontal = 0] = `Horizontal`, e8[e8.Vertical = 1] = `Vertical`, e8[e8.Radial360 = 2] = `Radial360`, e8[e8.Radial90 = 3] = `Radial90`, e8[e8.Radial180 = 4] = `Radial180`, e8;
})({});
var Be = (function(e8) {
  return e8[e8.Left = 0] = `Left`, e8[e8.Right = 1] = `Right`, e8[e8.Bottom = 2] = `Bottom`, e8[e8.Top = 3] = `Top`, e8;
})({});
var Ve = (function(e8) {
  return e8[e8.Auto = 0] = `Auto`, e8[e8.None = 1] = `None`, e8;
})({});
var He = (function(e8) {
  return e8[e8.Relative = 0] = `Relative`, e8[e8.Absolute = 1] = `Absolute`, e8;
})({});
var Ue = (function(e8) {
  return e8[e8.None = 0] = `None`, e8[e8.SolidColor = 1] = `SolidColor`, e8[e8.Image = 2] = `Image`, e8[e8.NineSlice = 3] = `NineSlice`, e8[e8.Tiled = 4] = `Tiled`, e8[e8.Filled = 5] = `Filled`, e8;
})({});
var We = (function(e8) {
  return e8[e8.Normal = 0] = `Normal`, e8[e8.Additive = 1] = `Additive`, e8[e8.Multiply = 2] = `Multiply`, e8[e8.Screen = 3] = `Screen`, e8[e8.PremultipliedAlpha = 4] = `PremultipliedAlpha`, e8[e8.PmaAdditive = 5] = `PmaAdditive`, e8[e8.Lighten = 6] = `Lighten`, e8[e8.Darken = 7] = `Darken`, e8[e8.Overlay = 8] = `Overlay`, e8[e8.None = 9] = `None`, e8;
})({});
function Ge(e8, t2) {
  let n2 = /* @__PURE__ */ new Set(), r2 = [];
  for (let [i2, a2] of Object.entries(e8)) typeof a2 == `number` && ((t2 ? !t2.includes(i2) : n2.has(a2)) || (n2.add(a2), r2.push({ label: i2, value: a2 })));
  return r2;
}
function Ke(e8) {
  let t2 = [], n2 = [], r2 = [], i2 = false;
  for (let a2 in e8) {
    let o2 = e8[a2];
    typeof o2 == `object` && o2 ? (i2 = true, Array.isArray(o2) ? r2.push(a2) : n2.push(a2)) : t2.push(a2);
  }
  return i2 ? { flatKeys: t2, objectKeys: n2, arrayKeys: r2 } : null;
}
var qe = /* @__PURE__ */ new Map();
function Je(e8) {
  let t2 = qe.get(e8);
  return t2 === void 0 && (t2 = /* @__PURE__ */ Symbol(`Component_${e8}`), qe.set(e8, t2)), t2;
}
function Ye(e8, t2, n2) {
  if (typeof e8 != `string` || e8 === ``) {
    let t3 = e8 === null ? `null` : Array.isArray(e8) ? `an array` : typeof e8 == `object` ? `an object with keys ${Object.keys(e8).join(`, `)}` : `${typeof e8} ${JSON.stringify(e8)}`;
    throw Error(`defineComponent takes the NAME first and the defaults second \u2014 defineComponent('MyThing', { speed: 100 }) \u2014 but was given ${t3}. Each field's inspector control comes from the TYPE of its default value, so the second argument is real values (speed: 100), not a description of them ({ speed: 'number' }).`);
  }
  if (typeof t2 != `object` || !t2) throw Error(`Component "${e8}": the second argument is the defaults OBJECT \u2014 defineComponent('${e8}', { speed: 100 }) \u2014 but was given ${t2 === void 0 ? `nothing` : JSON.stringify(t2)}.`);
  let r2 = Ke(t2), i2 = t2;
  for (let t3 of n2?.replicatedFields ?? []) if (!(t3 in i2)) throw Error(`Component "${e8}": replicatedFields names unknown field "${t3}"`);
  let a2 = n2?.renderableField;
  if (a2 !== void 0 && typeof i2[a2] != `boolean`) throw Error(`Component "${e8}": renderableField "${a2}" is not a boolean field of its defaults`);
  return { _id: Je(e8), _name: e8, _default: t2, _builtin: false, assetFields: n2?.assetFields ?? [], skeletalFields: n2?.skeletalFields, entityFields: n2?.entityFields ?? [], colorKeys: mt(t2), animatableFields: n2?.animatableFields ?? ht(t2), replicatedFields: n2?.replicatedFields ?? [], readonlyFields: n2?.readonlyFields ?? [], fieldMeta: n2?.fields ?? {}, discoverAssets: n2?.discoverAssets, transient: n2?.transient ?? false, renderableField: a2 ?? null, create(e9) {
    if (r2) {
      let t3 = { ...i2 };
      for (let e10 of r2.objectKeys) t3[e10] = { ...i2[e10] };
      for (let e10 of r2.arrayKeys) t3[e10] = i2[e10].slice();
      if (e9) {
        let n3 = e9;
        for (let e10 of Object.keys(n3)) n3[e10] !== void 0 && (r2.objectKeys.includes(e10) && typeof n3[e10] == `object` && n3[e10] !== null && !Array.isArray(n3[e10]) ? Object.assign(t3[e10], n3[e10]) : t3[e10] = n3[e10]);
      }
      return t3;
    }
    return e9 ? { ...t2, ...e9 } : { ...t2 };
  } };
}
function O() {
  return n().componentRegistry;
}
function k(e8, t2, n2) {
  let r2 = O().get(e8);
  if (r2) return r2;
  if (j.has(e8)) throw Error(`Component name collision: user component "${e8}" conflicts with an existing builtin component of the same name`);
  let i2 = Ye(e8, t2, n2);
  return O().set(e8, i2), N++, rt(e8, t2, false), i2;
}
function Xe(e8) {
  let t2 = O().get(e8);
  if (t2) return t2;
  if (j.has(e8)) throw Error(`Component name collision: tag "${e8}" conflicts with an existing builtin component of the same name`);
  let n2 = Ye(e8, {});
  return O().set(e8, n2), N++, rt(e8, {}, true), n2;
}
var et = null;
function tt() {
  et = new Map(O());
}
function rt(e8, t2, r2) {
  n().editorBridge?.registerComponent(e8, t2, r2);
}
var j = /* @__PURE__ */ new Map();
function it(e8, t2) {
  j.set(e8, t2);
}
function at() {
  let e8 = new Map(j);
  for (let [t2, n2] of O()) e8.set(t2, n2);
  return e8;
}
function M(e8) {
  return j.get(e8) ?? O().get(e8);
}
var N = 0;
function pt(e8, t2) {
  let n2 = { ...e8 };
  for (let r2 of Object.keys(t2)) n2[r2] = { ...e8[r2], ...t2[r2] };
  return n2;
}
function mt(e8) {
  if (typeof e8 != `object` || !e8) return [];
  let t2 = [];
  for (let n2 of Object.keys(e8)) {
    let r2 = e8[n2];
    if (typeof r2 == `object` && r2 && !Array.isArray(r2)) {
      let e9 = r2;
      `r` in e9 && `g` in e9 && `b` in e9 && `a` in e9 && t2.push(n2);
    }
  }
  return t2;
}
function ht(e8) {
  if (typeof e8 != `object` || !e8) return [];
  let t2 = [];
  for (let [n2, r2] of Object.entries(e8)) if (typeof r2 == `number`) t2.push(n2);
  else if (typeof r2 == `object` && r2 && !Array.isArray(r2)) for (let [e9, i2] of Object.entries(r2)) typeof i2 == `number` && t2.push(`${n2}.${e9}`);
  return t2;
}
function P(e8, t2, n2) {
  let r2 = j.get(e8) ?? O().get(e8);
  if (r2) {
    if (r2._builtin) return r2;
    throw Error(`Component name collision: builtin component "${e8}" conflicts with an existing user component of the same name`);
  }
  let i2 = D[e8], a2 = { _id: /* @__PURE__ */ Symbol(`Builtin_${e8}`), _name: e8, _cppName: e8, _builtin: true, _default: t2, assetFields: n2?.assetFields ?? i2?.assetFields ?? [], skeletalFields: n2?.skeletalFields ?? i2?.skeletal, entityFields: n2?.entityFields ?? i2?.entityFields ?? [], colorKeys: i2?.colorFields ?? mt(t2), animatableFields: i2?.animatableFields ?? [], replicatedFields: i2?.replicatedFields ?? [], readonlyFields: i2?.readonlyFields ?? [], fieldMeta: pt(i2?.fields ?? {}, n2?.fields ?? {}), discoverAssets: n2?.discoverAssets, transient: n2?.transient ?? i2?.transient ?? false, renderableField: n2?.renderableField ?? i2?.renderableField ?? null };
  return j.set(e8, a2), a2;
}
function gt() {
  for (let e8 of Object.keys(D)) j.has(e8) || P(e8, F(e8));
}
function F(e8, t2) {
  let n2 = D[e8];
  return { ...n2?.defaults, ...n2?.editorDefaults, ...t2 };
}
var I = P(`Transform`, F(`Transform`));
var yt = I;
var bt = P(`Sprite`, F(`Sprite`));
var xt = P(`ShapeRenderer`, F(`ShapeRenderer`));
var St = P(`Light2D`, F(`Light2D`));
var Ct = P(`ShadowCaster2D`, F(`ShadowCaster2D`));
var wt = P(`Camera`, F(`Camera`, { showFrustum: false }), { fields: { clearFlags: { flags: [{ label: `Color`, value: 1 }, { label: `Depth`, value: 2 }] }, showFrustum: { advanced: true } } });
var Tt = P(`Canvas`, F(`Canvas`));
var Et = P(`Velocity`, F(`Velocity`));
var L = P(`Parent`, F(`Parent`));
var R = P(`Children`, F(`Children`));
var Dt = P(`BitmapText`, F(`BitmapText`));
var Ot = P(`SpineAnimation`, F(`SpineAnimation`));
var kt = P(`DragonBonesAnimation`, F(`DragonBonesAnimation`));
var At = P(`Mesh2D`, F(`Mesh2D`, { geometry: { positions: [], indices: [] } }));
var jt = P(`TrailRenderer`, F(`TrailRenderer`));
var Mt = P(`ParticleForceField`, F(`ParticleForceField`));
var Nt = P(`TilemapLayer`, F(`TilemapLayer`), { discoverAssets: (e8) => {
  let t2 = [], n2 = e8.tileset;
  typeof n2 == `string` && n2 && t2.push({ type: `texture`, path: n2 });
  let r2 = e8.tilesetAssets;
  if (Array.isArray(r2) && r2.length > 0) for (let e9 of r2) typeof e9 == `string` && e9 && t2.push({ type: `tileset`, path: e9 });
  else {
    let n3 = e8.tilesetAsset;
    typeof n3 == `string` && n3 && t2.push({ type: `tileset`, path: n3 });
  }
  return t2;
} });
var Pt = P(`ParticleEmitter`, F(`ParticleEmitter`, { colorGradient: { stops: [] }, sizeCurve: { keys: [] } }), { fields: { blendMode: { enum: Ge(We) }, sizeCurve: { curve: true, category: `Size` }, colorGradient: { gradient: true, category: `Color` } } });
var Ft = Xe(`Disabled`);
var It = Xe(`RuntimeOnly`);
var z = k(`Name`, { value: `` });
var Lt = k(`SceneOwner`, { scene: ``, persistent: false });
var Rt = k(`Marker`, { type: ``, properties: {} }, { fields: { properties: { map: true } } });
var zt = k(`PostProcessVolume`, { effects: [], isGlobal: true, shape: `box`, size: { x: 5, y: 5 }, priority: 0, weight: 1, blendDistance: 0 }, { discoverAssets: (e8) => {
  let t2 = [], n2 = e8.effects;
  if (Array.isArray(n2)) for (let e9 of n2) {
    let n3 = e9.textures;
    if (n3) for (let e10 of Object.values(n3)) typeof e10 == `string` && e10 && t2.push({ type: `texture`, path: e10 });
  }
  return t2;
} });
function Bt(e8) {
  let t2 = M(e8);
  return t2 ? E(t2._default) : null;
}
var Vt = 2 ** 22;
var Ht = Vt - 1;
function B(e8, t2) {
  if (e8 instanceof _) throw e8;
  let r2 = n().wasmError, i2 = Date.now();
  if (i2 - r2.lastReportTime < 1e3) {
    r2.suppressedCount++;
    return;
  }
  r2.suppressedCount > 0 && (T.warn(`wasm`, `${r2.suppressedCount} WASM error(s) suppressed`), r2.suppressedCount = 0), r2.lastReportTime = i2, T.error(`wasm`, `error in ${t2}`, e8), r2.handler && r2.handler(e8, t2);
}
function V(e8, t2, n2, r2) {
  let i2 = [];
  return rn(i2, t2, n2, r2, ``), i2;
}
function rn(e8, t2, n2, r2, i2) {
  for (let [a2, o2] of Object.entries(n2)) {
    if (a2.startsWith(`_`)) continue;
    let n3 = i2 ? `${i2}.${a2}` : a2;
    if (!(a2 in t2)) {
      i2 || e8.push({ field: n3, expected: `field to exist in component definition`, actual: `unknown field`, value: o2 });
      continue;
    }
    let s2 = t2[a2], c2 = an(s2), l2 = an(o2);
    if (c2 !== `null` && c2 !== `undefined` && o2 != null) {
      if (c2 !== l2) {
        if (!i2 && r2?.has(a2) && (c2 === `string` && l2 === `number` || c2 === `number` && l2 === `string`)) continue;
        e8.push({ field: n3, expected: c2, actual: l2, value: o2 });
        continue;
      }
      c2 === `object` && rn(e8, s2, o2, void 0, n3);
    }
  }
}
function H(e8) {
  return new Set((e8.assetFields ?? []).map((e9) => e9.field));
}
function an(e8) {
  return e8 === null ? `null` : e8 === void 0 ? `undefined` : Array.isArray(e8) ? `array` : typeof e8;
}
function U(e8, t2) {
  let n2 = [`Invalid component data for "${e8}":`];
  for (let e9 of t2) n2.push(`  - Field "${e9.field}": expected ${e9.expected}, got ${e9.actual} (${JSON.stringify(e9.value)})`);
  return n2.join(`
`);
}
var Lr = 2 ** 53 - 1;
var $r = new Float32Array();
var ei = new Uint32Array();
var ti = new Uint8Array();
var oi = null;
function ci(e8) {
  return e8.wasmModule ?? oi;
}
function li(e8) {
  return e8.getWasmModule() ?? oi;
}
function hi(e8) {
  return { _type: `mut`, _component: e8 };
}
function gi(e8) {
  return typeof e8 == `object` && !!e8 && `_type` in e8 && e8._type === `mut`;
}
function yi(e8) {
  return typeof e8 == `object` && !!e8 && `_filterType` in e8 && e8._filterType === `added`;
}
function bi(e8) {
  return typeof e8 == `object` && !!e8 && `_filterType` in e8 && e8._filterType === `changed`;
}
function Z(e8, t2 = [], n2 = [], r2 = null) {
  let i2 = [], a2 = [], o2 = [];
  return e8.forEach((e9, t3) => {
    gi(e9) && i2.push(t3), yi(e9) ? a2.push({ index: t3, component: e9._component }) : bi(e9) && o2.push({ index: t3, component: e9._component });
  }), { _type: `query`, _components: e8, _mutIndices: i2, _with: t2, _without: n2, _addedFilters: a2, _changedFilters: o2, _filter: r2, with(...i3) {
    return Z(e8, [...t2, ...i3], n2, r2);
  }, without(...i3) {
    return Z(e8, t2, [...n2, ...i3], r2);
  }, filter(r3) {
    return Z(e8, t2, n2, r3);
  } };
}
function Oi(...e8) {
  return Z(e8);
}
function Mi() {
  return { _type: `commands` };
}
var Vi = (function(e8) {
  return e8[e8.Startup = 0] = `Startup`, e8[e8.First = 1] = `First`, e8[e8.PreUpdate = 2] = `PreUpdate`, e8[e8.Update = 3] = `Update`, e8[e8.PostUpdate = 4] = `PostUpdate`, e8[e8.Last = 5] = `Last`, e8[e8.FixedPreUpdate = 10] = `FixedPreUpdate`, e8[e8.FixedUpdate = 11] = `FixedUpdate`, e8[e8.FixedPostUpdate = 12] = `FixedPostUpdate`, e8;
})({});
function Hi() {
  return { _type: `get_world` };
}
var Ui = 0;
function Wi(e8, t2, n2) {
  let r2 = ++Ui;
  return { _id: /* @__PURE__ */ Symbol(`SystemTemplate_${r2}`), _params: e8, _fn: t2, _name: n2?.name ?? ``, _runBefore: n2?.runBefore, _runAfter: n2?.runAfter, _touches: n2?.touches };
}
var $i = 0;
function ea(e8, t2) {
  let n2 = ++$i;
  return { _id: /* @__PURE__ */ Symbol(`Resource_${n2}_${t2 ?? ``}`), _name: t2 ?? `Resource_${n2}`, _default: e8 };
}
function ta(e8) {
  return { _type: `res`, _resource: e8 };
}
function na(e8) {
  return { _type: `res_mut`, _resource: e8 };
}
var aa = ea({ delta: 0, elapsed: 0, frameCount: 0, fixedDelta: 1 / 60, fixedAlpha: 0, fixedTick: 0, scale: 1, unscaledDelta: 0 }, `Time`);

// sdk/dist/shared/enableSync.js
var p2 = { nearest: 0, linear: 1 };
var m2 = { repeat: 0, clamp: 1, mirror: 2 };
function ee2(e8, n2, r2 = true, a2) {
  let o2 = le(), c2 = g() && (a2?.srgb ?? true) ? 2 : 1;
  if (o2.createTextureFromBytes) {
    let e9 = a2?.filterMode ? p2[a2.filterMode] ?? 1 : void 0, t2 = a2?.wrapMode ? m2[a2.wrapMode] ?? 1 : void 0;
    return o2.createTextureFromBytes(n2.width, n2.height, n2.pixels, c2, r2, e9, t2);
  }
  if (!e8) throw Error(`createTextureFromPixels: a wasm module is required for the heap upload path`);
  return he(e8, n2.pixels.length, (t2) => {
    if (e8.HEAPU8.set(n2.pixels, t2), a2 && (a2.filterMode || a2.wrapMode) && o2.createTextureEx) {
      let e9 = p2[a2.filterMode ?? `linear`] ?? 1, i2 = m2[a2.wrapMode ?? `clamp`] ?? 1;
      return o2.createTextureEx(n2.width, n2.height, t2, n2.pixels.length, c2, r2, e9, i2);
    }
    return o2.createTexture(n2.width, n2.height, t2, n2.pixels.length, c2, r2);
  });
}
function te2(e8, n2, r2, a2, o2, s2, c2) {
  if (o2 <= 0 || s2 <= 0 || c2.length === 0) return;
  let l2 = le();
  if (l2.updateTextureSubregionFromBytes) {
    l2.updateTextureSubregionFromBytes(n2, r2, a2, o2, s2, c2);
    return;
  }
  !l2.updateTextureSubregion || !e8 || he(e8, c2.length, (t2) => {
    e8.HEAPU8.set(c2, t2), l2.updateTextureSubregion(n2, r2, a2, o2, s2, t2, c2.length);
  });
}
function ne2(e8, t2) {
  return t2 === `clamp` ? e8.CLAMP_TO_EDGE : t2 === `mirror` ? e8.MIRRORED_REPEAT : e8.REPEAT;
}
function re2(e8, t2, n2, r2) {
  e8.pixelStorei(e8.UNPACK_FLIP_Y_WEBGL, +!!n2), e8.pixelStorei(e8.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  let i2 = g() && (r2 ?? true) ? e8.SRGB8_ALPHA8 : e8.RGBA;
  e8.texImage2D(e8.TEXTURE_2D, 0, i2, e8.RGBA, e8.UNSIGNED_BYTE, t2), e8.pixelStorei(e8.UNPACK_FLIP_Y_WEBGL, 0);
}
function h(e8, t2) {
  let n2 = t2?.filter ?? `linear`, r2 = t2?.mipmaps ?? true, i2 = n2 === `nearest` ? r2 ? e8.NEAREST_MIPMAP_NEAREST : e8.NEAREST : r2 ? e8.LINEAR_MIPMAP_LINEAR : e8.LINEAR;
  e8.texParameteri(e8.TEXTURE_2D, e8.TEXTURE_MIN_FILTER, i2), e8.texParameteri(e8.TEXTURE_2D, e8.TEXTURE_MAG_FILTER, n2 === `nearest` ? e8.NEAREST : e8.LINEAR);
  let a2 = ne2(e8, t2?.wrap);
  e8.texParameteri(e8.TEXTURE_2D, e8.TEXTURE_WRAP_S, a2), e8.texParameteri(e8.TEXTURE_2D, e8.TEXTURE_WRAP_T, a2), r2 && e8.generateMipmap(e8.TEXTURE_2D);
}
var g2 = [171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10];
function ie2(e8) {
  if (e8.length < g2.length) return false;
  for (let t2 = 0; t2 < g2.length; t2++) if (e8[t2] !== g2[t2]) return false;
  return true;
}
function ae2(e8) {
  let t2 = e8.toLowerCase();
  return t2.endsWith(`.ktx2`) || t2.endsWith(`.ktx2.bin`);
}
function oe(e8) {
  return { astc: e8.getExtension(`WEBGL_compressed_texture_astc`), etc: e8.getExtension(`WEBGL_compressed_texture_etc`), s3tc: e8.getExtension(`WEBGL_compressed_texture_s3tc`), s3tcSrgb: e8.getExtension(`WEBGL_compressed_texture_s3tc_srgb`) };
}
var se = { "etc2-rgba8": [1, 6], "astc-4x4": [2, 7], "s3tc-dxt5": [5, 8] };
function _2(e8, t2) {
  return se[e8][+!!t2];
}
function ce2(e8, t2 = false) {
  for (let n2 of [`astc-4x4`, `etc2-rgba8`, `s3tc-dxt5`]) if (e8(_2(n2, t2))) return n2;
  return null;
}
function le2(e8, t2 = false) {
  return e8.astc ? `astc-4x4` : e8.etc ? `etc2-rgba8` : (t2 ? e8.s3tcSrgb : e8.s3tc) ? `s3tc-dxt5` : null;
}
function ue(e8, t2, n2 = false) {
  switch (t2) {
    case `astc-4x4`:
      return e8.astc ? n2 ? e8.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR : e8.astc.COMPRESSED_RGBA_ASTC_4x4_KHR : null;
    case `etc2-rgba8`:
      return e8.etc ? n2 ? e8.etc.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC : e8.etc.COMPRESSED_RGBA8_ETC2_EAC : null;
    case `s3tc-dxt5`:
      return n2 ? e8.s3tcSrgb ? e8.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT : null : e8.s3tc ? e8.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT : null;
  }
  return null;
}
function de(e8, t2) {
  h(e8, { filter: t2?.filter, wrap: t2?.wrap, mipmaps: false });
}
function fe(e8, n2, r2, i2, a2 = 0) {
  let o2 = e8.GL, s2 = o2.getNewId(o2.textures);
  o2.textures[s2] = n2;
  let c2 = le();
  return a2 > 0 && typeof c2.registerExternalTextureSized == `function` ? c2.registerExternalTextureSized(s2, r2, i2, a2) : c2.registerExternalTexture(s2, r2, i2);
}
function pe2(e8, t2, n2, r2, i2, a2) {
  let o2 = ue(n2, r2, a2?.srgb ?? false);
  if (o2 == null) throw Error(`compressed upload: no GL internalformat for ${r2}`);
  let s2 = e8.createTexture();
  if (!s2) throw Error(`compressed upload: gl.createTexture failed`);
  try {
    e8.bindTexture(e8.TEXTURE_2D, s2), e8.compressedTexImage2D(e8.TEXTURE_2D, 0, o2, i2.width, i2.height, 0, i2.data), de(e8, a2);
  } catch (t3) {
    throw e8.deleteTexture(s2), t3;
  }
  return { handle: fe(t2, s2, i2.width, i2.height, i2.data.byteLength), width: i2.width, height: i2.height };
}
function me(e8, t2, n2, r2) {
  let i2 = e8.createTexture();
  if (!i2) throw Error(`rgba upload: gl.createTexture failed`);
  try {
    e8.bindTexture(e8.TEXTURE_2D, i2);
    let t3 = r2?.srgb ? e8.SRGB8_ALPHA8 : e8.RGBA;
    e8.texImage2D(e8.TEXTURE_2D, 0, t3, n2.width, n2.height, 0, e8.RGBA, e8.UNSIGNED_BYTE, n2.data), de(e8, r2);
  } catch (t3) {
    throw e8.deleteTexture(i2), t3;
  }
  return { handle: fe(t2, i2, n2.width, n2.height), width: n2.width, height: n2.height };
}
function he2(e8, t2, n2, r2, i2) {
  let a2 = oe(e8), o2 = le2(a2, i2?.srgb ?? false);
  if (o2 !== null) {
    let s3 = n2.transcode(r2, o2);
    if (s3) return pe2(e8, t2, a2, o2, s3, i2);
  }
  let s2 = n2.transcodeToRgba(r2);
  if (!s2) throw Error(`BasisTranscoder failed to decode KTX2 (compressed and RGBA paths both failed)`);
  return me(e8, t2, s2, i2);
}
var v2 = [{ extensions: [`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`], contentType: `image`, editorType: `texture`, addressableType: `texture`, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`ktx2`], contentType: `binary`, editorType: `texture`, addressableType: `texture`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`mp3`, `wav`, `ogg`, `aac`, `flac`, `m4a`, `webm`], contentType: `audio`, editorType: `audio`, addressableType: `audio`, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`mp4`, `m4v`, `mov`], contentType: `binary`, editorType: `video`, addressableType: `binary`, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`mpg`, `mpeg`, `esv`], contentType: `binary`, editorType: `video`, addressableType: `binary`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`esmaterial`], contentType: `json`, editorType: `material`, addressableType: `material`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`esshader`], contentType: `text`, editorType: `shader`, addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`atlas`], contentType: `text`, editorType: `spine-atlas`, addressableType: `binary`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`skel`], contentType: `binary`, editorType: `spine-skeleton`, addressableType: `spine`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`dbbin`], suffixes: [`_ske.json`], contentType: `binary`, editorType: `dragonbones-skeleton`, addressableType: `binary`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [], suffixes: [`_tex.json`], contentType: `text`, editorType: `dragonbones-atlas`, addressableType: `binary`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`json`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`inputmap`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`bmfont`], contentType: `json`, editorType: `bitmap-font`, addressableType: `bitmap-font`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`fnt`], contentType: `text`, editorType: `bitmap-font`, addressableType: `bitmap-font`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`ttf`, `otf`, `woff`, `woff2`], contentType: `binary`, editorType: `font`, addressableType: `font`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`esprefab`], contentType: `json`, editorType: `prefab`, addressableType: `prefab`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`esscene`], contentType: `json`, editorType: `scene`, addressableType: null, wechatPackInclude: false, hasTransitiveDeps: false }, { extensions: [`esanim`], contentType: `json`, editorType: `anim-clip`, addressableType: null, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`tmj`], contentType: `json`, editorType: `tilemap`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`estileset`], contentType: `json`, editorType: `tileset`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`estimeline`], contentType: `json`, editorType: `timeline`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: true }, { extensions: [`eslocale`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`esfsm`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`esanimator`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: false }, { extensions: [`esbt`], contentType: `json`, editorType: `json`, addressableType: `json`, wechatPackInclude: true, hasTransitiveDeps: false }];
var y2 = /* @__PURE__ */ new Map();
var b2 = /* @__PURE__ */ new Set();
for (let e8 of v2) for (let t2 of e8.extensions) y2.set(t2, e8), b2.add(t2);
function x2(e8) {
  let t2 = e8.lastIndexOf(`.`);
  return t2 >= 0 ? e8.substring(t2 + 1).toLowerCase() : e8.toLowerCase();
}
function S2(e8) {
  let t2 = e8.toLowerCase();
  for (let e9 of v2) if (e9.suffixes?.some((e10) => t2.endsWith(e10))) return e9;
  return y2.get(x2(e8));
}
function T2(e8) {
  return typeof e8.prefab == `string`;
}
var E2 = (e8) => typeof e8 == `string` ? `"${e8}"` : String(e8);
function D2(e8, t2) {
  let n2 = /* @__PURE__ */ new Map();
  for (let r2 of e8) {
    n2.has(r2.id) ? t2(`duplicate-id`, `error`, `entity id ${E2(r2.id)} appears more than once`, r2.id) : n2.set(r2.id, r2);
    let e9 = /* @__PURE__ */ new Set();
    for (let n3 of r2.components) e9.has(n3.type) ? t2(`duplicate-component`, `error`, `entity ${E2(r2.id)} has more than one "${n3.type}" component`, r2.id, n3.type) : e9.add(n3.type);
  }
  return n2;
}
function O2(e8, t2, n2) {
  for (let r2 of e8) {
    if (r2.parent !== null) {
      let e9 = t2.get(r2.parent);
      e9 ? e9.children.includes(r2.id) || n2(`inconsistent-topology`, `error`, `entity ${E2(r2.id)} claims parent ${E2(r2.parent)} but that parent's children omit it`, r2.id) : n2(`missing-parent`, `error`, `entity ${E2(r2.id)} parent ${E2(r2.parent)} does not exist`, r2.id);
    }
    for (let e9 of r2.children) {
      let i2 = t2.get(e9);
      i2 ? i2.parent !== r2.id && n2(`inconsistent-topology`, `error`, `entity ${E2(r2.id)} lists ${E2(e9)} as a child but its parent points elsewhere`, r2.id, String(e9)) : n2(`missing-child`, `error`, `entity ${E2(r2.id)} lists child ${E2(e9)} which does not exist`, r2.id, String(e9));
    }
  }
}
function k2(e8, t2, n2) {
  let r2 = /* @__PURE__ */ new Map();
  for (let t3 of e8) r2.set(t3.id, 0);
  let i2 = false, a2 = (e9, o2) => {
    if (i2) return;
    let s2 = r2.get(e9);
    if (s2 === 2) return;
    if (s2 === 1) {
      n2(`parent-cycle`, `error`, `parent cycle detected: ${o2.slice(o2.indexOf(e9)).concat(e9).map(String).join(` \u2192 `)}`, e9), i2 = true;
      return;
    }
    r2.set(e9, 1);
    let c2 = t2.get(e9);
    c2 && c2.parent !== null && t2.has(c2.parent) && a2(c2.parent, [...o2, e9]), r2.set(e9, 2);
  };
  for (let t3 of e8) a2(t3.id, []);
}
function A(e8, t2, n2, i2) {
  for (let a2 of e8) for (let e9 of a2.components) {
    let o2 = M(e9.type);
    if (!(!o2 || o2.entityFields.length === 0)) for (let r2 of o2.entityFields) {
      let o3 = e9.data[r2];
      (typeof o3 == `string` || typeof o3 == `number`) && (i2(o3) || t2.has(o3) || n2(`dangling-entity-ref`, `warning`, `entity ${E2(a2.id)} field "${e9.type}.${r2}" references ${E2(o3)}, which is not in the document`, a2.id, `${e9.type}.${r2}`));
    }
  }
}
var Oe2 = (e8) => ({ id: e8.id, parent: e8.parent ?? null, children: e8.children ?? [], components: e8.components ?? [] });
function j2(e8) {
  let t2 = [], n2 = (e9, n3, r3, i3, a2) => {
    t2.push({ code: e9, severity: n3, message: r3, ...i3 === void 0 ? {} : { entityId: i3 }, ...a2 === void 0 ? {} : { field: a2 } });
  };
  if (!Array.isArray(e8?.entities)) return n2(`malformed`, `error`, `scene has no "entities" array`), t2;
  let r2 = e8.entities.map(Oe2), i2 = D2(r2, n2);
  O2(r2, i2, n2), k2(r2, i2, n2), A(r2, i2, n2, (e9) => e9 === 0 || typeof e9 != `number`);
  for (let t3 of e8.entities) if (!(T2(t3) || !Array.isArray(t3.components))) for (let e9 of t3.components) (typeof e9?.type != `string` || e9.type.length === 0) && n2(`malformed-component`, `error`, `entity ${t3.id} has a component with no type`, t3.id);
  return t2;
}
function M2(e8) {
  return e8.map((e9) => ({ type: e9.type, data: JSON.parse(JSON.stringify(e9.data)) }));
}
function N2(e8) {
  return JSON.parse(JSON.stringify(e8));
}
function P2(e8) {
  return JSON.parse(JSON.stringify(e8));
}
function F2(e8, t2) {
  for (let n2 of e8) {
    let e9 = M(n2.type);
    if (!(!e9 || e9.entityFields.length === 0)) for (let r2 of e9.entityFields) {
      let e10 = n2.data[r2];
      if (typeof e10 == `string`) {
        let i2 = t2.get(e10);
        n2.data[r2] = i2 === void 0 ? 0 : i2;
      } else if (typeof e10 == `number` && e10 !== 0) {
        let i2 = t2.get(e10);
        i2 !== void 0 && (n2.data[r2] = i2);
      }
    }
  }
}
function I2(e8) {
  let t2 = /* @__PURE__ */ new Map();
  for (let n2 of e8) {
    let e9 = t2.get(n2.prefabEntityId);
    e9 ? e9.push(n2) : t2.set(n2.prefabEntityId, [n2]);
  }
  return t2;
}
function L2(e8, t2) {
  if (!(!t2 || t2.length === 0)) {
    for (let n2 of t2) if (n2.prefabEntityId === e8.prefabEntityId) switch (n2.type) {
      case `property`:
        if (n2.componentType && n2.propertyName !== void 0) {
          let t3 = e8.components.find((e9) => e9.type === n2.componentType);
          t3 && (t3.data[n2.propertyName] = n2.value);
        }
        break;
      case `name`:
        typeof n2.value == `string` && (e8.name = n2.value);
        break;
      case `visibility`:
        typeof n2.value == `boolean` && (e8.visible = n2.value);
        break;
      case `component_added`:
        n2.componentData && (e8.components.some((e9) => e9.type === n2.componentData.type) || e8.components.push({ type: n2.componentData.type, data: N2(n2.componentData.data) }));
        break;
      case `component_replaced`:
        if (n2.componentData) {
          let t3 = n2.componentData.type, r2 = e8.components.find((e9) => e9.type === t3);
          r2 ? r2.data = N2(n2.componentData.data) : e8.components.push({ type: t3, data: N2(n2.componentData.data) });
        }
        break;
      case `component_removed`:
        n2.componentType && (e8.components = e8.components.filter((e9) => e9.type !== n2.componentType));
        break;
      case `metadata_set`:
        typeof n2.metadataKey == `string` && (e8.metadata ||= {}, e8.metadata[n2.metadataKey] = n2.value);
        break;
      case `metadata_removed`:
        typeof n2.metadataKey == `string` && e8.metadata && (Reflect.deleteProperty(e8.metadata, n2.metadataKey), Object.keys(e8.metadata).length === 0 && delete e8.metadata);
    }
  }
}
function Ae2(e8, t2) {
  return `${e8}/${t2}`;
}
function z2(e8, t2, n2) {
  let r2 = n2.depth ?? 0;
  if (r2 > 10) throw Error(`Prefab nesting depth exceeded 10. Check for deep or circular nesting in: ${e8.name}`);
  if (e8.basePrefab) return je2(e8, t2, n2, r2);
  Me2(e8);
  let i2 = n2.visited ?? /* @__PURE__ */ new Set(), a2 = /* @__PURE__ */ new Map();
  for (let t3 of e8.entities) t3.nestedPrefab || a2.set(t3.prefabEntityId, n2.allocateId());
  let o2 = [], s2 = I2(t2);
  for (let c3 of e8.entities) {
    if (c3.nestedPrefab) {
      let e9 = c3.nestedPrefab.prefabPath;
      if (i2.has(e9)) throw Error(`[Prefab] Circular reference detected: "${e9}" is already being instantiated in the current prefab chain`);
      let s3 = n2.loadPrefab(e9);
      if (!s3) throw Error(`Failed to load nested prefab: ${e9}`);
      let l4 = c3.prefabEntityId + `/`, u3 = t2.filter((e10) => e10.prefabEntityId.startsWith(l4)).map((e10) => ({ ...e10, prefabEntityId: e10.prefabEntityId.slice(l4.length) })), d3 = u3.length ? [...c3.nestedPrefab.overrides, ...u3] : c3.nestedPrefab.overrides;
      i2.add(e9);
      let f2 = z2(s3, d3, { ...n2, visited: i2, depth: r2 + 1 });
      i2.delete(e9);
      for (let e10 of f2.entities) e10.prefabEntityId = Ae2(c3.prefabEntityId, e10.prefabEntityId);
      a2.set(c3.prefabEntityId, f2.rootId);
      let p3 = f2.entities.find((e10) => e10.id === f2.rootId);
      p3 && (p3.parent = c3.parent === null ? null : a2.get(c3.parent) ?? null), o2.push(...f2.entities);
      continue;
    }
    let l3 = a2.get(c3.prefabEntityId), u2 = c3.prefabEntityId === e8.rootEntityId, d2 = { id: l3, prefabEntityId: c3.prefabEntityId, name: c3.name, parent: u2 || c3.parent === null ? null : a2.get(c3.parent) ?? null, children: c3.children.map((e9) => a2.get(e9)).filter((e9) => e9 !== void 0), components: M2(c3.components), visible: c3.visible, ...c3.metadata ? { metadata: P2(c3.metadata) } : {} };
    L2(d2, s2.get(c3.prefabEntityId)), F2(d2.components, a2), o2.push(d2);
  }
  let c2 = a2.get(e8.rootEntityId);
  if (c2 === void 0) throw Error(`Failed to resolve prefab root entity "${e8.rootEntityId}" in "${e8.name}"`);
  let l2 = new Map(o2.map((e9) => [e9.id, e9]));
  for (let t3 of e8.entities) {
    if (t3.prefabEntityId === e8.rootEntityId) continue;
    let n3 = a2.get(t3.prefabEntityId);
    if (n3 === void 0) continue;
    let r3 = l2.get(n3);
    if (!r3) continue;
    let i3 = t3.parent === null ? null : a2.get(t3.parent) ?? null;
    if (r3.parent !== i3) {
      if (r3.parent != null) {
        let e9 = l2.get(r3.parent);
        e9 && (e9.children = e9.children.filter((e10) => e10 !== n3));
      }
      if (r3.parent = i3, i3 != null) {
        let e9 = l2.get(i3);
        e9 && !e9.children.includes(n3) && e9.children.push(n3);
      }
    }
  }
  return { entities: o2, rootId: c2 };
}
function je2(e8, t2, n2, r2) {
  let i2 = e8.basePrefab, a2 = n2.visited ?? /* @__PURE__ */ new Set();
  if (a2.has(i2)) throw Error(`[Prefab] Circular variant reference detected: "${i2}" is already being instantiated in the current prefab chain`);
  let o2 = n2.loadPrefab(i2);
  if (!o2) throw Error(`Failed to load base prefab for variant: ${i2}`);
  a2.add(i2);
  let s2 = z2(V2(o2.basePrefab ? B2(o2, n2, r2 + 1, a2) : o2, e8), [...e8.overrides ?? [], ...t2], { ...n2, visited: a2, depth: r2 + 1 });
  return a2.delete(i2), s2;
}
function B2(e8, t2, n2, r2) {
  if (n2 > 10) throw Error(`Prefab variant chain exceeded depth 10; suspected circular inheritance ending at "${e8.name}"`);
  let i2 = e8.basePrefab;
  if (!i2) return e8;
  if (r2.has(i2)) throw Error(`[Prefab] Circular variant reference detected: "${i2}" is already being instantiated in the current prefab chain`);
  let a2 = t2.loadPrefab(i2);
  if (!a2) throw Error(`Failed to load base prefab for variant: ${i2}`);
  r2.add(i2);
  let o2 = V2(a2.basePrefab ? B2(a2, t2, n2 + 1, r2) : a2, e8);
  return r2.delete(i2), o2;
}
function V2(e8, t2) {
  if (t2.rootEntityId !== e8.rootEntityId) throw Error(`Variant "${t2.name}" rootEntityId "${t2.rootEntityId}" must match base "${e8.name}" rootEntityId "${e8.rootEntityId}". Variants extend the base; they do not relocate the root.`);
  let n2 = /* @__PURE__ */ new Map();
  for (let t3 of e8.entities) n2.set(t3.prefabEntityId, t3);
  let r2 = e8.entities.map((e9) => ({ ...e9 })), i2 = /* @__PURE__ */ new Map();
  for (let e9 of r2) i2.set(e9.prefabEntityId, e9);
  let a2 = t2.entities ?? [];
  for (let e9 of a2) {
    let n3 = i2.get(e9.prefabEntityId);
    if (n3) {
      let t3 = { ...e9, children: [...e9.children], components: e9.components.map((e10) => ({ type: e10.type, data: { ...e10.data } })), ...e9.metadata ? { metadata: { ...e9.metadata } } : {} }, a4 = r2.indexOf(n3);
      r2[a4] = t3, i2.set(e9.prefabEntityId, t3);
      continue;
    }
    if (e9.parent === null) throw Error(`Variant "${t2.name}" entity "${e9.prefabEntityId}" has parent=null but is not the root. Variant additions must attach to an existing entity from the base or another variant addition.`);
    let a3 = { ...e9, children: [...e9.children], components: e9.components.map((e10) => ({ type: e10.type, data: { ...e10.data } })), ...e9.metadata ? { metadata: { ...e9.metadata } } : {} };
    r2.push(a3), i2.set(e9.prefabEntityId, a3);
  }
  let o2 = new Set(e8.entities.map((e9) => e9.prefabEntityId));
  for (let e9 of a2) {
    if (o2.has(e9.prefabEntityId)) continue;
    let n3 = i2.get(e9.parent);
    if (!n3) throw Error(`Variant "${t2.name}" entity "${e9.prefabEntityId}" parent "${e9.parent}" not found in base or other variant additions.`);
    n3.children.includes(e9.prefabEntityId) || (n3.children = [...n3.children, e9.prefabEntityId]);
  }
  return Ne2(r2, t2.name), { version: e8.version, name: t2.name, rootEntityId: e8.rootEntityId, entities: r2 };
}
function Me2(e8) {
  let t2 = /* @__PURE__ */ new Map();
  for (let n2 of e8.entities) t2.set(n2.prefabEntityId, n2);
  for (let n2 of e8.entities) {
    if (n2.prefabEntityId.includes(`/`)) throw Error(`Prefab "${e8.name}" entity id "${n2.prefabEntityId}" contains the reserved separator "/". Authored prefab entity ids must not contain it.`);
    if (n2.parent !== null) {
      let r2 = t2.get(n2.parent);
      if (!r2) throw Error(`Prefab "${e8.name}" entity "${n2.prefabEntityId}" parent "${n2.parent}" does not exist.`);
      if (!r2.children.includes(n2.prefabEntityId)) throw Error(`Prefab "${e8.name}" inconsistent topology: entity "${n2.prefabEntityId}" claims parent "${n2.parent}" but the parent's children list does not contain it. children is the source of truth \u2014 fix by adding the child id there.`);
    }
    for (let r2 of n2.children) {
      let i2 = t2.get(r2);
      if (!i2) throw Error(`Prefab "${e8.name}" entity "${n2.prefabEntityId}" lists child "${r2}" which does not exist.`);
      if (i2.parent !== n2.prefabEntityId) throw Error(`Prefab "${e8.name}" inconsistent topology: entity "${n2.prefabEntityId}" lists "${r2}" as a child but the child's parent points elsewhere ("${i2.parent ?? `null`}").`);
    }
  }
}
function Ne2(e8, t2) {
  let n2 = /* @__PURE__ */ new Map();
  for (let t3 of e8) n2.set(t3.prefabEntityId, t3);
  let r2 = /* @__PURE__ */ new Map();
  for (let t3 of e8) r2.set(t3.prefabEntityId, 0);
  let i2 = (e9, a2) => {
    let o2 = r2.get(e9);
    if (o2 === 2) return;
    if (o2 === 1) {
      let n3 = a2.indexOf(e9), r3 = a2.slice(n3).concat(e9);
      throw Error(`Prefab "${t2}" parent cycle detected: ${r3.join(` \u2192 `)}`);
    }
    r2.set(e9, 1);
    let s2 = n2.get(e9);
    s2?.parent !== null && s2?.parent !== void 0 && i2(s2.parent, [...a2, e9]), r2.set(e9, 2);
  };
  for (let t3 of e8) i2(t3.prefabEntityId, []);
}
async function U2(e8, t2, n2, r2, i2 = 0) {
  if (i2 > 10) return;
  let a2 = r2 ?? /* @__PURE__ */ new Set();
  if (e8.basePrefab && !a2.has(e8.basePrefab) && !n2.has(e8.basePrefab)) {
    a2.add(e8.basePrefab);
    let r3 = await t2(e8.basePrefab);
    n2.set(e8.basePrefab, r3), await U2(r3, t2, n2, a2, i2 + 1);
  }
  for (let r3 of e8.entities) {
    if (!r3.nestedPrefab) continue;
    let e9 = r3.nestedPrefab.prefabPath;
    if (a2.has(e9) || n2.has(e9)) continue;
    a2.add(e9);
    let o2 = await t2(e9);
    n2.set(e9, o2), await U2(o2, t2, n2, a2, i2 + 1);
  }
}
function W(e8) {
  if (typeof e8 != `object` || !e8) throw Error(`Prefab data must be an object`);
  let t2 = e8;
  if (!Array.isArray(t2.entities)) throw Error(`Prefab data must have an "entities" array`);
  if (typeof t2.rootEntityId != `string` && typeof t2.rootEntityId != `number`) throw Error(`Prefab data must have a "rootEntityId" string or number`);
  let n2 = typeof t2.version == `string` ? t2.version : `1.0`;
  if (!(Fe2(t2) || n2 !== `2`)) return { data: t2, migrated: false, fromVersion: n2, toVersion: n2 };
  let r2 = Ie2(t2);
  return r2.version = `2`, { data: r2, migrated: true, fromVersion: n2, toVersion: `2` };
}
function Fe2(e8) {
  if (typeof e8.rootEntityId == `number`) return true;
  let t2 = e8.entities;
  for (let e9 of t2) {
    if (typeof e9 != `object` || !e9) continue;
    let t3 = e9;
    if (typeof t3.prefabEntityId == `number` || typeof t3.parent == `number`) return true;
    let n3 = t3.children;
    if (Array.isArray(n3) && n3.some((e10) => typeof e10 == `number`)) return true;
  }
  let n2 = e8.overrides;
  if (Array.isArray(n2)) {
    for (let e9 of n2) if (!(typeof e9 != `object` || !e9) && typeof e9.prefabEntityId == `number`) return true;
  }
  return false;
}
function Ie2(e8) {
  let t2 = (e9) => {
    if (typeof e9 == `string`) return e9;
    if (typeof e9 == `number`) return String(e9);
    throw Error(`Cannot stringify prefab id of type ${typeof e9}`);
  }, n2 = e8.entities.map((e9) => {
    let n3 = e9, r3 = { prefabEntityId: t2(n3.prefabEntityId), name: typeof n3.name == `string` ? n3.name : ``, parent: n3.parent === null || n3.parent === void 0 ? null : t2(n3.parent), children: Array.isArray(n3.children) ? n3.children.map(t2) : [], components: Array.isArray(n3.components) ? n3.components : [], visible: n3.visible !== false };
    if (n3.metadata && typeof n3.metadata == `object` && (r3.metadata = n3.metadata), n3.nestedPrefab && typeof n3.nestedPrefab == `object`) {
      let e10 = n3.nestedPrefab;
      r3.nestedPrefab = { prefabPath: typeof e10.prefabPath == `string` ? e10.prefabPath : ``, overrides: Array.isArray(e10.overrides) ? G(e10.overrides) : [] };
    }
    return r3;
  }), r2 = { version: `2`, name: typeof e8.name == `string` ? e8.name : ``, rootEntityId: t2(e8.rootEntityId), entities: n2 };
  return typeof e8.basePrefab == `string` && (r2.basePrefab = e8.basePrefab), Array.isArray(e8.overrides) && (r2.overrides = G(e8.overrides)), r2;
}
function G(e8) {
  return e8.map((e9) => {
    let t2 = e9, n2 = t2.prefabEntityId;
    return { ...t2, prefabEntityId: typeof n2 == `number` ? String(n2) : n2 };
  });
}
var X = () => null;
function Ve2(e8, t2, n2, r2 = X) {
  let { entities: i2, rootId: a2 } = z2(e8, t2.overrides, { allocateId: n2, loadPrefab: r2 });
  He2(i2, t2.overrides, a2, false);
  let o2 = Ue2(i2, t2.removed), s2 = i2.filter((e9) => !o2.has(e9.prefabEntityId)), c2 = /* @__PURE__ */ new Map();
  for (let e9 of s2) c2.set(e9.prefabEntityId, e9.id);
  let l2 = t2.added.map((e9) => {
    let t3 = n2();
    return c2.set(e9.prefabEntityId, t3), { id: t3, prefabEntityId: e9.prefabEntityId, name: e9.name, parent: a2, children: [], components: M2(e9.components), visible: e9.visible };
  });
  t2.added.forEach((e9, t3) => {
    l2[t3].parent = e9.parentId == null ? a2 : c2.get(e9.parentId) ?? a2;
  });
  let u2 = [...s2, ...l2];
  return He2(u2, t2.overrides, a2, true), Z2(u2), { entities: u2, rootId: a2 };
}
function He2(e8, t2, n2, r2) {
  let i2 = /* @__PURE__ */ new Map(), a2 = /* @__PURE__ */ new Map();
  for (let t3 of e8) i2.set(t3.prefabEntityId, t3.id), a2.set(t3.prefabEntityId, t3);
  for (let e9 of t2) {
    if (e9.type !== `parent`) continue;
    let t3 = a2.get(e9.prefabEntityId);
    if (!t3 || t3.id === n2) continue;
    let o2 = e9.value == null ? null : String(e9.value);
    if (o2 === null) {
      t3.parent = n2;
      continue;
    }
    let s2 = i2.get(o2);
    s2 === void 0 ? r2 && (t3.parent = n2) : t3.parent = s2;
  }
}
function Z2(e8) {
  let t2 = new Map(e8.map((e9) => [e9.id, e9]));
  for (let t3 of e8) t3.children = [];
  for (let n2 of e8) n2.parent != null && t2.get(n2.parent)?.children.push(n2.id);
}
function Ue2(e8, t2) {
  let n2 = new Map(e8.map((e9) => [e9.id, e9.prefabEntityId])), r2 = /* @__PURE__ */ new Map();
  for (let t3 of e8) {
    if (t3.parent == null) continue;
    let e9 = n2.get(t3.parent);
    if (e9 === void 0) continue;
    let i3 = r2.get(e9);
    i3 ? i3.push(t3.prefabEntityId) : r2.set(e9, [t3.prefabEntityId]);
  }
  let i2 = /* @__PURE__ */ new Set(), a2 = [...t2];
  for (; a2.length > 0; ) {
    let e9 = a2.shift();
    if (!i2.has(e9)) {
      i2.add(e9);
      for (let t3 of r2.get(e9) ?? []) a2.push(t3);
    }
  }
  return i2;
}
function Ke2(e8, t2, n2, r2 = X) {
  let { entities: i2, rootId: a2 } = Ve2(e8, t2, n2, r2);
  for (let e9 of i2) e9.id === a2 && (e9.id = t2.id), e9.parent === a2 && (e9.parent = t2.id);
  let o2 = i2.find((e9) => e9.id === t2.id);
  return o2 && (o2.parent = t2.parent), Z2(i2), { entities: i2, rootId: t2.id };
}
var tt2 = class extends Error {
  constructor(e8) {
    super(`Scene load aborted: ${e8.length} asset(s) missing`), this.name = `MissingAssetsError`, this.missing = e8;
  }
};
function rt2(e8) {
  return M(e8)?.assetFields ?? [];
}
function at2(t2, n2) {
  let i2 = M(t2.type);
  if (!i2 || i2.entityFields.length === 0) return;
  let a2 = t2.data;
  for (let r2 of i2.entityFields) {
    let i3 = a2[r2];
    if (typeof i3 == `number` && i3 !== 0) {
      let o2 = n2.get(i3);
      o2 === void 0 && T.warn(`scene`, `Entity reference not found: ${t2.type}.${r2} references entity ${i3} which does not exist`), a2[r2] = o2 === void 0 ? 0 : o2;
    }
  }
}
var Q = /* @__PURE__ */ new Map();
function ot(e8, t2) {
  Q.set(e8, t2);
}
function st(e8) {
  return e8.entities.some(T2);
}
var ct = (e8) => ({ id: e8.id, name: e8.name, parent: e8.parent, children: e8.children, components: e8.components, visible: e8.visible });
async function lt(t2, n2) {
  let r2 = t2.entities, i2 = 0;
  for (let e8 of r2) i2 = Math.max(i2, e8.id);
  let a2 = () => ++i2, o2 = [];
  for (let t3 of r2) {
    if (!T2(t3)) {
      o2.push(t3);
      continue;
    }
    let r3 = await n2(t3.prefab);
    if (!r3) {
      T.warn(`scene`, `Prefab instance "${t3.prefab}" could not be resolved; instance skipped`);
      continue;
    }
    let i3 = W(r3).data, s2 = /* @__PURE__ */ new Map();
    try {
      await U2(i3, async (e8) => {
        let t4 = await n2(e8);
        if (!t4) throw Error(`nested prefab "${e8}" not found`);
        return W(t4).data;
      }, s2);
    } catch (n3) {
      T.warn(`scene`, `Prefab instance "${t3.prefab}" has an unresolved nested prefab; instance skipped (${n3})`);
      continue;
    }
    let { entities: c2 } = Ke2(i3, t3, a2, (e8) => s2.get(e8) ?? null);
    for (let e8 of c2) o2.push(ct(e8));
  }
  return { ...t2, entities: o2 };
}
function dt(e8) {
  if (typeof e8 == `number`) return Number.isInteger(e8) && e8 > 0 ? e8 : 1;
  if (typeof e8 == `string`) {
    let t2 = /^\s*(\d+)/.exec(e8);
    if (t2) return Math.max(1, Number(t2[1]));
  }
  return 1;
}
var ft = /* @__PURE__ */ new Set([`StateMachine`, `StateVisuals`]);
function $(e8) {
  if (!e8 || typeof e8 != `object` || !Array.isArray(e8.entities)) throw Error(`Scene data must have an "entities" array`);
  let t2 = dt(e8.version);
  if (t2 > 1) throw Error(`Scene format version ${t2} is newer than this engine supports (1); upgrade the engine to load it.`);
  let n2 = JSON.parse(JSON.stringify(e8)), r2 = false;
  for (let e9 of n2.entities) {
    if (T2(e9)) continue;
    let t3 = e9.components.filter((e10) => !ft.has(e10.type));
    t3.length !== e9.components.length && (e9.components = t3, r2 = true);
    for (let t4 of e9.components) pt2(t4) && (r2 = true);
  }
  return n2.version = 1, { data: n2, migrated: r2, fromVersion: t2, toVersion: 1 };
}
function pt2(e8) {
  let t2 = false;
  if ((e8.type === `LocalTransform` || e8.type === `WorldTransform`) && (e8.type = `Transform`, t2 = true), e8.type === `UIMask`) {
    let n2 = e8.data;
    n2.mode === `scissor` ? (n2.mode = 0, t2 = true) : n2.mode === `stencil` && (n2.mode = 1, t2 = true);
  }
  return t2;
}
var mt2 = /* @__PURE__ */ new Set([`duplicate-id`, `parent-cycle`]);
function ht2(t2) {
  let n2 = j2(t2);
  if (n2.length === 0) return;
  let r2 = n2.filter((e8) => mt2.has(e8.code));
  for (let t3 of n2) r2.includes(t3) || T.warn(`scene`, `${t3.code}: ${t3.message}`);
  if (r2.length > 0) throw Error(`Scene "${t2.name}" cannot be loaded as written:
` + r2.map((e8) => `  ${e8.code}: ${e8.message}`).join(`
`));
}
function gt2(t2, n2) {
  ht2(n2);
  let r2 = /* @__PURE__ */ new Map();
  for (let i2 of n2.entities) {
    if (i2.visible === false) continue;
    if (T2(i2)) {
      T.warn(`scene`, `Prefab-instance entry skipped in synchronous load; use loadSceneWithAssets to load prefab scenes`);
      continue;
    }
    let n3 = t2.spawn();
    r2.set(i2.id, n3), t2.insert(n3, z, { value: i2.name });
  }
  try {
    for (let e8 of n2.entities) {
      if (e8.visible === false || T2(e8)) continue;
      let n3 = r2.get(e8.id);
      for (let i2 of e8.components) at2(i2, r2), xt2(t2, n3, i2, e8.name);
    }
    for (let e8 of n2.entities) if (e8.parent !== null) {
      let n3 = r2.get(e8.id), i2 = r2.get(e8.parent);
      n3 !== void 0 && i2 !== void 0 && t2.setParent(n3, i2);
    }
  } catch (e8) {
    for (let e9 of r2.values()) try {
      t2.despawn(e9);
    } catch {
    }
    throw e8;
  }
  return r2;
}
async function yt2(t2, n2, r2) {
  let i2 = n2;
  if (r2?.assets && st(i2)) {
    let t3 = r2.assets;
    i2 = await lt(i2, async (n3) => {
      try {
        return (await t3.loadPrefab(n3))?.data ?? null;
      } catch (t4) {
        return T.warn(`scene`, `Failed to load prefab "${n3}": ${t4}`), null;
      }
    });
  }
  let { data: a2 } = $(i2);
  if (r2?.assets) {
    let e8 = r2.assets, t3 = await e8.preloadSceneAssets(a2, r2.onProgress);
    if (r2.onMissingAssets && r2.onMissingAssets(t3.missing), r2.abortOnMissingAssets && t3.missing.length > 0) throw new tt2(t3.missing);
    if (e8.resolveSceneAssetPaths(a2, t3), bt2(a2, t3.textureHandles), r2.collectAssets) for (let e9 of t3.materialHandles.values()) e9 && r2.collectAssets.materialHandles.add(e9);
  }
  return gt2(t2, a2);
}
function bt2(e8, n2) {
  if (!e8.textureMetadata) return;
  let r2 = le();
  for (let [t2, i2] of Object.entries(e8.textureMetadata)) {
    let e9 = n2.get(t2);
    if (e9 && i2.sliceBorder) {
      let t3 = i2.sliceBorder;
      r2.setTextureMetadata(e9, t3.left, t3.right, t3.top, t3.bottom);
    }
  }
}
function xt2(t2, n2, i2, a2) {
  let s2 = M(i2.type);
  if (!s2) {
    let t3 = a2 ? ` on entity "${a2}"` : ``;
    T.warn(`scene`, `Unknown component type: ${i2.type}${t3}`);
    return;
  }
  let u2 = Q.get(i2.type), d2;
  if (u2?.outOfBandFields?.length) for (let e8 of u2.outOfBandFields) e8 in i2.data && ((d2 ??= {})[e8] = i2.data[e8], delete i2.data[e8]);
  let f2 = a2 ? ` (entity "${a2}")` : ``, p3 = V(i2.type, s2._default, i2.data, H(s2));
  if (p3.length > 0) {
    for (let e8 of p3) {
      let t3 = e8.field in i2.data ? e8.field : e8.field.split(`.`)[0];
      delete i2.data[t3];
    }
    T.warn(`scene`, `${U(i2.type + f2, p3)}
  \u2192 invalid fields dropped, their defaults apply (fix the scene file to silence this)`);
  }
  try {
    t2.insert(n2, s2, i2.data);
  } catch (t3) {
    T.error(`scene`, `component "${i2.type}"${f2} failed to insert \u2014 skipped: ${t3 instanceof Error ? t3.message : String(t3)}`);
    return;
  }
  u2?.importData && d2 && u2.importData(n2, d2);
}
var St2 = /* @__PURE__ */ new Set([`Name`, `Parent`, `Children`, `WorldTransform`]);
function Ct2(e8, t2) {
  let i2 = t2, a2 = [];
  for (let o2 of e8.getComponentTypes(t2)) {
    if (St2.has(o2)) continue;
    let s2 = M(o2);
    if (!s2 || s2.transient) continue;
    let c2 = e8.tryGet(t2, s2);
    if (c2 === null) continue;
    let l2 = s2._builtin ? c2 : E(c2);
    Q.get(o2)?.exportData?.(i2, l2), a2.push({ type: o2, data: l2 });
  }
  return a2;
}
function Dt2(e8, t2) {
  let n2 = /* @__PURE__ */ new Map(), i2 = /* @__PURE__ */ new Map(), a2 = /* @__PURE__ */ new Map(), o2 = [], s2 = [], c2 = /* @__PURE__ */ new Set(), l2 = [], u2 = (e9) => {
    let n3 = t2 ? t2(e9) : e9;
    return n3 == null || n3 === `` ? (l2.push(e9), null) : n3;
  }, d2 = (e9, t3, n3) => {
    let r2 = e9.get(t3);
    r2 || (r2 = /* @__PURE__ */ new Set(), e9.set(t3, r2)), r2.add(n3);
  }, f2 = (e9, t3) => {
    let r2 = u2(t3);
    r2 != null && (d2(n2, e9, r2), d2(i2, e9, t3), a2.has(r2) || a2.set(r2, t3));
  };
  for (let t3 of e8.entities) if (t3.visible !== false && Array.isArray(t3.components)) for (let e9 of t3.components) {
    let t4 = M(e9.type);
    if (!t4) continue;
    let n3 = e9.data;
    if (t4.discoverAssets) for (let e10 of t4.discoverAssets(n3)) typeof e10.path == `string` && e10.path && f2(e10.type, e10.path);
    else for (let e10 of t4.assetFields) {
      let t5 = n3[e10.field];
      typeof t5 == `string` && t5 && f2(e10.type, t5);
    }
    if (t4.skeletalFields) {
      let e10 = n3[t4.skeletalFields.skeletonField], r2 = n3[t4.skeletalFields.atlasField];
      if (e10 && r2) {
        let n4 = u2(e10), i3 = u2(r2);
        if (n4 != null && i3 != null) {
          let e11 = `${n4}:${i3}`;
          c2.has(e11) || (c2.add(e11), (t4.skeletalFields.runtime === `dragonbones` ? s2 : o2).push({ skeleton: n4, atlas: i3 }));
        }
      }
    }
  }
  return { byType: n2, rawByType: i2, rawFor: a2, spines: o2, dragonBones: s2, unresolved: l2 };
}

// sdk/dist/shared/physics.js
var y3 = class extends ae {
  constructor(e8) {
    super(), this.label = e8;
  }
};
async function b3(e8, t2 = 240) {
  for (let n2 = 0; n2 < t2; n2++) {
    let t3 = e8();
    if (t3 !== 0) return t3;
    await new Promise((e9) => setTimeout(e9, 0));
  }
  return 2;
}
var x3 = /* @__PURE__ */ new Set([`float`, `vec2`, `vec3`, `vec4`, `color`, `int`, `texture`]);
var S3 = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, color: 4 };
var ee3 = [`x`, `y`, `z`, `w`];
function C2(e8, t2) {
  let n2 = `${t2}(`, r2 = e8.indexOf(n2);
  if (r2 < 0) return;
  let i2 = r2 + n2.length, a2 = e8.indexOf(`)`, i2);
  if (!(a2 < 0)) return e8.slice(i2, a2).trim();
}
function te3(e8) {
  return e8 === `texture` ? [] : e8 === `color` ? [0, 0, 0, 1] : Array(S3[e8] ?? 1).fill(0);
}
function ne3(e8) {
  let t2 = e8.startsWith(`u_`) ? e8.slice(2) : e8;
  return t2.length > 0 && (t2 = t2[0].toUpperCase() + t2.slice(1)), t2;
}
function re3(e8) {
  let t2 = e8.trim().split(/\s+/), n2 = t2[0], r2 = t2[1];
  if (!n2 || !r2 || !x3.has(r2)) return null;
  let i2 = r2, a2 = { name: n2, type: i2, displayName: ne3(n2), default: te3(i2) }, o2 = C2(e8, `default`);
  if (o2 !== void 0) if (i2 === `texture`) a2.defaultTexture = o2;
  else {
    let e9 = o2.split(`,`).map((e10) => parseFloat(e10.trim())).filter((e10) => !Number.isNaN(e10));
    e9.length > 0 && (a2.default = e9);
  }
  let s2 = C2(e8, `range`);
  if (s2 !== void 0) {
    let [e9, t3] = s2.split(`,`).map((e10) => parseFloat(e10.trim()));
    !Number.isNaN(e9) && !Number.isNaN(t3) && (a2.range = { min: e9, max: t3 });
  }
  let c2 = C2(e8, `ui`);
  return c2 !== void 0 && (a2.ui = c2), a2;
}
function ie3(e8) {
  if (e8.type === `texture`) return e8.defaultTexture ?? 0;
  if (e8.type === `color`) {
    let t3 = e8.default;
    return { r: t3[0] ?? 0, g: t3[1] ?? 0, b: t3[2] ?? 0, a: t3[3] ?? 1 };
  }
  if (e8.type === `float` || e8.type === `int`) return e8.default[0] ?? 0;
  let t2 = {}, n2 = S3[e8.type] ?? 1;
  for (let r2 = 0; r2 < n2; r2++) t2[ee3[r2]] = e8.default[r2] ?? 0;
  return t2;
}
function ae3(e8) {
  let t2 = [], n2 = `Unlit2D`;
  for (let r2 of e8.split(`
`)) {
    let e9 = r2.trim();
    if (!e9.startsWith(`#pragma`)) continue;
    let i2 = e9.slice(7).trim(), a2 = i2.search(/\s/), o2 = a2 < 0 ? i2 : i2.slice(0, a2), s2 = a2 < 0 ? `` : i2.slice(a2 + 1).trim();
    if (o2 === `param`) {
      let e10 = re3(s2);
      e10 && t2.push(e10);
    } else o2 === `domain` && s2 && (n2 = s2);
  }
  return { domain: n2, params: t2 };
}
function oe2(e8) {
  return typeof e8 == `object` && !!e8 && `__textureRef` in e8;
}
function se2(e8) {
  return typeof e8 == `number` ? { arity: 1, values: [e8, 0, 0, 0] } : Array.isArray(e8) ? { arity: Math.max(1, Math.min(e8.length, 4)), values: [e8[0] ?? 0, e8[1] ?? 0, e8[2] ?? 0, e8[3] ?? 0] } : `w` in e8 ? { arity: 4, values: [e8.x, e8.y, e8.z, e8.w] } : `z` in e8 ? { arity: 3, values: [e8.x, e8.y, e8.z, 0] } : { arity: 2, values: [e8.x, e8.y, 0, 0] };
}
var ce3 = (function(e8) {
  return e8[e8.None = 0] = `None`, e8[e8.Back = 1] = `Back`, e8[e8.Front = 2] = `Front`, e8;
})({});
function ue2(e8) {
  let t2 = e8;
  return typeof t2?.renderer_renderMaterialPreview == `function` ? t2 : null;
}
var de2 = new class extends ae {
  constructor(...e8) {
    super(...e8), this.label = `material`;
  }
}();
var w2 = null;
var fe2 = 1;
var T3 = /* @__PURE__ */ new Map();
var E3 = /* @__PURE__ */ new Map();
var pe3 = /* @__PURE__ */ new Map();
var me2 = /* @__PURE__ */ new Set();
function _e2(e8) {
  let t2 = T3.get(e8);
  for (let e9 = 0; t2?.parent !== void 0 && e9 < 16; e9++) t2 = T3.get(t2.parent);
  return t2?.shader;
}
function ve2(e8, t2) {
  let n2 = e8 === void 0 ? void 0 : pe3.get(e8);
  if (!n2 || n2.has(t2)) return;
  let r2 = `${e8}:${t2}`;
  if (me2.has(r2)) return;
  me2.add(r2);
  let i2 = [...n2].join(`, `) || `(none)`;
  console.warn(`[material] "${t2}" is not a parameter of this shader \u2014 the value is ignored. It declares: ${i2}`);
}
function ye(e8, t2, n2) {
  return !!e8 | (t2 ? 2 : 0) | (n2 & 3) << 2;
}
function be(e8, t2) {
  let n2 = E3.get(e8);
  n2 || (n2 = /* @__PURE__ */ new Set(), E3.set(e8, n2)), n2.add(t2);
}
function xe(e8, t2) {
  E3.get(e8)?.delete(t2);
}
function Se(e8, t2, n2) {
  if (!w2) return;
  if (oe2(n2)) {
    w2.material_setTexture(e8, t2, n2.textureId);
    return;
  }
  let { arity: r2, values: i2 } = se2(n2);
  w2.material_setUniform(e8, t2, r2, i2[0], i2[1], i2[2], i2[3]);
}
function D3(e8) {
  let t2 = T3.get(e8);
  if (!t2) return null;
  let n2 = t2.parent === void 0 ? null : D3(t2.parent);
  if (!n2) return { shader: t2.shader, blendMode: t2.blendMode, depthTest: t2.depthTest, depthWrite: t2.depthWrite, cull: t2.cull, uniforms: new Map(t2.uniforms) };
  let r2 = n2.uniforms;
  for (let [e9, n3] of t2.uniforms) r2.set(e9, n3);
  return { shader: n2.shader, blendMode: t2.overrides.has(`blendMode`) ? t2.blendMode : n2.blendMode, depthTest: t2.overrides.has(`depthTest`) ? t2.depthTest : n2.depthTest, depthWrite: t2.overrides.has(`depthWrite`) ? t2.depthWrite : n2.depthWrite, cull: t2.overrides.has(`cull`) ? t2.cull : n2.cull, uniforms: r2 };
}
function O3(e8) {
  let t2 = D3(e8);
  if (t2 && w2) {
    w2.material_define(e8, t2.shader, t2.blendMode, ye(t2.depthTest, t2.depthWrite, t2.cull));
    for (let [n3, r2] of t2.uniforms) Se(e8, n3, r2);
  }
  let n2 = E3.get(e8);
  if (n2) for (let e9 of n2) O3(e9);
}
function Ce(e8) {
  let t2 = {};
  for (let [n2, r2] of Object.entries(e8)) if (typeof r2 == `number`) t2[n2] = r2;
  else if (typeof r2 == `object` && r2) {
    let e9 = r2;
    `r` in e9 ? t2[n2] = { x: e9.r ?? 0, y: e9.g ?? 0, z: e9.b ?? 0, w: e9.a ?? 1 } : `w` in e9 ? t2[n2] = { x: e9.x ?? 0, y: e9.y ?? 0, z: e9.z ?? 0, w: e9.w ?? 0 } : `z` in e9 ? t2[n2] = { x: e9.x ?? 0, y: e9.y ?? 0, z: e9.z ?? 0 } : `y` in e9 && (t2[n2] = { x: e9.x ?? 0, y: e9.y ?? 0 });
  }
  return t2;
}
var we = { createShader(e8, n2) {
  return le().createShader(e8, n2);
}, releaseShader(e8) {
  e8 > 0 && (pe3.delete(e8), le().releaseShader(e8));
}, create(e8) {
  let t2 = fe2++, n2 = { shader: e8.shader, uniforms: /* @__PURE__ */ new Map(), blendMode: e8.blendMode ?? 0, depthTest: e8.depthTest ?? false, depthWrite: e8.depthWrite ?? true, cull: e8.cull ?? 0, switches: e8.switches ? { ...e8.switches } : {}, overrides: /* @__PURE__ */ new Set(), dirty_: true, cachedBuffer_: null, cachedIdx_: 0 };
  if (e8.uniforms) for (let [t3, r2] of Object.entries(e8.uniforms)) ve2(e8.shader, t3), n2.uniforms.set(t3, r2);
  return T3.set(t2, n2), O3(t2), t2;
}, compileShader(e8, t2 = []) {
  let n2 = w2?.material_compileEsshader(e8, t2.join(`,`)) ?? 0;
  return n2 > 0 && pe3.set(n2, new Set(ae3(e8).params.map((e9) => e9.name))), n2;
}, getSwitch(e8, t2) {
  return T3.get(e8)?.switches[t2] ?? false;
}, setSwitch(e8, t2, n2) {
  let r2 = T3.get(e8);
  r2 && (r2.switches[t2] = n2);
}, get(e8) {
  return T3.get(e8);
}, setUniform(e8, t2, n2) {
  let r2 = T3.get(e8);
  r2 && (ve2(_e2(e8), t2), r2.uniforms.set(t2, n2), r2.dirty_ = true, O3(e8));
}, getUniform(e8, t2) {
  return D3(e8)?.uniforms.get(t2);
}, setBlendMode(e8, t2) {
  let n2 = T3.get(e8);
  n2 && (n2.blendMode = t2, n2.parent !== void 0 && n2.overrides.add(`blendMode`), O3(e8));
}, getBlendMode(e8) {
  return D3(e8)?.blendMode ?? 0;
}, setDepthTest(e8, t2) {
  let n2 = T3.get(e8);
  n2 && (n2.depthTest = t2, n2.parent !== void 0 && n2.overrides.add(`depthTest`), O3(e8));
}, setDepthWrite(e8, t2) {
  let n2 = T3.get(e8);
  n2 && (n2.depthWrite = t2, n2.parent !== void 0 && n2.overrides.add(`depthWrite`), O3(e8));
}, setCull(e8, t2) {
  let n2 = T3.get(e8);
  n2 && (n2.cull = t2, n2.parent !== void 0 && n2.overrides.add(`cull`), O3(e8));
}, getShader(e8) {
  return D3(e8)?.shader ?? 0;
}, release(e8) {
  let t2 = T3.get(e8);
  t2?.parent !== void 0 && xe(t2.parent, e8), E3.delete(e8), T3.delete(e8), w2?.material_undefine(e8);
}, isValid(e8) {
  return T3.has(e8);
}, async renderPreview(e8, t2, n2) {
  let r2 = ue2(w2);
  if (!r2 || (r2.renderer_renderMaterialPreview(e8, t2, n2), await b3(() => r2.renderer_pollPreviewReadback()) !== 1)) return null;
  let i2 = r2.renderer_getPreviewSize(), a2 = r2.renderer_getPreviewWidth(), o2 = r2.renderer_getPreviewHeight();
  if (i2 === 0 || a2 === 0 || o2 === 0) return null;
  let s2 = new Uint8ClampedArray(r2.HEAPU8.buffer, r2.renderer_getPreviewPtr(), i2), c2 = new Uint8ClampedArray(i2), l2 = a2 * 4;
  for (let e9 = 0; e9 < o2; e9++) c2.set(s2.subarray(e9 * l2, (e9 + 1) * l2), (o2 - 1 - e9) * l2);
  return new ImageData(c2, a2, o2);
}, releaseAll() {
  if (w2) for (let e8 of T3.keys()) w2.material_undefine(e8);
  T3.clear(), E3.clear();
}, createFromAsset(e8, t2, n2) {
  let r2 = Ce(e8.properties);
  if (n2 !== void 0 && n2 !== 0) {
    let t3 = this.createInstance(n2);
    for (let [e9, n3] of Object.entries(r2)) this.setUniform(t3, e9, n3);
    return e8.blendMode !== void 0 && this.setBlendMode(t3, e8.blendMode), e8.depthTest !== void 0 && this.setDepthTest(t3, e8.depthTest), e8.depthWrite !== void 0 && this.setDepthWrite(t3, e8.depthWrite), e8.cull !== void 0 && this.setCull(t3, e8.cull), t3;
  }
  return this.create({ shader: t2, uniforms: r2, blendMode: e8.blendMode ?? 0, depthTest: e8.depthTest ?? false, depthWrite: e8.depthWrite ?? true, cull: e8.cull ?? 0, switches: e8.switches });
}, createInstance(e8) {
  let t2 = T3.get(e8);
  if (!t2) throw Error(`Invalid source material: ${e8}`);
  let n2 = fe2++, r2 = { shader: t2.shader, uniforms: /* @__PURE__ */ new Map(), blendMode: t2.blendMode, depthTest: t2.depthTest, depthWrite: t2.depthWrite, cull: t2.cull, switches: {}, parent: e8, overrides: /* @__PURE__ */ new Set(), dirty_: true, cachedBuffer_: null, cachedIdx_: 0 };
  return T3.set(n2, r2), be(e8, n2), O3(n2), n2;
}, toAssetData(e8, t2, n2) {
  let r2 = T3.get(e8);
  if (!r2) return null;
  let i2 = r2.parent !== void 0 && n2 !== void 0, a2 = {}, o2 = i2 ? r2.uniforms : D3(e8)?.uniforms ?? r2.uniforms;
  for (let [e9, t3] of o2) a2[e9] = t3;
  if (i2) {
    let e9 = { version: `1.0`, type: `material`, shader: t2, instanceOf: n2, properties: a2 };
    return r2.overrides.has(`blendMode`) && (e9.blendMode = r2.blendMode), r2.overrides.has(`depthTest`) && (e9.depthTest = r2.depthTest), r2.overrides.has(`depthWrite`) && (e9.depthWrite = r2.depthWrite), r2.overrides.has(`cull`) && (e9.cull = r2.cull), e9;
  }
  let s2 = { version: `1.0`, type: `material`, shader: t2, blendMode: r2.blendMode, depthTest: r2.depthTest, depthWrite: r2.depthWrite, cull: r2.cull, properties: a2 };
  return Object.keys(r2.switches).length > 0 && (s2.switches = { ...r2.switches }), s2;
}, getUniforms(e8) {
  return D3(e8)?.uniforms ?? /* @__PURE__ */ new Map();
}, tex(e8, t2) {
  return { __textureRef: true, textureId: e8, slot: t2 };
} };
var k3 = { categoryBits: { bitmask: { bits: 16, source: `collisionLayers` }, advanced: true }, maskBits: { bitmask: { bits: 16, source: `collisionLayers` }, advanced: true } };
var A2 = P(`RigidBody`, { bodyType: 2, gravityScale: 1, linearDamping: 0, angularDamping: 0, fixedRotation: false, bullet: false, enabled: true }, { fields: { linearDamping: { min: 0, advanced: true }, angularDamping: { min: 0, advanced: true }, fixedRotation: { advanced: true }, bullet: { advanced: true } } });
var j3 = P(`BoxCollider`, { halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, radius: 0.05, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, { fields: { ...k3 } });
var M3 = P(`CircleCollider`, { radius: 0.5, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, { fields: { ...k3 } });
var N3 = P(`CapsuleCollider`, { radius: 0.25, halfHeight: 0.5, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, { fields: { ...k3 } });
var P3 = P(`SegmentCollider`, { point1: { x: -0.5, y: 0 }, point2: { x: 0.5, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, { fields: { ...k3 } });
var F3 = k(`PolygonCollider`, { vertices: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }], radius: 0, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 }, { fields: { ...k3 } });
var I3 = k(`ChainCollider`, { points: [{ x: -1, y: 0 }, { x: 0, y: 0.5 }, { x: 1, y: 0 }, { x: 0, y: -0.5 }], isLoop: true, friction: 0.6, restitution: 0, categoryBits: 1, maskBits: 65535, enabled: true }, { fields: { ...k3 } });
var R2 = k(`OneWayPlatform`, { normal: { x: 0, y: 1 }, enabled: true });
var z3 = k(`RevoluteJoint`, { connectedEntity: -1, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, enableMotor: false, motorSpeed: 0, maxMotorTorque: 0, enableLimit: false, lowerAngle: 0, upperAngle: 0, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var Ee2 = k(`DistanceJoint`, { connectedEntity: -1, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, length: 1, enableSpring: false, hertz: 1, dampingRatio: 0.5, enableLimit: false, minLength: 0.5, maxLength: 2, enableMotor: false, maxMotorForce: 0, motorSpeed: 0, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var De2 = k(`PrismaticJoint`, { connectedEntity: -1, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, axis: { x: 1, y: 0 }, enableSpring: false, hertz: 1, dampingRatio: 0.5, enableLimit: false, lowerTranslation: 0, upperTranslation: 0, enableMotor: false, maxMotorForce: 0, motorSpeed: 0, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var Oe3 = k(`WeldJoint`, { connectedEntity: -1, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, linearHertz: 0, angularHertz: 0, linearDampingRatio: 1, angularDampingRatio: 1, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var ke2 = k(`WheelJoint`, { connectedEntity: -1, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, axis: { x: 0, y: 1 }, enableSpring: true, hertz: 5, dampingRatio: 0.7, enableLimit: false, lowerTranslation: 0, upperTranslation: 0, enableMotor: false, maxMotorTorque: 0, motorSpeed: 0, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var Ae3 = k(`MotorJoint`, { connectedEntity: -1, linearVelocity: { x: 0, y: 0 }, maxVelocityForce: 0, angularVelocity: 0, maxVelocityTorque: 0, linearHertz: 0, linearDampingRatio: 0, maxSpringForce: 0, angularHertz: 0, angularDampingRatio: 0, maxSpringTorque: 0, collideConnected: false, enabled: true }, { entityFields: [`connectedEntity`] });
var B3 = ea({ module: null, initPromise: null }, `PhysicsRuntime`);
var je3 = new y3(`draw`);
var G2 = new Float32Array(256);
var Me3 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
var J = ea({ enabled: false, showColliders: true, showVelocity: false, showContacts: false }, `PhysicsDebugDraw`);
var X2 = ea({ collisionEnters: [], collisionExits: [], collisionHits: [], sensorEnters: [], sensorExits: [] }, `PhysicsEvents`);
var Z3 = ea(null, `Physics`);
var kt2 = k(`CharacterController`, { velocity: { x: 0, y: 0 }, up: { x: 0, y: 1 }, floorMaxAngle: 0.785398, maxSlides: 4, skinWidth: 1, snapLength: 0, slideOnCeiling: true, maskBits: 65535, isOnFloor: false, isOnWall: false, isOnCeiling: false, floorNormal: { x: 0, y: 0 }, realVelocity: { x: 0, y: 0 } }, { fields: { floorMaxAngle: { min: 0, max: 1.5708, step: 0.01, unit: `rad`, tooltip: `Max walkable slope from up (radians)` }, maxSlides: { min: 1, max: 8, step: 1, advanced: true }, skinWidth: { min: 0, step: 0.25, unit: `px`, advanced: true }, snapLength: { min: 0, step: 0.5, unit: `px`, tooltip: `Floor-snap probe length; 0 disables stair/slope stick` }, slideOnCeiling: { advanced: true }, up: { advanced: true }, maskBits: { bitmask: { bits: 16, source: `collisionLayers` }, advanced: true }, isOnFloor: { advanced: true }, isOnWall: { advanced: true }, isOnCeiling: { advanced: true }, floorNormal: { advanced: true }, realVelocity: { advanced: true } } });
var Rt2 = class {
  constructor(e8, t2, n2, r2) {
    this.type = e8, this.target = t2, this.currentTarget = n2, this.data = r2, this.propagationStopped = false, this.defaultPrevented = false;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
};
var zt2 = class extends Rt2 {
  constructor(e8, t2, n2, r2, i2) {
    super(e8, t2, n2, r2), this.root_ = i2, this.defaultPrevented = i2.defaultPrevented;
  }
  stopPropagation() {
    this.propagationStopped = true, this.root_.propagationStopped = true;
  }
  preventDefault() {
    this.defaultPrevented = true, this.root_.defaultPrevented = true;
  }
};
var Bt2 = class {
  constructor() {
    this.entityHandlers_ = /* @__PURE__ */ new Map(), this.globalHandlers_ = /* @__PURE__ */ new Map(), this.typeCounts_ = /* @__PURE__ */ new Map(), this.pending_ = [], this.activeKeys_ = /* @__PURE__ */ new Set();
  }
  on(e8, t2, n2) {
    if (typeof e8 == `number` && typeof t2 == `string` && typeof n2 == `function`) {
      let r3 = e8, i3 = t2, a3 = n2, o2 = this.entityHandlers_.get(r3);
      o2 || (o2 = /* @__PURE__ */ new Map(), this.entityHandlers_.set(r3, o2));
      let s2 = o2.get(i3);
      return s2 || (s2 = /* @__PURE__ */ new Set(), o2.set(i3, s2)), s2.has(a3) || this.countType_(i3, 1), s2.add(a3), () => {
        let e9 = this.entityHandlers_.get(r3), t3 = e9?.get(i3);
        t3?.delete(a3) && (this.countType_(i3, -1), t3.size === 0 && e9.delete(i3), e9 && e9.size === 0 && this.entityHandlers_.delete(r3));
      };
    }
    let r2 = e8, i2 = t2, a2 = this.globalHandlers_.get(r2);
    return a2 || (a2 = /* @__PURE__ */ new Set(), this.globalHandlers_.set(r2, a2)), a2.has(i2) || this.countType_(r2, 1), a2.add(i2), () => {
      let e9 = this.globalHandlers_.get(r2);
      e9?.delete(i2) && (this.countType_(r2, -1), e9.size === 0 && this.globalHandlers_.delete(r2));
    };
  }
  countType_(e8, t2) {
    let n2 = (this.typeCounts_.get(e8) ?? 0) + t2;
    n2 > 0 ? this.typeCounts_.set(e8, n2) : this.typeCounts_.delete(e8);
  }
  hasListenersFor(e8) {
    return this.typeCounts_.has(e8);
  }
  removeAll(e8) {
    let t2 = this.entityHandlers_.get(e8);
    if (t2) {
      for (let [e9, n2] of t2) this.countType_(e9, -n2.size);
      this.entityHandlers_.delete(e8);
    }
  }
  emit(e8, t2, n2) {
    let r2 = new Rt2(t2, e8, e8, n2);
    return this.pending_.push(r2), this.dispatch_(e8, r2), r2;
  }
  emitBubbled(e8, t2) {
    if (t2.propagationStopped) return t2;
    let n2 = new zt2(t2.type, t2.target, e8, t2.data, t2);
    return this.pending_.push(n2), this.dispatch_(e8, n2), n2;
  }
  drain() {
    let e8 = this.pending_;
    return this.pending_ = [], e8;
  }
  query(e8) {
    return this.pending_.filter((t2) => t2.type === e8);
  }
  clear() {
    this.entityHandlers_.clear(), this.globalHandlers_.clear(), this.pending_ = [], this.activeKeys_.clear();
  }
  dispatch_(t2, n2) {
    let r2 = `${t2}:${n2.type}`;
    if (!this.activeKeys_.has(r2)) {
      this.activeKeys_.add(r2);
      try {
        let r3 = this.entityHandlers_.get(t2);
        if (r3) {
          let t3 = r3.get(n2.type);
          if (t3) for (let r4 of Array.from(t3)) try {
            r4(n2);
          } catch (t4) {
            T.error(`ui`, `EntityEventQueue handler error [${n2.type}]`, t4);
          }
        }
        let i2 = this.globalHandlers_.get(n2.type);
        if (i2) for (let t3 of Array.from(i2)) try {
          t3(n2);
        } catch (t4) {
          T.error(`ui`, `EntityEventQueue handler error [${n2.type}]`, t4);
        }
      } finally {
        this.activeKeys_.delete(r2);
      }
    }
  }
};
var Vt2 = ea(new Bt2(), `EntityEvents`);
function Ht2(e8) {
  if (!e8.hasResource(Vt2)) {
    let t2 = new Bt2();
    e8.insertResource(Vt2, t2), e8.world.onDespawn((e9) => t2.removeAll(e9));
  }
  return e8.getResource(Vt2);
}

// sdk/dist/shared/spine.js
function v3(e8) {
  let t2 = [];
  for (let n2 of e8.split(`
`)) {
    let e9 = n2.trim();
    e9 && !e9.includes(`:`) && (/\.png$/i.test(e9) || /\.jpg$/i.test(e9)) && t2.push(e9);
  }
  return t2;
}
var y4 = `@uuid:`;
var b4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function x4(e8) {
  return typeof e8 == `string` ? e8.startsWith(`@uuid:`) ? b4.test(e8.slice(6)) : b4.test(e8) : false;
}
function C3(e8, t2, n2, r2, i2) {
  return t2 === n2 && e8 === n2 && n2 === 0 ? true : n2 > t2 ? e8 > t2 && e8 <= n2 : i2 && n2 < t2 ? e8 > t2 || e8 <= n2 : false;
}
var te4 = class {
  constructor() {
    this.clips = /* @__PURE__ */ new Map(), this.entityListeners = /* @__PURE__ */ new Map(), this.globalListeners = [];
  }
  registerClip(e8) {
    this.clips.set(e8.name, e8);
  }
  aliasClip(e8, t2) {
    this.clips.set(e8, t2);
  }
  unregisterClip(e8) {
    this.clips.delete(e8);
  }
  getClip(e8) {
    return this.clips.get(e8);
  }
  clearClips() {
    this.clips.clear();
  }
  onEvent(e8, t2) {
    let n2 = this.entityListeners.get(e8);
    return n2 || (n2 = [], this.entityListeners.set(e8, n2)), n2.push(t2), () => {
      let n3 = this.entityListeners.get(e8);
      if (n3) {
        let r2 = n3.indexOf(t2);
        r2 >= 0 && n3.splice(r2, 1), n3.length === 0 && this.entityListeners.delete(e8);
      }
    };
  }
  onEventGlobal(e8) {
    return this.globalListeners.push(e8), () => {
      let t2 = this.globalListeners.indexOf(e8);
      t2 >= 0 && this.globalListeners.splice(t2, 1);
    };
  }
  removeEntityListeners(e8) {
    this.entityListeners.delete(e8);
  }
  fireEvents(e8, t2, n2, r2) {
    if (!(!t2.events || t2.events.length === 0)) {
      for (let i2 of t2.events) if (C3(i2.frame, n2, r2, t2.frames.length, t2.loop)) {
        let t3 = this.entityListeners.get(e8);
        if (t3) for (let n3 of t3) n3(i2, e8);
        for (let t4 of this.globalListeners) t4(i2, e8);
      }
    }
  }
  update(e8, n2) {
    let r2 = e8.getEntitiesWithComponents([w3]);
    for (let i2 of r2) {
      let r3 = e8.get(i2, w3);
      if (!r3.enabled || !r3.playing || !r3.clip) continue;
      let a2 = this.clips.get(r3.clip);
      if (!a2 || a2.frames.length === 0) continue;
      r3.finished && (r3.finished = false, r3.currentFrame = 0, r3.frameTimer = 0);
      let o2 = Math.max(r3.speed, 1e-4), s2 = (e9) => (a2.frames[e9]?.duration ?? 1 / a2.fps) / o2, c2 = r3.frameTimer === 0 && r3.currentFrame === 0, l2 = r3.currentFrame;
      r3.frameTimer += n2;
      let u2 = c2, d2 = a2.frames.length + 1, f2 = s2(r3.currentFrame);
      for (; r3.playing && r3.frameTimer >= f2 && d2-- > 0; ) r3.frameTimer -= f2, r3.currentFrame++, r3.currentFrame >= a2.frames.length && (r3.loop && a2.loop ? r3.currentFrame = 0 : (r3.currentFrame = a2.frames.length - 1, r3.playing = false, r3.finished = true)), u2 = true, f2 = s2(r3.currentFrame);
      if (u2 && this.fireEvents(i2, a2, l2, r3.currentFrame), u2 && e8.has(i2, bt)) {
        let n3 = a2.frames[r3.currentFrame], o3 = e8.get(i2, bt);
        o3.texture = n3.texture, n3.uvOffset ? (o3.uvOffset = { x: n3.uvOffset.x, y: n3.uvOffset.y }, o3.uvScale = n3.uvScale ? { x: n3.uvScale.x, y: n3.uvScale.y } : { x: 1, y: 1 }) : (o3.uvOffset = { x: 0, y: 0 }, o3.uvScale = { x: 1, y: 1 }), n3.pivot && (o3.pivot = { x: n3.pivot.x, y: n3.pivot.y }), e8.insert(i2, bt, o3);
      }
      u2 && e8.insert(i2, w3, r3);
    }
  }
  gotoFrame(e8, t2, n2 = true) {
    let r2 = this.clips.get(e8.clip);
    !r2 || r2.frames.length === 0 || (e8.currentFrame = Math.max(0, Math.min(t2, r2.frames.length - 1)), e8.frameTimer = 0, e8.playing = n2, e8.finished = false);
  }
  gotoLabel(e8, t2, n2 = true) {
    let r2 = this.clips.get(e8.clip);
    if (!r2 || !r2.labels) return;
    let i2 = r2.labels[t2];
    i2 !== void 0 && this.gotoFrame(e8, i2, n2);
  }
};
var ne4 = ea(null, `SpriteAnimation`);
var w3 = k(`SpriteAnimator`, { clip: ``, speed: 1, playing: true, loop: true, enabled: true, currentFrame: 0, frameTimer: 0, finished: false }, { assetFields: [{ field: `clip`, type: `anim-clip` }] });
function re4(e8, t2, n2) {
  switch (e8.op) {
    case `gt`:
      return Number(t2[e8.param] ?? 0) > e8.value;
    case `lt`:
      return Number(t2[e8.param] ?? 0) < e8.value;
    case `eq`:
      return Number(t2[e8.param] ?? 0) === e8.value;
    case `neq`:
      return Number(t2[e8.param] ?? 0) !== e8.value;
    case `true`:
      return t2[e8.param] === true;
    case `false`:
      return t2[e8.param] === false;
    case `trigger`:
      return n2.has(e8.param);
  }
}
function T4(e8, t2, n2, r2) {
  for (let i2 of e8) {
    if (i2.hasExitTime && !r2) continue;
    let e9 = [], a2 = true;
    for (let r3 of i2.conditions) {
      if (!re4(r3, t2, n2)) {
        a2 = false;
        break;
      }
      r3.op === `trigger` && e9.push(r3.param);
    }
    if (a2) return { to: i2.to, usedTriggers: e9 };
  }
  return null;
}
function E4(e8, t2) {
  let n2 = e8.states.find((e9) => e9.name === t2);
  return !n2 || !n2.stateMachine ? [t2] : [t2, ...E4(n2.stateMachine, n2.stateMachine.initialState)];
}
function D4(e8, t2) {
  if (t2.length === 0) return null;
  let n2 = [], r2 = [], i2 = e8;
  for (let e9 of t2) {
    let t3 = i2.states.find((t4) => t4.name === e9);
    if (!t3) return null;
    if (n2.push(i2), r2.push(t3), !t3.stateMachine) break;
    i2 = t3.stateMachine;
  }
  return { scopes: n2, states: r2 };
}
function O4(e8, t2, n2, r2, i2 = true) {
  let a2 = t2 ? t2.split(`/`) : [], o2 = D4(e8, a2);
  if (!o2) return { nextPath: null, consumedTriggers: [] };
  let { scopes: s2, states: c2 } = o2, l2 = c2.length, u2 = [];
  u2.push({ list: e8.anyStateTransitions ?? [], scope: e8, base: [] });
  for (let e9 = 0; e9 < l2 - 1; e9++) {
    let t3 = c2[e9].stateMachine;
    u2.push({ list: t3.anyStateTransitions ?? [], scope: t3, base: a2.slice(0, e9 + 1) });
  }
  u2.push({ list: c2[l2 - 1].transitions ?? [], scope: s2[l2 - 1], base: a2.slice(0, l2 - 1) });
  for (let e9 = l2 - 2; e9 >= 0; e9--) u2.push({ list: c2[e9].transitions ?? [], scope: s2[e9], base: a2.slice(0, e9) });
  for (let e9 of u2) {
    let t3 = T4(e9.list, n2, r2, i2);
    if (t3) return { nextPath: [...e9.base, ...E4(e9.scope, t3.to)].join(`/`), consumedTriggers: t3.usedTriggers };
  }
  return { nextPath: null, consumedTriggers: [] };
}
function k4(e8, t2) {
  let n2 = D4(e8, t2 ? t2.split(`/`) : []);
  return n2 ? n2.states[n2.states.length - 1] : null;
}
function A3(e8, t2) {
  let n2 = [...e8.thresholds].sort((e9, t3) => e9.value - t3.value);
  if (n2.length === 0) return { value: 0, clip: `` };
  let r2 = n2[0];
  for (let e9 of n2) if (t2 >= e9.value) r2 = e9;
  else break;
  return r2;
}
function j4(e8, t2) {
  let n2 = {};
  for (let t3 of e8.parameters) t3.type !== `trigger` && (n2[t3.name] = t3.default ?? (t3.type !== `bool` && 0));
  for (let [e9, r2] of t2) n2[e9] = r2;
  return n2;
}
var M4 = k(`Animator`, { controller: ``, currentState: ``, enabled: true }, { assetFields: [{ field: `controller`, type: `animatorcontroller` }], discoverAssets: (e8) => {
  let t2 = e8.controller;
  return typeof t2 == `string` && (t2.endsWith(`.esanimator`) || x4(t2)) ? [{ type: `animatorcontroller`, path: t2 }] : [];
} });
var N4 = /* @__PURE__ */ new Map();
function P4(e8, t2) {
  N4.set(e8, t2);
}
function F4(e8) {
  return N4.get(e8);
}
var se3 = class {
  constructor() {
    this.controllers = /* @__PURE__ */ new Map(), this.params = /* @__PURE__ */ new Map(), this.triggers = /* @__PURE__ */ new Map(), this.spineDriver_ = null;
  }
  setSpineDriver(e8) {
    this.spineDriver_ = e8;
  }
  registerController(e8, t2) {
    this.controllers.set(e8, t2);
  }
  unregisterController(e8) {
    this.controllers.delete(e8);
  }
  getController(e8) {
    return this.controllers.get(e8) ?? F4(e8);
  }
  clearControllers() {
    this.controllers.clear();
  }
  setFloat(e8, t2, n2) {
    this.paramStore(e8).set(t2, n2);
  }
  setBool(e8, t2, n2) {
    this.paramStore(e8).set(t2, n2);
  }
  setTrigger(e8, t2) {
    this.triggerStore(e8).add(t2);
  }
  resetTrigger(e8, t2) {
    this.triggers.get(e8)?.delete(t2);
  }
  getFloat(e8, t2) {
    return Number(this.params.get(e8)?.get(t2) ?? 0);
  }
  getBool(e8, t2) {
    return this.params.get(e8)?.get(t2) === true;
  }
  removeEntity(e8) {
    this.params.delete(e8), this.triggers.delete(e8);
  }
  paramStore(e8) {
    let t2 = this.params.get(e8);
    return t2 || (t2 = /* @__PURE__ */ new Map(), this.params.set(e8, t2)), t2;
  }
  triggerStore(e8) {
    let t2 = this.triggers.get(e8);
    return t2 || (t2 = /* @__PURE__ */ new Set(), this.triggers.set(e8, t2)), t2;
  }
  update(e8, t2) {
    let n2 = e8.getEntitiesWithComponents([M4]);
    for (let r2 of n2) {
      let n3 = e8.get(r2, M4);
      if (!n3.enabled) continue;
      let i2 = this.controllers.get(n3.controller) ?? F4(t2 ? t2(n3.controller) : n3.controller) ?? F4(n3.controller);
      if (!i2 || i2.states.length === 0) continue;
      let a2 = n3.currentState, o2 = a2 ? k4(i2, a2) : null;
      if (!o2 && (a2 = E4(i2, i2.initialState).join(`/`), o2 = k4(i2, a2), !o2)) continue;
      let s2 = j4(i2, this.params.get(r2) ?? ce4), c2 = this.triggers.get(r2), l2 = e8.has(r2, w3) ? e8.get(r2, w3) : null, u2 = o2.spine ? `` : this.motionClipOf(o2, s2).clip, d2 = u2 !== `` && l2 != null && l2.clip === u2 && !l2.playing, { nextPath: f2, consumedTriggers: p3 } = O4(i2, a2, s2, c2 ?? le3, d2);
      if (c2) for (let e9 of p3) c2.delete(e9);
      let m3 = f2 ?? a2, h3 = m3 !== n3.currentState;
      h3 && (n3.currentState = m3, e8.insert(r2, M4, n3));
      let g3 = f2 ? k4(i2, m3) : o2;
      g3 && this.applyMotion(e8, r2, g3, s2, h3);
    }
  }
  applyMotion(e8, t2, n2, r2, i2) {
    if (n2.spine) {
      i2 && this.spineDriver_ && this.spineDriver_.setAnimation(t2, n2.spine.animation, n2.spine.loop ?? true);
      return;
    }
    if (!e8.has(t2, w3)) return;
    let a2 = this.motionClipOf(n2, r2), o2 = e8.get(t2, w3);
    o2.clip === a2.clip && !i2 || (o2.clip = a2.clip, o2.speed = a2.speed ?? n2.speed ?? 1, o2.loop = a2.loop ?? n2.loop ?? true, o2.currentFrame = 0, o2.frameTimer = 0, o2.playing = true, o2.finished = false, o2.enabled = true, e8.insert(t2, w3, o2));
  }
  motionClipOf(e8, t2) {
    return e8.blend ? A3(e8.blend, Number(t2[e8.blend.parameter] ?? 0)) : { value: 0, clip: e8.clip ?? ``, speed: e8.speed, loop: e8.loop };
  }
};
var ce4 = /* @__PURE__ */ new Map();
var le3 = /* @__PURE__ */ new Set();
var I4 = ea(null, `AnimatorController`);
var q = ea({ events: [] }, `SpineEvents`);
var J2 = ea(null, `Spine`);

// sdk/dist/shared/webAppFactory.js
var un = class {
  constructor(e8) {
    this.id = e8;
  }
  stop() {
  }
  pause() {
  }
  resume() {
  }
  setVolume() {
  }
  setPan() {
  }
  setLoop() {
  }
  setPlaybackRate() {
  }
  get isPlaying() {
    return false;
  }
  get currentTime() {
    return 0;
  }
  get duration() {
    return 0;
  }
};
var dn = class {
  constructor() {
    this.name = `null`, this.mixer = null, this.isReady = true, this.nextId_ = 1;
  }
  async initialize(e8) {
  }
  async ensureResumed() {
  }
  async loadBuffer(e8) {
    return { id: this.nextId_++, duration: 0, bytes: 0 };
  }
  async loadBufferFromData(e8, t2) {
    return { id: this.nextId_++, duration: 0, bytes: 0 };
  }
  unloadBuffer(e8) {
  }
  play(e8, t2) {
    return new un(this.nextId_++);
  }
  suspend() {
  }
  resume() {
  }
  dispose() {
  }
};
var fn = null;
function pn(e8) {
  fn = e8;
}
function P5() {
  if (!fn) throw Error(`[ESEngine] Platform not initialized. Import from "esengine" (web) or "esengine/wechat" (WeChat) instead of direct imports.`);
  return fn;
}
function F5() {
  return fn !== null;
}
function hn() {
  return fn?.name ?? null;
}
function gn() {
  return fn?.name === `wechat`;
}
async function yn(e8, t2) {
  return P5().fetch(e8, t2);
}
function Tn(e8, t2) {
  return P5().createCanvas(e8, t2);
}
function En() {
  return P5().createImage();
}
function Dn() {
  return F5() && typeof P5().rasterizeGlyph == `function`;
}
function On(e8) {
  return F5() ? P5().rasterizeGlyph?.(e8) ?? null : null;
}
function kn() {
  return F5() ? P5().createTextEditor?.() ?? null : null;
}
function jn() {
  F5() && P5().unbindInputEvents?.();
}
function Mn() {
  return P5().createAudioBackend?.() ?? new dn();
}
function Nn(e8) {
  let t2 = P5();
  return t2.loadSubpackage ? t2.loadSubpackage(e8) : Promise.resolve();
}
async function Pn(e8) {
  if (!F5()) return null;
  let t2 = P5();
  if (!t2.readCacheFile) return null;
  try {
    return await t2.readCacheFile(e8);
  } catch {
    return null;
  }
}
async function Fn(e8, t2) {
  if (!F5()) return;
  let n2 = P5();
  if (n2.writeCacheFile) try {
    await n2.writeCacheFile(e8, t2);
  } catch {
  }
}
function In(e8) {
  if (!F5()) return () => {
  };
  let t2 = P5();
  return t2.onMemoryWarning ? t2.onMemoryWarning(e8) : () => {
  };
}
function Ln(e8) {
  if (!F5()) return () => {
  };
  let t2 = P5();
  return t2.onUnhandledError ? t2.onUnhandledError(e8) : () => {
  };
}
function Rn(e8) {
  if (!F5()) return () => {
  };
  let t2 = P5();
  return t2.onContextLost ? t2.onContextLost(e8) : () => {
  };
}
function zn(e8) {
  if (!F5()) return () => {
  };
  let t2 = P5();
  return t2.onAppShow ? t2.onAppShow(e8) : () => {
  };
}
function Bn(e8) {
  if (!F5()) return () => {
  };
  let t2 = P5();
  return t2.onAppHide ? t2.onAppHide(e8) : () => {
  };
}
function Vn(e8) {
  return F5() ? P5().getStorageItem(e8) : null;
}
function Hn(e8, t2) {
  F5() && P5().setStorageItem(e8, t2);
}
function Un() {
  return F5() && P5().createRewardedAd !== void 0;
}
function Wn(e8) {
  return F5() ? P5().createRewardedAd?.(e8) ?? null : null;
}
function Gn(e8) {
  return F5() ? P5().createInterstitialAd?.(e8) ?? null : null;
}
function Yn() {
  if (!F5()) return false;
  let e8 = P5();
  return e8.login !== void 0 && (e8.canSignIn?.() ?? true);
}
function Xn() {
  return Yn() ? P5().login() : Promise.reject(Error(`this platform has no sign-in`));
}
function Zn() {
  return F5() ? P5().checkSession?.() ?? Promise.resolve(false) : Promise.resolve(false);
}
function ir() {
  return fn ? fn.devicePixelRatio() : typeof window < `u` && window.devicePixelRatio || 1;
}
var or = (e8) => Math.max(0, Math.min(1, e8));
function sr(e8, t2, n2) {
  let r2 = e8.sampleRate, i2 = Math.max(1, Math.floor(r2 * Math.max(0.05, t2))), a2 = e8.createBuffer(2, i2, r2);
  for (let e9 = 0; e9 < 2; e9++) {
    let t3 = a2.getChannelData(e9);
    for (let e10 = 0; e10 < i2; e10++) t3[e10] = (Math.random() * 2 - 1) * (1 - e10 / i2) ** n2;
  }
  return a2;
}
function cr(e8, t2) {
  let n2 = e8.createBiquadFilter();
  return n2.type = t2.filter, n2.frequency.value = Math.max(10, t2.frequency), t2.q !== void 0 && (n2.Q.value = t2.q), t2.gainDb !== void 0 && (n2.gain.value = t2.gainDb), { input: n2, output: n2 };
}
function lr(e8, t2) {
  let n2 = e8.createGain(), r2 = e8.createGain(), i2 = or(t2.wet ?? 0.35), a2 = e8.createGain();
  a2.gain.value = 1 - i2, n2.connect(a2), a2.connect(r2);
  let o2 = e8.createConvolver();
  o2.buffer = sr(e8, t2.seconds ?? 1.5, t2.decay ?? 3);
  let s2 = e8.createGain();
  return s2.gain.value = i2, n2.connect(o2), o2.connect(s2), s2.connect(r2), { input: n2, output: r2 };
}
function ur(e8, t2) {
  let n2 = e8.createDynamicsCompressor();
  return t2.thresholdDb !== void 0 && (n2.threshold.value = t2.thresholdDb), t2.ratio !== void 0 && (n2.ratio.value = Math.max(1, t2.ratio)), t2.attack !== void 0 && (n2.attack.value = Math.max(0, t2.attack)), t2.release !== void 0 && (n2.release.value = Math.max(0, t2.release)), t2.kneeDb !== void 0 && (n2.knee.value = Math.max(0, t2.kneeDb)), { input: n2, output: n2 };
}
function dr(e8, t2) {
  switch (t2.type) {
    case `filter`:
      return cr(e8, t2);
    case `reverb`:
      return lr(e8, t2);
    case `compressor`:
      return ur(e8, t2);
  }
}
var pr = 0.015;
var mr = class e2 {
  constructor(e8, t2) {
    this.muted_ = false, this.volume_ = 1, this.children_ = [], this.effectDefs_ = [], this.effectNodes_ = [], this.name_ = t2.name, this.context_ = e8, this.inputNode_ = e8.createGain(), this.duckNode_ = e8.createGain(), this.gainNode_ = e8.createGain(), this.inputNode_.connect(this.duckNode_), this.duckNode_.connect(this.gainNode_), this.volume_ = Math.max(0, Math.min(1, t2.volume ?? 1)), this.muted_ = t2.muted ?? false, this.gainNode_.gain.value = this.muted_ ? 0 : this.volume_;
  }
  get name() {
    return this.name_;
  }
  get input() {
    return this.inputNode_;
  }
  get node() {
    return this.gainNode_;
  }
  get volume() {
    return this.volume_;
  }
  set volume(e8) {
    this.volume_ = Math.max(0, Math.min(1, e8)), this.muted_ || this.gainNode_.gain.setTargetAtTime(this.volume_, this.gainNode_.context.currentTime, pr);
  }
  get muted() {
    return this.muted_;
  }
  set muted(e8) {
    this.muted_ = e8, this.gainNode_.gain.setTargetAtTime(e8 ? 0 : this.volume_, this.gainNode_.context.currentTime, pr);
  }
  get effects() {
    return this.effectDefs_.map((e8) => ({ ...e8 }));
  }
  setEffects(e8) {
    this.inputNode_.disconnect();
    for (let e9 of this.effectNodes_) e9.output.disconnect();
    this.effectDefs_ = e8.map((e9) => ({ ...e9 })), this.effectNodes_ = e8.map((e9) => dr(this.context_, e9));
    let t2 = this.inputNode_;
    for (let e9 of this.effectNodes_) t2.connect(e9.input), t2 = e9.output;
    t2.connect(this.duckNode_);
  }
  duckTo(e8, t2) {
    this.duckNode_.gain.setTargetAtTime(Math.max(0, Math.min(1, e8)), this.duckNode_.context.currentTime, Math.max(1e-3, t2));
  }
  connect(t2) {
    t2 instanceof e2 ? this.gainNode_.connect(t2.input) : this.gainNode_.connect(t2);
  }
  addChild(e8) {
    e8.connect(this), this.children_.push(e8);
  }
};
var hr = class {
  constructor(e8, t2 = {}) {
    this.buses_ = /* @__PURE__ */ new Map(), this.ducks_ = /* @__PURE__ */ new Map(), this.context_ = e8, this.master = new mr(e8, { name: `master`, volume: t2.masterVolume ?? 1 }), this.master.connect(e8.destination), this.music = new mr(e8, { name: `music`, volume: t2.musicVolume ?? 0.8 }), this.master.addChild(this.music), this.sfx = new mr(e8, { name: `sfx`, volume: t2.sfxVolume ?? 1 }), this.master.addChild(this.sfx), this.ui = new mr(e8, { name: `ui`, volume: t2.uiVolume ?? 1 }), this.master.addChild(this.ui), this.voice = new mr(e8, { name: `voice`, volume: t2.voiceVolume ?? 1 }), this.master.addChild(this.voice), this.buses_.set(`master`, this.master), this.buses_.set(`music`, this.music), this.buses_.set(`sfx`, this.sfx), this.buses_.set(`ui`, this.ui), this.buses_.set(`voice`, this.voice);
  }
  getBus(e8) {
    return this.buses_.get(e8);
  }
  busNames() {
    return [...this.buses_.keys()];
  }
  createBus(e8) {
    let t2 = new mr(this.context_, e8), n2 = e8.parent ? this.buses_.get(e8.parent) : this.master;
    return n2 && n2.addChild(t2), this.buses_.set(e8.name, t2), t2;
  }
  setDucking(e8, t2) {
    let n2 = this.buses_.get(e8);
    if (!n2) return false;
    let r2 = this.ducks_.get(e8);
    if (r2 && (this.buses_.get(r2.rule.trigger)?.node.disconnect(r2.analyser), this.ducks_.delete(e8), n2.duckTo(1, r2.rule.release ?? 0.4)), !t2) return true;
    let i2 = this.buses_.get(t2.trigger);
    if (!i2) return false;
    let a2 = this.context_.createAnalyser();
    return a2.fftSize = 256, i2.node.connect(a2), this.ducks_.set(e8, { rule: { ...t2 }, analyser: a2, data: new Uint8Array(a2.fftSize) }), true;
  }
  getDucking(e8) {
    let t2 = this.ducks_.get(e8);
    return t2 ? { ...t2.rule } : null;
  }
  updateDucking() {
    for (let [e8, t2] of this.ducks_) {
      let n2 = this.buses_.get(e8);
      if (!n2) continue;
      t2.analyser.getByteTimeDomainData(t2.data);
      let r2 = 0;
      for (let e9 = 0; e9 < t2.data.length; e9++) {
        let n3 = (t2.data[e9] - 128) / 128;
        r2 += n3 * n3;
      }
      let i2 = Math.sqrt(r2 / t2.data.length) > (t2.rule.threshold ?? 3e-3);
      n2.duckTo(i2 ? t2.rule.amount : 1, i2 ? t2.rule.attack ?? 0.05 : t2.rule.release ?? 0.4);
    }
  }
};
var gr = class {
  constructor(e8, t2 = 16) {
    this.pool_ = [], this.activeCount_ = 0, this.context_ = e8;
    for (let e9 = 0; e9 < t2; e9++) this.pool_.push(this.createNode());
  }
  createNode() {
    let e8 = this.context_.createGain(), t2 = this.context_.createStereoPanner();
    return e8.connect(t2), { gain: e8, panner: t2, source: null, inUse: false, startTime: 0 };
  }
  acquire() {
    let e8 = this.pool_.find((e9) => !e9.inUse);
    return e8 || (e8 = this.createNode(), this.pool_.push(e8)), e8.inUse = true, e8.startTime = this.context_.currentTime, e8.gain.gain.value = 1, e8.panner.pan.value = 0, this.activeCount_++, e8;
  }
  release(e8) {
    if (e8.inUse) {
      if (e8.source) {
        try {
          e8.source.stop();
        } catch {
        }
        e8.source.disconnect(), e8.source = null;
      }
      e8.panner.disconnect(), e8.inUse = false, this.activeCount_--;
    }
  }
  get activeCount() {
    return this.activeCount_;
  }
  get capacity() {
    return this.pool_.length;
  }
};
function _r(e8) {
  return { premultiplyAlpha: `none`, colorSpaceConversion: `none`, imageOrientation: e8 ? `flipY` : `from-image` };
}
function vr(e8, t2) {
  return createImageBitmap(e8, _r(t2));
}
async function yr(e8) {
  let t2 = await vr(e8, false);
  try {
    let e9 = Tn(t2.width, t2.height);
    e9.width = t2.width, e9.height = t2.height;
    let n2 = e9.getContext(`2d`, { willReadFrequently: true });
    if (!n2) throw Error(`imageDecode: 2D context unavailable for pixel decode`);
    n2.drawImage(t2, 0, 0);
    let r2 = n2.getImageData(0, 0, t2.width, t2.height);
    return { width: t2.width, height: t2.height, pixels: new Uint8Array(r2.data.buffer) };
  } finally {
    t2.close?.();
  }
}
async function br(e8) {
  let t2 = await fetch(e8);
  if (!t2.ok) throw Error(`image fetch failed (${t2.status}): ${e8}`);
  return yr(await t2.blob());
}
function xr(e8, t2) {
  return `${e8}:${t2 ? `f` : `n`}`;
}
var Sr = class {
  setTranscoder(e8) {
    this.transcoder_ = e8;
  }
  setTranscoderProvider(e8) {
    this.transcoderProvider_ = e8;
  }
  async ensureTranscoder_() {
    return this.transcoder_ ? this.transcoder_ : this.transcoderProvider_ ? (this.transcoderPending_ ||= this.transcoderProvider_(), this.transcoder_ = await this.transcoderPending_, this.transcoder_) : null;
  }
  constructor(e8) {
    this.type = `texture`, this.extensions = [`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.ktx2`], this.transcoder_ = null, this.transcoderProvider_ = null, this.transcoderPending_ = null, this.canvas_ = null, this.ctx_ = null, this.importSettingsResolver = null, this.pixelDecoder_ = null, this.module_ = e8;
  }
  setPendingSettings(e8) {
    this.pendingSettings_ = e8;
  }
  setPixelDecoder(e8) {
    this.pixelDecoder_ = e8;
  }
  get pixelDecoder() {
    return this.pixelDecoder_;
  }
  ensureCanvas_() {
    if (this.canvas_ && this.ctx_) return { canvas: this.canvas_, ctx: this.ctx_ };
    this.canvas_ = Tn(256, 256);
    let e8 = this.canvas_.getContext(`2d`, { willReadFrequently: true });
    if (!e8) throw Error(`TextureLoader: failed to create 2D context`);
    return this.ctx_ = e8, { canvas: this.canvas_, ctx: this.ctx_ };
  }
  async load(e8, t2) {
    let n2 = this.pendingSettings_;
    return this.pendingSettings_ = void 0, this.loadWithFlip(e8, t2, true, n2);
  }
  async loadRaw(e8, t2) {
    let n2 = this.pendingSettings_;
    return this.pendingSettings_ = void 0, this.loadWithFlip(e8, t2, false, n2);
  }
  async loadFromPixels(e8, t2, n2, r2) {
    let a2 = le();
    if (a2.createTextureFromBytes) return { handle: a2.createTextureFromBytes(e8, t2, n2, 1, r2), width: e8, height: t2 };
    if (!this.module_) throw Error(`TextureLoader.loadFromPixels: no wasm module and no native byte-upload path`);
    let o2 = this.module_;
    return { handle: he(o2, n2.length, (i2) => (o2.HEAPU8.set(n2, i2), a2.createTexture(e8, t2, i2, n2.length, 1, r2))), width: e8, height: t2 };
  }
  unload(e8) {
    le().releaseTexture(e8.handle);
  }
  async loadDetached(e8, t2, n2, r2) {
    return this.decodeAndUpload_(e8, t2, n2, r2);
  }
  async loadWithFlip(e8, t2, n2, r2) {
    let a2 = await this.decodeAndUpload_(e8, t2, n2, r2);
    return le().registerTextureWithPath?.(a2.handle, xr(e8, n2)), a2;
  }
  async decodeAndUpload_(e8, t2, n2, r2) {
    if (ae2(e8)) return this.loadCompressed(e8, t2, r2);
    if (this.pixelDecoder_) {
      let t3 = await this.pixelDecoder_(e8, n2), i3 = { filterMode: r2?.filter, wrapMode: r2?.wrap, srgb: r2?.srgb };
      return { handle: ee2(this.module_, t3, n2, i3), width: t3.width, height: t3.height };
    }
    let i2 = t2.backend.resolveUrl(t2.catalog.getBuildPath(e8)), a2 = await this.loadImage(i2, n2);
    return this.createTextureFromImage(a2, n2, r2);
  }
  async loadCompressed(e8, t2, n2) {
    let r2 = await t2.backend.fetchBinary(t2.catalog.getBuildPath(e8)), a2 = new Uint8Array(r2);
    if (!ie2(a2)) throw Error(`TextureLoader: ${e8} is not a KTX2 file`);
    let o2 = le();
    if (o2.createTextureFromKTX2) {
      let t3 = o2.createTextureFromKTX2(a2, g());
      if (!t3) throw Error(`TextureLoader: KTX2 transcode failed for ${e8}`);
      return { handle: t3.handle, width: t3.width, height: t3.height };
    }
    let s2 = await this.ensureTranscoder_();
    if (!s2) throw Error(`TextureLoader: no Basis transcoder available (basis side module missing \u2014 KTX2 assets need it)`);
    let c2 = this.getWebGL2Context();
    if (!c2) return this.loadCompressedViaEngine(e8, s2, a2);
    let l2 = he2(c2, this.module_, s2, a2, { ...n2, srgb: g() });
    return { handle: l2.handle, width: l2.width, height: l2.height };
  }
  async loadCompressedViaEngine(e8, t2, n2) {
    let r2 = le(), a2 = this.module_, o2 = g();
    if (a2 && r2.supportsCompressedFormat && r2.createCompressedTexture) {
      let e9 = r2.supportsCompressedFormat.bind(r2), i2 = ce2((t3) => e9(t3), o2);
      if (i2) {
        let e10 = t2.transcode(n2, i2);
        if (e10) {
          let t3 = _2(i2, o2), n3 = he(a2, e10.data.length, (n4) => (a2.HEAPU8.set(e10.data, n4), r2.createCompressedTexture(e10.width, e10.height, t3, n4, e10.data.length, 1)));
          if (n3) return { handle: n3, width: e10.width, height: e10.height };
        }
      }
    }
    let s2 = t2.transcodeToRgba(n2);
    if (!s2) throw Error(`TextureLoader: KTX2 decode failed for ${e8}`);
    return this.loadFromPixels(s2.width, s2.height, s2.data, false);
  }
  loadImage(e8, t2) {
    return new Promise((n2, r2) => {
      let i2 = En();
      i2.crossOrigin = `anonymous`, i2.onload = async () => {
        if (typeof createImageBitmap < `u`) try {
          n2(await vr(i2, t2));
          return;
        } catch {
        }
        n2(i2);
      }, i2.onerror = () => r2(Error(`Failed to load image: ${e8}`)), i2.src = e8;
    });
  }
  createTextureFromImage(e8, t2, n2) {
    let { width: r2, height: i2 } = e8, a2 = this.getWebGL2Context(), o2 = typeof ImageBitmap < `u` && e8 instanceof ImageBitmap ? false : t2;
    return a2 ? this.createTextureWebGL2(a2, e8, r2, i2, o2, n2) : this.createTextureFallback(e8, r2, i2, o2, n2);
  }
  getWebGL2Context() {
    return Tr(this.module_?.GL);
  }
  createTextureWebGL2(e8, t2, n2, r2, a2, o2) {
    let s2 = e8.createTexture();
    if (!s2) throw Error(`TextureLoader: gl.createTexture() returned null (GL context lost?)`);
    try {
      e8.bindTexture(e8.TEXTURE_2D, s2), re2(e8, t2, a2, o2?.srgb), h(e8, o2);
    } catch (t3) {
      throw e8.deleteTexture(s2), t3;
    }
    let c2 = this.module_.GL, l2 = c2.getNewId(c2.textures);
    return c2.textures[l2] = s2, { handle: le().registerExternalTexture(l2, n2, r2), width: n2, height: r2 };
  }
  createTextureFallback(e8, t2, n2, r2, a2) {
    if (!this.module_) throw Error(`TextureLoader: 2D-canvas fallback needs a wasm module (native uses the pixel-decode path)`);
    let o2 = this.module_, { canvas: s2, ctx: c2 } = this.ensureCanvas_();
    (s2.width < t2 || s2.height < n2) && (s2.width = Math.max(s2.width, wr(t2)), s2.height = Math.max(s2.height, wr(n2))), c2.clearRect(0, 0, s2.width, s2.height), c2.drawImage(e8, 0, 0);
    let l2 = c2.getImageData(0, 0, t2, n2), u2 = new Uint8Array(l2.data.buffer);
    Cr(u2);
    let d2 = le(), f2 = g() && (a2?.srgb ?? true) ? 2 : 1;
    return { handle: he(o2, u2.length, (e9) => (o2.HEAPU8.set(u2, e9), d2.createTexture(t2, n2, e9, u2.length, f2, r2))), width: t2, height: n2 };
  }
};
function Cr(e8) {
  for (let t2 = 0; t2 < e8.length; t2 += 4) {
    let n2 = e8[t2 + 3];
    if (n2 > 0 && n2 < 255) {
      let r2 = 255 / n2;
      e8[t2] = Math.min(255, Math.round(e8[t2] * r2)), e8[t2 + 1] = Math.min(255, Math.round(e8[t2 + 1] * r2)), e8[t2 + 2] = Math.min(255, Math.round(e8[t2 + 2] * r2));
    }
  }
}
function wr(e8) {
  let t2 = 1;
  for (; t2 < e8; ) t2 *= 2;
  return t2;
}
function Tr(e8) {
  try {
    let t2 = e8?.currentContext?.GLctx;
    if (Er(t2)) return t2;
    for (let t3 of e8?.contexts ?? []) if (t3 && Er(t3.GLctx)) return t3.GLctx;
  } catch {
  }
  return null;
}
function Er(e8) {
  return !!e8 && typeof e8.texStorage2D == `function`;
}
var Dr = 0;
var kr = class {
  constructor() {
    this.handlers_ = /* @__PURE__ */ new Map();
  }
  on(e8, t2) {
    let n2 = this.handlers_.get(e8);
    return n2 || (n2 = /* @__PURE__ */ new Set(), this.handlers_.set(e8, n2)), n2.has(t2) || (n2.add(t2), Dr++), () => {
      n2.delete(t2) && (Dr--, n2.size === 0 && this.handlers_.delete(e8));
    };
  }
  emit(e8, ...t2) {
    let n2 = this.handlers_.get(e8);
    if (n2) for (let e9 of [...n2]) e9(...t2);
  }
  clear() {
    for (let e8 of this.handlers_.values()) Dr -= e8.size;
    this.handlers_.clear();
  }
  get size() {
    let e8 = 0;
    for (let t2 of this.handlers_.values()) e8 += t2.size;
    return e8;
  }
};
var Ar = class {
  constructor(e8) {
    this.ws_ = null, this.sendQueue_ = [], this.events_ = new kr(), this.readyState = `closed`, this.url_ = e8.url, this.protocols_ = e8.protocols;
  }
  on(e8, t2) {
    return this.events_.on(e8, t2);
  }
  connect() {
    if (!this.ws_) {
      this.readyState = `connecting`;
      try {
        this.ws_ = new WebSocket(this.url_, this.protocols_), this.ws_.binaryType = `arraybuffer`, this.ws_.onopen = () => {
          this.readyState = `open`;
          for (let e8 of this.sendQueue_) this.ws_.send(e8);
          this.sendQueue_ = [], this.events_.emit(`open`);
        }, this.ws_.onmessage = (e8) => {
          this.events_.emit(`message`, e8.data);
        }, this.ws_.onclose = (e8) => {
          this.readyState = `closed`, this.ws_ = null, this.events_.emit(`close`, e8.code, e8.reason);
        }, this.ws_.onerror = (e8) => {
          this.events_.emit(`error`, e8);
        };
      } catch (e8) {
        this.readyState = `closed`, this.events_.emit(`error`, e8);
      }
    }
  }
  send(e8) {
    this.readyState === `open` && this.ws_ ? this.ws_.send(e8) : this.sendQueue_.push(e8);
  }
  close(e8, t2) {
    this.ws_ && (this.readyState = `closing`, this.ws_.close(e8, t2));
  }
};
function jr(e8) {
  let t2 = null;
  return { start(n2, r2, i2) {
    e8.onTouchStart?.(n2, r2, i2), t2 === null && (t2 = n2, e8.onPointerDown(0, r2, i2));
  }, move(n2, r2, i2) {
    e8.onTouchMove?.(n2, r2, i2), n2 === t2 && e8.onPointerMove(r2, i2);
  }, end(n2) {
    e8.onTouchEnd?.(n2), n2 === t2 && (t2 = null, e8.onPointerUp(0));
  }, cancel(n2) {
    e8.onTouchCancel?.(n2), n2 === t2 && (t2 = null, e8.onPointerUp(0));
  } };
}
var Mr = class {
  constructor() {
    this.actions = /* @__PURE__ */ new Map(), this.conditions = /* @__PURE__ */ new Map();
  }
  registerAction(e8, t2) {
    let n2 = typeof t2 == `function` ? { run: t2 } : t2, r2 = n2.params ?? [], i2 = n2.separator ?? `:`, a2 = n2.run, o2 = r2.length === 0 ? a2 : (e9, t3, n3, o3) => {
      let s2 = o3 && Object.keys(o3).length > 0 ? o3 : Nr(n3, r2, i2);
      return a2(e9, t3, n3 ?? Pr(s2, r2, i2), s2);
    };
    this.actions.set(e8, { fn: o2, params: r2, separator: i2, touches: n2.touches });
  }
  registerCondition(e8, t2) {
    let n2 = typeof t2 == `function` ? { check: t2 } : t2;
    this.conditions.set(e8, { fn: n2.check, touches: n2.touches });
  }
  getAction(e8) {
    return this.actions.get(e8)?.fn;
  }
  actionTouches(e8, t2 = {}) {
    let n2 = this.actions.get(e8)?.touches;
    if (n2) return typeof n2 == `function` ? n2(t2) : n2;
  }
  conditionTouches(e8) {
    return this.conditions.get(e8)?.touches;
  }
  getActionParams(e8) {
    return this.actions.get(e8)?.params ?? [];
  }
  getActionSeparator(e8) {
    return this.actions.get(e8)?.separator ?? `:`;
  }
  getCondition(e8) {
    return this.conditions.get(e8)?.fn;
  }
  hasAction(e8) {
    return this.actions.has(e8);
  }
  hasCondition(e8) {
    return this.conditions.has(e8);
  }
  actionNames() {
    return [...this.actions.keys()];
  }
  conditionNames() {
    return [...this.conditions.keys()];
  }
  clear() {
    this.actions.clear(), this.conditions.clear();
  }
};
function Nr(e8, t2, n2 = `:`) {
  let r2 = {};
  if (!e8 || t2.length === 0) return r2;
  let i2 = [], a2 = e8;
  for (let e9 = 0; e9 < t2.length - 1; e9++) {
    let e10 = a2.indexOf(n2);
    if (e10 < 0) break;
    i2.push(a2.slice(0, e10)), a2 = a2.slice(e10 + n2.length);
  }
  i2.push(a2);
  for (let e9 = 0; e9 < i2.length && e9 < t2.length; e9++) r2[t2[e9].name] = Ir(i2[e9], t2[e9].type);
  return r2;
}
function Pr(e8, t2, n2 = `:`) {
  if (!e8 || t2.length === 0) return;
  let r2 = t2.map((t3) => {
    let n3 = e8[t3.name];
    return n3 == null ? `` : String(n3);
  });
  for (; r2.length && r2[r2.length - 1] === ``; ) r2.pop();
  return r2.length ? r2.join(n2) : void 0;
}
function Fr(e8, t2, n2, r2, i2 = {}) {
  let a2 = e8.getAction(t2);
  if (!a2) return;
  let o2 = i2.params && Object.keys(i2.params).length > 0 ? i2.params : void 0;
  return a2(n2, r2, o2 ? Pr(o2, e8.getActionParams(t2), e8.getActionSeparator(t2)) ?? i2.arg : i2.arg, o2);
}
function Ir(e8, t2) {
  if (t2 === `number`) {
    let t3 = Number(e8);
    return Number.isFinite(t3) ? t3 : 0;
  }
  return t2 === `bool` ? e8 === `true` || e8 === `1` : e8;
}
var I5 = new Mr();
var zr = (function(e8) {
  return e8[e8.None = 0] = `None`, e8[e8.RunStart = 1] = `RunStart`, e8[e8.Instanced = 2] = `Instanced`, e8[e8.Shader = 3] = `Shader`, e8[e8.Blend = 4] = `Blend`, e8[e8.Layout = 5] = `Layout`, e8[e8.Material = 6] = `Material`, e8[e8.Depth = 7] = `Depth`, e8[e8.Cull = 8] = `Cull`, e8[e8.State = 9] = `State`, e8[e8.Scissor = 10] = `Scissor`, e8[e8.Stencil = 11] = `Stencil`, e8[e8.IndexGap = 12] = `IndexGap`, e8[e8.TextureSlots = 13] = `TextureSlots`, e8;
})({});
var Br = (function(e8) {
  return e8[e8.Sprite = 0] = `Sprite`, e8[e8.Spine = 1] = `Spine`, e8[e8.Mesh = 2] = `Mesh`, e8[e8.ExternalMesh = 3] = `ExternalMesh`, e8[e8.Text = 4] = `Text`, e8[e8.Particle = 5] = `Particle`, e8[e8.Shape = 6] = `Shape`, e8[e8.UIElement = 7] = `UIElement`, e8;
})({});
function Vr(e8) {
  if (!e8.renderer_hasCapturedData()) return null;
  let t2 = e8.renderer_getCapturedFrameSize();
  if (t2 === 0) return null;
  let n2 = e8.renderer_getCapturedFrameData(), r2 = e8.renderer_getCapturedEntities(), i2 = e8.renderer_getCapturedEntityCount(), a2 = e8.renderer_getCapturedCameraCount(), o2 = e8.HEAPU8, s2 = new DataView(o2.buffer, n2, t2 * 76), c2 = new Uint32Array(o2.buffer, r2, i2), l2 = [];
  for (let e9 = 0; e9 < t2; e9++) {
    let t3 = e9 * 76, n3 = s2.getUint32(t3, true), r3 = s2.getUint32(t3 + 4, true), a3 = s2.getUint8(t3 + 8), o3 = s2.getUint8(t3 + 9), u2 = s2.getUint8(t3 + 10), d2 = s2.getUint32(t3 + 12, true), f2 = s2.getUint32(t3 + 16, true), p3 = s2.getUint32(t3 + 20, true), m3 = s2.getUint32(t3 + 24, true), h3 = s2.getUint32(t3 + 28, true), g3 = s2.getUint32(t3 + 32, true), _3 = s2.getUint32(t3 + 36, true), v4 = s2.getInt32(t3 + 40, true), y5 = s2.getUint8(t3 + 44), b5 = s2.getInt32(t3 + 48, true), x5 = s2.getInt32(t3 + 52, true), S5 = s2.getInt32(t3 + 56, true), C5 = s2.getInt32(t3 + 60, true), ee4 = s2.getUint8(t3 + 64) !== 0, w5 = s2.getUint8(t3 + 65) !== 0, T5 = s2.getUint8(t3 + 66) !== 0, te5 = s2.getInt32(t3 + 68, true), E5 = s2.getUint8(t3 + 72), ne5 = [];
    for (let e10 = 0; e10 < g3 && _3 + e10 < i2; e10++) ne5.push(c2[_3 + e10]);
    l2.push({ index: n3, cameraIndex: r3, stage: a3, type: o3, blendMode: u2, textureId: d2, materialId: f2, shaderId: p3, vertexCount: m3, triangleCount: h3, entityCount: g3, entityOffset: _3, layer: v4, breakReason: y5, scissorX: b5, scissorY: x5, scissorW: S5, scissorH: C5, scissorEnabled: ee4, stencilWrite: w5, stencilTest: T5, stencilRef: te5, textureSlotUsage: E5, entities: ne5 });
  }
  return { drawCalls: l2, cameraCount: a2 };
}
function Hr(e8, t2) {
  e8.renderer_replayToDrawCall(t2);
}
async function Ur(e8) {
  if (await b3(() => e8.renderer_pollSnapshotReadback()) !== 1) return null;
  let t2 = e8.renderer_getSnapshotSize();
  if (t2 === 0) return null;
  let n2 = e8.renderer_getSnapshotWidth(), r2 = e8.renderer_getSnapshotHeight();
  if (n2 === 0 || r2 === 0) return null;
  let i2 = e8.renderer_getSnapshotPtr(), a2 = e8.HEAPU8, o2 = new Uint8ClampedArray(a2.buffer, i2, t2), s2 = new Uint8ClampedArray(t2), c2 = n2 * 4;
  for (let e9 = 0; e9 < r2; e9++) {
    let t3 = e9 * c2, n3 = (r2 - 1 - e9) * c2;
    s2.set(o2.subarray(t3, t3 + c2), n3);
  }
  return new ImageData(s2, n2, r2);
}
var Jr = (function(e8) {
  return e8[e8.Background = 0] = `Background`, e8[e8.Opaque = 1] = `Opaque`, e8[e8.Transparent = 2] = `Transparent`, e8[e8.Overlay = 3] = `Overlay`, e8;
})({});
var Xr = { drawCalls: 0, triangles: 0, sprites: 0, text: 0, spine: 0, meshes: 0, culled: 0 };
var Zr = new y3(`renderer`);
var L3 = null;
var $r2 = null;
var ti2 = { Live: 0, Lost: 1, Recovering: 2, Dead: 3 };
var ni = { Unknown: 0, ContextLost: 1, OutOfMemory: 2, Reset: 3, Removed: 4, Destroyed: 5, Validation: 6, Internal: 7 };
function ri() {
  return L3?.deviceStatus?.() ?? ti2.Live;
}
function ii() {
  return L3?.deviceLostReport?.() ?? ``;
}
function oi2(e8, t2) {
  L3?.notifyDeviceLost?.(e8, t2);
}
function ci2() {
  return L3?.recoverDevice?.() ?? false;
}
function li2() {
  return L3?.markDeviceRestored?.() ?? 0;
}
var R3 = { init(e8, t2) {
  $r2?.init(e8, t2);
}, resize(e8, t2) {
  $r2?.resize(e8, t2);
}, beginFrame(e8 = 0) {
  $r2?.beginFrame(e8);
}, updateTransforms(e8) {
  $r2?.updateTransforms(e8._cpp);
}, begin(e8, t2, n2 = 0, r2, i2) {
  $r2?.begin(e8, t2 ?? 0, n2, r2?.x ?? 0, r2?.y ?? 0, r2?.z ?? 0, r2?.w ?? 1, i2?.x ?? 0, i2?.y ?? 0, i2?.w ?? 0, i2?.h ?? 0);
}, flush() {
  $r2?.flush();
}, end() {
  $r2?.end();
}, submitAll(e8, t2, n2, r2, i2, a2) {
  $r2?.submitAll(e8._cpp, t2, n2, r2, i2, a2);
}, setStage(e8) {
  $r2?.setStage(e8);
}, createRenderTarget(e8, t2, n2 = 1) {
  return L3?.renderer_createTarget(e8, t2, n2) ?? 0;
}, releaseRenderTarget(e8) {
  L3?.renderer_releaseTarget(e8);
}, getTargetTexture(e8) {
  return L3?.renderer_getTargetTexture(e8) ?? 0;
}, getTargetDepthTexture(e8) {
  return L3?.renderer_getTargetDepthTexture(e8) ?? 0;
}, setClearColor(e8, t2, n2, r2) {
  L3?.renderer_setClearColor?.(e8, t2, n2, r2);
}, setViewport(e8, t2, n2, r2) {
  $r2?.setViewport(e8, t2, n2, r2);
}, setYSortLayers(e8) {
  $r2?.setYSortLayers(e8);
}, setDepthLayers(e8) {
  $r2?.setDepthLayers(e8);
}, setCullingMask(e8) {
  $r2?.setCullingMask(e8);
}, setTextureParams(e8, t2, n2, r2, i2) {
  L3?.renderer_setTextureParams?.(e8, t2, n2, r2, i2);
}, measureBitmapText(e8, t2, n2, r2) {
  return L3 ? le().measureBitmapText(e8, t2, n2, r2) : { width: 0, height: 0 };
}, getStats() {
  return $r2?.getStats() ?? Xr;
}, captureNextFrame() {
  L3?.renderer_captureNextFrame();
}, getCapturedData() {
  return L3 ? Vr(L3) : null;
}, hasCapturedData() {
  return L3?.renderer_hasCapturedData() ?? false;
}, replayToDrawCall(e8) {
  L3 && Hr(L3, e8);
}, getSnapshotImageData() {
  return L3 ? Ur(L3) : Promise.resolve(null);
} };
var bi2 = class e3 {
  constructor(e8, t2, n2) {
    this.entries_ = e8, this.addresses_ = t2, this.labels_ = n2;
  }
  static fromJson(t2) {
    let n2 = new Map(Object.entries(t2.entries)), r2 = new Map(Object.entries(t2.addresses ?? {})), i2 = new Map(Object.entries(t2.labels ?? {}));
    return new e3(n2, r2, i2);
  }
  static empty() {
    return new e3(/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map(), /* @__PURE__ */ new Map());
  }
  resolve(e8) {
    return this.addresses_.get(e8) || (this.entries_.has(e8), e8);
  }
  getEntry(e8) {
    return this.entries_.get(e8) ?? null;
  }
  getAtlasFrame(e8) {
    let t2 = this.entries_.get(e8);
    return !t2?.atlas || !t2.frame || !t2.uv ? null : { atlas: t2.atlas, frame: t2.frame, uvOffset: t2.uv.offset, uvScale: t2.uv.scale, trim: t2.trim };
  }
  getBuildPath(e8) {
    return this.entries_.get(e8)?.buildPath ?? e8;
  }
  getDeps(e8) {
    return this.entries_.get(e8)?.deps ?? [];
  }
  getByLabel(e8) {
    return this.labels_.get(e8) ?? [];
  }
  getAllLabels() {
    return Array.from(this.labels_.keys());
  }
  hasEntry(e8) {
    return this.entries_.has(e8);
  }
  hasAddress(e8) {
    return this.addresses_.has(e8);
  }
  get isEmpty() {
    return this.entries_.size === 0;
  }
};
function Ci(e8) {
  let t2 = /* @__PURE__ */ new Map();
  for (let { uuid: n2, path: r2, address: i2, settings: a2 } of e8) if (a2) for (let e9 of [n2, n2 && `@uuid:${n2}`, r2, i2]) e9 && (t2.set(e9, a2), e9.startsWith(`/`) || t2.set(`/${e9}`, a2));
  return t2.size > 0 ? (e9) => t2.get(e9) : () => void 0;
}
var z4 = (1n << 64n) - 1n;
var wi = 11400714785074694791n;
var Ti = 14029467366897019727n;
var Ei = 1609587929392839161n;
var Di = 9650029242287828579n;
var Oi2 = 2870177450012600261n;
function ki(e8, t2) {
  return (e8 << t2 | e8 >> 64n - t2) & z4;
}
function Ai(e8, t2) {
  return e8 = e8 + t2 * Ti & z4, e8 = ki(e8, 31n), e8 * wi & z4;
}
function ji(e8, t2) {
  let n2 = Ai(0n, t2);
  return e8 = (e8 ^ n2) & z4, e8 * wi + Di & z4;
}
function Mi2(e8, t2) {
  return BigInt((e8[t2] | e8[t2 + 1] << 8 | e8[t2 + 2] << 16 | e8[t2 + 3] << 24) >>> 0);
}
function Ni(e8, t2) {
  return Mi2(e8, t2 + 4) << 32n | Mi2(e8, t2);
}
function Pi(e8, t2 = 0n) {
  let n2 = e8.length, r2 = 0, i2;
  if (n2 >= 32) {
    let a2 = t2 + wi + Ti & z4, o2 = t2 + Ti & z4, s2 = t2 & z4, c2 = t2 - wi & z4, l2 = n2 - 32;
    do
      a2 = Ai(a2, Ni(e8, r2)), r2 += 8, o2 = Ai(o2, Ni(e8, r2)), r2 += 8, s2 = Ai(s2, Ni(e8, r2)), r2 += 8, c2 = Ai(c2, Ni(e8, r2)), r2 += 8;
    while (r2 <= l2);
    i2 = ki(a2, 1n) + ki(o2, 7n) + ki(s2, 12n) + ki(c2, 18n) & z4, i2 = ji(i2, a2), i2 = ji(i2, o2), i2 = ji(i2, s2), i2 = ji(i2, c2);
  } else i2 = t2 + Oi2 & z4;
  for (i2 = i2 + BigInt(n2) & z4; r2 + 8 <= n2; ) i2 = (i2 ^ Ai(0n, Ni(e8, r2))) & z4, i2 = ki(i2, 27n) * wi + Di & z4, r2 += 8;
  for (r2 + 4 <= n2 && (i2 = (i2 ^ Mi2(e8, r2) * wi & z4) & z4, i2 = ki(i2, 23n) * Ti + Ei & z4, r2 += 4); r2 < n2; ) i2 = (i2 ^ BigInt(e8[r2]) * Oi2 & z4) & z4, i2 = ki(i2, 11n) * wi & z4, r2 += 1;
  return i2 = (i2 ^ i2 >> 33n) & z4, i2 = i2 * Ti & z4, i2 = (i2 ^ i2 >> 29n) & z4, i2 = i2 * Ei & z4, i2 = (i2 ^ i2 >> 32n) & z4, i2;
}
function Fi(e8) {
  return Pi(e8).toString(16).padStart(16, `0`);
}
var Li = [`local`, `lazy`, `remote`];
function Ri(e8) {
  return e8 != null && Li.includes(e8) ? e8 : `local`;
}
var zi = class e4 {
  constructor(e8) {
    this.manifest = e8, this.keyIndex_ = null, this.pathIndex_ = null, this.remoteIndex_ = null;
  }
  static fromJson(t2) {
    return new e4(t2);
  }
  static empty() {
    return new e4({ version: `2.0`, groups: {} });
  }
  groupNames() {
    return Object.keys(this.manifest.groups);
  }
  group(e8) {
    return this.manifest.groups[e8] ?? null;
  }
  bundleMode(e8) {
    return Ri(this.manifest.groups[e8]?.bundleMode);
  }
  groupsByMode(e8) {
    return this.groupNames().filter((t2) => this.bundleMode(t2) === e8);
  }
  assetsInGroup(e8) {
    let t2 = this.manifest.groups[e8];
    return t2 ? Object.values(t2.assets) : [];
  }
  assetPathsInGroup(e8) {
    return this.assetsInGroup(e8).map((e9) => e9.path);
  }
  allAssets() {
    let e8 = [];
    for (let t2 of Object.values(this.manifest.groups)) e8.push(...Object.values(t2.assets));
    return e8;
  }
  entries() {
    let e8 = [];
    for (let [t2, n2] of Object.entries(this.manifest.groups)) for (let [r2, i2] of Object.entries(n2.assets)) e8.push({ group: t2, key: r2, asset: i2 });
    return e8;
  }
  textureImportLookup() {
    return Ci(this.entries().map(({ key: e8, asset: t2 }) => ({ uuid: e8, path: t2.path, address: t2.address, settings: t2.textureImport })));
  }
  revision() {
    return this.manifest.revision ?? null;
  }
  assetsByLabel(e8) {
    let t2 = /* @__PURE__ */ new Set(), n2 = [];
    for (let r2 of this.allAssets()) r2.labels.includes(e8) && !t2.has(r2.path) && (t2.add(r2.path), n2.push(r2));
    return n2;
  }
  findAsset(e8) {
    for (let t2 of this.allAssets()) if (t2.path === e8 || t2.address === e8) return t2;
    return null;
  }
  indexes() {
    if (!this.keyIndex_ || !this.pathIndex_) {
      let e8 = /* @__PURE__ */ new Map(), t2 = /* @__PURE__ */ new Map();
      for (let n2 of Object.values(this.manifest.groups)) for (let [r2, i2] of Object.entries(n2.assets)) if (e8.has(r2) || e8.set(r2, i2), t2.has(i2.path) || t2.set(i2.path, i2), i2.address) {
        e8.has(i2.address) || e8.set(i2.address, i2);
        let t3 = `/${i2.address}`;
        e8.has(t3) || e8.set(t3, i2);
      }
      this.keyIndex_ = e8, this.pathIndex_ = t2;
    }
    return { byKey: this.keyIndex_, byPath: this.pathIndex_ };
  }
  assetByKey(e8) {
    return this.indexes().byKey.get(e8) ?? null;
  }
  assetByPath(e8) {
    return this.indexes().byPath.get(e8) ?? null;
  }
  remoteAssetPath(e8) {
    if (!this.remoteIndex_) {
      let e9 = /* @__PURE__ */ new Map();
      for (let t2 of Object.values(this.manifest.groups)) if (Ri(t2.bundleMode) === `remote`) for (let [n2, r2] of Object.entries(t2.assets)) e9.set(n2, r2.path), e9.set(r2.path, r2.path), r2.address && (e9.set(r2.address, r2.path), e9.set(`/${r2.address}`, r2.path));
      this.remoteIndex_ = e9;
    }
    return this.remoteIndex_.get(e8) ?? null;
  }
  resolvePath(e8, t2 = (e9) => e9) {
    let { byKey: n2, byPath: r2 } = this.indexes(), i2 = t2(e8), a2 = n2.get(e8) ?? n2.get(i2) ?? r2.get(i2) ?? r2.get(e8);
    return a2 ? a2.path : i2;
  }
};
function Bi(e8, t2, n2) {
  let r2 = { key: t2, group: e8, path: n2.path, type: n2.type, size: n2.size ?? 0 };
  return n2.contentHash != null && (r2.contentHash = n2.contentHash), r2;
}
function Vi2(e8, t2) {
  let n2 = [], r2 = /* @__PURE__ */ new Set(), i2 = 0;
  for (let { group: a3, key: o3, asset: s3 } of t2.entries()) {
    let t3 = e8?.assetByKey(o3) ?? null;
    (!t3 || (s3.contentHash != null && t3.contentHash != null ? s3.contentHash !== t3.contentHash : s3.path !== t3.path)) && (n2.push(Bi(a3, o3, s3)), r2.add(a3), i2 += s3.size ?? 0);
  }
  let a2 = [];
  if (e8) {
    let n3 = new Set(t2.entries().map((e9) => e9.key));
    for (let { group: t3, key: r3, asset: i3 } of e8.entries()) n3.has(r3) || a2.push(Bi(t3, r3, i3));
  }
  let o2 = e8?.revision() ?? null, s2 = t2.revision() ?? null;
  return { hasUpdate: n2.length > 0 || o2 != null && s2 != null && o2 !== s2, fromRevision: o2, toRevision: s2, changedGroups: [...r2], changedAssets: n2, removedAssets: a2, totalBytes: i2 };
}
var Hi2 = D.Canvas.defaults;
var Ui2 = Hi2.designResolution.x;
var Wi2 = Hi2.designResolution.y;
var Gi2 = Hi2.pixelsPerUnit;
var qi = { ...D.Sprite.editorDefaults.size };
var Qi2 = 1 / 60;
var ea2 = 1 / 60;
var na2 = { sceneTransitionDuration: 0.3, sceneTransitionColor: { r: 0, g: 0, b: 0, a: 1 }, defaultFontFamily: `Arial`, canvasScaleMode: 1, canvasMatchWidthOrHeight: 0.5, maxDeltaTime: 0.25, maxFixedSteps: 8, textCanvasSize: 512, assetLoadTimeout: 3e4, assetFailureCooldown: 5e3, textureCacheBudget: 67108864, audioCacheBudget: 33554432 };
var oa = class {
  constructor(e8) {
    this.dispose_ = e8, this.cache_ = /* @__PURE__ */ new Map(), this.pending_ = /* @__PURE__ */ new Map(), this.failed_ = /* @__PURE__ */ new Map();
  }
  async getOrLoad(e8, t2, r2 = na2.assetLoadTimeout) {
    let i2 = this.cache_.get(e8);
    if (i2 !== void 0) return i2;
    let a2 = this.failed_.get(e8);
    if (a2 && Date.now() < a2.expiry) throw a2.error;
    this.failed_.delete(e8);
    let o2 = this.pending_.get(e8);
    if (o2 && !o2.aborted) return o2.promise;
    let s2 = { promise: null, aborted: false };
    s2.promise = (async () => {
      let n2 = t2();
      if (r2 <= 0) {
        let t3 = await n2;
        return s2.aborted || this.cache_.set(e8, t3), this.clearPendingIfCurrent_(e8, s2), t3;
      }
      let i3 = false, a3;
      n2.then((t3) => {
        i3 && this.disposeAbandoned_(e8, t3);
      }, () => {
      });
      let o3 = await Promise.race([n2, new Promise((t3, n3) => {
        a3 = setTimeout(() => {
          i3 = true, s2.aborted = true, n3(Error(`AsyncCache timeout: ${e8} (${r2}ms)`));
        }, r2);
      })]);
      return clearTimeout(a3), s2.aborted || this.cache_.set(e8, o3), this.clearPendingIfCurrent_(e8, s2), o3;
    })(), this.pending_.set(e8, s2);
    try {
      return await s2.promise;
    } catch (t3) {
      throw this.pending_.get(e8) === s2 && (this.pending_.delete(e8), t3 instanceof Error && this.failed_.set(e8, { error: t3, expiry: Date.now() + na2.assetFailureCooldown })), t3 instanceof Error && t3.message.startsWith(`AsyncCache timeout:`) && T.warn(`asset`, t3.message), t3;
    }
  }
  clearPendingIfCurrent_(e8, t2) {
    this.pending_.get(e8) === t2 && this.pending_.delete(e8);
  }
  disposeAbandoned_(e8, t2) {
    if (this.dispose_) try {
      this.dispose_(t2);
    } catch (t3) {
      T.warn(`asset`, `AsyncCache: releasing abandoned "${e8}" threw`, t3);
    }
  }
  get(e8) {
    return this.cache_.get(e8);
  }
  has(e8) {
    return this.cache_.has(e8);
  }
  delete(e8) {
    return this.cache_.delete(e8);
  }
  invalidate(e8) {
    let t2 = this.cache_.delete(e8), n2 = this.failed_.delete(e8), r2 = this.pending_.get(e8);
    return r2 && (r2.aborted = true, this.pending_.delete(e8)), t2 || n2 || r2 !== void 0;
  }
  clear() {
    this.cache_.clear();
  }
  clearAll() {
    this.cache_.clear(), this.failed_.clear();
    for (let e8 of this.pending_.values()) e8.aborted = true;
    this.pending_.clear();
  }
  set(e8, t2) {
    this.cache_.set(e8, t2);
  }
  entries() {
    return this.cache_.entries();
  }
  values() {
    return this.cache_.values();
  }
  sizes() {
    return { cached: this.cache_.size, pending: this.pending_.size, failed: this.failed_.size };
  }
};
var sa = class {
  constructor() {
    this.byKey_ = /* @__PURE__ */ new Map();
  }
  acquire(e8, t2) {
    let n2 = this.byKey_.get(e8);
    n2 || (n2 = [], this.byKey_.set(e8, n2));
    let r2 = n2.find((e9) => e9.value === t2);
    r2 ? r2.count++ : n2.push({ value: t2, count: 1 });
  }
  release(e8) {
    let t2 = this.byKey_.get(e8);
    if (!t2 || t2.length === 0) return;
    let n2 = t2[0];
    return n2.count--, n2.count > 0 ? { value: n2.value, exhausted: false } : (t2.shift(), t2.length === 0 && this.byKey_.delete(e8), { value: n2.value, exhausted: true });
  }
  releaseValue(e8, t2) {
    let n2 = this.byKey_.get(e8), r2 = n2?.findIndex((e9) => e9.value === t2) ?? -1;
    if (!n2 || r2 < 0) return false;
    let i2 = n2[r2];
    return --i2.count > 0 ? false : (n2.splice(r2, 1), n2.length === 0 && this.byKey_.delete(e8), true);
  }
  drain() {
    let e8 = [];
    for (let [t2, n2] of this.byKey_) for (let r2 of n2) e8.push({ key: t2, value: r2.value });
    return this.byKey_.clear(), e8;
  }
  get size() {
    return this.byKey_.size;
  }
  get rows() {
    let e8 = 0;
    for (let t2 of this.byKey_.values()) for (let n2 of t2) e8 += n2.count;
    return e8;
  }
  generations(e8) {
    return this.byKey_.get(e8) ?? [];
  }
  entries() {
    return this.byKey_;
  }
};
var ca = class {
  constructor(e8) {
    this.type = `spine`, this.extensions = [`.skel`], this.spineController_ = null, this.loaded_ = /* @__PURE__ */ new Set(), this.virtualFSPaths_ = /* @__PURE__ */ new Set(), this.skeletonHandles_ = /* @__PURE__ */ new Map(), this.module_ = e8;
  }
  setSpineController(e8) {
    this.spineController_ = e8;
  }
  getSkeletonHandle(e8) {
    return this.skeletonHandles_.get(e8);
  }
  isLoaded(e8) {
    return this.loaded_.has(e8);
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getDeps(e8), r2 = n2.length > 0 ? n2[0] : null;
    if (!r2) throw Error(`Spine skeleton has no atlas dependency: ${e8}. Pass atlas explicitly or configure Catalog deps.`);
    return this.loadWithAtlas(e8, r2, t2);
  }
  async loadWithAtlas(e8, t2, r2) {
    let a2 = `${e8}:${t2}`;
    if (this.loaded_.has(a2)) return { skeletonHandle: this.skeletonHandles_.get(a2) ?? -1 };
    let o2 = await r2.loadText(r2.catalog.getBuildPath(t2)), s2 = v3(o2), c2 = t2.substring(0, t2.lastIndexOf(`/`)), l2 = le(), u2 = s2.map(async (e9) => {
      let t3 = c2 ? `${c2}/${e9}` : e9;
      try {
        let n2 = await r2.loadTexture(t3, false);
        return l2.registerTextureWithPath(n2.handle, t3), { name: e9, handle: n2.handle, width: n2.width, height: n2.height };
      } catch (e10) {
        return T.warn(`asset`, `Failed to load texture: ${t3}`, e10), null;
      }
    }), d2 = (await Promise.all(u2)).filter((e9) => e9 !== null), f2 = r2.catalog.getBuildPath(e8), p3 = S2(e8)?.contentType === `binary`, m3 = p3 ? new Uint8Array(await r2.loadBinary(f2)) : await r2.loadText(f2);
    this.writeToVirtualFS(t2, o2), this.writeToVirtualFS(e8, m3), this.loaded_.add(a2);
    let h3 = -1;
    if (this.spineController_ && (h3 = this.spineController_.loadSkeleton(m3, o2, p3), h3 >= 0)) {
      let e9 = this.spineController_.getAtlasPageCount(h3);
      for (let t3 = 0; t3 < e9; t3++) {
        let e10 = this.spineController_.getAtlasPageTextureName(h3, t3), n2 = d2.find((t4) => t4.name === e10);
        if (n2) {
          let e11 = l2.getTextureGLId(n2.handle);
          this.spineController_.setAtlasPageTexture(h3, t3, e11, n2.width, n2.height);
        }
      }
      this.skeletonHandles_.set(a2, h3);
    }
    return { skeletonHandle: h3 };
  }
  unload(e8) {
  }
  releaseAll() {
    if (this.spineController_) for (let e8 of this.skeletonHandles_.values()) this.spineController_.unloadSkeleton(e8);
    this.skeletonHandles_.clear(), this.loaded_.clear(), this.cleanupVirtualFS();
  }
  writeToVirtualFS(e8, t2) {
    if (this.virtualFSPaths_.has(e8)) return;
    let r2 = this.module_?.FS;
    if (r2) try {
      la(r2, e8), r2.writeFile(e8, t2), this.virtualFSPaths_.add(e8);
    } catch (t3) {
      T.warn(`asset`, `Failed to write virtual FS: ${e8}`, t3);
    }
  }
  cleanupVirtualFS() {
    let e8 = this.module_?.FS;
    if (e8) {
      for (let t2 of this.virtualFSPaths_) try {
        e8.unlink(t2);
      } catch {
      }
      this.virtualFSPaths_.clear();
    }
  }
};
function la(e8, t2) {
  let n2 = t2.substring(0, t2.lastIndexOf(`/`));
  if (!n2) return;
  let r2 = n2.split(`/`).filter((e9) => e9), i2 = ``;
  for (let t3 of r2) {
    i2 += `/` + t3;
    try {
      e8.mkdir(i2);
    } catch {
    }
  }
}
function ua(e8) {
  let t2 = {};
  for (let n2 of ae3(e8).params) n2.type !== `texture` && (t2[n2.name] = ie3(n2));
  return t2;
}
var da = (e8, t2, n2, r2) => ({ id: e8, label: t2, description: n2, source: r2, defaults: ua(r2) });
var fa = [da(`sprite-unlit`, `Unlit`, `Texture \xD7 vertex color \xD7 tint, no lighting.`, `#pragma shader "Sprite Unlit"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_tint color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color * u_tint;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
}
#pragma end
`), da(`sprite-lit`, `Lit`, `Lit by the scene's 2D lights; optional normal map.`, `#pragma shader "Sprite Lit"
#pragma version 300 es
#pragma domain Lit2D
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Unset u_normalMap = flat normal, so lighting works with no normal map assigned.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
    let N = sampleNormal(u_normalMap, u_normalMap_s, v.v_texCoord);
    return vec4f(applyLighting2D(base.rgb, N, v.v_worldPos), base.a);
}
#pragma end
`), da(`sprite-hit-flash`, `Hit Flash`, `Blend toward a flash color; drive u_flash from code for damage blinks.`, `#pragma shader "Hit Flash"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_flash float default(0) range(0,1) ui(slider)
#pragma param u_flashColor color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Drive u_flash 1 \u2192 0 from code (tween) for the classic damage blink.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    fragColor = vec4(mix(base.rgb, u_flashColor.rgb, u_flash), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
    return vec4f(mix(base.rgb, mc.u_flashColor.rgb, mc.u_flash), base.a);
}
#pragma end
`), da(`sprite-outline`, `Outline`, `Colored silhouette outline around the sprite's opaque pixels.`, `#pragma shader "Outline"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_outlineColor color default(1,1,1,1)
#pragma param u_outlineWidth float default(1) range(0,8)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    highp vec2 texel = u_outlineWidth / vec2(textureSize(u_textures[0], 0));
    float edge = 0.0;
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, -texel.y)).a);
    fragColor = mix(vec4(u_outlineColor.rgb, edge * u_outlineColor.a), base, base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
    let texel = mc.u_outlineWidth / vec2f(textureDimensions(t0, 0));
    var edge = 0.0;
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x, 0.0), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x, 0.0), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(0.0,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(0.0, -texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f( texel.x, -texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x,  texel.y), 0.0).a);
    edge = max(edge, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(-texel.x, -texel.y), 0.0).a);
    return mix(vec4f(mc.u_outlineColor.rgb, edge * mc.u_outlineColor.a), base, base.a);
}
#pragma end
`), da(`sprite-dissolve`, `Dissolve`, `Noise-driven burn-away with a glowing edge (u_progress 0\u21921).`, `#pragma shader "Dissolve"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_progress float default(0) range(0,1) ui(slider)
#pragma param u_edgeColor color default(1,0.5,0,1)
#pragma param u_edgeWidth float default(0.08) range(0,0.5)
#pragma param u_noiseScale float default(12) range(1,64)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2(0.0, 1.0)), hash2d(i + vec2(1.0, 1.0)), f.x), f.y);
}

// u_progress 0 = intact, 1 = fully dissolved; a glowing edge leads the cut.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    float n = noise2d(v_texCoord * u_noiseScale);
    float cut = u_progress * (1.0 + u_edgeWidth);
    if (n < cut - u_edgeWidth) discard;
    vec3 rgb = (n < cut) ? u_edgeColor.rgb : base.rgb;
    fragColor = vec4(rgb, base.a);
}
#pragma end

#pragma fragment wgsl
fn hash2d(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn noise2d(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2f(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2f(0.0, 1.0)), hash2d(i + vec2f(1.0, 1.0)), f.x), f.y);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let base = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color;
    let n = noise2d(v.v_texCoord * mc.u_noiseScale);
    let cut = mc.u_progress * (1.0 + mc.u_edgeWidth);
    if (n < cut - mc.u_edgeWidth) { discard; }
    let rgb = select(base.rgb, mc.u_edgeColor.rgb, n < cut);
    return vec4f(rgb, base.a);
}
#pragma end
`), da(`sprite-pixelate`, `Pixelate`, `Quantizes UVs to a coarse pixel grid.`, `#pragma shader "Pixelate"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_pixels float default(32) range(2,256)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec2 uv = (floor(v_texCoord * u_pixels) + 0.5) / u_pixels;
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = (floor(v.v_texCoord * mc.u_pixels) + 0.5) / mc.u_pixels;
    return textureSampleLevel(t0, s0, uv, 0.0) * v.v_color;
}
#pragma end
`), da(`sprite-uv-scroll`, `UV Scroll`, `Scrolls the texture over time (conveyors, water, clouds).`, `#pragma shader "UV Scroll"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_scrollSpeed vec2 default(0.1,0)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// u_time.x is the engine frame clock (seconds), injected into every shader.
void main() {
    vec2 uv = fract(v_texCoord + u_time.x * u_scrollSpeed);
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = fract(v.v_texCoord + tc.u_time.x * mc.u_scrollSpeed);
    return textureSampleLevel(t0, s0, uv, 0.0) * v.v_color;
}
#pragma end
`)];
function pa(e8) {
  return fa.find((t2) => t2.id === e8);
}
var ma = class {
  constructor() {
    this.type = `material`, this.extensions = [`.esmaterial`], this.shaderCache_ = new oa();
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2), i2 = JSON.parse(r2);
    if (i2.type !== `material`) throw Error(`Invalid material file type: ${i2.type} at ${e8}`);
    if (i2.instanceOf) {
      let n3 = ga(e8, i2.instanceOf), r3 = await this.load(n3, t2), a3 = we.createFromAsset(i2, 0, r3.handle), o3 = await this.applyTextureProps(a3, i2, e8, t2);
      return { handle: a3, shaderHandle: r3.shaderHandle, texturePaths: [...r3.texturePaths ?? [], ...o3], parentHandle: r3.handle };
    }
    let a2 = ha(i2.switches), o2 = await this.loadShader(e8, i2.shader, a2, t2), s2 = we.createFromAsset(i2, o2);
    return { handle: s2, shaderHandle: o2, texturePaths: await this.applyTextureProps(s2, i2, e8, t2) };
  }
  async applyTextureProps(e8, t2, r2, i2) {
    let a2 = [];
    for (let [o2, s2] of Object.entries(t2.properties)) {
      if (typeof s2 != `string`) continue;
      let t3 = ga(r2, s2);
      try {
        let n2 = await i2.loadTexture(t3);
        we.setUniform(e8, o2, we.tex(n2.handle)), a2.push(t3);
      } catch (e9) {
        T.warn(`asset`, `Material ${r2}: failed to load texture '${t3}' for param '${o2}'`, e9);
      }
    }
    return a2;
  }
  unload(e8, t2) {
    if (e8.texturePaths) for (let n2 of e8.texturePaths) t2.releaseTexture(n2);
    e8.parentHandle !== void 0 && we.release(e8.parentHandle), we.release(e8.handle);
  }
  releaseAll() {
    this.shaderCache_.clearAll();
  }
  async loadShader(e8, t2, n2, r2) {
    let i2 = t2.startsWith(`builtin:`), a2 = i2 ? t2 : ga(e8, t2), o2 = n2.length ? `${a2}#${n2.join(`|`)}` : a2, s2 = this.shaderCache_.get(o2);
    return s2 === void 0 ? this.shaderCache_.getOrLoad(o2, async () => {
      let e9;
      if (i2) {
        let n3 = pa(t2.slice(8));
        if (!n3) throw Error(`Unknown built-in shader: ${t2}`);
        e9 = n3.source;
      } else e9 = await r2.loadText(r2.catalog.getBuildPath(a2));
      let o3 = we.compileShader(e9, n2);
      if (!o3) throw Error(`Failed to compile material shader: ${a2}`);
      return o3;
    }) : s2;
  }
};
function ha(e8) {
  return e8 ? Object.entries(e8).filter(([, e9]) => e9).map(([e9]) => e9).sort() : [];
}
function ga(e8, t2) {
  if (t2.startsWith(`/`) || t2.startsWith(`http`) || t2.startsWith(`assets/`)) return t2;
  let n2 = e8.substring(0, e8.lastIndexOf(`/`));
  return n2 ? `${n2}/${t2}` : t2;
}
var _a = 1213027141;
var va = { Position: 0, Color: 1, TexCoord0: 2, Normal: 3, Tangent: 4 };
var ya = { Float32: 0, UNorm8: 1 };
function ba(e8) {
  return e8 === ya.UNorm8 ? 1 : 4;
}
function xa(e8) {
  let t2 = [], n2 = 0;
  for (let r2 of e8) t2.push({ ...r2, offset: n2 }), n2 += r2.components * ba(r2.type), n2 = n2 + 3 & -4;
  return { channels: t2, vertexStride: n2 };
}
function Sa(e8) {
  let t2 = 44 + e8.channels.length * 8 + e8.vertexCount * e8.vertexStride + e8.indices.length * 4, n2 = new Uint8Array(t2), r2 = new DataView(n2.buffer);
  r2.setUint32(0, _a, true), r2.setUint16(4, 1, true), r2.setUint16(6, e8.channels.length, true), r2.setUint32(8, e8.vertexStride, true), r2.setUint32(12, e8.vertexCount, true), r2.setUint32(16, e8.indices.length, true);
  for (let t3 = 0; t3 < 3; t3++) r2.setFloat32(20 + t3 * 4, e8.aabbMin[t3], true), r2.setFloat32(32 + t3 * 4, e8.aabbMax[t3], true);
  let i2 = 44;
  for (let t3 of e8.channels) r2.setUint8(i2, t3.semantic), r2.setUint8(i2 + 1, t3.components), r2.setUint8(i2 + 2, t3.type), r2.setUint8(i2 + 3, +(t3.type === ya.UNorm8)), r2.setUint32(i2 + 4, t3.offset, true), i2 += 8;
  return n2.set(e8.vertices.subarray(0, e8.vertexCount * e8.vertexStride), i2), i2 += e8.vertexCount * e8.vertexStride, n2.set(new Uint8Array(e8.indices.buffer, e8.indices.byteOffset, e8.indices.length * 4), i2), n2;
}
function Ca(e8) {
  let t2 = new DataView(e8.buffer, e8.byteOffset, e8.byteLength);
  if (e8.byteLength < 44 || t2.getUint32(0, true) !== _a) throw Error(`not an .esmesh file`);
  let n2 = t2.getUint16(4, true);
  if (n2 > 1) throw Error(`.esmesh version ${n2} is newer than this engine understands (1)`);
  let r2 = t2.getUint16(6, true), i2 = t2.getUint32(8, true), a2 = t2.getUint32(12, true), o2 = t2.getUint32(16, true), s2 = [t2.getFloat32(20, true), t2.getFloat32(24, true), t2.getFloat32(28, true)], c2 = [t2.getFloat32(32, true), t2.getFloat32(36, true), t2.getFloat32(40, true)], l2 = [], u2 = 44;
  for (let e9 = 0; e9 < r2; e9++) l2.push({ semantic: t2.getUint8(u2), components: t2.getUint8(u2 + 1), type: t2.getUint8(u2 + 2), offset: t2.getUint32(u2 + 4, true) }), u2 += 8;
  let d2 = a2 * i2, f2 = u2 + d2 + o2 * 4;
  if (e8.byteLength < f2) throw Error(`.esmesh is truncated: ${e8.byteLength} bytes, header describes ${f2}`);
  let p3 = e8.subarray(u2, u2 + d2), m3 = new Uint32Array(o2), h3 = u2 + d2;
  for (let e9 = 0; e9 < o2; e9++) m3[e9] = t2.getUint32(h3 + e9 * 4, true);
  return { channels: l2, vertexStride: i2, vertexCount: a2, vertices: p3, indices: m3, aabbMin: s2, aabbMax: c2 };
}
function wa(e8) {
  let t2 = new Uint8Array(e8.length * 8), n2 = new DataView(t2.buffer), r2 = 0;
  for (let t3 of e8) n2.setUint8(r2, t3.semantic), n2.setUint8(r2 + 1, t3.components), n2.setUint8(r2 + 2, t3.type), n2.setUint8(r2 + 3, +(t3.type === ya.UNorm8)), n2.setUint32(r2 + 4, t3.offset, true), r2 += 8;
  return t2;
}
var Ta = class {
  constructor(e8) {
    this.module_ = e8, this.type = `mesh`, this.extensions = [`.esmesh`];
  }
  async load(e8, t2) {
    let n2 = Ca(new Uint8Array(await t2.loadBinary(t2.catalog.getBuildPath(e8)))), r2 = wa(n2.channels), i2 = this.module_();
    if (!i2?.mesh_createFromChannels) throw Error(`this engine build carries no mesh_createFromChannels`);
    let a2 = C(i2, (e9) => {
      let t3 = e9(r2.byteLength), a3 = e9(n2.vertices.byteLength), o2 = e9(n2.indices.byteLength);
      return i2.HEAPU8.set(r2, t3), i2.HEAPU8.set(n2.vertices, a3), i2.HEAPU8.set(new Uint8Array(n2.indices.buffer, n2.indices.byteOffset, n2.indices.byteLength), o2), i2.mesh_createFromChannels(t3, n2.channels.length, n2.vertexStride, a3, n2.vertices.byteLength, o2, n2.indices.length, n2.aabbMin[0], n2.aabbMin[1], n2.aabbMin[2], n2.aabbMax[0], n2.aabbMax[1], n2.aabbMax[2]);
    });
    if (!a2) throw Error(`the engine rejected the geometry in ${e8}`);
    return { handle: a2 };
  }
  unload(e8) {
    this.module_()?.mesh_release?.(e8.handle);
  }
};
var Ea = 1073741824;
var Da = /* @__PURE__ */ new Map();
var Oa = /* @__PURE__ */ new Map();
function ka(e8) {
  return `es-${(e8.split(`/`).pop() ?? e8).replace(/\.[^.]+$/, ``).replace(/[^A-Za-z0-9_-]+/g, `-`).replace(/^-+|-+$/g, ``) || `font`}-${Math.abs([...e8].reduce((e9, t2) => e9 * 31 + t2.charCodeAt(0) | 0, 0)).toString(36)}`;
}
function Aa(e8, t2) {
  let n2 = Oa.get(e8);
  if (n2 !== void 0) return n2;
  let r2 = Ea++;
  return Da.set(r2, t2), Oa.set(e8, r2), r2;
}
function ja(e8) {
  return Da.get(e8) ?? null;
}
function Ma(e8) {
  let t2 = Oa.get(e8);
  t2 !== void 0 && (Oa.delete(e8), Da.delete(t2));
}
function Na(e8, t2) {
  return (e8 ? ja(e8) : null) ?? t2;
}
var Pa = /\.(ttf|otf|woff2?)$/i;
var Fa = class {
  constructor() {
    this.type = `font`, this.extensions = [`.bmfont`, `.fnt`, `.ttf`, `.otf`, `.woff`, `.woff2`];
  }
  async load(e8, t2) {
    if (Pa.test(e8)) return this.loadOutlineFont(e8, t2);
    let n2 = S2(e8);
    return n2?.editorType === `bitmap-font` && n2.contentType === `json` ? this.loadBmfontJson(e8, t2) : this.loadFntFile(e8, t2);
  }
  unload(e8) {
    if (ja(e8.handle) !== null) {
      Ma(e8.path ?? ``);
      return;
    }
    le().releaseBitmapFont(e8.handle);
  }
  async loadOutlineFont(e8, t2) {
    let n2 = ka(e8), r2 = await t2.loadBinary(t2.catalog.getBuildPath(e8));
    return await P5().registerFont?.(n2, r2), { handle: Aa(e8, n2), family: n2, path: e8 };
  }
  async loadBmfontJson(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2), i2 = JSON.parse(r2), a2 = i2.type === `label-atlas` ? i2.generatedFnt : i2.fntFile;
    if (!a2) throw Error(`Invalid bmfont asset: no fnt file specified in ${e8}`);
    let o2 = e8.substring(0, e8.lastIndexOf(`/`)), s2 = o2 ? `${o2}/${a2}` : a2;
    return this.loadFntFile(s2, t2);
  }
  async loadFntFile(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2), a2 = r2.match(/file="([^"]+)"/);
    if (!a2) throw Error(`No page texture found in .fnt file: ${e8}`);
    let o2 = a2[1], s2 = e8.substring(0, e8.lastIndexOf(`/`)), c2 = s2 ? `${s2}/${o2}` : o2, l2 = await t2.loadTexture(c2, false);
    return { handle: le().loadBitmapFont(r2, l2.handle, l2.width, l2.height) };
  }
};
var Ia = class {
  constructor(e8 = () => null) {
    this.getAudio_ = e8, this.type = `audio`, this.extensions = [`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.webm`];
  }
  async load(e8, t2) {
    let r2 = t2.getAudio();
    if (!r2) return T.warn(`asset`, `AudioAssetLoader: no Audio resource for "${e8}" (AudioPlugin not installed?)`), { bufferId: e8 };
    if (r2.retainBuffer(e8)) return { bufferId: e8 };
    let i2 = t2.catalog.getBuildPath(e8), a2 = await t2.loadBinary(i2);
    return await r2.preloadFromData(e8, a2), r2.retainBuffer(e8), { bufferId: e8 };
  }
  unload(e8) {
    this.getAudio_()?.releaseBuffer(e8.bufferId);
  }
  invalidate(e8) {
    return this.getAudio_()?.invalidateBuffer(e8) ?? false;
  }
};
var Ra = { x: 0.5, y: 0.5 };
function za(e8) {
  let t2 = e8.cellWidth + e8.spacing;
  return t2 > 0 ? Math.max(1, Math.floor((e8.pageWidth - e8.margin + e8.spacing) / t2)) : 1;
}
function Ba(e8) {
  let t2 = e8.cellHeight + e8.spacing;
  return t2 > 0 ? Math.max(1, Math.floor((e8.pageHeight - e8.margin + e8.spacing) / t2)) : 1;
}
function Va(e8, t2) {
  let n2 = za(e8), r2 = Ba(e8), i2 = Math.min(Math.max(0, Math.floor(t2)), n2 * r2 - 1), a2 = i2 % n2, o2 = Math.floor(i2 / n2);
  return { x: e8.margin + a2 * (e8.cellWidth + e8.spacing), y: e8.margin + o2 * (e8.cellHeight + e8.spacing), width: e8.cellWidth, height: e8.cellHeight };
}
function Ha(e8, t2) {
  let n2 = Va(e8, t2);
  return { uvOffset: { x: n2.x / e8.pageWidth, y: 1 - (n2.y + n2.height) / e8.pageHeight }, uvScale: { x: n2.width / e8.pageWidth, y: n2.height / e8.pageHeight } };
}
function Ua(e8) {
  return e8.pivot !== void 0 || e8.frames.some((e9) => e9.pivot !== void 0);
}
function Wa(e8, t2) {
  if (t2.pivot) return { x: t2.pivot.x, y: t2.pivot.y };
  if (!Ua(e8)) return null;
  let n2 = e8.pivot ?? Ra;
  return { x: n2.x, y: n2.y };
}
function Ga(e8, t2) {
  return typeof e8 == `number` && Number.isInteger(e8) && e8 > 0 ? e8 : t2;
}
function Ka(e8, t2) {
  return typeof e8 == `number` && Number.isFinite(e8) && e8 >= 0 ? e8 : t2;
}
function qa(e8) {
  let t2 = e8;
  if (!(!t2 || typeof t2.x != `number` || typeof t2.y != `number`) && !(!Number.isFinite(t2.x) || !Number.isFinite(t2.y))) return { x: t2.x, y: t2.y };
}
function Ja(e8) {
  let t2 = e8, n2, r2 = t2?.sheet;
  r2 && typeof r2.texture == `string` && r2.texture && (n2 = { texture: r2.texture, cellWidth: Ga(r2.cellWidth, 32), cellHeight: Ga(r2.cellHeight, 32), margin: Ka(r2.margin, 0), spacing: Ka(r2.spacing, 0), pageWidth: Ga(r2.pageWidth, 1), pageHeight: Ga(r2.pageHeight, 1) });
  let i2 = [];
  for (let e9 of Array.isArray(t2?.frames) ? t2.frames : []) {
    if (!e9) continue;
    let t3 = typeof e9.duration == `number` && e9.duration > 0 ? e9.duration : void 0, r3 = qa(e9.pivot);
    if (n2 && typeof e9.cell == `number` && Number.isInteger(e9.cell) && e9.cell >= 0) i2.push({ cell: e9.cell, ...t3 === void 0 ? {} : { duration: t3 }, ...r3 ? { pivot: r3 } : {} });
    else if (typeof e9.texture == `string` && e9.texture) {
      let n3 = { texture: e9.texture };
      t3 !== void 0 && (n3.duration = t3), r3 && (n3.pivot = r3);
      let a3 = e9.atlasFrame;
      a3 && [a3.x, a3.y, a3.width, a3.height, a3.pageWidth, a3.pageHeight].every((e10) => typeof e10 == `number` && Number.isFinite(e10)) && (n3.atlasFrame = { x: a3.x, y: a3.y, width: a3.width, height: a3.height, pageWidth: a3.pageWidth, pageHeight: a3.pageHeight }), i2.push(n3);
    }
  }
  let a2 = [];
  for (let e9 of Array.isArray(t2?.events) ? t2.events : []) e9 && typeof e9.name == `string` && e9.name && typeof e9.frame == `number` && Number.isInteger(e9.frame) && e9.frame >= 0 && a2.push({ frame: e9.frame, name: e9.name, ...e9.data === void 0 ? {} : { data: e9.data } });
  let o2 = qa(t2?.pivot);
  return { version: typeof t2?.version == `string` ? t2.version : `1.4`, type: `animation-clip`, fps: Ga(t2?.fps, 12), loop: typeof t2?.loop != `boolean` || t2.loop, ...o2 ? { pivot: o2 } : {}, ...n2 ? { sheet: n2 } : {}, frames: i2, ...a2.length ? { events: a2 } : {} };
}
function Za(e8) {
  let t2 = /* @__PURE__ */ new Set();
  e8.sheet?.texture && t2.add(e8.sheet.texture);
  for (let n2 of e8.frames) n2.texture && t2.add(n2.texture);
  return Array.from(t2);
}
function Qa(e8, t2, n2) {
  return { uvOffset: { x: e8.x / t2, y: 1 - (e8.y + e8.height) / n2 }, uvScale: { x: e8.width / t2, y: e8.height / n2 } };
}
function $a(e8, t2, r2) {
  let i2 = t2.sheet, a2 = i2 ? za(i2) * Ba(i2) : 0;
  return { name: e8, fps: t2.fps ?? 12, loop: t2.loop ?? true, ...t2.events?.length ? { events: t2.events.map((e9) => ({ frame: e9.frame, name: e9.name, data: e9.data })) } : {}, frames: t2.frames.map((o2) => {
    let s2 = Wa(t2, o2);
    if (i2 && o2.cell !== void 0) return o2.cell >= a2 && T.warn(`asset`, `${e8}: frame cell ${o2.cell} outside the ${a2}-cell sheet grid; clamped`), { texture: r2.get(i2.texture) ?? 0, duration: o2.duration, ...s2 ? { pivot: s2 } : {}, ...Ha(i2, o2.cell) };
    let c2 = { texture: r2.get(o2.texture ?? ``) ?? 0, duration: o2.duration, ...s2 ? { pivot: s2 } : {} };
    if (o2.atlasFrame) {
      let e9 = o2.atlasFrame;
      Object.assign(c2, Qa(e9, e9.pageWidth, e9.pageHeight));
    }
    return c2;
  }) };
}
var eo = class {
  constructor() {
    this.type = `anim-clip`, this.extensions = [`.esanim`];
  }
  async load(e8, t2) {
    let r2 = t2.catalog.getBuildPath(e8), i2 = await t2.loadText(r2), a2 = Ja(JSON.parse(i2)), o2 = Za(a2), s2 = /* @__PURE__ */ new Map();
    for (let e9 of o2) try {
      let n2 = await t2.loadTexture(e9, true);
      s2.set(e9, n2.handle);
    } catch (t3) {
      T.warn(`asset`, `Failed to load texture: ${e9}`, t3), s2.set(e9, 0);
    }
    let c2 = $a(e8, a2, s2);
    return t2.getSpriteAnimation()?.registerClip(c2), { clipId: e8 };
  }
  unload(e8) {
  }
};
var to = new class extends ae {
  constructor(...e8) {
    super(...e8), this.label = `tilemap`;
  }
}();
var B4 = null;
function no(e8) {
  to.connect(e8), B4 = to.module;
}
function ro() {
  to.disconnect(), B4 = null;
}
var V3 = { initLayer(e8, t2, n2, r2, i2) {
  B4?.tilemap_initLayer(e8, t2, n2, r2, i2);
}, destroyLayer(e8) {
  B4?.tilemap_destroyLayer(e8);
}, setTile(e8, t2, n2, r2) {
  B4?.tilemap_setTile(e8, t2, n2, r2);
}, getTile(e8, t2, n2) {
  return B4 ? B4.tilemap_getTile(e8, t2, n2) : 0;
}, fillRect(e8, t2, n2, r2, i2, a2) {
  B4?.tilemap_fillRect(e8, t2, n2, r2, i2, a2);
}, setTiles(e8, t2) {
  let n2 = B4;
  if (!n2) return;
  let r2 = t2.byteLength;
  he(n2, r2, (r3) => {
    new Uint16Array(n2.HEAPU8.buffer, r3, t2.length).set(t2), n2.tilemap_setTiles(e8, r3, t2.length);
  });
}, setTilesets(e8, t2) {
  let n2 = B4;
  if (!n2) return;
  let r2 = new Uint32Array(t2.length * 5);
  for (let e9 = 0; e9 < t2.length; e9++) r2[e9 * 5] = t2[e9].firstId, r2[e9 * 5 + 1] = t2[e9].textureHandle, r2[e9 * 5 + 2] = t2[e9].columns, r2[e9 * 5 + 3] = t2[e9].margin ?? 0, r2[e9 * 5 + 4] = t2[e9].spacing ?? 0;
  he(n2, r2.byteLength, (i2) => {
    new Uint32Array(n2.HEAPU8.buffer, i2, r2.length).set(r2), n2.tilemap_setTilesets(e8, i2, t2.length);
  });
}, hasLayer(e8) {
  return B4 ? B4.tilemap_hasLayer(e8) : false;
}, setRenderProps(e8, t2, n2, r2, i2, a2, o2, s2, c2) {
  B4?.tilemap_setRenderProps(e8, t2, n2, r2, i2, a2, o2, s2, c2);
}, setTint(e8, t2, n2, r2, i2, a2) {
  B4?.tilemap_setTint(e8, t2, n2, r2, i2, a2);
}, setVisible(e8, t2) {
  B4?.tilemap_setVisible(e8, t2);
}, setOriginEntity(e8, t2) {
  B4?.tilemap_setOriginEntity(e8, t2);
}, setTileAnimation(e8, t2, n2) {
  let r2 = B4;
  if (!r2 || n2.length === 0) return;
  let i2 = new Uint32Array(n2.length * 2);
  for (let e9 = 0; e9 < n2.length; e9++) i2[e9 * 2] = n2[e9].tileId, i2[e9 * 2 + 1] = n2[e9].duration;
  let a2 = i2.byteLength;
  he(r2, a2, (a3) => {
    new Uint32Array(r2.HEAPU8.buffer, a3, i2.length).set(i2), r2.tilemap_setTileAnimation(e8, t2, a3, n2.length);
  });
}, clearTileAnimations(e8) {
  B4?.tilemap_clearTileAnimations(e8);
}, advanceAnimations(e8, t2) {
  B4?.tilemap_advanceAnimations(e8, t2);
}, setTileProperty(e8, t2, n2, r2) {
  B4?.tilemap_setTileProperty(e8, t2, n2, r2);
}, getTileProperty(e8, t2, n2, r2) {
  return B4 ? B4.tilemap_getTileProperty(e8, t2, n2, r2) : ``;
}, flipTile(e8, t2, n2, r2, i2, a2) {
  B4?.tilemap_flipTile(e8, t2, n2, r2, i2, a2);
}, rotateTile(e8, t2, n2, r2) {
  B4?.tilemap_rotateTile(e8, t2, n2, r2);
}, initInfiniteLayer(e8, t2, n2) {
  if (B4?.tilemap_initInfinite) {
    B4.tilemap_initInfinite(e8, t2, n2);
    return;
  }
  B4?.tilemap_initInfiniteLayer(e8, t2, n2);
}, setChunkTiles(e8, t2, n2, r2, i2, a2) {
  let o2 = B4;
  if (!o2) return;
  let s2 = r2.byteLength;
  he(o2, s2, (s3) => {
    new Uint16Array(o2.HEAPU8.buffer, s3, r2.length).set(r2), o2.tilemap_setChunkTiles(e8, t2, n2, s3, i2, a2);
  });
}, setGridType(e8, t2) {
  B4?.tilemap_setGridType(e8, t2);
}, setHexParams(e8, t2, n2, r2) {
  B4?.tilemap_setHexParams(e8, t2, +!!n2, +!!r2);
}, tileToWorld(e8, t2, n2, r2, i2) {
  if (!B4) return { x: 0, y: 0 };
  let a2 = B4.tilemap_tileToWorld(e8, t2, n2, r2, i2), o2 = new Float32Array(B4.HEAPU8.buffer, a2, 2);
  return { x: o2[0], y: o2[1] };
}, worldToTile(e8, t2, n2, r2, i2) {
  if (!B4) return { x: 0, y: 0 };
  let a2 = B4.tilemap_worldToTile(e8, t2, n2, r2, i2), o2 = new Float32Array(B4.HEAPU8.buffer, a2, 2);
  return { x: o2[0], y: o2[1] };
}, exportChunks(e8) {
  return B4?.tilemap_exportChunks?.(e8) ?? ``;
}, importChunks(e8, t2) {
  return B4?.tilemap_importChunks?.(e8, t2) ?? false;
} };
var io = ea(V3, `Tilemaps`);
var ao = k(`Tilemap`, { source: `` }, { assetFields: [{ field: `source`, type: `tilemap` }] });
function oo(e8, t2, n2, r2) {
  let i2 = new Uint8Array(t2 * n2), a2 = [], o2 = (a3, o3) => {
    if (a3 >= t2 || o3 >= n2) return false;
    let s2 = o3 * t2 + a3;
    if (i2[s2]) return false;
    let c2 = e8[s2] & 8191;
    return c2 !== 0 && r2.has(c2);
  };
  for (let e9 = 0; e9 < n2; e9++) for (let r3 = 0; r3 < t2; r3++) {
    if (!o2(r3, e9)) continue;
    let s2 = 1;
    for (; o2(r3 + s2, e9); ) s2++;
    let c2 = 1, l2 = true;
    for (; l2; ) {
      let t3 = e9 + c2;
      if (t3 >= n2) break;
      for (let e10 = 0; e10 < s2; e10++) if (!o2(r3 + e10, t3)) {
        l2 = false;
        break;
      }
      l2 && c2++;
    }
    for (let n3 = 0; n3 < c2; n3++) for (let a3 = 0; a3 < s2; a3++) i2[(e9 + n3) * t2 + (r3 + a3)] = 1;
    a2.push({ col: r3, row: e9, width: s2, height: c2 });
  }
  return a2;
}
var co = (() => {
  let e8 = new Int16Array(128).fill(-1);
  for (let t2 = 0; t2 < 62; t2++) e8[`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`.charCodeAt(t2)] = t2;
  return e8[43] = 62, e8[45] = 62, e8[47] = 63, e8[95] = 63, e8;
})();
function lo(e8) {
  let t2 = [];
  for (let n3 = 0; n3 < e8.length; n3++) {
    let r3 = e8.charCodeAt(n3), i3 = r3 < 128 ? co[r3] : -1;
    i3 >= 0 && t2.push(i3);
  }
  let n2 = new Uint8Array(t2.length * 6 >> 3), r2 = 0, i2 = 0, a2 = 0;
  for (let e9 of t2) i2 = i2 << 6 | e9, r2 += 6, r2 >= 8 && (r2 -= 8, n2[a2++] = i2 >> r2 & 255);
  return n2;
}
function uo(e8) {
  if (!e8) return [];
  let t2;
  try {
    t2 = lo(e8);
  } catch {
    return [];
  }
  if (t2.byteLength < 8) return [];
  let n2 = new DataView(t2.buffer, t2.byteOffset, t2.byteLength), r2 = 0;
  if (n2.getUint32(r2, true) !== 1297371973) return [];
  r2 += 4;
  let i2 = n2.getUint32(r2, true);
  r2 += 4;
  let a2 = [];
  for (let e9 = 0; e9 < i2 && !(r2 + 520 > t2.byteLength); e9++) {
    let e10 = n2.getInt32(r2, true);
    r2 += 4;
    let t3 = n2.getInt32(r2, true);
    r2 += 4;
    let i3 = new Uint16Array(256);
    for (let e11 = 0; e11 < 256; e11++) i3[e11] = n2.getUint16(r2, true), r2 += 2;
    a2.push({ x: e10, y: t3, tiles: i3 });
  }
  return a2;
}
var fo = 8191;
var po = 8192;
var mo = 16384;
var ho = 32768;
function vo(e8) {
  return e8 & fo;
}
function yo(e8) {
  return { flipH: !!(e8 & po), flipV: !!(e8 & mo), flipD: !!(e8 & ho) };
}
var xo = [0, 1, 2, 3];
var So = [1, 0, 3, 2];
var Co = [3, 2, 1, 0];
var wo = [0, 3, 2, 1];
function Eo(e8, t2) {
  return [e8[t2[0]], e8[t2[1]], e8[t2[2]], e8[t2[3]]];
}
function Do(e8) {
  let t2 = xo;
  return e8.flipD && (t2 = Eo(wo, t2)), e8.flipV && (t2 = Eo(Co, t2)), e8.flipH && (t2 = Eo(So, t2)), t2;
}
var Oo = /* @__PURE__ */ new Map();
for (let e8 = 0; e8 < 8; e8++) {
  let t2 = { flipH: !!(e8 & 1), flipV: !!(e8 & 2), flipD: !!(e8 & 4) };
  Oo.set(Do(t2).join(`,`), t2);
}
function Po(e8) {
  return e8.startsWith(`/`) || e8.startsWith(`assets/`);
}
function Fo(e8, t2) {
  return Po(t2) ? t2 : Io(e8, t2);
}
function Io(e8, t2) {
  let n2 = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*|)$/i.exec(e8), r2 = n2 ? n2[1] : ``, i2 = n2 ? n2[2] : e8, a2 = i2.lastIndexOf(`/`), o2 = ((a2 >= 0 ? i2.substring(0, a2 + 1) : ``) + t2).split(`/`), s2 = [];
  for (let e9 of o2) e9 === `..` ? s2.pop() : e9 !== `.` && e9 !== `` && s2.push(e9);
  return r2 ? `${r2}/${s2.join(`/`)}` : s2.join(`/`);
}
var Ro = 2147483648;
var zo = 1073741824;
var Bo = 536870912;
function Vo(e8) {
  if (!e8) return { r: 1, g: 1, b: 1, a: 1 };
  let t2 = e8.startsWith(`#`) ? e8.slice(1) : e8;
  if (t2.length === 8) {
    let e9 = parseInt(t2.slice(0, 2), 16) / 255;
    return { r: parseInt(t2.slice(2, 4), 16) / 255, g: parseInt(t2.slice(4, 6), 16) / 255, b: parseInt(t2.slice(6, 8), 16) / 255, a: e9 };
  }
  return t2.length === 6 ? { r: parseInt(t2.slice(0, 2), 16) / 255, g: parseInt(t2.slice(2, 4), 16) / 255, b: parseInt(t2.slice(4, 6), 16) / 255, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
}
function Ho(e8) {
  if (e8 === 0) return 0;
  let t2 = 0;
  return e8 & Ro && (t2 |= 8192), e8 & zo && (t2 |= 16384), e8 & Bo && (t2 |= 32768), e8 & 8191 | t2;
}
function Uo(e8) {
  return { globalId: e8 & 536870911, flipH: !!(e8 & Ro), flipV: !!(e8 & zo), flipD: !!(e8 & Bo) };
}
function Wo(e8) {
  let t2 = [];
  for (let n2 of e8) if (n2.type === `group`) {
    let e9 = n2.layers;
    e9 && t2.push(...Wo(e9));
  } else t2.push(n2);
  return t2;
}
function Go(e8) {
  let t2 = /* @__PURE__ */ new Map();
  for (let n2 of e8) {
    let e9 = n2.x ?? 0, r2 = n2.y ?? 0, i2 = n2.width ?? 0, a2 = n2.height ?? 0, o2 = n2.data;
    if (o2) for (let n3 = 0; n3 < a2; n3++) for (let a3 = 0; a3 < i2; a3++) {
      let s2 = o2[n3 * i2 + a3];
      if (!s2) continue;
      let c2 = e9 + a3, l2 = r2 + n3, u2 = Math.floor(c2 / 16), d2 = Math.floor(l2 / 16), f2 = `${u2},${d2}`, p3 = t2.get(f2);
      p3 || (p3 = { x: u2, y: d2, width: 16, height: 16, tiles: new Uint16Array(256) }, t2.set(f2, p3)), p3.tiles[(l2 - d2 * 16) * 16 + (c2 - u2 * 16)] = Ho(s2);
    }
  }
  return [...t2.values()];
}
function Ko(e8) {
  let t2 = e8.width, n2 = e8.height, r2 = e8.tilewidth ?? 0, i2 = e8.tileheight ?? 0;
  if (!t2 || !n2 || !r2 || !i2) return null;
  let a2 = e8.tilesets, o2 = [];
  if (a2) for (let e9 of a2) {
    let t3 = e9.tiles, n3 = !e9.image && t3?.some((e10) => typeof e10.image == `string`) ? t3.filter((e10) => typeof e10.image == `string` && e10.image).map((e10) => ({ id: e10.id ?? 0, image: e10.image, width: e10.imagewidth ?? 0, height: e10.imageheight ?? 0 })) : void 0;
    o2.push({ name: e9.name ?? ``, image: e9.image ?? ``, firstGid: e9.firstgid ?? 1, tileWidth: e9.tilewidth ?? r2, tileHeight: e9.tileheight ?? i2, columns: e9.columns ?? 1, tileCount: e9.tilecount ?? 0, margin: e9.margin ?? 0, spacing: e9.spacing ?? 0, ...n3?.length ? { collectionTiles: n3 } : {} });
  }
  let s2 = e8.layers, c2 = s2 ? Wo(s2) : void 0, l2 = [];
  if (c2) for (let e9 of c2) {
    if (e9.type !== `tilelayer`) continue;
    let r3 = e9.width ?? t2, i3 = e9.height ?? n2, a3 = e9.visible !== false, o3 = e9.data, s3 = e9.chunks, c3 = !!s3 && s3.length > 0, u3 = c3 ? Go(s3) : [], d3 = new Uint16Array(c3 ? 0 : r3 * i3);
    if (!c3 && o3) for (let e10 = 0; e10 < o3.length && e10 < d3.length; e10++) d3[e10] = Ho(o3[e10]);
    let f3 = typeof e9.opacity == `number` ? e9.opacity : 1, p4 = e9.tintcolor, m4 = Vo(p4), h3 = typeof e9.parallaxx == `number` ? e9.parallaxx : 1, g3 = typeof e9.parallaxy == `number` ? e9.parallaxy : 1;
    l2.push({ name: e9.name ?? ``, width: r3, height: i3, visible: a3, tiles: d3, chunks: u3, infinite: c3, opacity: f3, tintColor: m4, parallaxX: h3, parallaxY: g3 });
  }
  let u2 = [], d2 = [];
  if (c2) for (let e9 of c2) {
    if (e9.type !== `objectgroup`) continue;
    let t3 = e9.objects;
    if (!t3) continue;
    let n3 = [];
    for (let e10 of t3) {
      let t4 = /* @__PURE__ */ new Map(), r4 = e10.properties;
      if (r4) for (let e11 of r4) t4.set(e11.name, e11.value);
      let i4 = `rect`, a3 = null;
      if (e10.ellipse) i4 = `ellipse`;
      else if (e10.point) i4 = `point`;
      else if (e10.polygon) {
        i4 = `polygon`;
        let t5 = e10.polygon;
        a3 = [];
        for (let e11 of t5) a3.push(e11.x, e11.y);
      } else if (e10.polyline) {
        i4 = `polyline`;
        let t5 = e10.polyline;
        a3 = [];
        for (let e11 of t5) a3.push(e11.x, e11.y);
      }
      n3.push({ id: e10.id ?? 0, name: e10.name ?? ``, type: e10.type ?? e10.class ?? ``, visible: e10.visible !== false, shape: i4, x: e10.x ?? 0, y: e10.y ?? 0, width: e10.width ?? 0, height: e10.height ?? 0, rotation: e10.rotation ?? 0, vertices: a3, properties: t4, gid: typeof e10.gid == `number` ? e10.gid : void 0 });
    }
    let r3 = /* @__PURE__ */ new Map(), i3 = e9.properties;
    if (i3) for (let e10 of i3) r3.set(e10.name, e10.value);
    u2.push({ name: e9.name ?? ``, visible: e9.visible !== false, properties: r3, objects: n3 });
  }
  let f2 = /* @__PURE__ */ new Map(), p3 = /* @__PURE__ */ new Map(), m3 = /* @__PURE__ */ new Map();
  if (a2) for (let e9 of a2) {
    let t3 = e9.firstgid ?? 1, n3 = e9.tilewidth || r2 || 1, a3 = e9.tileheight || i2 || 1, o3 = e9.tiles;
    if (o3) for (let e10 of o3) {
      let r3 = e10.id + t3, i3 = e10.animation;
      if (i3 && i3.length > 0) {
        let e11 = i3.map((e12) => ({ tileId: (e12.tileid ?? 0) + t3, duration: e12.duration ?? 100 }));
        f2.set(r3, e11);
      }
      let o4 = e10.properties, s3 = false;
      if (o4) {
        let e11 = /* @__PURE__ */ new Map();
        for (let t4 of o4) {
          let n4 = t4.name;
          n4 === `collision` && t4.value === true && (s3 = true), e11.set(n4, String(t4.value));
        }
        e11.size > 0 && p3.set(r3, e11);
      }
      let c3 = e10.objectgroup, l3 = qo(c3?.objects, n3, a3) ?? (s3 ? { type: `box` } : null);
      if (l3) {
        let e11 = { shape: l3, ...Jo(o4) };
        l3.type === `box` && !e11.oneWay && !e11.sensor && e11.density === void 0 && e11.friction === void 0 && e11.restitution === void 0 ? d2.push(r3) : m3.set(r3, e11);
      }
    }
  }
  return { width: t2, height: n2, tileWidth: r2, tileHeight: i2, orientation: e8.orientation ?? `orthogonal`, hexSideLength: e8.hexsidelength ?? 0, staggerAxis: e8.staggeraxis ?? `y`, staggerIndex: e8.staggerindex ?? `odd`, layers: l2, tilesets: o2, objectGroups: u2, collisionTileIds: d2, tileShapes: m3, tileAnimations: f2, tileProperties: p3 };
}
function qo(e8, t2, n2) {
  if (!e8) return null;
  for (let r2 of e8) {
    if (r2.point === true || r2.polyline) continue;
    let e9 = r2.x ?? 0, i2 = r2.y ?? 0, a2 = r2.width ?? 0, o2 = r2.height ?? 0;
    if (r2.ellipse === true) {
      if (a2 <= 0 || o2 <= 0) continue;
      return { type: `circle`, cx: (e9 + a2 / 2) / t2, cy: (i2 + o2 / 2) / n2, r: (a2 + o2) / 4 / t2 };
    }
    let s2 = r2.polygon;
    if (s2 && s2.length >= 3) return { type: `polygon`, points: s2.map((r3) => [(e9 + r3.x) / t2, (i2 + r3.y) / n2]) };
    if (a2 > 0 && o2 > 0) {
      let r3 = 0.5;
      return Math.abs(e9) <= r3 && Math.abs(i2) <= r3 && Math.abs(a2 - t2) <= r3 && Math.abs(o2 - n2) <= r3 ? { type: `box` } : { type: `polygon`, points: [[e9 / t2, i2 / n2], [(e9 + a2) / t2, i2 / n2], [(e9 + a2) / t2, (i2 + o2) / n2], [e9 / t2, (i2 + o2) / n2]] };
    }
  }
  return null;
}
function Jo(e8) {
  let t2 = {};
  if (!e8) return t2;
  for (let n2 of e8) {
    let e9 = (n2.name ?? ``).toLowerCase(), r2 = n2.value;
    e9 === `oneway` && r2 === true ? t2.oneWay = { nx: 0, ny: 1 } : e9 === `sensor` && r2 === true ? t2.sensor = true : (e9 === `friction` || e9 === `restitution` || e9 === `density`) && typeof r2 == `number` && (t2[e9] = r2);
  }
  return t2;
}
async function Yo(e8, t2) {
  let n2 = e8.tilesets;
  if (n2?.some((e9) => typeof e9.source == `string`)) {
    let r2 = await Promise.all(n2.map(async (e9) => {
      if (typeof e9.source != `string`) return e9;
      let n3 = JSON.parse(await t2(e9.source));
      return typeof n3.image == `string` && n3.image && (n3 = { ...n3, image: Fo(e9.source, n3.image) }), Array.isArray(n3.tiles) && (n3 = { ...n3, tiles: n3.tiles.map((t3) => typeof t3?.image == `string` && t3.image ? { ...t3, image: Fo(e9.source, t3.image) } : t3) }), { ...n3, firstgid: e9.firstgid };
    }));
    e8 = { ...e8, tilesets: r2 };
  }
  return Ko(e8);
}
function Xo(e8, t2, n2) {
  let r2 = e8.reduce((e9, t3) => Math.max(e9, t3.id), 0) + 1, i2 = Math.max(1, Math.ceil(Math.sqrt(r2))), a2 = Math.max(1, Math.ceil(r2 / i2)), o2 = i2 * t2, s2 = a2 * n2, c2 = new Uint8Array(o2 * s2 * 4), l2 = t2 * 4;
  for (let r3 of e8) {
    let e9 = r3.id % i2 * t2, a3 = Math.floor(r3.id / i2) * n2;
    for (let t3 = 0; t3 < n2; t3++) c2.set(r3.pixels.subarray(t3 * l2, (t3 + 1) * l2), ((a3 + t3) * o2 + e9) * 4);
  }
  return { pixels: c2, columns: i2, rows: a2, width: o2, height: s2 };
}
var Zo = Math.PI / 180;
function Qo(e8) {
  return e8.properties?.get(`collision`) === true || e8.name.toLowerCase() === `collision`;
}
function $o(e8, t2, n2, r2, i2) {
  let a2 = e8.rotation * Zo, o2 = Math.cos(a2), s2 = Math.sin(a2), c2 = { x: t2 + e8.x + r2 * o2 - i2 * s2, y: n2 - (e8.y + r2 * s2 + i2 * o2), z: 0 };
  if (a2 === 0) return { position: c2 };
  let l2 = -a2 * 0.5;
  return { position: c2, rotation: { w: Math.cos(l2), x: 0, y: 0, z: Math.sin(l2) } };
}
function es(e8, t2, r2, i2, a2, o2) {
  if (t2.shape === `rect`) {
    let n2 = o2(t2.width * 0.5, t2.height * 0.5);
    return e8.insert(n2, j3, { halfExtents: { x: t2.width * 0.5 / r2, y: t2.height * 0.5 / r2 }, isSensor: i2 }), n2;
  }
  if (t2.shape === `ellipse`) {
    let n2 = o2(t2.width * 0.5, t2.height * 0.5);
    return e8.insert(n2, M3, { radius: (t2.width + t2.height) * 0.25 / r2, isSensor: i2 }), n2;
  }
  if (!t2.vertices || t2.vertices.length < 4) return null;
  let s2 = [];
  for (let e9 = 0; e9 < t2.vertices.length; e9 += 2) s2.push({ x: t2.vertices[e9] / r2, y: (0 - t2.vertices[e9 + 1]) / r2 });
  if (t2.shape === `polyline`) {
    if (i2) return null;
    let t3 = o2(0, 0);
    return e8.insert(t3, I3, { points: s2, isLoop: false }), t3;
  }
  if (s2.length < 3) return null;
  if (s2.length <= 8) {
    let t3 = o2(0, 0);
    return e8.insert(t3, F3, { vertices: s2, isSensor: i2 }), t3;
  }
  T.warn(`tilemap`, `object polygon in group '${a2}' has ${s2.length} vertices (Box2D max 8); using its bounding box`);
  let c2 = 1 / 0, l2 = 1 / 0, u2 = -1 / 0, d2 = -1 / 0;
  for (let e9 = 0; e9 < t2.vertices.length; e9 += 2) {
    let n2 = t2.vertices[e9], r3 = t2.vertices[e9 + 1];
    n2 < c2 && (c2 = n2), n2 > u2 && (u2 = n2), r3 < l2 && (l2 = r3), r3 > d2 && (d2 = r3);
  }
  let f2 = o2((c2 + u2) * 0.5, (l2 + d2) * 0.5);
  return e8.insert(f2, j3, { halfExtents: { x: (u2 - c2) * 0.5 / r2, y: (d2 - l2) * 0.5 / r2 }, isSensor: i2 }), f2;
}
function ns(e8) {
  let t2 = {};
  for (let [n2, r2] of e8.properties) t2[n2] = String(r2);
  return t2;
}
function rs(e8, t2, n2, r2, i2) {
  return t2.gid !== void 0 || t2.shape === `point` ? null : es(e8, t2, r2, i2, t2.name || `object ${t2.id}`, (r3, i3) => {
    let a2 = e8.spawn(t2.name || `Region_${t2.id}`), { position: o2, rotation: s2 } = $o(t2, 0, 0, r3, i3);
    return e8.insert(a2, I, s2 ? { position: o2, rotation: s2 } : { position: o2 }), e8.insert(a2, Rt, { type: t2.type || ``, properties: ns(t2) }), e8.insert(a2, A2, { bodyType: 0 }), e8.insert(a2, It, {}), e8.setParent(a2, n2), a2;
  });
}
function as(e8, t2, n2, r2, i2, a2, o2, s2, c2, l2 = 1) {
  let u2 = oo(t2, n2, r2, o2), d2 = [];
  for (let t3 of u2) {
    let n3 = t3.width * i2, r3 = t3.height * a2, o3 = s2 + t3.col * i2 + n3 * 0.5, u3 = c2 - t3.row * a2 - r3 * 0.5, f2 = e8.spawn();
    e8.insert(f2, I, { position: { x: o3, y: u3, z: 0 } }), e8.insert(f2, A2, { bodyType: 0 }), e8.insert(f2, j3, { halfExtents: { x: n3 * 0.5 / l2, y: r3 * 0.5 / l2 } }), d2.push(f2);
  }
  return d2;
}
function ss(e8, t2, n2, r2, i2, a2, o2, s2 = 1) {
  let c2 = [];
  for (let l2 of t2) {
    let t3 = oo(l2.tiles, 16, 16, n2), u2 = l2.x * 16, d2 = l2.y * 16;
    for (let n3 of t3) {
      let t4 = u2 + n3.col, l3 = d2 + n3.row, f2 = t4 + n3.width - 1, p3 = l3 + n3.height - 1, m3 = e8.spawn();
      e8.insert(m3, I, { position: { x: a2 + (t4 + f2 + 1) / 2 * r2, y: o2 - (l3 + p3 + 1) / 2 * i2, z: 0 } }), e8.insert(m3, A2, { bodyType: 0 }), e8.insert(m3, j3, { halfExtents: { x: n3.width * r2 * 0.5 / s2, y: n3.height * i2 * 0.5 / s2 } }), c2.push(m3);
    }
  }
  return c2;
}
function cs(e8, t2, n2, r2, i2, a2) {
  return e8.map(([e9, o2]) => {
    let s2 = e9, c2 = 1 - o2;
    if (i2 && (c2 = 1 - c2), r2 && (s2 = 1 - s2), a2) {
      let e10 = s2;
      s2 = c2, c2 = e10;
    }
    return { x: (s2 - 0.5) * t2, y: (c2 - 0.5) * n2 };
  });
}
function ls(e8, t2, n2, r2, i2, a2) {
  let o2 = e8.shape;
  if (o2.type === `polygon`) return { kind: `polygon`, vertices: cs(o2.points, t2, n2, r2, i2, a2) };
  if (o2.type === `circle`) {
    let e9 = cs([[o2.cx, o2.cy]], t2, n2, r2, i2, a2)[0];
    return { kind: `circle`, radius: o2.r * t2, offset: e9 };
  }
  return { kind: `box`, halfExtents: { x: t2 * 0.5, y: n2 * 0.5 }, offset: { x: 0, y: 0 } };
}
function us(e8, t2, n2, r2, i2) {
  let a2 = e8, o2 = t2;
  if (n2 && (a2 = -a2), r2 && (o2 = -o2), i2) {
    let e9 = a2;
    a2 = o2, o2 = e9;
  }
  return { x: a2, y: o2 };
}
function ds(e8, t2, n2, r2, i2, a2, o2, s2, c2, l2) {
  let u2 = yo(n2), d2 = e8.spawn();
  e8.insert(d2, I, { position: { x: s2 + (r2 + 0.5) * a2, y: c2 - (i2 + 0.5) * o2, z: 0 } }), e8.insert(d2, A2, { bodyType: 0 });
  let f2 = {};
  t2.density !== void 0 && (f2.density = t2.density), t2.friction !== void 0 && (f2.friction = t2.friction), t2.restitution !== void 0 && (f2.restitution = t2.restitution), t2.sensor && (f2.isSensor = true);
  let p3 = ls(t2, a2, o2, u2.flipH, u2.flipV, u2.flipD);
  return p3.kind === `polygon` ? e8.insert(d2, F3, { vertices: p3.vertices.map((e9) => ({ x: e9.x / l2, y: e9.y / l2 })), ...f2 }) : p3.kind === `circle` ? e8.insert(d2, M3, { radius: p3.radius / l2, offset: { x: p3.offset.x / l2, y: p3.offset.y / l2 }, ...f2 }) : p3.kind === `box` && e8.insert(d2, j3, { halfExtents: { x: p3.halfExtents.x / l2, y: p3.halfExtents.y / l2 }, ...f2 }), t2.oneWay && e8.insert(d2, R2, { normal: us(t2.oneWay.nx, t2.oneWay.ny, u2.flipH, u2.flipV, u2.flipD) }), d2;
}
function fs(e8, t2, n2, r2, i2, a2, o2, s2 = 1) {
  let c2 = [];
  if (n2.size === 0) return c2;
  let l2 = s2 || 1;
  for (let s3 of t2) {
    let t3 = s3.x * 16, u2 = s3.y * 16;
    for (let d2 = 0; d2 < s3.tiles.length; d2++) {
      let f2 = s3.tiles[d2], p3 = n2.get(vo(f2));
      if (!p3) continue;
      let m3 = t3 + d2 % 16, h3 = u2 + Math.floor(d2 / 16);
      c2.push(ds(e8, p3, f2, m3, h3, r2, i2, a2, o2, l2));
    }
  }
  return c2;
}
function ps(e8, t2, n2, r2, i2, a2, o2, s2, c2, l2 = 1) {
  let u2 = [];
  if (i2.size === 0) return u2;
  let d2 = l2 || 1, f2 = Math.min(t2.length, n2 * r2);
  for (let r3 = 0; r3 < f2; r3++) {
    let l3 = t2[r3], f3 = i2.get(vo(l3));
    f3 && u2.push(ds(e8, f3, l3, r3 % n2, Math.floor(r3 / n2), a2, o2, s2, c2, d2));
  }
  return u2;
}
var hs = /* @__PURE__ */ new Map();
function gs(e8, t2) {
  hs.set(e8, t2);
}
function _s(e8) {
  return hs.get(e8);
}
function vs(e8) {
  return hs.delete(e8);
}
var bs = /* @__PURE__ */ new Map();
function xs(e8, t2) {
  bs.set(e8, t2);
}
function Ss(e8) {
  return bs.get(e8);
}
var Cs = class {
  constructor() {
    this.type = `tilemap`, this.extensions = [`.tmj`, `.tmx`];
  }
  async load(e8, t2) {
    let r2 = t2.catalog.getBuildPath(e8), i2 = await t2.loadText(r2);
    if (i2.trimStart().startsWith(`<`)) throw Error(`[tilemap] "${e8}" is a Tiled XML map \u2014 the engine parses the JSON format only. In Tiled: File \u2192 Export As \u2192 "JSON map files (*.tmj)", then reference the .tmj.`);
    let a2 = await Yo(JSON.parse(i2), (n2) => t2.loadText(t2.catalog.getBuildPath(Fo(e8, n2))));
    if (!a2) throw Error(`Failed to parse tilemap: ${e8}`);
    let o2 = [];
    for (let r3 of a2.tilesets) {
      if (r3.collectionTiles?.length) {
        o2.push(await this.foldCollection_(e8, r3, a2, t2));
        continue;
      }
      let i3 = Fo(e8, r3.image), s2 = 0;
      try {
        s2 = (await t2.loadTexture(i3, true)).handle;
      } catch (t3) {
        T.error(`tilemap`, `"${e8}": tileset "${r3.name}" image failed to load ("${r3.image}" \u2192 "${i3}") \u2014 its tiles will NOT render (collision still generates). Check that the image exists at that path and is imported into the project.`, t3);
      }
      let c2 = r3.columns > 0 ? Math.max(1, Math.ceil(r3.tileCount / r3.columns)) : 1;
      o2.push({ textureHandle: s2, columns: r3.columns, rows: c2, firstId: r3.firstGid, margin: r3.margin ?? 0, spacing: r3.spacing ?? 0 });
    }
    return gs(e8, { tileWidth: a2.tileWidth, tileHeight: a2.tileHeight, orientation: a2.orientation, hexSideLength: a2.hexSideLength, staggerAxis: a2.staggerAxis, staggerIndex: a2.staggerIndex, layers: a2.layers.map((e9) => ({ name: e9.name, width: e9.width, height: e9.height, tiles: e9.tiles, chunks: e9.chunks ?? [], infinite: e9.infinite ?? false })), tilesets: o2, collisionTileIds: a2.collisionTileIds, tileShapes: a2.tileShapes, tileAnimations: a2.tileAnimations, tileProperties: a2.tileProperties, objectGroups: a2.objectGroups }), { sourceId: e8 };
  }
  async foldCollection_(e8, t2, n2, r2) {
    if (!r2.decodePixels || !r2.createTextureFromPixels) throw Error(`[tilemap] "${e8}": tileset "${t2.name}" is an image collection, but this asset provider cannot decode/compose pixels \u2014 load it through the app Assets channel.`);
    let i2 = Xo(await Promise.all(t2.collectionTiles.map(async (t3) => {
      let i3 = await r2.decodePixels(Fo(e8, t3.image));
      if (i3.width !== n2.tileWidth || i3.height !== n2.tileHeight) throw Error(`[tilemap] "${e8}": collection tile "${t3.image}" is ${i3.width}x${i3.height}, but the map grid is ${n2.tileWidth}x${n2.tileHeight} \u2014 collection tiles must match the grid (resize them, or author a grid tileset image instead).`);
      return { id: t3.id, pixels: i3.pixels };
    })), n2.tileWidth, n2.tileHeight);
    return { textureHandle: (await r2.createTextureFromPixels(i2.width, i2.height, i2.pixels, true)).handle, columns: i2.columns, rows: i2.rows, firstId: t2.firstGid, margin: 0, spacing: 0 };
  }
  unload(e8) {
  }
  invalidate(e8) {
    return vs(e8);
  }
};
function Ts(e8, t2) {
  return typeof e8 == `number` && Number.isFinite(e8) && e8 > 0 ? Math.floor(e8) : t2;
}
function Es(e8, t2) {
  return typeof e8 == `number` && Number.isFinite(e8) && e8 >= 0 ? e8 : t2;
}
function Ds(e8) {
  if (e8 === true) return { nx: 0, ny: 1 };
  if (!e8 || typeof e8 != `object`) return;
  let t2 = Number.isFinite(e8.nx) ? e8.nx : Number.isFinite(e8.x) ? e8.x : 0, n2 = Number.isFinite(e8.ny) ? e8.ny : Number.isFinite(e8.y) ? e8.y : 1, r2 = Math.hypot(t2, n2);
  return r2 > 1e-6 ? { nx: t2 / r2, ny: n2 / r2 } : { nx: 0, ny: 1 };
}
function Os(e8) {
  if (e8 === true) return { type: `box` };
  if (!e8 || typeof e8 != `object`) return;
  let t2;
  if (e8.type === `polygon` && Array.isArray(e8.points)) {
    let n3 = e8.points.filter((e9) => Array.isArray(e9) && e9.length >= 2 && typeof e9[0] == `number` && typeof e9[1] == `number`).map((e9) => [e9[0], e9[1]]);
    if (n3.length < 3) return;
    t2 = { type: `polygon`, points: n3 };
  } else t2 = e8.type === `circle` && Number.isFinite(e8.r) && e8.r > 0 ? { type: `circle`, cx: Number.isFinite(e8.cx) ? e8.cx : 0, cy: Number.isFinite(e8.cy) ? e8.cy : 0, r: e8.r } : { type: `box` };
  let n2 = t2, r2 = Ds(e8.oneWay);
  return r2 && (n2.oneWay = r2), e8.sensor === true && (n2.sensor = true), Number.isFinite(e8.density) && (n2.density = e8.density), Number.isFinite(e8.friction) && (n2.friction = e8.friction), Number.isFinite(e8.restitution) && (n2.restitution = e8.restitution), n2;
}
function ks(e8) {
  let t2 = e8, n2 = {}, r2 = t2 && typeof t2.tiles == `object` && t2.tiles || {};
  for (let e9 of Object.keys(r2)) {
    let t3 = Number(e9);
    if (!Number.isInteger(t3) || t3 <= 0) continue;
    let i3 = r2[e9] ?? {}, a2 = {}, o2 = Os(i3.collision);
    if (o2 && (a2.collision = o2), i3.properties && typeof i3.properties == `object`) {
      a2.properties = {};
      for (let e10 of Object.keys(i3.properties)) a2.properties[e10] = String(i3.properties[e10]);
    }
    if (Array.isArray(i3.animation)) {
      let e10 = i3.animation.filter((e11) => e11 && Number.isInteger(e11.tile)).map((e11) => ({ tile: e11.tile, durationMs: Es(e11.durationMs, 100) }));
      e10.length > 0 && (a2.animation = e10);
    }
    if (i3.terrain && typeof i3.terrain == `object` && Number.isInteger(i3.terrain.set) && i3.terrain.set >= 0) {
      let e10 = { set: i3.terrain.set };
      Number.isInteger(i3.terrain.mask) && i3.terrain.mask >= 0 && (e10.mask = i3.terrain.mask), Array.isArray(i3.terrain.corners) && i3.terrain.corners.length === 4 && i3.terrain.corners.every((e11) => Number.isInteger(e11) && e11 >= 0) && (e10.corners = [i3.terrain.corners[0], i3.terrain.corners[1], i3.terrain.corners[2], i3.terrain.corners[3]]), (e10.mask !== void 0 || e10.corners !== void 0) && (a2.terrain = e10);
    }
    typeof i3.probability == `number` && Number.isFinite(i3.probability) && i3.probability >= 0 && i3.probability !== 1 && (a2.probability = i3.probability), (a2.collision || a2.properties || a2.animation || a2.terrain || a2.probability !== void 0) && (n2[t3] = a2);
  }
  let i2 = Array.isArray(t2?.terrains) ? t2.terrains.filter((e9) => e9 && typeof e9.name == `string`).map((e9) => {
    let t3 = e9.mode === `corner` ? `corner` : e9.mode === `wang` ? `wang` : `edge`, n3 = Array.isArray(e9.colors) ? e9.colors.filter((e10) => e10 && typeof e10.color == `string`).map((e10) => ({ name: typeof e10.name == `string` ? e10.name : ``, color: e10.color })) : [];
    return { name: e9.name, mode: t3, ...typeof e9.color == `string` ? { color: e9.color } : {}, ...n3.length > 0 ? { colors: n3 } : {} };
  }) : [];
  return { version: typeof t2?.version == `string` ? t2.version : `1`, texture: typeof t2?.texture == `string` ? t2.texture : ``, tileWidth: Ts(t2?.tileWidth, 16), tileHeight: Ts(t2?.tileHeight, 16), columns: Ts(t2?.columns, 1), margin: Es(t2?.margin, 0), spacing: Es(t2?.spacing, 0), tileCount: Number.isInteger(t2?.tileCount) ? t2?.tileCount : void 0, tiles: n2, ...i2.length > 0 ? { terrains: i2 } : {} };
}
var Ns = class {
  constructor() {
    this.type = `tileset`, this.extensions = [`.estileset`];
  }
  async load(e8, t2) {
    let r2 = t2.catalog.getBuildPath(e8), i2 = await t2.loadText(r2), a2 = ks(JSON.parse(i2)), o2 = 0, s2, c2;
    if (a2.texture) try {
      let e9 = await t2.loadTexture(a2.texture, true);
      o2 = e9.handle, s2 = e9.width, c2 = e9.height;
    } catch (e9) {
      T.warn(`asset`, `Failed to load tileset atlas: ${a2.texture}`, e9);
    }
    return xs(e8, { asset: a2, textureHandle: o2, textureWidth: s2, textureHeight: c2 }), { tilesetId: e8 };
  }
  unload(e8) {
  }
};
var Ps = { Once: 0, Loop: 1, PingPong: 2 };
var Fs = { once: Ps.Once, loop: Ps.Loop, pingPong: Ps.PingPong };
var Is = { [Ps.Once]: `once`, [Ps.Loop]: `loop`, [Ps.PingPong]: `pingPong` };
function Ls(e8) {
  return e8 ? Fs[e8] ?? Ps.Once : Ps.Once;
}
var H2 = { Property: `property`, Spine: `spine`, SpriteAnim: `spriteAnim`, Audio: `audio`, Activation: `activation`, Marker: `marker`, CustomEvent: `customEvent`, AnimFrames: `animFrames` };
var zs = { Hermite: `hermite`, Linear: `linear`, Step: `step`, EaseIn: `easeIn`, EaseOut: `easeOut`, EaseInOut: `easeInOut` };
var Bs = [[`1.0`, `1.1`, (e8) => {
  for (let t2 of e8.tracks ?? []) if (t2.type === H2.Property) for (let e9 of t2.channels ?? []) for (let t3 of e9.keyframes ?? []) t3.interpolation || Math.abs(t3.outTangent) >= 1e5 && (t3.interpolation = `step`, t3.outTangent = 0);
}]];
function Vs(e8) {
  let t2 = e8.version ?? `1.0`;
  for (let [n2, r2, i2] of Bs) t2 === n2 && (i2(e8), t2 = r2);
  e8.version = `1.1`;
}
function Hs(e8) {
  let t2 = { name: e8.name ?? ``, childPath: e8.childPath ?? `` };
  switch (e8.type) {
    case H2.Property:
      return { ...t2, type: H2.Property, component: e8.component ?? ``, channels: (e8.channels ?? []).map((e9) => ({ property: e9.property, keyframes: (e9.keyframes ?? []).map((e10) => ({ ...e10, inTangent: e10.inTangent ?? 0, outTangent: e10.outTangent ?? 0 })) })) };
    case H2.Spine:
      return { ...t2, type: H2.Spine, clips: e8.clips ?? [], blendIn: e8.blendIn ?? 0 };
    case H2.SpriteAnim:
      return { ...t2, type: H2.SpriteAnim, clip: e8.clip ?? ``, startTime: e8.startTime ?? 0 };
    case H2.Audio:
      return { ...t2, type: H2.Audio, events: e8.events ?? [] };
    case H2.Activation:
      return { ...t2, type: H2.Activation, ranges: e8.ranges ?? [] };
    case H2.Marker:
      return { ...t2, type: H2.Marker, markers: e8.markers ?? [] };
    case H2.CustomEvent:
      return { ...t2, type: H2.CustomEvent, events: (e8.events ?? []).map((e9) => ({ time: e9.time ?? 0, name: e9.name ?? ``, payload: e9.payload ?? {} })) };
    case H2.AnimFrames:
      return { ...t2, type: H2.AnimFrames, frames: (e8.animFrames ?? []).map((e9) => ({ texture: e9.texture ?? ``, duration: e9.duration })) };
    default:
      return T.warn(`timeline`, `Unknown track type: ${e8.type}, skipping`), null;
  }
}
function Us(e8) {
  let t2 = e8 ?? {};
  return Vs(t2), { version: `1.1`, type: `timeline`, duration: t2.duration ?? 0, wrapMode: Ls(t2.wrapMode), tracks: (t2.tracks ?? []).map(Hs).filter((e9) => e9 !== null) };
}
function Ws(e8) {
  let t2 = /* @__PURE__ */ new Set(), n2 = /* @__PURE__ */ new Set(), r2 = /* @__PURE__ */ new Set();
  for (let i2 of e8.tracks) if (i2.type === H2.Audio) for (let e9 of i2.events) t2.add(e9.clip);
  else if (i2.type === H2.SpriteAnim) i2.clip && n2.add(i2.clip);
  else if (i2.type === H2.AnimFrames) for (let e9 of i2.frames) e9.texture && r2.add(e9.texture);
  return { audio: Array.from(t2), animClips: Array.from(n2), textures: Array.from(r2) };
}
var Gs = null;
function Ks(e8) {
  Gs = e8;
}
function qs(e8, t2) {
  Gs?.registerAsset(e8, t2);
}
function Js(e8, t2) {
  Gs?.registerTextureHandles(e8, t2);
}
function Ys(e8, t2) {
  return Gs?.getTextureHandle(e8, t2) ?? 0;
}
var Xs = class {
  constructor() {
    this.type = `timeline`, this.extensions = [`.estimeline`];
  }
  async load(e8, t2) {
    let r2 = t2.catalog.getBuildPath(e8), i2 = await t2.loadText(r2), a2 = Us(JSON.parse(i2)), o2 = Ws(a2), s2 = /* @__PURE__ */ new Map();
    for (let e9 of o2.textures) try {
      let n2 = await t2.loadTexture(e9, true);
      s2.set(e9, n2.handle);
    } catch (t3) {
      T.warn(`asset`, `Failed to load texture: ${e9}`, t3), s2.set(e9, 0);
    }
    return qs(e8, a2), s2.size > 0 && Js(e8, s2), { timelineId: e8 };
  }
  unload(e8) {
  }
};
async function rc(e8, t2, n2) {
  let r2 = W(t2).data, i2 = /* @__PURE__ */ new Map();
  if (n2?.assets) {
    let e9 = n2.assets;
    await U2(r2, async (t3) => {
      let n3 = await e9.loadPrefab(t3);
      return W(n3.data).data;
    }, i2);
  }
  let a2 = 0, o2 = { allocateId: () => a2++, loadPrefab: (e9) => i2.get(e9) ?? null, visited: /* @__PURE__ */ new Set() }, { entities: s2, rootId: c2 } = z2(r2, n2?.overrides ?? [], o2), l2 = { version: 1, name: r2.name, entities: s2.map((e9) => ({ id: e9.id, name: e9.name, parent: e9.parent, children: e9.children, components: e9.components, visible: e9.visible })) }, u2 = await yt2(e8, l2, { assets: n2?.assets, assetBaseUrl: n2?.assetBaseUrl }), d2 = u2.get(c2);
  return n2?.parent !== void 0 && e8.setParent(d2, n2.parent), { root: d2, entities: u2 };
}
var ic = class {
  constructor() {
    this.type = `prefab`, this.extensions = [`.esprefab`];
  }
  async load(e8, t2) {
    let r2 = t2.catalog.getBuildPath(e8), i2 = await t2.loadText(r2), a2 = JSON.parse(i2), { data: o2, migrated: s2, fromVersion: c2, toVersion: l2 } = W(a2);
    return s2 && T.info(`prefab`, `migrated "${e8}" ${c2} \u2192 ${l2} (legacy numeric ids \u2192 strings). Re-save to persist.`), { data: o2 };
  }
  unload(e8) {
  }
};
function ac(e8) {
  return typeof e8 == `string` ? e8 : e8?.name ?? ``;
}
function oc(e8) {
  return typeof e8 == `object` && e8 ? e8.arg : void 0;
}
function sc(e8) {
  return typeof e8 == `object` && e8 ? e8.params : void 0;
}
var cc = class {
  constructor() {
    this.data = /* @__PURE__ */ new Map(), this.triggers = /* @__PURE__ */ new Set();
  }
  get(e8) {
    return this.data.get(e8);
  }
  set(e8, t2) {
    this.data.set(e8, t2);
  }
  has(e8) {
    return this.data.has(e8);
  }
  delete(e8) {
    this.data.delete(e8);
  }
  fire(e8) {
    this.triggers.add(e8);
  }
  isFired(e8) {
    return this.triggers.has(e8);
  }
  consume(e8) {
    this.triggers.delete(e8);
  }
  clearTriggers() {
    this.triggers.clear();
  }
};
function lc(e8, t2) {
  let n2 = e8.get(t2.key);
  switch (t2.op) {
    case `==`:
      return n2 === t2.value;
    case `!=`:
      return n2 !== t2.value;
    case `<`:
      return dc(n2) < dc(t2.value);
    case `<=`:
      return dc(n2) <= dc(t2.value);
    case `>`:
      return dc(n2) > dc(t2.value);
    case `>=`:
      return dc(n2) >= dc(t2.value);
    case `truthy`:
      return !!n2;
    case `falsy`:
      return !n2;
    default:
      return fc(t2.op);
  }
}
function uc(e8, t2) {
  if (Array.isArray(t2)) {
    for (let n2 of t2) if (!lc(e8, n2)) return false;
    return true;
  }
  return lc(e8, t2);
}
function dc(e8) {
  return typeof e8 == `number` ? e8 : Number(e8);
}
function fc(e8) {
  throw Error(`unknown compare op: ${e8}`);
}
function pc(e8) {
  let t2 = /* @__PURE__ */ new Map();
  for (let n2 of e8.states) t2.set(n2.name, n2);
  return { initial: e8.initial, states: t2 };
}
function mc(e8) {
  return { current: e8.initial, previous: null, entered: false };
}
function hc(e8, t2, n2, r2, i2) {
  let a2 = e8.states.get(t2.current);
  if (!a2) return false;
  t2.entered ||= (_c(i2, a2.onEnter, n2, r2), true);
  for (let e9 of a2.transitions ?? []) if (gc(e9, n2, r2, i2)) return e9.trigger && r2.consume(e9.trigger), _c(i2, a2.onExit, n2, r2), t2.previous = t2.current, t2.current = e9.to, t2.entered = false, true;
  return _c(i2, a2.onUpdate, n2, r2), false;
}
function gc(e8, t2, n2, r2) {
  if (e8.trigger && !n2.isFired(e8.trigger)) return false;
  if (e8.condition) {
    let i2 = r2.getCondition(e8.condition);
    if (!i2 || !i2(t2, n2)) return false;
  }
  return !(e8.guard && !uc(n2, e8.guard));
}
function _c(e8, t2, n2, r2) {
  let i2 = ac(t2);
  i2 && Fr(e8, i2, n2, r2, { arg: oc(t2), params: sc(t2) });
}
var vc = k(`StateMachineAgent`, { fsm: ``, current: `` }, { assetFields: [{ field: `fsm`, type: `statemachine` }], discoverAssets: (e8) => {
  let t2 = e8.fsm;
  return typeof t2 == `string` && (t2.endsWith(`.esfsm`) || x4(t2)) ? [{ type: `statemachine`, path: t2 }] : [];
}, fields: { current: { advanced: true, tooltip: `Active state (runtime, read-only).` } } });
var yc = /* @__PURE__ */ new Map();
function bc(e8, t2) {
  let n2 = pc(t2);
  return yc.set(e8, n2), n2;
}
function xc(e8) {
  return yc.get(e8);
}
function Sc() {
  return yc.values();
}
var wc = class {
  constructor() {
    this.type = `statemachine`, this.extensions = [`.esfsm`];
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2);
    return bc(e8, JSON.parse(r2)), { fsmId: e8 };
  }
  unload() {
  }
};
var Tc = class {
  constructor() {
    this.type = `animatorcontroller`, this.extensions = [`.esanimator`];
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2), i2 = JSON.parse(r2);
    return P4(e8, i2), { controllerId: e8 };
  }
  unload() {
  }
};
var Ec = k(`BehaviorTreeAgent`, { bt: ``, status: `` }, { assetFields: [{ field: `bt`, type: `behaviortree` }], discoverAssets: (e8) => {
  let t2 = e8.bt;
  return typeof t2 == `string` && (t2.endsWith(`.esbt`) || x4(t2)) ? [{ type: `behaviortree`, path: t2 }] : [];
}, fields: { status: { advanced: true, tooltip: `Last root status (runtime, read-only).` } } });
var Dc = /* @__PURE__ */ new Map();
function Oc(e8, t2) {
  return Dc.set(e8, t2), t2;
}
function kc(e8) {
  return Dc.get(e8);
}
function Ac() {
  return Dc.values();
}
var Mc = class {
  constructor() {
    this.type = `behaviortree`, this.extensions = [`.esbt`];
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2);
    return Oc(e8, JSON.parse(r2)), { btId: e8 };
  }
  unload() {
  }
};
var Nc = (e8) => e8 === 1 ? `one` : `other`;
function Pc(e8, t2) {
  return t2 ? e8.replace(/\{(\w+)\}/g, (e9, n2) => Object.prototype.hasOwnProperty.call(t2, n2) ? String(t2[n2]) : e9) : e8;
}
function Fc(e8, t2, n2) {
  return t2 === 0 && e8.zero !== void 0 ? e8.zero : e8[n2(t2)] ?? e8.other;
}
var Ic = class {
  constructor(e8 = `en`, t2 = `en`) {
    this.catalogs = /* @__PURE__ */ new Map(), this.selectors = /* @__PURE__ */ new Map(), this.locale_ = e8, this.fallback_ = t2;
  }
  addCatalog(e8, t2) {
    let n2 = this.catalogs.get(e8);
    n2 || (n2 = /* @__PURE__ */ new Map(), this.catalogs.set(e8, n2));
    for (let e9 of Object.keys(t2)) n2.set(e9, t2[e9]);
  }
  setLocale(e8) {
    this.locale_ = e8;
  }
  get locale() {
    return this.locale_;
  }
  setFallbackLocale(e8) {
    this.fallback_ = e8;
  }
  get fallbackLocale() {
    return this.fallback_;
  }
  setPluralSelector(e8, t2) {
    this.selectors.set(e8, t2);
  }
  availableLocales() {
    return [...this.catalogs.keys()];
  }
  has(e8) {
    return this.lookup_(e8) !== void 0;
  }
  t(e8, t2) {
    let n2 = this.lookup_(e8);
    return n2 === void 0 ? e8 : Pc(typeof n2 == `string` ? n2 : Fc(n2, typeof t2?.count == `number` ? t2.count : 0, this.selectors.get(this.locale_) ?? Nc), t2);
  }
  lookup_(e8) {
    return this.catalogs.get(this.locale_)?.get(e8) ?? this.catalogs.get(this.fallback_)?.get(e8);
  }
};
var Lc = ea(null, `Localization`);
function zc(e8, t2) {
  let n2;
  try {
    n2 = JSON.parse(e8);
  } catch (e9) {
    throw Error(`${t2}: not valid JSON \u2014 ${e9 instanceof Error ? e9.message : String(e9)}`);
  }
  let r2 = n2;
  if (typeof r2 != `object` || !r2) throw Error(`${t2}: expected an object { version, locale, entries }`);
  if (r2.version !== void 0 && r2.version !== 1) throw Error(`${t2}: unsupported locale-table version ${String(r2.version)} (expected 1)`);
  if (typeof r2.locale != `string` || r2.locale.length === 0) throw Error(`${t2}: 'locale' must be a non-empty string (e.g. "en", "zh-CN")`);
  if (typeof r2.entries != `object` || r2.entries === null || Array.isArray(r2.entries)) throw Error(`${t2}: 'entries' must be an object of key \u2192 string | plural forms`);
  for (let [e9, n3] of Object.entries(r2.entries)) if (typeof n3 != `string`) {
    if (typeof n3 == `object` && n3 && typeof n3.other == `string`) {
      let r3 = null;
      for (let [e10, t3] of Object.entries(n3)) if (typeof t3 != `string`) {
        r3 = e10;
        break;
      }
      if (r3 === null) continue;
      throw Error(`${t2}: entry '${e9}' plural form '${r3}' must be a string`);
    }
    throw Error(`${t2}: entry '${e9}' must be a string or plural forms with an 'other' catch-all`);
  }
  return { version: 1, locale: r2.locale, entries: r2.entries };
}
var Bc = class {
  constructor() {
    this.type = `locale`, this.extensions = [`.eslocale`];
  }
  async load(e8, t2) {
    let n2 = t2.getLocalization();
    if (!n2) throw Error(`${e8}: no Localization resource \u2014 add localizationPlugin to the app before loading locale tables`);
    let r2 = t2.catalog.getBuildPath(e8), i2 = zc(await t2.loadText(r2), e8);
    return n2.addCatalog(i2.locale, i2.entries), { locale: i2.locale, keyCount: Object.keys(i2.entries).length };
  }
  unload() {
  }
};
var Vc = class {
  constructor() {
    this.type = `json`, this.extensions = [`.json`];
  }
  async load(e8, t2) {
    let n2 = t2.catalog.getBuildPath(e8), r2 = await t2.loadText(n2);
    try {
      return { data: JSON.parse(r2) };
    } catch (t3) {
      throw Error(`${e8}: not valid JSON \u2014 ${t3 instanceof Error ? t3.message : String(t3)}`);
    }
  }
  unload() {
  }
};
async function Hc(e8, t2, n2) {
  if (e8.length === 0) return;
  let r2 = 0, i2 = [], a2 = async () => {
    for (; r2 < e8.length; ) {
      let t3 = r2++;
      try {
        await e8[t3]();
      } finally {
        n2();
      }
    }
  }, o2 = Math.min(t2, e8.length);
  for (let e9 = 0; e9 < o2; e9++) i2.push(a2());
  await Promise.all(i2);
}
function Uc() {
  return { textures: /* @__PURE__ */ new Map(), materials: /* @__PURE__ */ new Map(), spine: /* @__PURE__ */ new Map(), fonts: /* @__PURE__ */ new Map() };
}
var Wc = { texture: { load: (e8, t2, n2) => e8.loadTexture(t2).then((e9) => {
  n2.textures.set(t2, e9);
}), release: (e8, t2) => e8.releaseTexture(t2), displayable: true }, material: { load: (e8, t2, n2) => e8.loadMaterial(t2).then((e9) => {
  n2.materials.set(t2, e9);
}), release: (e8, t2) => e8.releaseTyped(`material`, t2), displayable: true }, font: { load: (e8, t2, n2) => e8.loadFont(t2).then((e9) => {
  n2.fonts.set(t2, e9);
}), release: (e8, t2) => e8.releaseTyped(`font`, t2), displayable: true }, "bitmap-font": { load: (e8, t2, n2) => e8.loadFont(t2).then((e9) => {
  n2.fonts.set(t2, e9);
}), release: (e8, t2) => e8.releaseTyped(`font`, t2), displayable: true }, spine: { load: (e8, t2, n2) => e8.loadSpine(t2).then((e9) => {
  n2.spine.set(t2, e9);
}), release: null, displayable: true }, prefab: { load: (e8, t2) => e8.loadPrefab(t2).then(() => {
}), release: (e8, t2) => e8.releaseTyped(`prefab`, t2), displayable: false }, audio: { load: (e8, t2) => e8.loadAudio(t2).then(() => {
}), release: (e8, t2) => e8.releaseTyped(`audio`, t2), displayable: false } };
var Gc = class e5 {
  get baseUrl() {
    return this.baseUrl_;
  }
  set baseUrl(e8) {
    this.baseUrl_ = e8, this.backend.setBaseUrl && this.backend.setBaseUrl(e8 ?? ``);
  }
  constructor(e8) {
    this.manifestModel_ = null, this.pendingUpdate_ = null, this.persistKey_ = null, this.loaders_ = /* @__PURE__ */ new Map(), this.textureImportResolver_ = null, this.textureCache_ = new oa((e9) => {
      le().releaseTexture(e9.handle);
    }), this.textureRefs_ = new sa(), this.resetEpoch_ = 0, this.abandoned_ = /* @__PURE__ */ new Set(), this.genericCache_ = /* @__PURE__ */ new Map(), this.genericRefs_ = new sa(), this.loadContext_ = null, this.assetRefResolver_ = null, this.assetRegistry_ = null, this.refCounter_ = null, this.invalidateListeners_ = /* @__PURE__ */ new Set(), this.handleToPath_ = /* @__PURE__ */ new Map(), this.materialLoader_ = null, this.backend = e8.backend, this.catalog = e8.catalog ?? bi2.empty(), this.module_ = e8.module, this.getAudio_ = e8.getAudio ?? (() => null), this.getSpriteAnimation_ = e8.getSpriteAnimation ?? (() => null), this.getLocalization_ = e8.getLocalization ?? (() => null), this.setManifest(e8.manifest ?? null), this.textureLoader_ = new Sr(e8.module), this.spineLoader_ = new ca(e8.module), this.registerBuiltinLoaders();
  }
  static create(t2) {
    return new e5(t2);
  }
  register(e8) {
    this.loaders_.set(e8.type, e8);
  }
  getLoader(e8) {
    return this.loaders_.get(e8);
  }
  async loadTexture(e8) {
    return this.loadTextureVariant_(e8, true);
  }
  async loadTextureRaw(e8) {
    return this.loadTextureVariant_(e8, false);
  }
  texturesAwaitingReupload() {
    let e8 = le().texturesAwaitingReupload?.() ?? ``;
    return e8 ? e8.split(`
`).map((e9) => {
      let t2 = e9.indexOf(`|`);
      return { handle: Number(t2 < 0 ? e9 : e9.slice(0, t2)), path: t2 < 0 ? `` : e9.slice(t2 + 1) };
    }) : [];
  }
  async reuploadTexturesAfterDeviceLoss() {
    let e8 = le();
    if (!e8.adoptTextureContent) return 0;
    let t2 = 0;
    for (let { handle: r2, path: i2 } of this.texturesAwaitingReupload()) {
      if (!i2) continue;
      let a2 = i2.lastIndexOf(`:`), o2 = a2 < 0 ? i2 : i2.slice(0, a2), s2 = a2 < 0 || i2.slice(a2 + 1) === `f`;
      try {
        let n2 = await this.textureLoader_.loadDetached(this.resolveLoadPath_(o2), this.getLoadContext_(), s2, this.textureImportResolver_?.(o2));
        e8.adoptTextureContent(r2, n2.handle) && t2++, e8.releaseTexture(n2.handle);
      } catch (e9) {
        T.warn(`assets`, `Device recovery: re-upload failed for ${o2}`, e9);
      }
    }
    return T.info(`assets`, `Device recovery: ${t2} texture(s) re-uploaded`), t2;
  }
  async recoverFromDeviceLoss() {
    if (!ci2()) return false;
    await this.reuploadTexturesAfterDeviceLoss();
    let e8 = li2();
    return e8 > 0 ? (T.warn(`assets`, `Device recovery: ${e8} texture(s) are still the placeholder`), false) : true;
  }
  async loadTextureVariant_(e8, t2) {
    let n2 = this.resolveLoadPath_(e8), r2 = this.textureCacheKey_(n2, t2), a2 = this.textureImportResolver_?.(e8), o2 = this.resetEpoch_, s2 = await this.textureCache_.getOrLoad(r2, () => {
      let e9 = this.reviveResidentTexture_(r2);
      return e9 ? Promise.resolve(e9) : (this.textureLoader_.setPendingSettings(a2), t2 ? this.textureLoader_.load(n2, this.getLoadContext_()) : this.textureLoader_.loadRaw(n2, this.getLoadContext_()));
    });
    if (o2 !== this.resetEpoch_) throw this.abandoned_.has(s2.handle) || (this.abandoned_.add(s2.handle), le().releaseTexture(s2.handle), pe(s2.handle)), Error(`Assets were released while "${e8}" was loading; its texture has no owner. Load it again.`);
    if (this.textureRefs_.acquire(r2, s2.handle), this.recordHandlePath_(`texture`, s2.handle, n2), a2?.sliceBorder) {
      let e9 = a2.sliceBorder;
      le().setTextureMetadata(s2.handle, e9.left, e9.right, e9.top, e9.bottom);
    }
    return s2;
  }
  reviveResidentTexture_(e8) {
    let t2 = le();
    if (typeof t2.acquireTextureByPath != `function` || typeof t2.invalidateTexturePath != `function`) return null;
    let n2 = t2.acquireTextureByPath(e8);
    if (!n2) return null;
    let r2 = t2.getTextureDimensions(n2);
    return r2 ? { handle: n2, width: r2.width, height: r2.height } : (t2.releaseTexture(n2), null);
  }
  setTextureImportSettingsResolver(e8) {
    this.textureImportResolver_ = e8;
  }
  getTexture(e8) {
    let t2 = this.resolveLoadPath_(e8);
    return this.textureCache_.get(this.textureCacheKey_(t2, true));
  }
  pathForHandle(e8, t2) {
    return this.handleToPath_.get(`${e8}:${t2}`) ?? null;
  }
  recordHandlePath_(e8, t2, n2) {
    t2 !== 0 && this.handleToPath_.set(`${e8}:${t2}`, n2);
  }
  async loadSpine(e8, t2) {
    let n2 = this.resolveLoadPath_(e8), r2 = this.getLoadContext_();
    if (t2) {
      let e9 = this.resolveLoadPath_(t2);
      return this.spineLoader_.loadWithAtlas(n2, e9, r2);
    }
    return this.spineLoader_.load(n2, r2);
  }
  async loadMaterial(e8) {
    return this.loadTyped(`material`, e8);
  }
  async loadFont(e8) {
    return this.loadTyped(`font`, e8);
  }
  async loadAudio(e8) {
    return this.loadTyped(`audio`, e8);
  }
  async loadAnimClip(e8) {
    let t2 = await this.loadTyped(`anim-clip`, e8), n2 = this.getSpriteAnimation_();
    if (n2 && e8 !== t2.clipId) {
      let r2 = n2.getClip(t2.clipId);
      r2 && !n2.getClip(e8) && n2.aliasClip(e8, r2);
    }
    return t2;
  }
  async loadTilemap(e8) {
    return this.loadTyped(`tilemap`, e8);
  }
  async loadTileset(e8) {
    return this.loadTyped(`tileset`, e8);
  }
  async loadTimeline(e8) {
    return this.loadTyped(`timeline`, e8);
  }
  async loadLocaleTable(e8) {
    return this.loadTyped(`locale`, e8);
  }
  async loadStateMachine(e8) {
    return this.loadTyped(`statemachine`, e8);
  }
  async loadBehaviorTree(e8) {
    return this.loadTyped(`behaviortree`, e8);
  }
  async loadAnimatorController(e8) {
    return this.loadTyped(`animatorcontroller`, e8);
  }
  async loadPrefab(e8) {
    return this.loadTyped(`prefab`, e8);
  }
  async loadJson(e8) {
    return this.loadTyped(`json`, e8);
  }
  async load(e8, t2) {
    return this.loadTyped(e8, t2);
  }
  getAtlasFrame(e8) {
    return this.catalog.getAtlasFrame(e8) ?? this.catalog.getAtlasFrame(this.resolveLoadPath_(e8));
  }
  setManifest(e8) {
    this.manifestModel_ = e8 == null ? null : e8 instanceof zi ? e8 : zi.fromJson(e8);
  }
  getManifest() {
    return this.manifestModel_;
  }
  async loadByLabel(e8, t2) {
    let n2 = Uc(), r2 = 0, i2 = [], a2 = (e9) => e9.then(() => {
      t2?.(++r2, o2);
    }).catch(() => {
      t2?.(++r2, o2);
    });
    for (let t3 of this.catalog.getByLabel(e8)) {
      let e9 = this.catalog.getEntry(t3);
      if (!e9) continue;
      let r3 = this.bundleLoadTask_(t3, e9.type, n2);
      r3 && i2.push(a2(r3));
    }
    let o2 = i2.length;
    return t2?.(0, o2), r2 = 0, await Promise.allSettled(i2), n2;
  }
  async loadGroup(e8, t2) {
    let r2 = Uc(), i2 = this.manifestModel_;
    if (!i2) return T.warn(`asset`, `loadGroup('${e8}') called but no manifest is set`), t2?.(0, 0), r2;
    let a2 = i2.bundleMode(e8);
    a2 === `lazy` && await Nn(e8);
    let o2 = 0, s2 = [], c2 = (e9) => e9.then(() => {
      t2?.(++o2, l2);
    }).catch(() => {
      t2?.(++o2, l2);
    });
    for (let t3 of i2.assetsInGroup(e8)) {
      let e9 = this.manifestAssetUrl_(t3.path, a2 === `remote`), n2 = this.groupLoadTask_(e9, t3.type, r2);
      n2 && s2.push(c2(n2));
    }
    let l2 = s2.length;
    return t2?.(0, l2), o2 = 0, await Promise.allSettled(s2), r2;
  }
  releaseGroup(e8) {
    let t2 = this.manifestModel_;
    if (!t2) {
      T.warn(`asset`, `releaseGroup('${e8}') called but no manifest is set`);
      return;
    }
    let r2 = t2.bundleMode(e8);
    for (let n2 of t2.assetsInGroup(e8)) {
      let e9 = this.manifestAssetUrl_(n2.path, r2 === `remote`);
      Wc[n2.type]?.release?.(this, e9);
    }
  }
  get remoteRoot() {
    return this.remoteRoot_;
  }
  setRemoteRoot(e8) {
    this.remoteRoot_ = e8 ? e8.replace(/\/+$/, ``) : void 0;
  }
  remoteUrlFor_(e8, t2 = this.remoteRoot_) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(e8) || !t2 ? e8 : `${t2.replace(/\/+$/, ``)}/${e8.replace(/^\/+/, ``)}`;
  }
  manifestAssetUrl_(e8, t2, n2 = this.remoteRoot_) {
    return t2 && n2 ? this.remoteUrlFor_(e8, n2) : this.resolveLoadPath_(e8);
  }
  async checkForUpdate(e8) {
    let t2 = await this.backend.fetchText(this.backend.resolveUrl(e8.manifestUrl)), n2 = JSON.parse(t2), r2 = zi.fromJson(n2), i2 = Vi2(this.manifestModel_, r2), a2 = e8.remoteRoot ?? this.remoteRoot_ ?? null;
    return this.pendingUpdate_ = { plan: i2, model: r2, manifestJson: n2, remoteRoot: a2 }, i2;
  }
  async applyUpdate(e8) {
    let t2 = this.pendingUpdate_;
    if (!t2) return T.warn(`asset`, `applyUpdate() called with no pending update \u2014 call checkForUpdate first`), e8?.(0, 0), { ok: false, updated: 0, failed: [] };
    let r2 = t2.plan.changedAssets, i2 = t2.remoteRoot ?? void 0, a2 = [], o2 = 0;
    if (e8?.(0, r2.length), await Hc(r2.map((e9) => async () => {
      let n2 = await this.fetchAndVerify_(e9, t2.model, i2);
      n2 && a2.push({ path: e9.path, reason: n2 });
    }), 6, () => {
      e8?.(++o2, r2.length);
    }), a2.length > 0) return T.warn(`asset`, `applyUpdate: ${a2.length}/${r2.length} asset(s) failed \u2014 update rolled back (manifest unchanged)`), { ok: false, updated: 0, failed: a2 };
    let s2 = /* @__PURE__ */ new Map();
    for (let e9 of r2) {
      let t3 = this.getTexture(e9.key);
      t3 && s2.set(e9.key, t3.handle);
    }
    t2.remoteRoot != null && this.setRemoteRoot(t2.remoteRoot), this.setManifest(t2.model);
    for (let e9 of r2) this.fireInvalidate_(e9.key, s2.get(e9.key) ?? 0);
    return this.persistActiveManifest_(t2.manifestJson), this.pendingUpdate_ = null, { ok: true, updated: r2.length, failed: [] };
  }
  async fetchAndVerify_(e8, t2, n2) {
    let r2 = t2.group(e8.group), i2 = r2 != null && Ri(r2.bundleMode) === `remote`, a2 = this.manifestAssetUrl_(e8.path, i2, n2);
    try {
      let t3 = this.backend.resolveUrl(a2), n3 = await this.backend.fetchBinary(t3);
      return e8.contentHash && Fi(new Uint8Array(n3)) !== e8.contentHash ? `integrity` : (i2 && await Fn(t3, n3), null);
    } catch {
      return `fetch`;
    }
  }
  restorePersistedUpdate(e8) {
    this.persistKey_ = e8;
    let t2 = Vn(e8);
    if (!t2) return false;
    try {
      let e9 = JSON.parse(t2);
      return e9.remoteRoot && this.setRemoteRoot(e9.remoteRoot), this.setManifest(e9.manifest), true;
    } catch (e9) {
      return T.warn(`asset`, `failed to restore persisted manifest`, e9), false;
    }
  }
  persistActiveManifest_(e8) {
    if (this.persistKey_) try {
      Hn(this.persistKey_, JSON.stringify({ manifest: e8, remoteRoot: this.remoteRoot_ ?? null }));
    } catch (e9) {
      T.warn(`asset`, `failed to persist updated manifest`, e9);
    }
  }
  bundleLoadTask_(e8, t2, n2) {
    let r2 = Wc[t2];
    return r2?.displayable ? r2.load(this, e8, n2) : null;
  }
  groupLoadTask_(e8, t2, n2) {
    let r2 = Wc[t2];
    return r2 ? r2.load(this, e8, n2) : null;
  }
  async preload(e8, t2, r2) {
    let i2 = [], a2 = [];
    for (let t3 of e8) {
      let e9 = this.resolveLoadPath_(t3), r3 = this.inferAssetType_(e9);
      if (!r3) {
        T.warn(`asset`, `preload: cannot determine asset type for ${t3}`), i2.push({ ref: t3, reason: `unresolved` });
        continue;
      }
      let o3 = this.typedLoadFor_(e9, r3);
      if (!o3) {
        T.warn(`asset`, `preload: no loader for type '${r3}' (${t3})`), i2.push({ ref: t3, type: r3, reason: `unresolved` });
        continue;
      }
      a2.push(() => o3().then(() => {
      }).catch((e10) => {
        T.warn(`asset`, `preload: failed to load ${t3}`, e10), i2.push({ ref: t3, type: r3, reason: `load-failed`, error: e10 instanceof Error ? e10.message : String(e10) });
      }));
    }
    let o2 = 0, s2 = a2.length;
    return t2?.(0, s2), await Hc(a2, Math.max(1, r2?.maxConcurrent ?? 6), () => {
      t2?.(++o2, s2);
    }), { failed: i2 };
  }
  inferAssetType_(e8) {
    let t2 = this.catalog.getEntry(e8)?.type;
    if (t2) return t2;
    let n2 = this.manifestModel_?.assetByPath(e8)?.type;
    if (n2) return n2;
    let r2 = e8.lastIndexOf(`.`);
    if (r2 < 0) return null;
    let i2 = e8.slice(r2).toLowerCase();
    for (let e9 of this.loaders_.values()) if (e9.extensions.includes(i2)) return e9.type;
    return null;
  }
  typedLoadFor_(e8, t2) {
    switch (t2) {
      case `texture`:
        return () => this.loadTexture(e8);
      case `spine`:
        return () => this.loadSpine(e8);
      case `font`:
      case `bitmap-font`:
        return () => this.loadFont(e8);
      default:
        return this.loaders_.has(t2) ? () => this.loadTyped(t2, e8) : null;
    }
  }
  async fetchJson(e8) {
    let t2 = this.resolveLoadPath_(e8), n2 = this.backend.resolveUrl(this.catalog.getBuildPath(t2)), r2 = await this.backend.fetchText(n2);
    return JSON.parse(r2);
  }
  async fetchBinary(e8) {
    let t2 = this.resolveLoadPath_(e8), n2 = this.backend.resolveUrl(this.catalog.getBuildPath(t2));
    return this.backend.fetchBinary(n2);
  }
  async fetchText(e8) {
    let t2 = this.resolveLoadPath_(e8), n2 = this.backend.resolveUrl(this.catalog.getBuildPath(t2));
    return this.backend.fetchText(n2);
  }
  async preloadSceneAssets(e8, t2, r2) {
    let i2 = [], a2 = Dt2(e8, (e9) => this.resolveRef(e9));
    for (let e9 of a2.unresolved) i2.push({ ref: e9, reason: `unresolved` });
    a2.unresolved.length > 0 && T.warn(`asset`, `${a2.unresolved.length} unresolved asset ref(s)`, a2.unresolved);
    let o2 = a2.byType.get(`texture`) ?? /* @__PURE__ */ new Set(), s2 = a2.byType.get(`material`) ?? /* @__PURE__ */ new Set(), c2 = a2.byType.get(`font`) ?? /* @__PURE__ */ new Set(), l2 = a2.rawByType.get(`anim-clip`) ?? /* @__PURE__ */ new Set(), u2 = a2.byType.get(`audio`) ?? /* @__PURE__ */ new Set(), d2 = a2.byType.get(`tilemap`) ?? /* @__PURE__ */ new Set(), f2 = a2.byType.get(`tileset`) ?? /* @__PURE__ */ new Set(), p3 = a2.byType.get(`timeline`) ?? /* @__PURE__ */ new Set(), m3 = a2.byType.get(`statemachine`) ?? /* @__PURE__ */ new Set(), h3 = a2.byType.get(`behaviortree`) ?? /* @__PURE__ */ new Set(), g3 = a2.byType.get(`animatorcontroller`) ?? /* @__PURE__ */ new Set(), _3 = a2.byType.get(`mesh`) ?? /* @__PURE__ */ new Set(), v4 = a2.spines, y5 = /* @__PURE__ */ new Map(), b5 = /* @__PURE__ */ new Map(), x5 = /* @__PURE__ */ new Map(), S5 = /* @__PURE__ */ new Map(), C5 = [], ee4 = 0, w5 = (e9, t3, n2) => {
      i2.push({ ref: e9, type: t3, reason: `load-failed`, error: n2 instanceof Error ? n2.message : String(n2) });
    }, T5 = [], te5 = (e9, t3, r3, i3) => {
      for (let a3 of e9) T5.push(() => t3(a3).then((e10) => {
        r3.set(a3, e10.handle);
      }).catch((e10) => {
        T.warn(`asset`, `Failed to load ${i3}: ${a3}`, e10), r3.set(a3, 0), w5(a3, i3, e10);
      }));
    }, E5 = (e9, t3, r3) => {
      for (let i3 of e9) T5.push(() => t3(i3).then(() => {
      }).catch((e10) => {
        T.warn(`asset`, `Failed to load ${r3}: ${i3}`, e10), w5(i3, r3, e10);
      }));
    };
    if (te5(o2, (e9) => this.loadTexture(a2.rawFor.get(e9) ?? e9), y5, `texture`), te5(s2, (e9) => this.loadMaterial(e9), b5, `material`), te5(c2, (e9) => this.loadFont(e9), x5, `font`), te5(_3, (e9) => this.loadTyped(`mesh`, e9), S5, `mesh`), !r2?.skipSpine) for (let e9 of v4) T5.push(() => this.loadSpine(e9.skeleton, e9.atlas).then(() => {
    }).catch((t3) => {
      T.warn(`asset`, `Failed to load spine: ${e9.skeleton}`, t3), w5(e9.skeleton, `spine`, t3);
    }));
    E5(l2, (e9) => this.loadAnimClip(e9), `anim-clip`), E5(d2, (e9) => this.loadTilemap(e9), `tilemap`), E5(f2, (e9) => this.loadTileset(e9), `tileset`), E5(p3, (e9) => this.loadTimeline(e9), `timeline`), E5(u2, (e9) => this.loadAudio(e9), `audio`), E5(m3, (e9) => this.loadTyped(`statemachine`, e9), `statemachine`), E5(h3, (e9) => this.loadTyped(`behaviortree`, e9), `behaviortree`), E5(g3, (e9) => this.loadTyped(`animatorcontroller`, e9), `animatorcontroller`);
    let ne5 = T5.length;
    return t2?.(0, ne5), await Hc(T5, Math.max(1, r2?.maxConcurrent ?? 6), () => {
      t2?.(++ee4, ne5);
    }), { textureHandles: y5, materialHandles: b5, fontHandles: x5, meshHandles: S5, releaseCallbacks: C5, missing: i2 };
  }
  resolveSceneAssetPaths(e8, t2) {
    let { textureHandles: n2, materialHandles: r2, fontHandles: i2, meshHandles: a2 } = t2, o2 = this.refCounter_;
    for (let t3 of e8.entities) if (Array.isArray(t3.components)) for (let e9 of t3.components) {
      let s2 = rt2(e9.type);
      for (let { field: c2, type: l2 } of s2) {
        let s3 = e9.data[c2];
        if (typeof s3 != `string` || !s3) continue;
        let u2 = this.resolveRef(s3);
        if (u2 == null) {
          e9.data[c2] = Bt(e9.type)?.[c2] ?? 0;
          continue;
        }
        switch (l2) {
          case `texture`: {
            let r3 = n2.get(u2) ?? 0;
            e9.data[c2] = r3, o2 && r3 && o2.addTextureRef(u2, t3.id);
            let i3 = this.catalog.getAtlasFrame(s3) ?? this.catalog.getAtlasFrame(u2);
            if (i3) {
              let t4 = e9.data.uvOffset, n3 = e9.data.uvScale, r4 = t4?.x ?? 0, a3 = t4?.y ?? 0, o3 = n3?.x ?? 1, s4 = n3?.y ?? 1;
              e9.data.uvOffset = { x: i3.uvOffset[0] + r4 * i3.uvScale[0], y: i3.uvOffset[1] + a3 * i3.uvScale[1] }, e9.data.uvScale = { x: o3 * i3.uvScale[0], y: s4 * i3.uvScale[1] }, i3.trim && (e9.data._trimOffsetX = i3.trim.offsetX, e9.data._trimOffsetY = i3.trim.offsetY, e9.data._trimSourceW = i3.trim.sourceW, e9.data._trimSourceH = i3.trim.sourceH);
            }
            break;
          }
          case `material`: {
            let n3 = r2.get(u2) ?? 0;
            e9.data[c2] = n3, o2 && n3 && o2.addMaterialRef(u2, t3.id);
            break;
          }
          case `font`: {
            let n3 = i2.get(u2) ?? 0;
            e9.data[c2] = n3, o2 && n3 && o2.addFontRef(u2, t3.id);
            break;
          }
          case `mesh`:
            e9.data[c2] = a2.get(u2) ?? 0;
        }
      }
    }
  }
  releaseTexture(e8) {
    let t2 = this.resolveLoadPath_(e8);
    for (let e9 of [true, false]) {
      let n2 = this.textureCacheKey_(t2, e9), r2 = this.textureRefs_.release(n2);
      r2?.exhausted && (le().releaseTexture(r2.value), pe(r2.value), this.textureCache_.get(n2)?.handle === r2.value && this.textureCache_.delete(n2));
    }
  }
  releaseFont(e8) {
    this.releaseTyped(`font`, e8);
  }
  releaseAudio(e8) {
    this.releaseTyped(`audio`, e8);
  }
  releaseAnimClip(e8) {
    this.releaseTyped(`anim-clip`, e8);
  }
  releaseTimeline(e8) {
    this.releaseTyped(`timeline`, e8);
  }
  releaseTilemap(e8) {
    this.releaseTyped(`tilemap`, e8);
  }
  releasePrefab(e8) {
    this.releaseTyped(`prefab`, e8);
  }
  releaseMaterial(e8) {
    let t2 = this.pathForHandle(`material`, e8);
    t2 !== null && this.releaseTyped(`material`, t2);
  }
  releaseAssets(e8) {
    for (let [t2, n2] of e8) if (t2 !== `material` && t2 !== `spine`) for (let e9 of n2) t2 === `texture` ? this.releaseTexture(e9) : this.releaseTyped(t2, e9);
  }
  releaseTyped(e8, t2) {
    let n2 = this.resolveLoadPath_(t2), r2 = `${e8}:${n2}`, i2 = this.genericRefs_.release(r2);
    if (!i2?.exhausted) return;
    this.loaders_.get(e8)?.unload(i2.value, this.getLoadContext_());
    let a2 = this.genericCache_.get(e8);
    a2 && a2.get(n2) === i2.value && a2.delete(n2);
  }
  invalidate(e8) {
    let t2 = this.resolveRef(e8) ?? e8, n2 = this.textureCache_.get(this.textureCacheKey_(t2, true))?.handle ?? 0, r2 = false, i2 = ce();
    for (let e9 of [true, false]) {
      let n3 = this.textureCacheKey_(t2, e9);
      this.textureCache_.invalidate(n3) && (r2 = true), typeof i2?.invalidateTexturePath == `function` && i2.invalidateTexturePath(n3) && (r2 = true);
    }
    for (let [e9, n3] of this.genericCache_.entries()) n3.invalidate(t2) && (r2 = true);
    for (let e9 of this.loaders_.values()) e9.invalidate?.(t2) && (r2 = true);
    for (let [e9, n3] of this.handleToPath_) n3 === t2 && this.handleToPath_.delete(e9);
    return r2 && this.fireInvalidate_(e8, n2), r2;
  }
  fireInvalidate_(e8, t2 = 0) {
    for (let r2 of this.invalidateListeners_) try {
      r2(e8, t2);
    } catch (e9) {
      T.warn(`asset`, `onInvalidate listener threw`, e9);
    }
  }
  onInvalidate(e8) {
    return this.invalidateListeners_.add(e8), () => {
      this.invalidateListeners_.delete(e8);
    };
  }
  sizes() {
    let e8 = this.textureCache_.sizes(), t2 = 0, n2 = e8.pending;
    for (let e9 of this.genericCache_.values()) {
      let r2 = e9.sizes();
      t2 += r2.cached, n2 += r2.pending;
    }
    return { textureCached: e8.cached, pendingLoads: n2, refCounts: this.textureRefs_.size + this.genericRefs_.size, refRows: this.textureRefs_.rows + this.genericRefs_.rows, genericCaches: this.genericCache_.size, genericCached: t2, handlePaths: this.handleToPath_.size, invalidateListeners: this.invalidateListeners_.size, registryEntries: this.assetRegistry_?.size ?? 0, trackedRefRows: this.refCounter_?.getTotalRefRows() ?? 0 };
  }
  releaseAll() {
    let e8 = le();
    this.resetEpoch_++, this.abandoned_.clear();
    let t2 = /* @__PURE__ */ new Set();
    for (let n2 of this.textureCache_.values()) t2.add(n2.handle), e8.releaseTexture(n2.handle), pe(n2.handle);
    this.textureCache_.clearAll();
    for (let { value: n2 } of this.textureRefs_.drain()) t2.has(n2) || (t2.add(n2), e8.releaseTexture(n2), pe(n2));
    this.spineLoader_.releaseAll(), this.materialLoader_?.releaseAll();
    for (let e9 of this.genericCache_.values()) e9.clearAll();
    this.genericCache_.clear();
    for (let { key: e9, value: t3 } of this.genericRefs_.drain()) this.loaders_.get(e9.slice(0, e9.indexOf(`:`)))?.unload(t3, this.getLoadContext_());
    this.handleToPath_.clear();
  }
  setSpineController(e8) {
    this.spineLoader_.setSpineController(e8);
  }
  getSpineLoader() {
    return this.spineLoader_;
  }
  getTextureLoader() {
    return this.textureLoader_;
  }
  setAssetRefResolver(e8) {
    this.assetRefResolver_ = e8;
  }
  getAssetRefResolver() {
    return this.assetRefResolver_;
  }
  setAssetRegistry(e8) {
    this.assetRegistry_ = e8, this.assetRefResolver_ = (t2) => e8.resolveRef(t2);
  }
  getAssetRegistry() {
    return this.assetRegistry_;
  }
  setRefCounter(e8) {
    this.refCounter_ = e8;
  }
  getRefCounter() {
    return this.refCounter_;
  }
  resolveRef(e8) {
    return this.assetRefResolver_ ? this.assetRefResolver_(e8) : e8;
  }
  resolveLoadPath(e8) {
    return this.resolveLoadPath_(e8);
  }
  resolveLoadPath_(e8) {
    let t2 = this.remoteAssetPath_(e8);
    if (t2 != null) return t2;
    let n2 = this.assetRefResolver_?.(e8) ?? e8;
    return this.catalog.resolve(n2);
  }
  remoteAssetPath_(e8) {
    if (!this.remoteRoot_) return null;
    let t2 = this.manifestModel_;
    if (!t2) return null;
    let n2 = e8.startsWith(`@uuid:`) ? e8.slice(y4.length).toLowerCase() : e8, r2 = t2.remoteAssetPath(n2) ?? t2.remoteAssetPath(e8);
    return r2 == null ? null : this.remoteUrlFor_(r2);
  }
  registerBuiltinLoaders() {
    this.register(this.textureLoader_), this.register(this.spineLoader_), this.materialLoader_ = new ma(), this.register(this.materialLoader_), this.register(new Fa()), this.register(new Ta(() => this.module_)), this.register(new Ia(() => this.getAudio_())), this.register(new eo()), this.register(new Cs()), this.register(new Ns()), this.register(new Xs()), this.register(new ic()), this.register(new wc()), this.register(new Tc()), this.register(new Mc()), this.register(new Bc()), this.register(new Vc());
  }
  textureCacheKey_(e8, t2) {
    return xr(e8, t2);
  }
  async loadTyped(e8, t2) {
    let n2 = this.loaders_.get(e8);
    if (!n2) throw Error(`No loader registered for type: ${e8}`);
    let r2 = this.resolveLoadPath_(t2), i2 = this.genericCache_.get(e8);
    i2 || (i2 = new oa(), this.genericCache_.set(e8, i2));
    let a2 = await i2.getOrLoad(r2, () => n2.load(r2, this.getLoadContext_()));
    this.genericRefs_.acquire(`${e8}:${r2}`, a2);
    let o2 = a2?.handle;
    return typeof o2 == `number` && o2 !== 0 && this.recordHandlePath_(e8, o2, r2), a2;
  }
  getLoadContext_() {
    if (this.loadContext_) return this.loadContext_;
    let e8 = this;
    return this.loadContext_ = { backend: this.backend, catalog: this.catalog, resourceManager: le(), async loadTexture(t2, n2) {
      return n2 === false ? e8.loadTextureRaw(t2) : e8.loadTexture(t2);
    }, releaseTexture(t2) {
      e8.releaseTexture(t2);
    }, async loadText(t2) {
      return e8.backend.fetchText(e8.backend.resolveUrl(t2));
    }, async loadBinary(t2) {
      return e8.backend.fetchBinary(e8.backend.resolveUrl(t2));
    }, async decodePixels(t2) {
      let n2 = e8.textureLoader_.pixelDecoder;
      return n2 ? n2(t2, false) : br(e8.backend.resolveUrl(e8.catalog.getBuildPath(t2)));
    }, async createTextureFromPixels(t2, n2, r2, i2) {
      return e8.textureLoader_.loadFromPixels(t2, n2, r2, i2);
    }, getAudio() {
      return e8.getAudio_();
    }, getSpriteAnimation() {
      return e8.getSpriteAnimation_();
    }, getLocalization() {
      return e8.getLocalization_();
    } }, this.loadContext_;
  }
};
var Kc = class {
  constructor(e8) {
    this.baseUrl_ = e8.baseUrl.replace(/\/+$/, ``);
  }
  async fetchBinary(e8) {
    let t2 = this.resolveUrl(e8);
    if (/^https?:\/\//i.test(t2)) {
      let e9 = await Pn(t2);
      if (e9) return e9;
    }
    let n2 = await yn(t2);
    if (!n2.ok) throw Error(`Failed to fetch '${e8}': ${n2.status} ${n2.statusText}`);
    return n2.arrayBuffer();
  }
  async fetchText(e8) {
    let t2 = await yn(this.resolveUrl(e8));
    if (!t2.ok) throw Error(`Failed to fetch '${e8}': ${t2.status} ${t2.statusText}`);
    return t2.text();
  }
  resolveUrl(e8) {
    return e8.startsWith(`/`) || e8.includes(`://`) ? e8 : this.baseUrl_ ? `${this.baseUrl_}/${e8}` : e8;
  }
  setBaseUrl(e8) {
    this.baseUrl_ = e8.replace(/\/+$/, ``);
  }
};
var Yc = { "etc2-rgba8": 0, "astc-4x4": 1, "s3tc-dxt5": 2 };
var Xc = class {
  constructor(e8) {
    this.mod = e8;
  }
  transcode(e8, t2) {
    return this.run_(e8, Yc[t2]);
  }
  transcodeToRgba(e8) {
    return this.run_(e8, 3);
  }
  run_(e8, t2) {
    let n2 = this.mod, r2 = n2._malloc(e8.length);
    if (!r2) return null;
    try {
      if (n2.HEAPU8.set(e8, r2), !n2._es_basis_open(r2, e8.length)) return null;
      try {
        let e9 = n2._es_basis_get_width(), r3 = n2._es_basis_get_height(), i2 = n2._es_basis_transcoded_size(t2);
        if (i2 <= 0) return null;
        let a2 = n2._malloc(i2);
        if (!a2) return null;
        try {
          return n2._es_basis_transcode(t2, a2, i2) ? { width: e9, height: r3, data: n2.HEAPU8.slice(a2, a2 + i2) } : null;
        } finally {
          n2._free(a2);
        }
      } finally {
        n2._es_basis_close();
      }
    } finally {
      n2._free(r2);
    }
  }
};
function Zc(e8) {
  return e8._es_basis_init(), new Xc(e8);
}
var Qc = class {
  constructor() {
    this.refs_ = /* @__PURE__ */ new Map();
  }
  add(e8, t2) {
    let n2 = this.refs_.get(e8);
    n2 || (n2 = /* @__PURE__ */ new Set(), this.refs_.set(e8, n2)), n2.add(t2);
  }
  remove(e8, t2) {
    let n2 = this.refs_.get(e8);
    n2 && (n2.delete(t2), n2.size === 0 && this.refs_.delete(e8));
  }
  getCount(e8) {
    return this.refs_.get(e8)?.size ?? 0;
  }
  getRefs(e8) {
    return Array.from(this.refs_.get(e8) ?? []);
  }
  getAll() {
    let e8 = [];
    for (let [t2, n2] of this.refs_) e8.push({ assetPath: t2, refCount: n2.size, entities: Array.from(n2) });
    return e8;
  }
  removeEntity(e8) {
    for (let [t2, n2] of this.refs_) n2.delete(e8), n2.size === 0 && this.refs_.delete(t2);
  }
  get size() {
    return this.refs_.size;
  }
  get rows() {
    let e8 = 0;
    for (let t2 of this.refs_.values()) e8 += t2.size;
    return e8;
  }
  clear() {
    this.refs_.clear();
  }
};
var $c = class {
  constructor() {
    this.textures_ = new Qc(), this.fonts_ = new Qc(), this.materials_ = new Qc();
  }
  addTextureRef(e8, t2) {
    this.textures_.add(e8, t2);
  }
  removeTextureRef(e8, t2) {
    this.textures_.remove(e8, t2);
  }
  getTextureRefCount(e8) {
    return this.textures_.getCount(e8);
  }
  getTextureRefs(e8) {
    return this.textures_.getRefs(e8);
  }
  getAllTextureRefs() {
    return this.textures_.getAll();
  }
  addFontRef(e8, t2) {
    this.fonts_.add(e8, t2);
  }
  removeFontRef(e8, t2) {
    this.fonts_.remove(e8, t2);
  }
  getFontRefCount(e8) {
    return this.fonts_.getCount(e8);
  }
  getFontRefs(e8) {
    return this.fonts_.getRefs(e8);
  }
  getAllFontRefs() {
    return this.fonts_.getAll();
  }
  addMaterialRef(e8, t2) {
    this.materials_.add(e8, t2);
  }
  removeMaterialRef(e8, t2) {
    this.materials_.remove(e8, t2);
  }
  getMaterialRefCount(e8) {
    return this.materials_.getCount(e8);
  }
  getMaterialRefs(e8) {
    return this.materials_.getRefs(e8);
  }
  getAllMaterialRefs() {
    return this.materials_.getAll();
  }
  removeAllRefsForEntity(e8) {
    this.textures_.removeEntity(e8), this.fonts_.removeEntity(e8), this.materials_.removeEntity(e8);
  }
  clear() {
    this.textures_.clear(), this.fonts_.clear(), this.materials_.clear();
  }
  getTotalRefCount() {
    return { textures: this.textures_.size, fonts: this.fonts_.size, materials: this.materials_.size };
  }
  getTotalRefRows() {
    return this.textures_.rows + this.fonts_.rows + this.materials_.rows;
  }
};
var el = class {
  constructor(e8, t2 = null) {
    this.bufferCache_ = /* @__PURE__ */ new Map(), this.loadingBuffers_ = /* @__PURE__ */ new Map(), this.evictOrder_ = /* @__PURE__ */ new Set(), this.residentBytes_ = 0, this.bufferBudgetOverride_ = null, this.bgmHandle_ = null, this.bgmVolume_ = 1, this.fades_ = [], this.softBuses_ = /* @__PURE__ */ new Map(), this.softVoices_ = [], this.fadingOut_ = /* @__PURE__ */ new Set(), this.disposed_ = false, this.assetResolver_ = null, this.refResolver_ = null, this.baseUrl = ``, this.backend_ = e8, this.mixer_ = t2;
  }
  get bufferBudget() {
    return this.bufferBudgetOverride_ ?? na2.audioCacheBudget;
  }
  setBufferBudget(e8) {
    this.bufferBudgetOverride_ = e8 === null ? null : Math.max(0, Math.floor(e8)), this.enforceBudget_();
  }
  retainBuffer(e8) {
    let t2 = this.bufferCache_.get(e8);
    return t2 ? (t2.refCount++, this.evictOrder_.delete(e8), true) : false;
  }
  releaseBuffer(e8) {
    let t2 = this.bufferCache_.get(e8);
    !t2 || t2.refCount === 0 || --t2.refCount === 0 && (this.bufferBudget === 0 ? this.freeBuffer_(e8, t2) : (this.evictOrder_.add(e8), this.enforceBudget_()));
  }
  invalidateBuffer(e8) {
    let t2 = this.bufferCache_.get(e8);
    return t2 ? (this.freeBuffer_(e8, t2), true) : false;
  }
  trimBufferCache() {
    let e8 = 0;
    for (let t2 of [...this.evictOrder_]) {
      let n2 = this.bufferCache_.get(t2);
      n2 && (this.freeBuffer_(t2, n2), e8++);
    }
    return e8;
  }
  getBufferStats() {
    return { bufferCount: this.bufferCache_.size, bufferBytes: this.residentBytes_, bufferBudget: this.bufferBudget, evictableCount: this.evictOrder_.size };
  }
  insertEntry_(e8, t2) {
    let n2 = { handle: t2, bytes: t2.bytes ?? 0, refCount: 0 };
    this.bufferCache_.set(e8, n2), this.residentBytes_ += n2.bytes, this.enforceBudget_(), this.evictOrder_.add(e8);
  }
  lookupBuffer_(e8) {
    let t2 = this.bufferCache_.get(e8);
    if (t2) return t2.refCount === 0 && this.evictOrder_.delete(e8) && this.evictOrder_.add(e8), t2.handle;
  }
  freeBuffer_(e8, t2) {
    this.backend_.unloadBuffer(t2.handle), this.bufferCache_.delete(e8), this.evictOrder_.delete(e8), this.residentBytes_ -= t2.bytes;
  }
  enforceBudget_() {
    let e8 = this.bufferBudget;
    if (e8 !== 0) for (let t2 of this.evictOrder_) {
      if (this.residentBytes_ <= e8) break;
      let n2 = this.bufferCache_.get(t2);
      n2 && this.freeBuffer_(t2, n2);
    }
  }
  setAssetResolver(e8) {
    this.assetResolver_ = e8;
  }
  setRefResolver(e8) {
    this.refResolver_ = e8;
  }
  resolveUrl_(e8) {
    return this.refResolver_ ? this.refResolver_(e8) : !this.baseUrl || e8.startsWith(`/`) || e8.startsWith(`http://`) || e8.startsWith(`https://`) ? e8 : `${this.baseUrl}/${e8}`;
  }
  async ensureBuffer_(e8, t2) {
    if (this.bufferCache_.has(e8)) return;
    let n2 = this.loadingBuffers_.get(e8);
    if (n2) return n2;
    let r2 = (async () => {
      let n3 = await t2();
      this.bufferCache_.has(e8) || this.insertEntry_(e8, n3);
    })();
    this.loadingBuffers_.set(e8, r2);
    try {
      await r2;
    } finally {
      this.loadingBuffers_.delete(e8);
    }
  }
  async preload(e8) {
    if (!this.bufferCache_.has(e8)) {
      if (this.assetResolver_) {
        let t2 = this.assetResolver_(e8);
        if (t2) return this.preloadFromData(e8, t2);
      }
      await this.ensureBuffer_(e8, () => this.backend_.loadBuffer(this.resolveUrl_(e8)));
    }
  }
  async preloadAll(e8) {
    await Promise.all(e8.map((e9) => this.preload(e9)));
  }
  async preloadFromData(e8, t2) {
    await this.ensureBuffer_(e8, () => this.backend_.loadBufferFromData(e8, t2));
  }
  async playTrack(e8, t2 = {}) {
    if (this.disposed_) return null;
    try {
      await this.ensureBuffer_(e8, () => this.backend_.loadBuffer(e8));
    } catch {
      return null;
    }
    if (this.disposed_) return null;
    let n2 = this.lookupBuffer_(e8);
    return n2 ? (t2.bus && this.ensureBus(t2.bus), this.playVoice_(n2, t2)) : null;
  }
  playSFX(e8, t2) {
    let r2 = { bus: `sfx`, volume: t2?.volume, playbackRate: t2?.pitch, pan: t2?.pan, priority: t2?.priority ?? 0 }, i2 = this.lookupBuffer_(e8);
    if (!i2) {
      let t3 = this.createDeferredHandle_();
      return this.preload(e8).then(() => {
        if (this.disposed_) return;
        let n2 = this.lookupBuffer_(e8);
        n2 && t3.resolve(this.playVoice_(n2, r2));
      }).catch((t4) => {
        T.warn(`audio`, `Failed to preload audio: ${e8}`, t4);
      }), t3;
    }
    return this.playVoice_(i2, r2);
  }
  playBGM(e8, t2) {
    let r2 = (e9) => {
      this.cancelFades_();
      let n2 = t2?.volume ?? 1, r3 = this.bgmVolume_;
      this.bgmVolume_ = n2, this.bgmHandle_ && t2?.crossFade ? this.fadeOut_(this.bgmHandle_, t2.crossFade, r3) : this.bgmHandle_ && this.bgmHandle_.stop();
      let i3 = t2?.fadeIn ?? t2?.crossFade;
      this.bgmHandle_ = this.playVoice_(e9, { bus: `music`, volume: n2, loop: true }), i3 && this.fadeIn_(this.bgmHandle_, i3, n2);
    }, i2 = this.lookupBuffer_(e8);
    i2 ? r2(i2) : this.preload(e8).then(() => {
      if (this.disposed_) return;
      let t3 = this.lookupBuffer_(e8);
      t3 && r2(t3);
    }).catch((t3) => {
      T.warn(`audio`, `Failed to preload BGM: ${e8}`, t3);
    });
  }
  stopAll() {
    this.cancelFades_(), this.bgmHandle_ &&= (this.bgmHandle_.stop(), null);
  }
  stopBGM(e8) {
    if (this.bgmHandle_) if (this.cancelFades_(), e8 && e8 > 0) {
      let t2 = this.bgmHandle_;
      this.bgmHandle_ = null, this.fadeOut_(t2, e8, this.bgmVolume_);
    } else this.bgmHandle_.stop(), this.bgmHandle_ = null;
  }
  suspend() {
    this.backend_.suspend();
  }
  resume() {
    this.backend_.resume();
  }
  setMasterVolume(e8) {
    if (this.mixer_) {
      this.mixer_.master.volume = e8;
      return;
    }
    this.setSoftBus_(`master`, { volume: e8 });
  }
  setMusicVolume(e8) {
    if (this.mixer_) {
      this.mixer_.music.volume = e8;
      return;
    }
    this.setSoftBus_(`music`, { volume: e8 });
  }
  setSFXVolume(e8) {
    if (this.mixer_) {
      this.mixer_.sfx.volume = e8;
      return;
    }
    this.setSoftBus_(`sfx`, { volume: e8 });
  }
  setUIVolume(e8) {
    if (this.mixer_) {
      this.mixer_.ui.volume = e8;
      return;
    }
    this.setSoftBus_(`ui`, { volume: e8 });
  }
  getMasterVolume() {
    return this.mixer_?.master.volume ?? 1;
  }
  getMusicVolume() {
    return this.mixer_?.music.volume ?? 1;
  }
  getSFXVolume() {
    return this.mixer_?.sfx.volume ?? 1;
  }
  getUIVolume() {
    return this.mixer_?.ui.volume ?? 1;
  }
  getBusVolume(e8) {
    return this.mixer_ ? this.mixer_.getBus(e8)?.volume ?? 1 : this.softBuses_.get(e8)?.volume ?? 1;
  }
  isBusMuted(e8) {
    return this.mixer_ ? this.mixer_.getBus(e8)?.muted ?? false : this.softBuses_.get(e8)?.muted ?? false;
  }
  setSoftBus_(e8, t2) {
    let n2 = this.softBuses_.get(e8) ?? { volume: 1, muted: false };
    t2.volume !== void 0 && (n2.volume = t2.volume), t2.muted !== void 0 && (n2.muted = t2.muted), this.softBuses_.set(e8, n2), this.applyBus_(e8);
  }
  softGain_(e8) {
    if (this.mixer_) return 1;
    let t2 = (e9) => {
      let t3 = this.softBuses_.get(e9);
      return t3 ? t3.muted ? 0 : t3.volume : 1;
    };
    return e8 === `master` ? t2(`master`) : t2(e8) * t2(`master`);
  }
  applyVoice_(e8) {
    e8.handle.setVolume(e8.base * this.softGain_(e8.bus) * e8.fade);
  }
  applyBus_(e8) {
    this.softVoices_ = this.softVoices_.filter((e9) => e9.handle.isPlaying || this.fadeOf_(e9) !== null);
    for (let t2 of this.softVoices_) (e8 === `master` || t2.bus === e8) && this.applyVoice_(t2);
  }
  fadeOf_(e8) {
    return this.fades_.find((t2) => t2.voice === e8) ?? null;
  }
  playVoice_(e8, t2) {
    let n2 = t2.bus ?? `sfx`, r2 = t2.volume ?? 1, i2 = this.backend_.play(e8, { ...t2, volume: r2 * this.softGain_(n2) });
    return this.softVoices_.push({ handle: i2, bus: n2, base: r2, fade: 1 }), this.softVoices_.length > 64 && (this.softVoices_ = this.softVoices_.filter((e9) => e9.handle.isPlaying)), i2;
  }
  muteBus(e8, t2) {
    if (!this.mixer_) {
      this.setSoftBus_(e8, { muted: t2 });
      return;
    }
    let n2 = this.mixer_.getBus(e8);
    n2 && (n2.muted = t2);
  }
  ensureBus(e8, t2) {
    return this.mixer_ ? (this.mixer_.getBus(e8) || this.mixer_.createBus({ name: e8, ...t2 ? { parent: t2 } : {} }), true) : false;
  }
  setBusVolume(e8, t2) {
    if (!this.mixer_) {
      this.setSoftBus_(e8, { volume: t2 });
      return;
    }
    let n2 = this.mixer_.getBus(e8);
    n2 && (n2.volume = t2);
  }
  setBusEffects(e8, t2) {
    let n2 = this.mixer_?.getBus(e8);
    return n2 ? (n2.setEffects(t2), true) : false;
  }
  getBusEffects(e8) {
    return this.mixer_?.getBus(e8)?.effects ?? [];
  }
  setBusDucking(e8, t2) {
    return this.mixer_?.setDucking(e8, t2) ?? false;
  }
  getBusDucking(e8) {
    return this.mixer_?.getDucking(e8) ?? null;
  }
  updateDucking() {
    this.mixer_?.updateDucking();
  }
  getBufferHandle(e8) {
    return this.lookupBuffer_(e8);
  }
  getSpectrum(e8) {
    return this.backend_.getFrequencyData?.(e8) ?? false;
  }
  dispose() {
    this.disposed_ = true, this.cancelFades_(), this.bgmHandle_ &&= (this.bgmHandle_.stop(), null);
    for (let e8 of this.bufferCache_.values()) this.backend_?.unloadBuffer(e8.handle);
    this.bufferCache_.clear(), this.evictOrder_.clear(), this.residentBytes_ = 0, this.backend_?.dispose();
  }
  updateFades(e8) {
    if (!(this.fades_.length === 0 || !(e8 > 0))) for (let t2 = this.fades_.length - 1; t2 >= 0; t2--) {
      let n2 = this.fades_[t2];
      n2.elapsed += e8;
      let r2 = n2.duration > 0 ? Math.min(n2.elapsed / n2.duration, 1) : 1;
      n2.voice.fade = n2.from + (n2.to - n2.from) * r2, this.applyVoice_(n2.voice), (r2 >= 1 || !n2.voice.handle.isPlaying) && (n2.stopAtEnd && (n2.voice.handle.stop(), this.fadingOut_.delete(n2.voice.handle)), this.fades_.splice(t2, 1));
    }
  }
  fadeIn_(e8, t2, n2) {
    let r2 = this.voiceOf_(e8, n2, `music`);
    r2.base = n2, r2.fade = 0, this.applyVoice_(r2), this.fades_.push({ voice: r2, from: 0, to: 1, duration: t2, elapsed: 0, stopAtEnd: false });
  }
  voiceOf_(e8, t2, n2) {
    let r2 = this.softVoices_.find((t3) => t3.handle === e8);
    if (r2) return r2;
    let i2 = { handle: e8, bus: n2, base: t2, fade: 1 };
    return this.softVoices_.push(i2), i2;
  }
  cancelFades_() {
    this.fades_.length = 0;
    for (let e8 of this.fadingOut_) e8.stop();
    this.fadingOut_.clear();
  }
  fadeOut_(e8, t2, n2) {
    this.fadingOut_.add(e8);
    let r2 = this.voiceOf_(e8, n2, `music`);
    this.fades_.push({ voice: r2, from: r2.fade, to: 0, duration: t2, elapsed: 0, stopAtEnd: true });
  }
  createDeferredHandle_() {
    let e8 = null;
    return { id: -1, stop() {
      e8?.stop();
    }, pause() {
      e8?.pause();
    }, resume() {
      e8?.resume();
    }, setVolume(t2) {
      e8?.setVolume(t2);
    }, setPan(t2) {
      e8?.setPan(t2);
    }, setLoop(t2) {
      e8?.setLoop(t2);
    }, setPlaybackRate(t2) {
      e8?.setPlaybackRate(t2);
    }, get isPlaying() {
      return e8?.isPlaying ?? false;
    }, get currentTime() {
      return e8?.currentTime ?? 0;
    }, get duration() {
      return e8?.duration ?? 0;
    }, resolve(t2) {
      e8 = t2;
    } };
  }
};
var tl = ea(null, `Audio`);
var U4 = ea(null, `Assets`);
var nl = class {
  constructor() {
    this.name = `asset`;
  }
  build(e8) {
    let t2 = e8.wasmModule;
    if (!t2) {
      T.warn(`asset`, `AssetPlugin: No WASM module available`);
      return;
    }
    let r2 = Gc.create({ backend: new Kc({ baseUrl: `` }), module: t2, getAudio: () => e8.hasResource(tl) ? e8.getResource(tl) : null, getSpriteAnimation: () => e8.hasResource(ne4) ? e8.getResource(ne4) : null, getLocalization: () => e8.hasResource(Lc) ? e8.getResource(Lc) : null });
    r2.getTextureLoader().setTranscoderProvider(async () => {
      let t3 = e8.sideModules;
      if (!t3) return null;
      let n2 = await t3.acquire(`basis`);
      return n2 ? Zc(n2) : null;
    });
    let i2 = new $c();
    r2.setRefCounter(i2), e8.world.onDespawn((e9) => i2.removeAllRefsForEntity(e9)), e8.insertResource(U4, r2), this.driveDeviceRecovery_(e8, r2);
  }
  driveDeviceRecovery_(e8, t2) {
    let r2 = false, i2 = 0, a2 = 0, o2 = 0;
    e8.addSystemToSchedule(1, Wi([], () => {
      let s2 = ri();
      if (s2 === ti2.Live || s2 === ti2.Dead) {
        a2 = 0, i2 = 0, o2 = 0;
        return;
      }
      let c2 = e8.getResource(aa)?.unscaledDelta ?? 0;
      if (o2 += c2, r2 || (i2 += c2, i2 < a2)) return;
      i2 = 0, r2 = true;
      let l2 = o2;
      t2.recoverFromDeviceLoss().then((e9) => {
        if (e9) {
          T.info(`asset`, `Device recovered after ${l2.toFixed(1)}s`), a2 = 0;
          return;
        }
        a2 = Math.min(a2 ? a2 * 2 : rl, il);
      }).catch((e9) => {
        T.warn(`asset`, `Device recovery threw; will retry`, e9), a2 = Math.min(a2 ? a2 * 2 : rl, il);
      }).finally(() => {
        r2 = false;
      });
    }));
  }
};
var rl = 0.25;
var il = 5;
var al = new nl();
function ol(e8, t2) {
  return e8 ? e8.resolveLoadPath(t2) : t2;
}
var sl = { SpinePlay: 0, SpineStop: 1, SpriteAnimPlay: 2, AudioPlay: 3, ActivationSet: 4 };
function cl(e8, t2, n2) {
  let r2 = t2.split(`.`), i2 = e8;
  for (let e9 = 0; e9 < r2.length - 1; e9++) if (i2 = i2[r2[e9]], typeof i2 != `object` || !i2) return false;
  let a2 = r2[r2.length - 1];
  return a2 in i2 && (i2[a2] = n2, true);
}
function ll(e8, t2, n2) {
  if (!n2) return t2;
  let r2 = M(`Children`), i2 = M(`Name`);
  if (!r2 || !i2) return null;
  let a2 = t2, o2 = n2.split(`/`);
  for (let t3 of o2) {
    let n3 = e8.tryGet(a2, r2);
    if (!n3) return null;
    let o3 = n3.entities || [], s2 = null;
    for (let n4 of o3) {
      let r3 = e8.tryGet(n4, i2);
      if (r3 && r3.value === t3) {
        s2 = n4;
        break;
      }
    }
    if (s2 === null) return null;
    a2 = s2;
  }
  return a2;
}
function ul(e8, t2, n2, r2, i2, a2, o2) {
  switch (n2) {
    case sl.SpinePlay:
      if (e8.has(r2, Ot)) {
        let t3 = e8.get(r2, Ot);
        t3.animation = o2, t3.playing = true, t3.loop = i2 !== 0, e8.set(r2, Ot, t3);
      }
      break;
    case sl.SpineStop:
      if (e8.has(r2, Ot)) {
        let t3 = e8.get(r2, Ot);
        t3.playing = false, e8.set(r2, Ot, t3);
      }
      break;
    case sl.SpriteAnimPlay:
      if (e8.has(r2, w3)) {
        let t3 = e8.get(r2, w3);
        e8.insert(r2, w3, { ...t3, clip: o2, playing: true });
      }
      break;
    case sl.AudioPlay:
      o2 && t2 && t2.playSFX(o2, { volume: a2 });
      break;
    case sl.ActivationSet: {
      let t3 = i2 !== 0;
      if (e8.has(r2, Ot)) {
        let n4 = e8.get(r2, Ot);
        n4.enabled !== t3 && (n4.enabled = t3, e8.set(r2, Ot, n4));
      }
      if (e8.has(r2, w3)) {
        let n4 = e8.get(r2, w3);
        n4.enabled !== t3 && e8.insert(r2, w3, { ...n4, enabled: t3 });
      }
      let n3 = M(`Sprite`);
      if (n3 && e8.has(r2, n3)) {
        let i3 = e8.get(r2, n3);
        i3.enabled !== t3 && e8.set(r2, n3, { ...i3, enabled: t3 });
      }
      let a3 = M(`UINode`);
      if (a3 && e8.has(r2, a3)) {
        let n4 = e8.get(r2, a3), i3 = +!t3;
        n4.display !== i3 && e8.insert(r2, a3, { ...n4, display: i3 });
      }
      break;
    }
  }
}
function dl(e8, t2, n2, r2, i2) {
  let a2 = i2 * i2, o2 = a2 * i2, s2 = 2 * o2 - 3 * a2 + 1, c2 = o2 - 2 * a2 + i2, l2 = -2 * o2 + 3 * a2, u2 = o2 - a2;
  return s2 * e8 + c2 * n2 + l2 * t2 + u2 * r2;
}
function fl(e8) {
  return e8 * e8;
}
function pl(e8) {
  return 1 - (1 - e8) * (1 - e8);
}
function ml(e8) {
  return e8 < 0.5 ? 2 * e8 * e8 : 1 - 2 * (1 - e8) * (1 - e8);
}
function hl(e8, t2) {
  let n2 = e8.keyframes;
  if (!n2 || n2.length === 0) return 0;
  if (n2.length === 1 || t2 <= n2[0].time) return n2[0].value;
  if (t2 >= n2[n2.length - 1].time) return n2[n2.length - 1].value;
  let r2 = 0;
  for (; r2 < n2.length - 1 && n2[r2 + 1].time <= t2; ) r2++;
  let i2 = n2[r2], a2 = n2[r2 + 1], o2 = a2.time - i2.time;
  if (o2 <= 0) return i2.value;
  let s2 = (t2 - i2.time) / o2;
  switch (i2.interpolation) {
    case zs.Linear:
      return i2.value + (a2.value - i2.value) * s2;
    case zs.Step:
      return i2.value;
    case zs.EaseIn:
      return i2.value + (a2.value - i2.value) * fl(s2);
    case zs.EaseOut:
      return i2.value + (a2.value - i2.value) * pl(s2);
    case zs.EaseInOut:
      return i2.value + (a2.value - i2.value) * ml(s2);
    case zs.Hermite:
    default:
      return dl(i2.value, a2.value, i2.outTangent * o2, a2.inTangent * o2, s2);
  }
}
function gl(e8, t2, n2) {
  if (t2 <= 0) return { time: 0, stopped: true };
  if (e8 < 0) return { time: 0, stopped: false };
  if (e8 < t2) return { time: e8, stopped: false };
  switch (n2) {
    case Ps.Loop:
      return { time: e8 % t2, stopped: false };
    case Ps.PingPong: {
      let n3 = t2 * 2, r2 = e8 % n3;
      return { time: r2 <= t2 ? r2 : n3 - r2, stopped: false };
    }
    case Ps.Once:
    default:
      return { time: t2, stopped: true };
  }
}
var _l = { "Transform.rotation.z": (e8, t2) => {
  let n2 = t2 * 0.5;
  e8.rotation = { w: Math.cos(n2), x: 0, y: 0, z: Math.sin(n2) };
} };
function vl(e8, t2, n2, r2) {
  let i2 = _l[`${t2}.${n2}`];
  return i2 ? (i2(e8, r2), true) : cl(e8, n2, r2);
}
function yl(e8, t2, n2, r2, i2) {
  for (let a2 of e8.tracks) {
    if (a2.type !== H2.Property) continue;
    let e9 = r2.getComponent(a2.component);
    if (!e9) continue;
    let o2 = r2.resolveChild(n2, a2.childPath);
    if (o2 == null || !r2.world.has(o2, e9)) continue;
    let s2 = r2.world.get(o2, e9), c2 = false;
    for (let e10 of a2.channels) {
      if (!e10.keyframes || e10.keyframes.length === 0 || i2?.skipChannel?.(a2.childPath, a2.component, e10.property)) continue;
      let n3 = hl(e10, t2);
      vl(s2, a2.component, e10.property, n3) && (c2 = true);
    }
    c2 && r2.world.set(o2, e9, s2);
  }
}
function xl(e8 = Ps.Once, t2 = 1) {
  return { time: 0, prevTime: 0, playing: false, speed: t2, wrapMode: e8, spineClipIndices: {} };
}
function Sl(e8, t2, n2, r2, i2 = [[t2.prevTime, t2.time]]) {
  let a2 = [], { time: o2 } = t2;
  for (let s2 = 0; s2 < e8.tracks.length; s2++) {
    let c2 = e8.tracks[s2];
    if (c2.type === H2.Property || c2.type === H2.AnimFrames) continue;
    let l2 = n2(r2, c2.childPath);
    if (l2 != null) switch (c2.type) {
      case H2.Spine: {
        let e9 = -1;
        for (let t3 = c2.clips.length - 1; t3 >= 0; t3--) {
          let n4 = c2.clips[t3];
          if (o2 >= n4.start && o2 < n4.start + n4.duration) {
            e9 = t3;
            break;
          }
        }
        let n3 = t2.spineClipIndices[s2] ?? -1;
        if (e9 !== n3) if (t2.spineClipIndices[s2] = e9, e9 === -1) n3 >= 0 && a2.push({ kind: sl.SpineStop, entity: l2, intParam: 0, floatParam: 0, str: `` });
        else {
          let t3 = c2.clips[e9];
          a2.push({ kind: sl.SpinePlay, entity: l2, intParam: +!!t3.loop, floatParam: t3.speed, str: t3.animation });
        }
        break;
      }
      case H2.SpriteAnim:
        for (let [e9, t3] of i2) if (t3 > e9 && e9 <= c2.startTime && c2.startTime <= t3) {
          a2.push({ kind: sl.SpriteAnimPlay, entity: l2, intParam: 0, floatParam: 0, str: c2.clip });
          break;
        }
        break;
      case H2.Audio:
        for (let [e9, t3] of i2) for (let n3 of c2.events) n3.time > e9 && n3.time <= t3 && a2.push({ kind: sl.AudioPlay, entity: l2, intParam: 0, floatParam: n3.volume, str: n3.clip });
        break;
      case H2.Activation: {
        let e9 = false;
        for (let t3 of c2.ranges) if (o2 >= t3.start && o2 < t3.end) {
          e9 = true;
          break;
        }
        a2.push({ kind: sl.ActivationSet, entity: l2, intParam: +!!e9, floatParam: 0, str: `` });
        break;
      }
    }
  }
  return a2;
}
function Cl(e8, t2) {
  let n2 = false;
  return e8.playing && e8.finished && (t2.time = 0, t2.prevTime = 0, t2.spineClipIndices = {}, e8.finished = false, n2 = true), t2.playing = e8.playing, n2;
}
function wl(e8, t2, n2) {
  return !t2.playing && e8.playing ? (e8.playing = false, n2 && (e8.finished = true), true) : false;
}
function Tl(e8, t2, n2, r2, i2) {
  if (!n2.playing) return false;
  n2.prevTime = n2.time;
  let a2 = n2.time + r2 * n2.speed, o2 = gl(a2, e8.duration, n2.wrapMode);
  n2.time = o2.time, yl(e8, n2.time, t2, i2.deps, i2.sampleOpts), i2.onPropertyApplied?.(t2, e8);
  let s2 = n2.wrapMode === Ps.Loop && a2 >= e8.duration && e8.duration > 0 ? [[n2.prevTime, e8.duration], [0, n2.time]] : [[n2.prevTime, n2.time]];
  for (let r3 of Sl(e8, n2, i2.deps.resolveChild, t2, s2)) ul(i2.deps.world, i2.audio ?? null, r3.kind, r3.entity, r3.intParam, r3.floatParam, r3.str);
  return o2.stopped && (n2.playing = false), o2.stopped;
}
var El = class {
  constructor(e8 = null) {
    this.flags_ = e8, this.states_ = /* @__PURE__ */ new Map();
  }
  ensureState(e8, t2, n2) {
    let r2 = this.states_.get(e8);
    return r2 || (r2 = xl(t2, n2), this.states_.set(e8, r2)), r2;
  }
  getState(e8) {
    return this.states_.get(e8);
  }
  removeState(e8) {
    this.states_.delete(e8);
  }
  clearStates() {
    this.states_.clear();
  }
  play(e8) {
    let t2 = this.states_.get(e8);
    t2 && (t2.playing = true), this.flags_?.raise(e8);
  }
  pause(e8) {
    let t2 = this.states_.get(e8);
    t2 && (t2.playing = false), this.flags_?.lower(e8);
  }
  stop(e8) {
    let t2 = this.states_.get(e8);
    t2 && (t2.playing = false, t2.time = 0, t2.prevTime = 0, t2.spineClipIndices = {}), this.flags_?.reset(e8);
  }
  setTime(e8, t2) {
    let n2 = this.states_.get(e8);
    n2 && (n2.prevTime = n2.time, n2.time = t2);
  }
  isPlaying(e8) {
    return this.states_.get(e8)?.playing ?? false;
  }
  getCurrentTime(e8) {
    return this.states_.get(e8)?.time ?? 0;
  }
};
var Dl = ea(null, `Timeline`);
var Ol = k(`TimelinePlayer`, { timeline: ``, playing: false, speed: 1, wrapMode: `once`, finished: false }, { assetFields: [{ field: `timeline`, type: `timeline` }], fields: { finished: { advanced: true, tooltip: `Clip completed (runtime, read-only). Raise Playing to replay.` } } });
var kl = class {
  constructor() {
    this.name = `timeline`, this.loadedAssets_ = /* @__PURE__ */ new Map(), this.textureHandles_ = /* @__PURE__ */ new Map(), this.animFramesStates_ = /* @__PURE__ */ new Map(), this.offDespawn_ = null;
  }
  registerAsset(e8, t2) {
    this.loadedAssets_.set(e8, t2);
  }
  getAsset(e8) {
    return this.loadedAssets_.get(e8);
  }
  registerTextureHandles(e8, t2) {
    this.textureHandles_.set(e8, t2);
  }
  getTextureHandle(e8, t2) {
    return this.textureHandles_.get(e8)?.get(t2) ?? 0;
  }
  build(e8) {
    Ks(this);
    let t2 = e8.world, n2 = (e9, n3, r2) => {
      if (!t2.has(e9, Ol)) return;
      let i2 = t2.get(e9, Ol);
      i2.playing === n3 && !(r2 && i2.finished) || (i2.playing = n3, r2 && (i2.finished = false), t2.insert(e9, Ol, i2));
    };
    e8.insertResource(Dl, new El({ raise: (e9) => n2(e9, true, false), lower: (e9) => n2(e9, false, false), reset: (e9) => n2(e9, false, true) })), this.offDespawn_ = t2.onDespawn((t3) => {
      e8.getResource(Dl).removeState(t3), this.animFramesStates_.delete(t3);
    }), e8.addSystemToSchedule(3, Wi([ta(aa)], (n3) => {
      let r2 = e8.getResource(Dl), i2 = e8.hasResource(tl) ? e8.getResource(tl) : null, a2 = e8.hasResource(U4) ? e8.getResource(U4) : null, o2 = { world: t2, getComponent: M, resolveChild: (e9, n4) => ll(t2, e9, n4) };
      for (let e9 of t2.getEntitiesWithComponents([Ol])) {
        let s2 = t2.get(e9, Ol);
        if (!s2.timeline) continue;
        let c2 = ol(a2, s2.timeline), l2 = this.loadedAssets_.get(c2) ?? this.loadedAssets_.get(s2.timeline);
        if (!l2) continue;
        let u2 = Ls(s2.wrapMode), d2 = r2.ensureState(e9, u2, s2.speed);
        d2.speed = s2.speed, d2.wrapMode = u2;
        let f2 = Cl(s2, d2);
        this.ensureAnimFrames(e9, l2);
        let p3 = Tl(l2, e9, d2, n3.delta, { deps: o2, audio: i2 });
        this.processAnimFrames(t2, e9, d2.time, c2), (wl(s2, d2, p3) || f2) && t2.insert(e9, Ol, s2);
      }
    }, { name: `TimelineSystem` }), { runIf: l });
  }
  clearHandles() {
    this.animFramesStates_.clear();
  }
  cleanup() {
    this.offDespawn_?.(), this.offDespawn_ = null, this.animFramesStates_.clear(), this.loadedAssets_.clear(), this.textureHandles_.clear(), Ks(null);
  }
  ensureAnimFrames(e8, t2) {
    if (this.animFramesStates_.has(e8)) return;
    let n2 = t2.tracks.filter((e9) => e9.type === H2.AnimFrames);
    n2.length > 0 && this.animFramesStates_.set(e8, { tracks: n2, lastFrameIndices: n2.map(() => -1) });
  }
  processAnimFrames(e8, t2, n2, r2) {
    let i2 = this.animFramesStates_.get(t2);
    if (!i2) return;
    let a2 = M(`Sprite`);
    if (!(!a2 || !e8.has(t2, a2))) for (let o2 = 0; o2 < i2.tracks.length; o2++) {
      let s2 = i2.tracks[o2].frames;
      if (s2.length === 0) continue;
      let c2 = 0, l2 = 0;
      for (let e9 = 0; e9 < s2.length; e9++) {
        let t3 = s2[e9].duration ?? 0.08333333333333333;
        if (n2 < c2 + t3) {
          l2 = e9;
          break;
        }
        c2 += t3, e9 === s2.length - 1 && (l2 = s2.length - 1);
      }
      if (l2 !== i2.lastFrameIndices[o2]) {
        i2.lastFrameIndices[o2] = l2;
        let n3 = Ys(r2, s2[l2].texture);
        if (n3) {
          let r3 = e8.get(t2, a2);
          r3.texture = n3, e8.set(t2, a2, r3);
        }
      }
    }
  }
};
var Al = new kl();
function jl(e8, t2, n2) {
  let r2 = t2.split(`.`), i2 = e8;
  for (let e9 = 0; e9 < r2.length - 1; e9++) if (i2 = i2[r2[e9]], typeof i2 != `object` || !i2) return false;
  let a2 = r2[r2.length - 1];
  return a2 in i2 && (i2[a2] = n2, true);
}
function Ml(e8) {
  let t2 = e8.indexOf(`.`);
  return t2 === -1 ? null : { componentName: e8.substring(0, t2), fieldPath: e8.substring(t2 + 1) };
}
function Nl(e8, t2, n2, r2) {
  let i2 = Ml(n2);
  if (!i2) return false;
  let a2 = M(i2.componentName);
  if (!a2 || !e8.has(t2, a2)) return false;
  let o2 = e8.get(t2, a2);
  return jl(o2, i2.fieldPath, r2) ? (e8.insert(t2, a2, o2), true) : false;
}
var Pl = { reads: [Ol._name], writes: [Ol._name] };
var Fl = { reads: [w3._name], writes: [w3._name] };
function Il() {
  zl(`timeline.play`, (e8) => {
    if (!e8.has(Ol)) return;
    let t2 = e8.get(Ol);
    t2.playing || (t2.playing = true, e8.set(Ol, t2));
  }, Pl), zl(`timeline.pause`, (e8) => {
    if (!e8.has(Ol)) return;
    let t2 = e8.get(Ol);
    t2.playing && (t2.playing = false, e8.set(Ol, t2));
  }, Pl), Bl(`timeline.finished`, (e8) => {
    if (!e8.has(Ol)) return false;
    let t2 = e8.get(Ol);
    return t2.finished && !t2.playing;
  }, { reads: [Ol._name] }), zl(`spriteAnim.play`, (e8, t2, n2) => {
    if (!e8.has(w3)) return;
    let r2 = e8.get(w3), i2 = !!n2 && n2 !== r2.clip;
    !i2 && r2.playing || (i2 && (r2.clip = n2, r2.currentFrame = 0, r2.frameTimer = 0, r2.finished = false), r2.playing = true, e8.set(w3, r2));
  }, Fl), zl(`spriteAnim.restart`, (e8, t2, n2) => {
    if (!e8.has(w3)) return;
    let r2 = e8.get(w3);
    n2 && (r2.clip = n2), r2.currentFrame = 0, r2.frameTimer = 0, r2.finished = false, r2.playing = true, e8.set(w3, r2);
  }, Fl), zl(`spriteAnim.stop`, (e8) => {
    if (!e8.has(w3)) return;
    let t2 = e8.get(w3);
    t2.playing && (t2.playing = false, e8.set(w3, t2));
  }, Fl), Bl(`spriteAnim.finished`, (e8) => {
    if (!e8.has(w3)) return false;
    let t2 = e8.get(w3);
    return t2.finished && !t2.playing;
  }, { reads: [w3._name] }), I5.hasAction(`property.set`) || I5.registerAction(`property.set`, { separator: `=`, params: [{ name: `path`, type: `string`, tooltip: `Component.field, e.g. UIVisual.color.a` }, { name: `value`, type: `string` }], run: (e8, t2, n2, r2) => {
    let i2 = typeof r2?.path == `string` ? r2.path.trim() : ``, a2 = r2?.value;
    !i2 || a2 === void 0 || Nl(e8.world, e8.entity, i2, Rl(a2));
  }, touches: (e8) => {
    let t2 = Ll(e8).split(`.`)[0];
    return t2 ? { writes: [t2] } : { opaque: true };
  } });
}
function Ll(e8) {
  let t2 = e8.params?.path;
  return typeof t2 == `string` ? t2.trim() : (e8.arg ?? ``).split(`=`)[0].trim();
}
function Rl(e8) {
  if (typeof e8 != `string`) return e8;
  try {
    return JSON.parse(e8.trim());
  } catch {
    return e8.trim();
  }
}
function zl(e8, t2, n2) {
  I5.hasAction(e8) || I5.registerAction(e8, { run: t2, touches: n2 });
}
function Bl(e8, t2, n2) {
  I5.hasCondition(e8) || I5.registerCondition(e8, { check: t2, touches: n2 });
}
var Vl = `esengine:`;
var Hl = { getString(e8, t2) {
  let n2 = P5().getStorageItem(Vl + e8);
  return n2 === null ? t2 : n2;
}, setString(e8, t2) {
  P5().setStorageItem(Vl + e8, t2);
}, getNumber(e8, t2) {
  let n2 = P5().getStorageItem(Vl + e8);
  if (n2 === null) return t2;
  let r2 = Number(n2);
  return Number.isNaN(r2) ? t2 : r2;
}, setNumber(e8, t2) {
  P5().setStorageItem(Vl + e8, String(t2));
}, getBoolean(e8, t2) {
  let n2 = P5().getStorageItem(Vl + e8);
  return n2 === null ? t2 : n2 === `true`;
}, setBoolean(e8, t2) {
  P5().setStorageItem(Vl + e8, String(t2));
}, getJSON(e8, t2) {
  let r2 = P5().getStorageItem(Vl + e8);
  if (r2 === null) return t2;
  try {
    return JSON.parse(r2);
  } catch (r3) {
    return T.warn(`storage`, `Failed to parse JSON for key "${e8}"`, r3), t2;
  }
}, setJSON(e8, t2) {
  P5().setStorageItem(Vl + e8, JSON.stringify(t2));
}, remove(e8) {
  P5().removeStorageItem(Vl + e8);
}, has(e8) {
  return P5().getStorageItem(Vl + e8) !== null;
}, clear() {
  P5().clearStorage(Vl);
} };
var Ul = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });
var Wl = class {
  constructor() {
    this.editorHandler_ = null, this.uiHandler_ = null, this.mods_ = Ul;
  }
  setEditorHandler(e8) {
    return this.editorHandler_ = e8, () => {
      this.editorHandler_ === e8 && (this.editorHandler_ = null);
    };
  }
  setUIHandler(e8) {
    return this.uiHandler_ = e8, () => {
      this.uiHandler_ === e8 && (this.uiHandler_ = null);
    };
  }
  get currentMods() {
    return this.mods_;
  }
  dispatchKeyDown(e8) {
    return this.updateModsFromKey(e8, true), Kl(ql(this.editorHandler_?.onKeyDown), this.editorHandler_, e8, this.mods_) || Kl(ql(this.uiHandler_?.onKeyDown), this.uiHandler_, e8, this.mods_);
  }
  dispatchKeyUp(e8) {
    let t2 = Kl(ql(this.editorHandler_?.onKeyUp), this.editorHandler_, e8, this.mods_) || Kl(ql(this.uiHandler_?.onKeyUp), this.uiHandler_, e8, this.mods_);
    return this.updateModsFromKey(e8, false), t2;
  }
  dispatchPointerMove(e8, t2) {
    return Kl(ql(this.editorHandler_?.onPointerMove), this.editorHandler_, e8, t2, this.mods_) || Kl(ql(this.uiHandler_?.onPointerMove), this.uiHandler_, e8, t2, this.mods_);
  }
  dispatchPointerDown(e8, t2, n2) {
    return Kl(ql(this.editorHandler_?.onPointerDown), this.editorHandler_, e8, t2, n2, this.mods_) || Kl(ql(this.uiHandler_?.onPointerDown), this.uiHandler_, e8, t2, n2, this.mods_);
  }
  dispatchPointerUp(e8) {
    return Kl(ql(this.editorHandler_?.onPointerUp), this.editorHandler_, e8, this.mods_) || Kl(ql(this.uiHandler_?.onPointerUp), this.uiHandler_, e8, this.mods_);
  }
  dispatchWheel(e8, t2) {
    return Kl(ql(this.editorHandler_?.onWheel), this.editorHandler_, e8, t2, this.mods_) || Kl(ql(this.uiHandler_?.onWheel), this.uiHandler_, e8, t2, this.mods_);
  }
  dispatchTouchStart(e8, t2, n2) {
    return Kl(ql(this.editorHandler_?.onTouchStart), this.editorHandler_, e8, t2, n2) || Kl(ql(this.uiHandler_?.onTouchStart), this.uiHandler_, e8, t2, n2);
  }
  dispatchTouchMove(e8, t2, n2) {
    return Kl(ql(this.editorHandler_?.onTouchMove), this.editorHandler_, e8, t2, n2) || Kl(ql(this.uiHandler_?.onTouchMove), this.uiHandler_, e8, t2, n2);
  }
  dispatchTouchEnd(e8) {
    return Kl(ql(this.editorHandler_?.onTouchEnd), this.editorHandler_, e8) || Kl(ql(this.uiHandler_?.onTouchEnd), this.uiHandler_, e8);
  }
  dispatchTouchCancel(e8) {
    return Kl(ql(this.editorHandler_?.onTouchCancel), this.editorHandler_, e8) || Kl(ql(this.uiHandler_?.onTouchCancel), this.uiHandler_, e8);
  }
  updateModsFromKey(e8, t2) {
    let { shift: n2, ctrl: r2, alt: i2, meta: a2 } = this.mods_;
    if (e8 === `ShiftLeft` || e8 === `ShiftRight`) n2 = t2;
    else if (e8 === `ControlLeft` || e8 === `ControlRight`) r2 = t2;
    else if (e8 === `AltLeft` || e8 === `AltRight`) i2 = t2;
    else if (e8 === `MetaLeft` || e8 === `MetaRight` || e8 === `OSLeft` || e8 === `OSRight`) a2 = t2;
    else return;
    this.mods_ = { shift: n2, ctrl: r2, alt: i2, meta: a2 };
  }
};
var Gl = new Wl();
function Kl(e8, t2, ...n2) {
  if (typeof e8 != `function`) return false;
  try {
    return e8.apply(t2, n2) === true;
  } catch {
    return false;
  }
}
function ql(e8) {
  return e8;
}
var Jl = (function(e8) {
  return e8[e8.South = 0] = `South`, e8[e8.East = 1] = `East`, e8[e8.West = 2] = `West`, e8[e8.North = 3] = `North`, e8[e8.LeftBumper = 4] = `LeftBumper`, e8[e8.RightBumper = 5] = `RightBumper`, e8[e8.LeftTrigger = 6] = `LeftTrigger`, e8[e8.RightTrigger = 7] = `RightTrigger`, e8[e8.Back = 8] = `Back`, e8[e8.Start = 9] = `Start`, e8[e8.LeftStick = 10] = `LeftStick`, e8[e8.RightStick = 11] = `RightStick`, e8[e8.DpadUp = 12] = `DpadUp`, e8[e8.DpadDown = 13] = `DpadDown`, e8[e8.DpadLeft = 14] = `DpadLeft`, e8[e8.DpadRight = 15] = `DpadRight`, e8[e8.Guide = 16] = `Guide`, e8;
})({});
var Yl = (function(e8) {
  return e8[e8.LeftX = 0] = `LeftX`, e8[e8.LeftY = 1] = `LeftY`, e8[e8.RightX = 2] = `RightX`, e8[e8.RightY = 3] = `RightY`, e8;
})({});
var Xl = { x: 0, y: 0 };
var Zl = class {
  constructor() {
    this.keysDown = /* @__PURE__ */ new Set(), this.keysPressed = /* @__PURE__ */ new Set(), this.keysReleased = /* @__PURE__ */ new Set(), this.mouseX = 0, this.mouseY = 0, this.mouseButtons = /* @__PURE__ */ new Set(), this.mouseButtonsPressed = /* @__PURE__ */ new Set(), this.mouseButtonsReleased = /* @__PURE__ */ new Set(), this.scrollDeltaX = 0, this.scrollDeltaY = 0, this.touchAvailable = false, this.touches = /* @__PURE__ */ new Map(), this.touchesStarted = /* @__PURE__ */ new Map(), this.touchesEnded = /* @__PURE__ */ new Set(), this.keysPressedFixed = /* @__PURE__ */ new Set(), this.keysReleasedFixed = /* @__PURE__ */ new Set(), this.mouseButtonsPressedFixed = /* @__PURE__ */ new Set(), this.mouseButtonsReleasedFixed = /* @__PURE__ */ new Set(), this.fixedContext_ = false, this.virtual_ = /* @__PURE__ */ new Map(), this.gamepads = /* @__PURE__ */ new Map(), this.gamepadButtonThreshold = 0.5, this.gamepadDeadzone = 0.15, this.pointerOverUI = false, this.injected_ = /* @__PURE__ */ new Map();
  }
  isKeyDown(e8) {
    return this.keysDown.has(e8);
  }
  isKeyPressed(e8) {
    return (this.fixedContext_ ? this.keysPressedFixed : this.keysPressed).has(e8);
  }
  isKeyReleased(e8) {
    return (this.fixedContext_ ? this.keysReleasedFixed : this.keysReleased).has(e8);
  }
  getMousePosition() {
    return { x: this.mouseX, y: this.mouseY };
  }
  isMouseButtonDown(e8) {
    return this.mouseButtons.has(e8);
  }
  isMouseButtonPressed(e8) {
    return (this.fixedContext_ ? this.mouseButtonsPressedFixed : this.mouseButtonsPressed).has(e8);
  }
  isMouseButtonReleased(e8) {
    return (this.fixedContext_ ? this.mouseButtonsReleasedFixed : this.mouseButtonsReleased).has(e8);
  }
  noteKeyDown(e8) {
    this.keysDown.has(e8) || (this.keysPressed.add(e8), this.keysPressedFixed.add(e8)), this.keysDown.add(e8);
  }
  noteKeyUp(e8) {
    this.keysDown.delete(e8), this.keysReleased.add(e8), this.keysReleasedFixed.add(e8);
  }
  noteMouseDown(e8) {
    this.mouseButtons.add(e8), this.mouseButtonsPressed.add(e8), this.mouseButtonsPressedFixed.add(e8);
  }
  noteMouseUp(e8) {
    this.mouseButtons.delete(e8), this.mouseButtonsReleased.add(e8), this.mouseButtonsReleasedFixed.add(e8);
  }
  getScrollDelta() {
    return { x: this.scrollDeltaX, y: this.scrollDeltaY };
  }
  getTouches() {
    return [...this.touches.values()];
  }
  getTouchCount() {
    return this.touches.size;
  }
  getTouch(e8) {
    return this.touches.get(e8) ?? null;
  }
  isTouchActive(e8) {
    return this.touches.has(e8);
  }
  setVirtual(e8, t2, n2 = 0) {
    let r2 = this.virtual_.get(e8);
    r2 ? (r2.x = t2, r2.y = n2) : this.virtual_.set(e8, { x: t2, y: n2 });
  }
  getVirtual(e8) {
    return this.virtual_.get(e8) ?? Xl;
  }
  clearVirtual() {
    this.virtual_.clear();
  }
  getGamepads() {
    let e8 = [];
    for (let [t2, n2] of this.gamepads) n2.connected && e8.push(t2);
    return e8;
  }
  isGamepadConnected(e8 = 0) {
    return this.gamepads.get(e8)?.connected ?? false;
  }
  isGamepadButtonDown(e8, t2 = 0) {
    let n2 = this.connectedPad_(t2);
    return !!n2 && (n2.buttons[e8] ?? 0) >= this.gamepadButtonThreshold;
  }
  isGamepadButtonPressed(e8, t2 = 0) {
    let n2 = this.connectedPad_(t2);
    if (!n2) return false;
    let r2 = this.gamepadButtonThreshold;
    return (n2.buttons[e8] ?? 0) >= r2 && (n2.prevButtons[e8] ?? 0) < r2;
  }
  isGamepadButtonReleased(e8, t2 = 0) {
    let n2 = this.connectedPad_(t2);
    if (!n2) return false;
    let r2 = this.gamepadButtonThreshold;
    return (n2.buttons[e8] ?? 0) < r2 && (n2.prevButtons[e8] ?? 0) >= r2;
  }
  getGamepadButtonValue(e8, t2 = 0) {
    return this.connectedPad_(t2)?.buttons[e8] ?? 0;
  }
  getGamepadAxis(e8, t2 = 0) {
    let n2 = this.connectedPad_(t2);
    if (!n2) return 0;
    let r2 = n2.axes[e8] ?? 0;
    return Math.abs(r2) < this.gamepadDeadzone ? 0 : r2;
  }
  connectedPad_(e8) {
    let t2 = this.gamepads.get(e8);
    return t2?.connected ? t2 : void 0;
  }
  isPointerOverUI() {
    return this.pointerOverUI;
  }
  injectGamepad(e8) {
    this.injected_.set(e8.index, e8);
  }
  releaseGamepad(e8) {
    e8 === void 0 ? this.injected_.clear() : this.injected_.delete(e8);
  }
  updateGamepads(e8) {
    let t2 = this.injected_.size === 0 ? e8 : [...e8.filter((e9) => !this.injected_.has(e9.index)), ...this.injected_.values()];
    for (let e9 of this.gamepads.values()) e9.connected = false;
    for (let e9 of t2) {
      let t3 = this.gamepads.get(e9.index);
      t3 || (t3 = { connected: true, buttons: [], prevButtons: [], axes: [] }, this.gamepads.set(e9.index, t3)), t3.prevButtons = t3.buttons, t3.buttons = e9.buttons, t3.axes = e9.axes, t3.connected = e9.connected;
    }
  }
  clearFrameState() {
    this.keysPressed.clear(), this.keysReleased.clear(), this.mouseButtonsPressed.clear(), this.mouseButtonsReleased.clear(), this.scrollDeltaX = 0, this.scrollDeltaY = 0, this.touchesStarted.clear(), this.touchesEnded.clear();
  }
  beginFixedStep() {
    this.fixedContext_ = true;
  }
  endFixedStep() {
    this.keysPressedFixed.clear(), this.keysReleasedFixed.clear(), this.mouseButtonsPressedFixed.clear(), this.mouseButtonsReleasedFixed.clear(), this.fixedContext_ = false;
  }
};
var Ql = ea(new Zl(), `Input`);
function $l(e8) {
  return { onKeyDown(t2) {
    Gl.dispatchKeyDown(t2) || e8.noteKeyDown(t2);
  }, onKeyUp(t2) {
    Gl.dispatchKeyUp(t2) || e8.noteKeyUp(t2);
  }, onPointerMove(t2, n2) {
    e8.mouseX = t2, e8.mouseY = n2, Gl.dispatchPointerMove(t2, n2);
  }, onPointerDown(t2, n2, r2) {
    e8.mouseX = n2, e8.mouseY = r2, !Gl.dispatchPointerDown(t2, n2, r2) && e8.noteMouseDown(t2);
  }, onPointerUp(t2) {
    Gl.dispatchPointerUp(t2) || e8.noteMouseUp(t2);
  }, onWheel(t2, n2) {
    Gl.dispatchWheel(t2, n2) || (e8.scrollDeltaX += t2, e8.scrollDeltaY += n2);
  }, onTouchStart(t2, n2, r2) {
    if (Gl.dispatchTouchStart(t2, n2, r2)) return;
    let i2 = { id: t2, x: n2, y: r2 };
    e8.touches.set(t2, i2), e8.touchesStarted.set(t2, i2);
  }, onTouchMove(t2, n2, r2) {
    if (Gl.dispatchTouchMove(t2, n2, r2)) return;
    let i2 = e8.touches.get(t2);
    i2 ? (i2.x = n2, i2.y = r2) : e8.touches.set(t2, { id: t2, x: n2, y: r2 });
  }, onTouchEnd(t2) {
    Gl.dispatchTouchEnd(t2) || (e8.touches.delete(t2), e8.touchesEnded.add(t2));
  }, onTouchCancel(t2) {
    Gl.dispatchTouchCancel(t2) || (e8.touches.delete(t2), e8.touchesEnded.add(t2));
  } };
}
var eu = class {
  constructor(e8) {
    this.name = `input`, this.unbind_ = null, this.target_ = e8 ?? null;
  }
  build(e8) {
    let t2 = new Zl();
    e8.insertResource(Ql, t2), t2.touchAvailable = P5().hasTouch?.() ?? false, P5().bindInputEvents($l(t2), this.target_ ?? void 0);
    let n2 = P5();
    if (n2.pollGamepads) {
      let r2 = n2.pollGamepads.bind(n2);
      e8.addSystemToSchedule(1, Wi([], () => {
        t2.updateGamepads(r2());
      }, { name: `GamepadPollSystem` }));
    }
    e8.addSystemToSchedule(5, Wi([], () => {
      t2.clearFrameState();
    }, { name: `InputClearSystem` }));
  }
  cleanup() {
    jn();
  }
};
var tu = new eu();
var bu = class {
  constructor() {
    this.reads = /* @__PURE__ */ new Set(), this.writes = /* @__PURE__ */ new Set(), this.unknown = false;
  }
  add(e8) {
    if (!e8) return this.unknown = true, this;
    for (let t2 of e8.reads ?? []) this.reads.add(t2);
    for (let t2 of e8.writes ?? []) this.writes.add(t2);
    return e8.opaque && (this.unknown = true), this;
  }
  reading(...e8) {
    for (let t2 of e8) this.reads.add(t2);
    return this;
  }
  writing(...e8) {
    for (let t2 of e8) this.writes.add(t2);
    return this;
  }
  build() {
    return { reads: [...this.reads].sort(), writes: [...this.writes].sort(), ...this.unknown ? { opaque: true } : {} };
  }
};
function xu(e8, t2, n2 = new bu()) {
  for (let r2 of t2) if (r2.kind === `action`) {
    if (!e8.hasAction(r2.name)) continue;
    n2.add(e8.actionTouches(r2.name, r2.input));
  } else {
    if (!e8.hasCondition(r2.name)) continue;
    n2.add(e8.conditionTouches(r2.name));
  }
  return n2;
}
function Su(e8, t2) {
  let n2 = e8.get(t2);
  return n2 || (n2 = { bb: new cc(), run: null, fsmKey: null }, e8.set(t2, n2)), n2.bb;
}
function Cu(e8, t2, n2, r2, i2) {
  if (n2 <= 0) return;
  let a2 = { entity: 0, dt: n2, blackboard: null, world: e8, commands: t2, get: (t3) => e8.get(a2.entity, t3), set: (t3, n3) => e8.set(a2.entity, t3, n3), has: (t3) => e8.has(a2.entity, t3) };
  for (let t3 of e8.getEntitiesWithComponents([vc])) {
    let o2 = e8.get(t3, vc);
    if (!o2.fsm) continue;
    let s2 = xc(i2 ? i2(o2.fsm) : o2.fsm) ?? xc(o2.fsm);
    if (!s2) continue;
    let c2 = r2.get(t3);
    c2 || (c2 = { bb: new cc(), run: null, fsmKey: null }, r2.set(t3, c2)), (c2.run === null || c2.fsmKey !== o2.fsm) && (c2.run = mc(s2), c2.fsmKey = o2.fsm), a2.entity = t3, a2.dt = n2, a2.blackboard = c2.bb, hc(s2, c2.run, a2, c2.bb, I5), o2.current !== c2.run.current && (o2.current = c2.run.current, e8.set(t3, vc, o2));
  }
}
function* wu(e8) {
  for (let t2 of e8.states.values()) {
    for (let e9 of [t2.onEnter, t2.onUpdate, t2.onExit]) {
      let t3 = ac(e9);
      t3 && (yield { kind: `action`, name: t3, input: { arg: oc(e9), params: sc(e9) } });
    }
    for (let e9 of t2.transitions ?? []) e9.condition && (yield { kind: `condition`, name: e9.condition });
  }
}
function Tu() {
  let e8 = new bu().writing(vc._name);
  for (let t2 of Sc()) xu(I5, wu(t2), e8);
  return e8.build();
}
var Eu = class {
  constructor(e8) {
    this.states = e8;
  }
  blackboard(e8) {
    return Su(this.states, e8);
  }
  fire(e8, t2) {
    Su(this.states, e8).fire(t2);
  }
  state(e8) {
    return this.states.get(e8)?.run?.current ?? null;
  }
};
var Du = ea(null, `AiFsm`);
var Ou = class {
  constructor() {
    this.name = `fsm`;
  }
  build(e8) {
    Il();
    let t2 = /* @__PURE__ */ new Map();
    e8.world.onDespawn((e9) => t2.delete(e9)), e8.insertResource(Du, new Eu(t2));
    let n2 = (t3) => ol(e8.hasResource(U4) ? e8.getResource(U4) : null, t3);
    e8.addSystemToSchedule(3, Wi([ta(aa), Mi(), Hi()], (e9, r2, i2) => {
      Cu(i2, r2, e9.delta, t2, n2);
    }, { name: `StateMachineSystem`, touches: Tu }), { runIf: l });
  }
};
var ku = new Ou();
var Au = k(`EventBinding`, { rows: [] });
function ju(e8, t2, n2) {
  if (!n2) return t2;
  let r2 = t2, i2 = null;
  for (; r2 !== null && e8.valid(r2); ) {
    let t3 = Pu(e8, r2, n2, i2);
    if (t3 !== null) return t3;
    i2 = r2, r2 = Mu(e8, r2);
  }
  return e8.findEntityByName(n2);
}
function Mu(e8, t2) {
  if (!e8.has(t2, L)) return null;
  let n2 = e8.get(t2, L).entity;
  return e8.valid(n2) ? n2 : null;
}
function Nu(e8, t2) {
  return e8.has(t2, z) ? e8.get(t2, z).value : ``;
}
function Pu(e8, t2, n2, r2) {
  if (t2 === r2 || !e8.valid(t2)) return null;
  if (Nu(e8, t2) === n2) return t2;
  if (!e8.has(t2, R)) return null;
  for (let i2 of e8.get(t2, R).entities) {
    let t3 = Pu(e8, i2, n2, r2);
    if (t3 !== null) return t3;
  }
  return null;
}
function Fu(e8) {
  let { world: t2, events: r2 } = e8, i2 = /* @__PURE__ */ new Map(), a2 = /* @__PURE__ */ new Set(), o2 = (r3, i3) => {
    if (!I5.hasAction(i3.action)) {
      T.warn(`events`, `EventBinding: unknown action "${i3.action}"`);
      return;
    }
    let a3 = ju(t2, r3, i3.target ?? ``);
    if (a3 === null || !t2.valid(a3)) {
      T.warn(`events`, `EventBinding: no entity named "${i3.target}"`);
      return;
    }
    let o3 = e8.blackboardOf(a3), s3 = { entity: a3, dt: e8.dt(), blackboard: o3, world: t2, commands: e8.commands(), get: (e9) => t2.get(a3, e9), set: (e9, n2) => t2.set(a3, e9, n2), has: (e9) => t2.has(a3, e9) };
    if (i3.guard) {
      let e9 = I5.getCondition(i3.guard);
      if (!e9) {
        T.warn(`events`, `EventBinding: unknown condition "${i3.guard}"`);
        return;
      }
      if (!e9(s3, o3)) return;
    }
    Fr(I5, i3.action, s3, o3, { arg: i3.arg, params: i3.params });
  }, s2 = (e9) => {
    let n2 = e9.currentTarget;
    if (!t2.valid(n2) || !t2.has(n2, Au)) return;
    let r3 = t2.get(n2, Au);
    for (let t3 = 0; t3 < r3.rows.length; t3++) {
      let i3 = r3.rows[t3];
      if (!(i3.event !== e9.type || i3.enabled === false || !i3.action)) {
        if (i3.once) {
          let e10 = `${n2}:${t3}`;
          if (a2.has(e10)) continue;
          a2.add(e10);
        }
        o2(n2, i3);
      }
    }
  };
  return { sync() {
    let e9 = /* @__PURE__ */ new Set();
    for (let n2 of t2.getEntitiesWithComponents([Au])) {
      let r3 = t2.get(n2, Au);
      for (let t3 of r3.rows) t3.event && t3.action && t3.enabled !== false && e9.add(t3.event);
    }
    for (let [t3, n2] of i2) e9.has(t3) || (n2(), i2.delete(t3));
    for (let t3 of e9) i2.has(t3) || i2.set(t3, r2.on(t3, s2));
  }, dispose() {
    for (let e9 of i2.values()) e9();
    i2.clear(), a2.clear();
  } };
}
var Iu = class {
  constructor() {
    this.name = `eventBinding`, this.profileDomain = `events`, this.runtime_ = null;
  }
  build(e8) {
    Il(), Lu();
    let t2 = e8.world, n2 = Ht2(e8), r2 = /* @__PURE__ */ new Map();
    t2.onDespawn((e9) => r2.delete(e9));
    let i2 = null, o2 = 0, s2 = Fu({ world: t2, events: n2, blackboardOf: (t3) => {
      let n3 = e8.hasResource(Du) ? e8.getResource(Du) : null;
      if (n3) return n3.blackboard(t3);
      let i3 = r2.get(t3);
      return i3 || r2.set(t3, i3 = new cc()), i3;
    }, commands: () => i2, dt: () => o2 });
    this.runtime_ = s2, e8.addSystemToSchedule(2, Wi([ta(aa), Mi()], (e9, t3) => {
      o2 = e9.delta, i2 = t3, s2.sync();
    }, { name: `EventBindingSystem` }), { runIf: l });
  }
  cleanup() {
    this.runtime_?.dispose(), this.runtime_ = null;
  }
};
function Lu() {
  I5.hasAction(`fsm.fire`) || I5.registerAction(`fsm.fire`, { params: [{ name: `trigger`, type: `string` }], run: (e8, t2, n2, r2) => {
    let i2 = r2?.trigger;
    typeof i2 == `string` && i2 && t2.fire(i2);
  } }), I5.hasAction(`blackboard.set`) || I5.registerAction(`blackboard.set`, { separator: `=`, params: [{ name: `key`, type: `string` }, { name: `value`, type: `string` }], run: (e8, t2, n2, r2) => {
    let i2 = typeof r2?.key == `string` ? r2.key.trim() : ``;
    if (!i2) return;
    let a2 = r2?.value;
    if (a2 === void 0) return;
    let o2 = a2;
    if (typeof a2 == `string`) try {
      o2 = JSON.parse(a2.trim());
    } catch {
      o2 = a2.trim();
    }
    t2.set(i2, o2);
  } });
}
var Ru = new Iu();
var Wu = ea({ viewProjection: new Float32Array(16), vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0, worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0, worldMouseX: 0, worldMouseY: 0, valid: false }, `UICameraInfo`);
var od = ea(/* @__PURE__ */ new Map(), `SceneOrigins`);
var dd = class {
  constructor() {
    this.nextStackId = 1, this.stacks = /* @__PURE__ */ new Map(), this.cameraBindings = /* @__PURE__ */ new Map(), this.screenStack = null;
  }
  createStack() {
    return new fd(this);
  }
  reset() {
    for (let e8 of [...this.stacks.values()]) e8.destroy();
    this.stacks.clear(), this.cameraBindings.clear(), this.screenStack = null, this.nextStackId = 1;
  }
};
var fd = class {
  constructor(e8) {
    this.passes_ = [], this.destroyed_ = false, this.dirty_ = true, this.state_ = e8, this.id = e8.nextStackId++, e8.stacks.set(this.id, this);
  }
  addPass(e8, t2) {
    return this.passes_.push({ name: e8, shader: t2, enabled: true, floatUniforms: /* @__PURE__ */ new Map(), vec4Uniforms: /* @__PURE__ */ new Map(), textureUniforms: /* @__PURE__ */ new Map() }), this.dirty_ = true, this;
  }
  removePass(e8) {
    let t2 = this.passes_.findIndex((t3) => t3.name === e8);
    return t2 !== -1 && (this.passes_.splice(t2, 1), this.dirty_ = true), this;
  }
  clearPasses() {
    return this.passes_.length > 0 && (this.passes_.length = 0, this.dirty_ = true), this;
  }
  setEnabled(e8, t2) {
    let n2 = this.passes_.find((t3) => t3.name === e8);
    return n2 && n2.enabled !== t2 && (n2.enabled = t2, this.dirty_ = true), this;
  }
  setUniform(e8, t2, n2) {
    let r2 = this.passes_.find((t3) => t3.name === e8);
    return r2 && r2.floatUniforms.get(t2) !== n2 && (r2.floatUniforms.set(t2, n2), this.dirty_ = true), this;
  }
  setTexture(e8, t2, n2) {
    let r2 = this.passes_.find((t3) => t3.name === e8);
    return r2 && r2.textureUniforms.get(t2) !== n2 && (r2.textureUniforms.set(t2, n2), this.dirty_ = true), this;
  }
  setUniformVec4(e8, t2, n2) {
    let r2 = this.passes_.find((t3) => t3.name === e8);
    if (r2) {
      let e9 = r2.vec4Uniforms.get(t2);
      (!e9 || e9.x !== n2.x || e9.y !== n2.y || e9.z !== n2.z || e9.w !== n2.w) && (r2.vec4Uniforms.set(t2, { ...n2 }), this.dirty_ = true);
    }
    return this;
  }
  setAllPassesEnabled(e8) {
    for (let t2 of this.passes_) t2.enabled !== e8 && (t2.enabled = e8, this.dirty_ = true);
  }
  get passCount() {
    return this.passes_.length;
  }
  get enabledPassCount() {
    let e8 = 0;
    for (let t2 of this.passes_) t2.enabled && e8++;
    return e8;
  }
  get passes() {
    return this.passes_;
  }
  get isDirty() {
    return this.dirty_;
  }
  clearDirty() {
    this.dirty_ = false;
  }
  get isDestroyed() {
    return this.destroyed_;
  }
  destroy() {
    if (!this.destroyed_) {
      this.destroyed_ = true;
      for (let [e8, t2] of this.state_.cameraBindings) t2 === this && this.state_.cameraBindings.delete(e8);
      this.state_.stacks.delete(this.id);
    }
  }
};
var pd = new class extends ae {
  constructor(...e8) {
    super(...e8), this.label = `postprocess`;
  }
}();
var md = null;
function _d() {
  if (!md) throw Error(`PostProcess API not initialized. Call initPostProcessAPI() first.`);
  return md;
}
function vd(e8, t2 = false) {
  if (!t2 && !e8.isDirty) return;
  let n2 = _d();
  try {
    n2.postprocess_clearPasses();
  } catch (e9) {
    B(e9, `PostProcess._applyForCamera:clearPasses`);
    return;
  }
  for (let t3 of e8.passes) if (t3.enabled) {
    try {
      n2.postprocess_addPass(t3.name, t3.shader);
    } catch (e9) {
      B(e9, `PostProcess._applyForCamera:addPass("${t3.name}")`);
      continue;
    }
    for (let [e9, r2] of t3.floatUniforms) try {
      n2.postprocess_setUniformFloat(t3.name, e9, r2);
    } catch (n3) {
      B(n3, `PostProcess._applyForCamera:setUniform("${t3.name}", "${e9}")`);
    }
    for (let [e9, r2] of t3.vec4Uniforms) try {
      n2.postprocess_setUniformVec4(t3.name, e9, r2.x, r2.y, r2.z, r2.w);
    } catch (n3) {
      B(n3, `PostProcess._applyForCamera:setUniformVec4("${t3.name}", "${e9}")`);
    }
    for (let [e9, r2] of t3.textureUniforms) try {
      n2.postprocess_setPassTexture(t3.name, e9, r2);
    } catch (n3) {
      B(n3, `PostProcess._applyForCamera:setPassTexture("${t3.name}", "${e9}")`);
    }
  }
  e8.clearDirty();
}
var yd = class {
  constructor() {
    this.state = new dd(), this.volumeStacks = /* @__PURE__ */ new Map(), this.volumeShaders = /* @__PURE__ */ new Map(), this.engineStack_ = null;
  }
  get screenStack() {
    return this.state.screenStack;
  }
  setScreenStack(e8) {
    this.state.screenStack = e8;
  }
  createStack() {
    return this.state.createStack();
  }
  bind(e8, t2) {
    if (t2.isDestroyed) throw Error(`Cannot bind a destroyed PostProcessStack`);
    this.state.cameraBindings.set(e8, t2);
  }
  unbind(e8) {
    this.state.cameraBindings.delete(e8);
  }
  getStack(e8) {
    return this.state.cameraBindings.get(e8) ?? null;
  }
  init(e8, t2) {
    try {
      return _d().postprocess_init(e8, t2);
    } catch (n2) {
      return B(n2, `PostProcess.init(${e8}x${t2})`), false;
    }
  }
  shutdown() {
    try {
      _d().postprocess_shutdown();
    } catch (e8) {
      B(e8, `PostProcess.shutdown`);
    }
  }
  resize(e8, t2) {
    try {
      _d().postprocess_resize(e8, t2);
    } catch (n2) {
      B(n2, `PostProcess.resize(${e8}x${t2})`);
    }
  }
  isInitialized() {
    if (!md) return false;
    try {
      return md.postprocess_isInitialized();
    } catch (e8) {
      return B(e8, `PostProcess.isInitialized`), false;
    }
  }
  setBypass(e8) {
    try {
      _d().postprocess_setBypass(e8);
    } catch (e9) {
      B(e9, `PostProcess.setBypass`);
    }
  }
  begin() {
    try {
      _d().postprocess_begin();
    } catch (e8) {
      B(e8, `PostProcess.begin`);
    }
  }
  end() {
    try {
      _d().postprocess_end();
    } catch (e8) {
      B(e8, `PostProcess.end`);
    }
  }
  setOutputViewport(e8, t2, n2, r2) {
    try {
      _d().postprocess_setOutputViewport(e8, t2, n2, r2);
    } catch (e9) {
      B(e9, `PostProcess.setOutputViewport`);
    }
  }
  _applyForCamera(e8) {
    let t2 = this.state.cameraBindings.get(e8);
    if (!t2 || t2.isDestroyed || t2.enabledPassCount === 0) {
      this.setBypass(true);
      return;
    }
    this.isInitialized() || this.init(1, 1), this.setBypass(false), vd(t2, this.engineStack_ !== t2), this.engineStack_ = t2;
  }
  _resetAfterCamera() {
    try {
      _d().postprocess_clearPasses(), _d().postprocess_setBypass(true), this.engineStack_ = null;
    } catch (e8) {
      B(e8, `PostProcess._resetAfterCamera`);
    }
  }
  _beginScreenCapture() {
    try {
      _d().postprocess_beginScreenCapture();
    } catch (e8) {
      B(e8, `PostProcess._beginScreenCapture`);
    }
  }
  _endScreenCapture() {
    try {
      _d().postprocess_endScreenCapture();
    } catch (e8) {
      B(e8, `PostProcess._endScreenCapture`);
    }
  }
  _applyScreenStack() {
    let e8 = this.state.screenStack;
    if (!e8 || e8.isDestroyed || e8.enabledPassCount === 0) return;
    let t2 = _d();
    try {
      t2.postprocess_clearScreenPasses();
    } catch (e9) {
      B(e9, `PostProcess._applyScreenStack:clearScreenPasses`);
      return;
    }
    for (let n2 of e8.passes) if (n2.enabled) {
      try {
        t2.postprocess_addScreenPass(n2.name, n2.shader);
      } catch (e9) {
        B(e9, `PostProcess._applyScreenStack:addScreenPass("${n2.name}")`);
        continue;
      }
      for (let [e9, r2] of n2.floatUniforms) try {
        t2.postprocess_setScreenUniformFloat(n2.name, e9, r2);
      } catch (t3) {
        B(t3, `PostProcess._applyScreenStack:setScreenUniform("${n2.name}", "${e9}")`);
      }
      for (let [e9, r2] of n2.vec4Uniforms) try {
        t2.postprocess_setScreenUniformVec4(n2.name, e9, r2.x, r2.y, r2.z, r2.w);
      } catch (t3) {
        B(t3, `PostProcess._applyScreenStack:setScreenUniformVec4("${n2.name}", "${e9}")`);
      }
    }
  }
  _executeScreenPasses() {
    try {
      _d().postprocess_executeScreenPasses();
    } catch (e8) {
      B(e8, `PostProcess._executeScreenPasses`);
    }
  }
};
var bd = ea(null, `PostProcess`);
var xd = { createLutGrade() {
  return we.compileShader(`#pragma shader "PP LUT Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_lut texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 sampleLut(vec3 c) {
    const float size = 32.0;
    float b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    float slice0 = floor(b);
    float slice1 = min(slice0 + 1.0, size - 1.0);
    float u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    float v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    vec3 a = texture(u_lut, vec2(u + slice0 / size, v)).rgb;
    vec3 d = texture(u_lut, vec2(u + slice1 / size, v)).rgb;
    return mix(a, d, b - slice0);
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    fragColor = vec4(mix(color.rgb, sampleLut(color.rgb), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
fn sampleLut(c : vec3f) -> vec3f {
    let size = 32.0;
    let b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    let slice0 = floor(b);
    let slice1 = min(slice0 + 1.0, size - 1.0);
    let u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    let v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    let a = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice0 / size, v), 0.0).rgb;
    let d = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice1 / size, v), 0.0).rgb;
    return mix(a, d, b - slice0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    return vec4f(mix(color.rgb, sampleLut(color.rgb), mc.u_intensity), color.a);
}
#pragma end
`);
}, createBlur() {
  return we.compileShader(`#pragma shader "PP Blur"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(2) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 texelSize = u_viewport.zw;
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
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texelSize = tc.u_viewport.zw;
    let offset = mc.u_intensity;
    let uv = v.v_texCoord;

    var color = vec4f(0.0);
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,    -offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv, 0.0)                                       * 0.25;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,     offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  offset) * texelSize, 0.0) * 0.0625;

    return color;
}
#pragma end
`);
}, createVignette() {
  return we.compileShader(`#pragma shader "PP Vignette"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.6) range(0,1)
#pragma param u_softness float default(0.5) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);
    float vig = 1.0 - smoothstep(1.0 - u_softness, 1.0, dist);
    fragColor = vec4(color.rgb * mix(1.0, vig, u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let uv = v.v_texCoord * 2.0 - 1.0;
    let dist = length(uv);
    let vig = 1.0 - smoothstep(1.0 - mc.u_softness, 1.0, dist);
    return vec4f(color.rgb * mix(1.0, vig, mc.u_intensity), color.a);
}
#pragma end
`);
}, createGrayscale() {
  return we.compileShader(`#pragma shader "PP Grayscale"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let gray = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    return vec4f(mix(color.rgb, vec3f(gray), mc.u_intensity), color.a);
}
#pragma end
`);
}, createBloomExtract() {
  return we.compileShader(`#pragma shader "PP Bloom Extract"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_threshold float default(0.4) range(0,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = u_threshold * 0.5;
    float soft = brightness - u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contrib = max(soft, brightness - u_threshold);
    contrib /= max(brightness, 0.00001);
    fragColor = vec4(color.rgb * contrib, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let brightness = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let knee = mc.u_threshold * 0.5;
    var soft = brightness - mc.u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    var contrib = max(soft, brightness - mc.u_threshold);
    contrib /= max(brightness, 0.00001);
    return vec4f(color.rgb * contrib, 1.0);
}
#pragma end
`);
}, createBloomKawase(e8) {
  let t2 = `(${e8.toFixed(1)} + 0.5)`, n2 = `#pragma shader "PP Bloom Kawase ${e8.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(1) range(0.5,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    float d = ${t2} * max(u_radius, 0.5);
    vec2 ts = u_viewport.zw;
    fragColor = (
        texture(u_texture, v_texCoord + vec2(-d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2( d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2(-d,  d) * ts) +
        texture(u_texture, v_texCoord + vec2( d,  d) * ts)
    ) * 0.25;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let d = ${t2} * max(mc.u_radius, 0.5);
    let ts = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    return (
        textureSampleLevel(t0, s0, uv + vec2f(-d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f(-d,  d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d,  d) * ts, 0.0)
    ) * 0.25;
}
#pragma end
`;
  return we.compileShader(n2);
}, createBloomComposite() {
  return we.compileShader(`#pragma shader "PP Bloom Composite"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1.5) range(0,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    vec4 blur = texture(u_texture, v_texCoord);
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb + blur.rgb * u_intensity, scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb + blur.rgb * mc.u_intensity, scene.a);
}
#pragma end
`);
}, createColorGrade() {
  return we.compileShader(`#pragma shader "PP Color Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)
#pragma param u_contrast float default(1) range(0,2)
#pragma param u_saturation float default(1) range(0,2)
#pragma param u_temperature float default(0) range(-1,1)
#pragma param u_tint float default(0) range(-1,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb;

    // Exposure (stops): 2^EV.
    c *= exp2(u_exposure);

    // White balance: warm/cool on R/B, green/magenta on G. Identity at 0.
    c.r *= 1.0 + u_temperature * 0.2;
    c.b *= 1.0 - u_temperature * 0.2;
    c.g *= 1.0 + u_tint * 0.2;

    // Contrast about mid-grey.
    c = (c - 0.5) * u_contrast + 0.5;

    // Saturation about Rec.709 luma.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, u_saturation);

    fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    var c = src.rgb;

    c *= exp2(mc.u_exposure);

    c.r *= 1.0 + mc.u_temperature * 0.2;
    c.b *= 1.0 - mc.u_temperature * 0.2;
    c.g *= 1.0 + mc.u_tint * 0.2;

    c = (c - 0.5) * mc.u_contrast + 0.5;

    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = mix(vec3f(luma), c, mc.u_saturation);

    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src.a);
}
#pragma end
`);
}, createChromaticAberration() {
  return we.compileShader(`#pragma shader "PP Chromatic Aberration"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(3) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 offset = u_intensity * u_viewport.zw;
    float r = texture(u_texture, v_texCoord + offset).r;
    float g = texture(u_texture, v_texCoord).g;
    float b = texture(u_texture, v_texCoord - offset).b;
    float a = texture(u_texture, v_texCoord).a;
    fragColor = vec4(r, g, b, a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let offset = mc.u_intensity * tc.u_viewport.zw;
    let r = textureSampleLevel(t0, s0, v.v_texCoord + offset, 0.0).r;
    let g = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).g;
    let b = textureSampleLevel(t0, s0, v.v_texCoord - offset, 0.0).b;
    let a = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).a;
    return vec4f(r, g, b, a);
}
#pragma end
`);
}, createTonemap() {
  return we.compileShader(`#pragma shader "PP Tonemap"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 aces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb * exp2(u_exposure);
    fragColor = vec4(aces(c), src.a);
}
#pragma end

#pragma fragment wgsl
fn aces(x : vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let c = src.rgb * exp2(mc.u_exposure);
    return vec4f(aces(c), src.a);
}
#pragma end
`);
}, createFxaa() {
  return we.compileShader(`#pragma shader "PP FXAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

const float REDUCE_MIN = 1.0 / 128.0;
const float REDUCE_MUL = 1.0 / 8.0;
const float SPAN_MAX = 8.0;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec2 inv = u_viewport.zw;
    vec4 srcM = texture(u_texture, v_texCoord);
    vec3 rgbNW = texture(u_texture, v_texCoord + vec2(-1.0, -1.0) * inv).rgb;
    vec3 rgbNE = texture(u_texture, v_texCoord + vec2( 1.0, -1.0) * inv).rgb;
    vec3 rgbSW = texture(u_texture, v_texCoord + vec2(-1.0,  1.0) * inv).rgb;
    vec3 rgbSE = texture(u_texture, v_texCoord + vec2( 1.0,  1.0) * inv).rgb;

    float lM = luma(srcM.rgb);
    float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    vec2 dir;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2(-SPAN_MAX), vec2(SPAN_MAX)) * inv;

    vec3 rgbA = 0.5 * (
        texture(u_texture, v_texCoord + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(u_texture, v_texCoord + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(u_texture, v_texCoord + dir * -0.5).rgb +
        texture(u_texture, v_texCoord + dir *  0.5).rgb);

    float lB = luma(rgbB);
    vec3 aa = (lB < lMin || lB > lMax) ? rgbA : rgbB;
    fragColor = vec4(mix(srcM.rgb, aa, clamp(u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end

#pragma fragment wgsl
const REDUCE_MIN = 1.0 / 128.0;
const REDUCE_MUL = 1.0 / 8.0;
const SPAN_MAX = 8.0;

fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let inv = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    let srcM = textureSampleLevel(t0, s0, uv, 0.0);
    let rgbNW = textureSampleLevel(t0, s0, uv + vec2f(-1.0, -1.0) * inv, 0.0).rgb;
    let rgbNE = textureSampleLevel(t0, s0, uv + vec2f( 1.0, -1.0) * inv, 0.0).rgb;
    let rgbSW = textureSampleLevel(t0, s0, uv + vec2f(-1.0,  1.0) * inv, 0.0).rgb;
    let rgbSE = textureSampleLevel(t0, s0, uv + vec2f( 1.0,  1.0) * inv, 0.0).rgb;

    let lM = luma(srcM.rgb);
    let lNW = luma(rgbNW);
    let lNE = luma(rgbNE);
    let lSW = luma(rgbSW);
    let lSE = luma(rgbSE);
    let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    var dir : vec2f;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    let reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    let rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2f(-SPAN_MAX), vec2f(SPAN_MAX)) * inv;

    let rgbA = 0.5 * (
        textureSampleLevel(t0, s0, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
    let rgbB = rgbA * 0.5 + 0.25 * (
        textureSampleLevel(t0, s0, uv + dir * -0.5, 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir *  0.5, 0.0).rgb);

    let lB = luma(rgbB);
    let aa = select(rgbB, rgbA, lB < lMin || lB > lMax);
    return vec4f(mix(srcM.rgb, aa, clamp(mc.u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end
`);
}, createLensDistortion() {
  return we.compileShader(`#pragma shader "PP Lens Distortion"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_strength float default(0) range(-1,1)
#pragma param u_zoom float default(1) range(0.5,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    vec2 warped = uv * (1.0 + u_strength * r2) / max(u_zoom, 0.0001);
    vec2 suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_texture, suv);
    }
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = v.v_texCoord * 2.0 - 1.0;
    let r2 = dot(uv, uv);
    let warped = uv * (1.0 + mc.u_strength * r2) / max(mc.u_zoom, 0.0001);
    let suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        return vec4f(0.0);
    }
    return textureSampleLevel(t0, s0, suv, 0.0);
}
#pragma end
`);
}, createOutline() {
  return we.compileShader(`#pragma shader "PP Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_threshold float default(0.2) range(0,1)
#pragma param u_thickness float default(1) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

float lum(vec2 offset) {
    return dot(texture(u_texture, v_texCoord + offset).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 px = vec2(u_thickness) / u_viewport.xy;
    float tl = lum(vec2(-px.x,  px.y));
    float tt = lum(vec2( 0.0,   px.y));
    float tr = lum(vec2( px.x,  px.y));
    float ll = lum(vec2(-px.x,  0.0));
    float rr = lum(vec2( px.x,  0.0));
    float bl = lum(vec2(-px.x, -px.y));
    float bb = lum(vec2( 0.0,  -px.y));
    float br = lum(vec2( px.x, -px.y));
    float gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    float gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    float edge = clamp((sqrt(gx * gx + gy * gy) - u_threshold) * 4.0, 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, vec3(0.0), edge * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
fn lum(uv : vec2f) -> f32 {
    return dot(textureSampleLevel(t0, s0, uv, 0.0).rgb, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let px = vec2f(mc.u_thickness) / tc.u_viewport.xy;
    let tl = lum(v.v_texCoord + vec2f(-px.x,  px.y));
    let tt = lum(v.v_texCoord + vec2f( 0.0,   px.y));
    let tr = lum(v.v_texCoord + vec2f( px.x,  px.y));
    let ll = lum(v.v_texCoord + vec2f(-px.x,  0.0));
    let rr = lum(v.v_texCoord + vec2f( px.x,  0.0));
    let bl = lum(v.v_texCoord + vec2f(-px.x, -px.y));
    let bb = lum(v.v_texCoord + vec2f( 0.0,  -px.y));
    let br = lum(v.v_texCoord + vec2f( px.x, -px.y));
    let gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    let gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    let edge = clamp((sqrt(gx * gx + gy * gy) - mc.u_threshold) * 4.0, 0.0, 1.0);
    return vec4f(mix(src.rgb, vec3f(0.0), edge * mc.u_intensity), src.a);
}
#pragma end
`);
}, createPixelate() {
  return we.compileShader(`#pragma shader "PP Pixelate"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_pixelSize float default(4) range(1,64)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 blocks = u_viewport.xy / max(u_pixelSize, 1.0);
    vec2 uv = (floor(v_texCoord * blocks) + 0.5) / blocks;
    fragColor = texture(u_texture, uv);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blocks = tc.u_viewport.xy / max(mc.u_pixelSize, 1.0);
    let uv = (floor(v.v_texCoord * blocks) + 0.5) / blocks;
    return textureSampleLevel(t0, s0, uv, 0.0);
}
#pragma end
`);
} };
var Sd = /* @__PURE__ */ new Map();
function Cd(e8) {
  Sd.set(e8.type, e8);
}
function wd(e8) {
  return Sd.get(e8);
}
Cd({ type: `blur`, label: `Blur`, factory: () => xd.createBlur(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 20, step: 0.1, defaultValue: 2 }] }), Cd({ type: `bloom`, label: `Bloom`, factory: () => xd.createBloomExtract(), uniforms: [{ name: `u_threshold`, label: `Threshold`, min: 0, max: 2, step: 0.01, defaultValue: 0.4 }, { name: `u_intensity`, label: `Intensity`, min: 0, max: 5, step: 0.1, defaultValue: 1.5 }, { name: `u_radius`, label: `Radius`, min: 0.5, max: 5, step: 0.1, defaultValue: 1 }], multiPass: [{ name: `bloom_extract`, factory: () => xd.createBloomExtract() }, { name: `bloom_kawase_0`, factory: () => xd.createBloomKawase(0) }, { name: `bloom_kawase_1`, factory: () => xd.createBloomKawase(1) }, { name: `bloom_kawase_2`, factory: () => xd.createBloomKawase(2) }, { name: `bloom_kawase_3`, factory: () => xd.createBloomKawase(3) }, { name: `bloom_kawase_4`, factory: () => xd.createBloomKawase(4) }, { name: `bloom_composite`, factory: () => xd.createBloomComposite() }] }), Cd({ type: `vignette`, label: `Vignette`, factory: () => xd.createVignette(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 1, step: 0.01, defaultValue: 0.6 }, { name: `u_softness`, label: `Softness`, min: 0, max: 1, step: 0.01, defaultValue: 0.5 }] }), Cd({ type: `grayscale`, label: `Grayscale`, factory: () => xd.createGrayscale(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 1, step: 0.01, defaultValue: 1 }] }), Cd({ type: `colorGrade`, label: `Color Grade`, factory: () => xd.createColorGrade(), uniforms: [{ name: `u_exposure`, label: `Exposure`, min: -3, max: 3, step: 0.05, defaultValue: 0 }, { name: `u_contrast`, label: `Contrast`, min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 }, { name: `u_saturation`, label: `Saturation`, min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 }, { name: `u_temperature`, label: `Temperature`, min: -1, max: 1, step: 0.01, defaultValue: 0 }, { name: `u_tint`, label: `Tint`, min: -1, max: 1, step: 0.01, defaultValue: 0 }] }), Cd({ type: `chromaticAberration`, label: `Chromatic Aberration`, factory: () => xd.createChromaticAberration(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 20, step: 0.1, defaultValue: 3 }] }), Cd({ type: `tonemap`, label: `Tonemap (ACES)`, factory: () => xd.createTonemap(), uniforms: [{ name: `u_exposure`, label: `Exposure`, min: -3, max: 3, step: 0.05, defaultValue: 0 }] }), Cd({ type: `fxaa`, label: `FXAA`, factory: () => xd.createFxaa(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 1, step: 0.01, defaultValue: 1 }] }), Cd({ type: `lensDistortion`, label: `Lens Distortion`, factory: () => xd.createLensDistortion(), uniforms: [{ name: `u_strength`, label: `Strength`, min: -1, max: 1, step: 0.01, defaultValue: 0 }, { name: `u_zoom`, label: `Zoom`, min: 0.5, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 }] }), Cd({ type: `pixelate`, label: `Pixelate`, factory: () => xd.createPixelate(), uniforms: [{ name: `u_pixelSize`, label: `Pixel Size`, min: 1, max: 64, step: 1, defaultValue: 4 }] }), Cd({ type: `outline`, label: `Outline`, factory: () => xd.createOutline(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 1, step: 0.01, defaultValue: 1 }, { name: `u_threshold`, label: `Threshold`, min: 0, max: 1, step: 0.01, defaultValue: 0.2 }, { name: `u_thickness`, label: `Thickness`, min: 0.5, max: 4, step: 0.5, defaultValue: 1 }] }), Cd({ type: `lutGrade`, label: `LUT Grade`, factory: () => xd.createLutGrade(), uniforms: [{ name: `u_intensity`, label: `Intensity`, min: 0, max: 1, step: 0.01, defaultValue: 1 }], textures: [{ name: `u_lut`, label: `LUT (1024x32, 32 slices)` }] });
function Dd(e8, t2, n2, r2, i2, a2) {
  let o2 = Math.abs(e8 - n2) - i2, s2 = Math.abs(t2 - r2) - a2;
  return Math.sqrt(Math.max(o2, 0) ** 2 + Math.max(s2, 0) ** 2) + Math.min(Math.max(o2, s2), 0);
}
function Od(e8, t2, n2, r2, i2) {
  let a2 = e8 - n2, o2 = t2 - r2;
  return Math.sqrt(a2 * a2 + o2 * o2) - i2;
}
function kd(e8, t2, n2, r2) {
  if (e8.isGlobal) return e8.weight;
  let i2;
  return i2 = e8.shape === `sphere` ? Od(n2, r2, t2.x, t2.y, e8.size.x) : Dd(n2, r2, t2.x, t2.y, e8.size.x, e8.size.y), i2 <= 0 ? e8.weight : e8.blendDistance <= 0 || i2 >= e8.blendDistance ? 0 : (1 - i2 / e8.blendDistance) * e8.weight;
}
function Ad(e8) {
  let t2 = /* @__PURE__ */ new Map(), n2 = [...e8].sort((e9, t3) => e9.data.priority - t3.data.priority);
  for (let { data: e9, factor: r2 } of n2) if (!(r2 <= 0)) for (let n3 of e9.effects) {
    if (!n3.enabled) continue;
    let e10 = t2.get(n3.type);
    if (e10) {
      if (n3.textures) for (let [t3, r3] of Object.entries(n3.textures)) r3 && e10.textures.set(t3, r3);
      for (let [t3, i2] of Object.entries(n3.uniforms)) {
        let n4 = e10.uniforms.get(t3) ?? 0;
        e10.uniforms.set(t3, n4 + (i2 - n4) * r2);
      }
    } else {
      let e11 = wd(n3.type), i2 = /* @__PURE__ */ new Map();
      for (let [t3, a3] of Object.entries(n3.uniforms)) {
        let n4 = e11?.uniforms.find((e12) => e12.name === t3)?.neutralValue ?? 0;
        i2.set(t3, n4 + (a3 - n4) * r2);
      }
      let a2 = /* @__PURE__ */ new Map();
      if (n3.textures) for (let [e12, t3] of Object.entries(n3.textures)) t3 && a2.set(e12, t3);
      t2.set(n3.type, { enabled: true, uniforms: i2, textures: a2 });
    }
  }
  return t2;
}
var jd = ea({ enabled: true }, `PostProcessVolumeConfig`);
var Md = null;
function Nd(e8) {
  Md = e8;
}
function Pd(e8, t2, n2) {
  let r2 = e8.volumeShaders.get(t2);
  if (r2 !== void 0) return r2;
  let i2 = n2();
  return e8.volumeShaders.set(t2, i2), i2;
}
function Fd(e8, t2, n2) {
  if (!(n2.size === 0 || !Md)) for (let [r2, i2] of n2) {
    let n3 = Md(i2);
    n3 && e8.setTexture(t2, r2, n3);
  }
}
var Id = /* @__PURE__ */ new WeakMap();
function Ld(e8) {
  let t2 = ``;
  for (let [n2, r2] of e8) if (r2.enabled) {
    t2 += n2 + `:`;
    for (let [e9, n3] of r2.uniforms) t2 += e9 + `=` + n3 + `;`;
    t2 += `|`;
    for (let [e9, n3] of r2.textures) t2 += e9 + `=` + n3 + `;`;
    t2 += `#`;
  }
  return t2;
}
function Rd(e8, t2, n2) {
  if (n2.size === 0) {
    let n3 = e8.volumeStacks.get(t2);
    n3 && (e8.unbind(t2), n3.destroy(), e8.volumeStacks.delete(t2));
    return;
  }
  let r2 = e8.volumeStacks.get(t2);
  r2 || (r2 = e8.createStack(), e8.volumeStacks.set(t2, r2));
  let i2 = Ld(n2);
  if (Id.get(r2) !== i2) {
    Id.set(r2, i2), r2.clearPasses();
    for (let [t3, i3] of n2) {
      if (!i3.enabled) continue;
      let n3 = wd(t3);
      if (n3) if (n3.multiPass) for (let t4 of n3.multiPass) {
        let n4 = Pd(e8, t4.name, t4.factory);
        r2.addPass(t4.name, n4);
        for (let [e9, n5] of i3.uniforms) r2.setUniform(t4.name, e9, n5);
        Fd(r2, t4.name, i3.textures);
      }
      else {
        let a2 = Pd(e8, t3, n3.factory);
        r2.addPass(t3, a2);
        for (let [e9, n4] of i3.uniforms) r2.setUniform(t3, e9, n4);
        Fd(r2, t3, i3.textures);
      }
    }
    r2.enabledPassCount > 0 ? e8.bind(t2, r2) : e8.unbind(t2);
  }
}
var zd = Wi([ta(bd), Oi(zt, I), Oi(wt, I)], (e8, t2, n2) => {
  let r2 = [];
  for (let [e9, n3, i2] of t2) r2.push({ data: n3, tx: { x: i2.position.x, y: i2.position.y } });
  for (let [t3, i2, a2] of n2) {
    if (!i2.isActive) continue;
    let n3 = a2.position.x, o2 = a2.position.y, s2 = [];
    for (let { data: e9, tx: t4 } of r2) {
      let r3 = kd(e9, t4, n3, o2);
      r3 > 0 && s2.push({ data: e9, factor: r3 });
    }
    Rd(e8, t3, s2.length > 0 ? Ad(s2) : /* @__PURE__ */ new Map());
  }
}, { name: `PostProcessVolumeSystem` });
function Bd(e8) {
  for (let [t2, n2] of e8.volumeStacks) e8.unbind(t2), n2.destroy();
  e8.volumeStacks.clear();
  for (let t2 of e8.volumeShaders.values()) we.releaseShader(t2);
  e8.volumeShaders.clear();
}
var Vd = class {
  constructor() {
    this.name = `postProcess`, this.profileDomain = `render`;
  }
  build(e8) {
    let t2 = new yd();
    e8.insertResource(bd, t2), e8.pipeline?.setPostProcess(t2), e8.insertResource(jd, { enabled: true }), Nd((t3) => e8.hasResource(U4) ? e8.getResource(U4).getTexture(t3)?.handle ?? 0 : 0), e8.addSystemToSchedule(4, zd);
  }
  cleanup(e8) {
    e8?.hasResource(bd) && Bd(e8.getResource(bd));
  }
};
var Hd = new Vd();
var Xd = ea(null, `SceneManager`);
var Qd = class {
  constructor(e8, t2, n2 = () => null) {
    this.world_ = e8, this.getAssets_ = t2, this.getScenes_ = n2;
  }
  async instantiate(e8, t2) {
    let n2 = this.getAssets_(), r2 = (await n2.loadPrefab(e8)).data, i2 = await rc(this.world_, r2, { assets: n2, assetBaseUrl: t2?.baseUrl, parent: t2?.parent, overrides: $d(r2, e8, t2?.overrides) });
    return t2?.scene !== false && this.adoptIntoActiveScene_(i2), i2;
  }
  adoptIntoActiveScene_(e8) {
    let t2 = this.getScenes_(), n2 = t2?.getActive(), r2 = n2 ? t2?.getScene(n2) : null;
    if (r2) for (let t3 of e8.entities.values()) r2.adopt(t3);
  }
};
function $d(e8, t2, n2) {
  if (!n2?.length) return;
  let r2 = new Set(e8.entities.map((e9) => e9.prefabEntityId));
  return n2.map((n3) => {
    if (!n3.prefabEntityId) return { ...n3, prefabEntityId: e8.rootEntityId };
    if (!r2.has(n3.prefabEntityId)) throw Error(`prefab "${t2}" has no entity "${n3.prefabEntityId}" for this override (${n3.type}${n3.componentType ? ` ${n3.componentType}.${n3.propertyName}` : ``}). Its root is "${e8.rootEntityId}" \u2014 or leave prefabEntityId out and the root is used. Entities: ${[...r2].join(`, `)}`);
    return n3;
  });
}
var ef = ea(null, `Prefabs`);
var tf = class {
  constructor() {
    this.name = `prefabs`, this.dependencies = [U4];
  }
  build(e8) {
    e8.insertResource(ef, new Qd(e8.world, () => e8.getResource(U4), () => e8.hasResource(Xd) ? e8.getResource(Xd) : null));
  }
};
var nf = new tf();
var rf = (function(e8) {
  return e8[e8.Float = 1] = `Float`, e8[e8.Float2 = 2] = `Float2`, e8[e8.Float3 = 3] = `Float3`, e8[e8.Float4 = 4] = `Float4`, e8[e8.Int = 5] = `Int`, e8[e8.Int2 = 6] = `Int2`, e8[e8.Int3 = 7] = `Int3`, e8[e8.Int4 = 8] = `Int4`, e8;
})({});
var af = new y3(`geometry`);
var gf = new y3(`glDebug`);
function Sf(e8, t2) {
  let n2 = t2 ?? new Float32Array(16), r2 = e8[0], i2 = e8[1], a2 = e8[2], o2 = e8[3], s2 = e8[4], c2 = e8[5], l2 = e8[6], u2 = e8[7], d2 = e8[8], f2 = e8[9], p3 = e8[10], m3 = e8[11], h3 = e8[12], g3 = e8[13], _3 = e8[14], v4 = e8[15], y5 = r2 * c2 - i2 * s2, b5 = r2 * l2 - a2 * s2, x5 = r2 * u2 - o2 * s2, S5 = i2 * l2 - a2 * c2, C5 = i2 * u2 - o2 * c2, ee4 = a2 * u2 - o2 * l2, w5 = d2 * g3 - f2 * h3, T5 = d2 * _3 - p3 * h3, te5 = d2 * v4 - m3 * h3, E5 = f2 * _3 - p3 * g3, ne5 = f2 * v4 - m3 * g3, re5 = p3 * v4 - m3 * _3, D5 = y5 * re5 - b5 * ne5 + x5 * E5 + S5 * te5 - C5 * T5 + ee4 * w5;
  return D5 === 0 ? n2 : (D5 = 1 / D5, n2[0] = (c2 * re5 - l2 * ne5 + u2 * E5) * D5, n2[1] = (a2 * ne5 - i2 * re5 - o2 * E5) * D5, n2[2] = (g3 * ee4 - _3 * C5 + v4 * S5) * D5, n2[3] = (p3 * C5 - f2 * ee4 - m3 * S5) * D5, n2[4] = (l2 * te5 - s2 * re5 - u2 * T5) * D5, n2[5] = (r2 * re5 - a2 * te5 + o2 * T5) * D5, n2[6] = (_3 * x5 - h3 * ee4 - v4 * b5) * D5, n2[7] = (d2 * ee4 - p3 * x5 + m3 * b5) * D5, n2[8] = (s2 * ne5 - c2 * te5 + u2 * w5) * D5, n2[9] = (i2 * te5 - r2 * ne5 - o2 * w5) * D5, n2[10] = (h3 * C5 - g3 * x5 + v4 * y5) * D5, n2[11] = (f2 * x5 - d2 * C5 - m3 * y5) * D5, n2[12] = (c2 * T5 - s2 * E5 - l2 * w5) * D5, n2[13] = (r2 * E5 - i2 * T5 + a2 * w5) * D5, n2[14] = (g3 * b5 - h3 * S5 - _3 * y5) * D5, n2[15] = (d2 * S5 - f2 * b5 + p3 * y5) * D5, n2);
}
function Cf(e8, t2, n2, r2) {
  let i2 = r2[0] * e8 + r2[4] * t2 + r2[8] * n2 + r2[12], a2 = r2[1] * e8 + r2[5] * t2 + r2[9] * n2 + r2[13], o2 = r2[2] * e8 + r2[6] * t2 + r2[10] * n2 + r2[14], s2 = r2[3] * e8 + r2[7] * t2 + r2[11] * n2 + r2[15], c2 = s2 === 0 ? 0 : 1 / s2;
  return { x: i2 * c2, y: a2 * c2, z: o2 * c2 };
}
function wf(e8, t2, n2, r2, i2, a2, o2, s2 = 0) {
  let c2 = (e8 - r2) / a2 * 2 - 1, l2 = (t2 - i2) / o2 * 2 - 1, u2 = Cf(c2, l2, -1, n2), d2 = Cf(c2, l2, 1, n2), f2 = d2.z - u2.z;
  if (f2 === 0) return { x: u2.x, y: u2.y };
  let p3 = (s2 - u2.z) / f2;
  return { x: u2.x + (d2.x - u2.x) * p3, y: u2.y + (d2.y - u2.y) * p3 };
}
function Ef(e8, t2) {
  return 2 * Math.atan2(e8, t2);
}
function Df(e8, t2, n2, r2, i2, a2, o2, s2 = 0) {
  let c2 = n2[0] * e8 + n2[4] * t2 + n2[8] * s2 + n2[12], l2 = n2[1] * e8 + n2[5] * t2 + n2[9] * s2 + n2[13], u2 = n2[3] * e8 + n2[7] * t2 + n2[11] * s2 + n2[15], d2 = c2 / u2, f2 = l2 / u2;
  return [r2 + (d2 * 0.5 + 0.5) * a2, i2 + (f2 * 0.5 + 0.5) * o2];
}
function Of() {
  let e8 = new Float32Array(16), t2 = new Float32Array(16), n2 = true;
  return { update(e9) {
    for (let r2 = 0; r2 < 16; r2++) if (t2[r2] !== e9[r2]) {
      t2.set(e9), n2 = true;
      break;
    }
  }, getInverse(t3) {
    return n2 &&= (Sf(t3, e8), false), e8;
  } };
}
var jf = ea(null, `CameraView`);
var Pf = { viewProjection: new Float32Array(16), vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0, worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0, worldMouseX: 0, worldMouseY: 0, valid: false };
var Xf = ea(null, `SceneStreaming`);
var Zf = Wi([na(Xd), ta(aa)], (e8, t2) => {
  e8.get().updateTransition(t2.delta);
}, { name: `SceneTransitionSystem` });
var Qf = Wi([ta(Xf), Hi()], (e8, t2) => {
  let n2 = e8.getFocusEntity();
  if (n2 != null && t2.valid(n2) && t2.has(n2, I)) {
    let r2 = t2.get(n2, I);
    e8.setFocus(r2.position.x, r2.position.y);
  }
  e8.update();
}, { name: `SceneStreamingSystem`, touches: { reads: [`Transform`] } });
var ep = k(`FollowTarget`, { target: -1, offsetX: 0, offsetY: 0, deadzone: 0, damping: 0.25 });
var rp = k(`CameraBounds`, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
var up = { active: false, x: 0, y: 0, orthoSize: 360, uiPreviewAspect: 0, perspective: false, fov: 60, distance: 1e3 };
var mp = ea({ ...up }, `EditorView`);
var gp = { designWidth: 1920, designHeight: 1080, scaleMode: -1, matchWidthOrHeight: 0.5 };
var _p = ea({ ...gp }, `ScreenScaling`);
var vp = { Linear: 0, EaseInQuad: 1, EaseOutQuad: 2, EaseInOutQuad: 3, EaseInCubic: 4, EaseOutCubic: 5, EaseInOutCubic: 6, EaseInBack: 7, EaseOutBack: 8, EaseInOutBack: 9, EaseInElastic: 10, EaseOutElastic: 11, EaseInOutElastic: 12, EaseOutBounce: 13, CubicBezier: 14, Step: 15 };
function yp(e8) {
  return e8;
}
function bp(e8) {
  return e8 * e8;
}
function xp(e8) {
  return e8 * (2 - e8);
}
function Sp(e8) {
  return e8 < 0.5 ? 2 * e8 * e8 : -1 + (4 - 2 * e8) * e8;
}
function Cp(e8) {
  return e8 * e8 * e8;
}
function wp(e8) {
  let t2 = e8 - 1;
  return t2 * t2 * t2 + 1;
}
function Tp(e8) {
  return e8 < 0.5 ? 4 * e8 * e8 * e8 : (e8 - 1) * (2 * e8 - 2) * (2 * e8 - 2) + 1;
}
var Ep = 1.70158;
var Dp = 2.70158;
var Op = Ep * 1.525;
function kp(e8) {
  return Dp * e8 * e8 * e8 - Ep * e8 * e8;
}
function Ap(e8) {
  let t2 = e8 - 1;
  return 1 + Dp * t2 * t2 * t2 + Ep * t2 * t2;
}
function jp(e8) {
  return e8 < 0.5 ? (2 * e8) ** 2 * (7.189819 * e8 - Op) / 2 : ((2 * e8 - 2) ** 2 * (3.5949095 * (e8 * 2 - 2) + Op) + 2) / 2;
}
var Mp = 2 * Math.PI / 3;
var Np = 2 * Math.PI / 4.5;
function Pp(e8) {
  return e8 === 0 || e8 === 1 ? e8 : -(2 ** (10 * e8 - 10)) * Math.sin((e8 * 10 - 10.75) * Mp);
}
function Fp(e8) {
  return e8 === 0 || e8 === 1 ? e8 : 2 ** (-10 * e8) * Math.sin((e8 * 10 - 0.75) * Mp) + 1;
}
function Ip(e8) {
  return e8 === 0 || e8 === 1 ? e8 : e8 < 0.5 ? -(2 ** (20 * e8 - 10) * Math.sin((20 * e8 - 11.125) * Np)) / 2 : 2 ** (-20 * e8 + 10) * Math.sin((20 * e8 - 11.125) * Np) / 2 + 1;
}
var Lp = 7.5625;
var Rp = 2.75;
function zp(e8) {
  return e8 < 1 / Rp ? Lp * e8 * e8 : e8 < 2 / Rp ? (e8 -= 1.5 / Rp, Lp * e8 * e8 + 0.75) : e8 < 2.5 / Rp ? (e8 -= 2.25 / Rp, Lp * e8 * e8 + 0.9375) : (e8 -= 2.625 / Rp, Lp * e8 * e8 + 0.984375);
}
var Bp = 1e-6;
function Vp(e8, t2, n2, r2, i2) {
  let a2 = e8;
  for (let n3 = 0; n3 < 8; n3++) {
    let n4 = 1 - a2, i3 = 3 * t2 * n4 * n4 * a2 + 3 * r2 * n4 * a2 * a2 + a2 * a2 * a2 - e8;
    if (Math.abs(i3) < Bp) break;
    let o3 = 3 * t2 * (1 - 3 * a2) * (1 - a2) + 6 * r2 * a2 * (1 - a2) - 3 * r2 * a2 * a2 + 3 * a2 * a2;
    if (Math.abs(o3) < Bp) break;
    a2 -= i3 / o3;
  }
  let o2 = 1 - a2;
  return 3 * n2 * o2 * o2 * a2 + 3 * i2 * o2 * a2 * a2 + a2 * a2 * a2;
}
function Hp(e8) {
  return e8 < 1 ? 0 : 1;
}
function Up(e8, t2, n2) {
  switch (e8) {
    case vp.Linear:
      return yp(t2);
    case vp.EaseInQuad:
      return bp(t2);
    case vp.EaseOutQuad:
      return xp(t2);
    case vp.EaseInOutQuad:
      return Sp(t2);
    case vp.EaseInCubic:
      return Cp(t2);
    case vp.EaseOutCubic:
      return wp(t2);
    case vp.EaseInOutCubic:
      return Tp(t2);
    case vp.EaseInBack:
      return kp(t2);
    case vp.EaseOutBack:
      return Ap(t2);
    case vp.EaseInOutBack:
      return jp(t2);
    case vp.EaseInElastic:
      return Pp(t2);
    case vp.EaseOutElastic:
      return Fp(t2);
    case vp.EaseInOutElastic:
      return Ip(t2);
    case vp.EaseOutBounce:
      return zp(t2);
    case vp.CubicBezier:
      return n2 ? Vp(t2, n2.p1x, n2.p1y, n2.p2x, n2.p2y) : yp(t2);
    case vp.Step:
      return Hp(t2);
    default:
      return yp(t2);
  }
}
var Wp = { Linear: 0, EaseIn: 1, EaseOut: 2, EaseInOut: 3 };
var Yp = { target: -1, hasPending: false, pendingTarget: -1, pendingTime: 0, pendingCurve: Wp.EaseInOut, blending: false, from: null, startTime: 0, duration: 0, curve: Wp.EaseInOut, currentMain: null, shakes: [], shakeSeq: 0 };
var Zp = ea({ ...Yp }, `CameraDirector`);
var am = new Float32Array(16);
var sm = new Float32Array(16);
var lm = new Float32Array(16);
var dm = new Float32Array(16);
var pm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
var Km = { UILayout: `uiLayout`, UIInteraction: `uiInteraction`, UIRenderOrder: `uiRenderOrder`, UIVisibility: `uiVisibility`, UIMask: `uiMask`, Text: `text`, Focus: `focus`, Drag: `drag`, SafeArea: `safeArea`, TextInput: `textInput` };
var qm = { UILayout: `UILayoutSystem`, UILayoutLate: `UILayoutLateSystem`, UIRenderOrder: `UIRenderOrderSystem`, UIInteraction: `UIInteractionSystem`, ListView: `ListViewSystem`, Text: `TextSystem`, Focus: `FocusSystem`, Tween: `TweenSystem`, Animator: `AnimatorSystem`, SpriteAnimator: `SpriteAnimatorSystem` };
var Jm = { Px: 0, Percent: 1, Auto: 2 };
var W2 = (e8) => ({ value: e8, unit: Jm.Px });
var Ym = (e8) => ({ value: e8, unit: Jm.Percent });
var G3 = () => ({ value: 0, unit: Jm.Auto });
var K = P(`UINode`, { position: 0, display: 0, opacity: 1, pointerEvents: 0, width: G3(), height: G3(), minWidth: G3(), minHeight: G3(), maxWidth: G3(), maxHeight: G3(), flexGrow: 0, flexShrink: 1, flexBasis: G3(), alignSelf: 0, marginLeft: W2(0), marginTop: W2(0), marginRight: W2(0), marginBottom: W2(0), insetLeft: G3(), insetTop: G3(), insetRight: G3(), insetBottom: G3() });
var q3 = P(`UIVisual`, { visualType: 0, texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, fit: 0, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 }, fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true });
var Zm = { Row: 0, Column: 1, RowReverse: 2, ColumnReverse: 3 };
var Qm = { NoWrap: 0, Wrap: 1 };
var $m = { Start: 0, Center: 1, End: 2, SpaceBetween: 3, SpaceAround: 4, SpaceEvenly: 5 };
var eh = { Start: 0, Center: 1, End: 2, Stretch: 3 };
var th = { Start: 0, Center: 1, End: 2, Stretch: 3, SpaceBetween: 4, SpaceAround: 5 };
var nh = P(`FlexContainer`, { direction: Zm.Row, wrap: Qm.NoWrap, justifyContent: $m.Start, alignItems: eh.Stretch, alignContent: th.Start, gap: { x: 0, y: 0 }, padding: { left: 0, top: 0, right: 0, bottom: 0 } });
var rh = ea({ generation: 0 }, `UILayoutGeneration`);
var ih = new class extends ae {
  constructor(...e8) {
    super(...e8), this.label = `uiHelpers`;
  }
}();
var ah = null;
var oh = null;
function sh(e8, t2) {
  e8 ? (ih.connect(e8), ah = ih.module) : ah = null, oh = t2;
}
function ch(e8, t2) {
  let n2 = 0, r2 = t2;
  for (; e8.has(r2, L); ) {
    let t3 = e8.get(r2, L).entity;
    if (!e8.valid(t3)) break;
    n2++, r2 = t3;
  }
  return n2;
}
function lh(e8) {
  return ah && oh && ah.getUINodeComputedWidth ? ah.getUINodeComputedWidth(oh, e8) : 0;
}
function uh(e8) {
  return ah && oh && ah.getUINodeComputedHeight ? ah.getUINodeComputedHeight(oh, e8) : 0;
}
function dh(e8, t2, n2) {
  let r2 = t2;
  for (; e8.has(r2, L); ) {
    let t3 = e8.get(r2, L).entity;
    if (!e8.valid(t3)) break;
    if (n2(t3)) return;
    r2 = t3;
  }
}
function fh(e8, t2, n2, r2) {
  e8.has(t2, n2) || e8.insert(t2, n2, r2);
}
function ph(e8, t2) {
  e8.has(t2, q3) || e8.insert(t2, q3, { visualType: 0, texture: 0, color: { r: 1, g: 1, b: 1, a: 1 }, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 }, fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true });
}
var mh = class {
  constructor() {
    this.map_ = /* @__PURE__ */ new Map();
  }
  get(e8) {
    return this.map_.get(e8);
  }
  set(e8, t2) {
    this.map_.set(e8, t2);
  }
  delete(e8) {
    this.map_.delete(e8);
  }
  has(e8) {
    return this.map_.has(e8);
  }
  cleanup(e8) {
    for (let [t2] of this.map_) e8.valid(t2) || this.map_.delete(t2);
  }
  ensureInit(e8, t2) {
    let n2 = this.map_.get(e8);
    return n2 || (n2 = t2(), this.map_.set(e8, n2)), n2;
  }
  clear() {
    this.map_.clear();
  }
  [Symbol.iterator]() {
    return this.map_[Symbol.iterator]();
  }
};
var hh = class {
  constructor() {
    this.name = `uiLayout`, this.profileDomain = `ui`;
  }
  build(e8) {
    it(`UINode`, K), it(`UIVisual`, q3), it(`FlexContainer`, nh);
    let t2 = e8.world, n2 = ci(e8), r2 = t2.getCppRegistry();
    sh(n2, r2);
    let i2 = { generation: 0 };
    e8.insertResource(rh, i2), t2.enableChangeTracking(K), t2.enableChangeTracking(nh);
    let a2 = -1, o2 = () => {
      let e9 = t2.anyChangedSince(K, a2) || t2.anyChangedSince(nh, a2);
      return a2 = t2.getWorldTick() - 1, e9;
    };
    e8.addSystemToSchedule(2, Wi([ta(Wu)], (e9) => {
      e9.valid && (n2?.uiLayout_update?.(r2, e9.worldLeft, e9.worldBottom, e9.worldRight, e9.worldTop, o2()), n2?.transform_update?.(r2), i2.generation++);
    }, { name: `UILayoutSystem` })), e8.addSystemToSchedule(4, Wi([ta(Wu)], (e9) => {
      e9.valid && (n2?.uiLayout_update?.(r2, e9.worldLeft, e9.worldBottom, e9.worldRight, e9.worldTop, o2()), i2.generation++);
    }, { name: `UILayoutLateSystem` }), { runAfter: [qm.ListView], runBefore: [qm.UIRenderOrder] });
  }
};
var gh = new hh();
var _h = { Scissor: 0, Stencil: 1 };
var vh = P(`UIMask`, { enabled: true, mode: _h.Scissor, alphaCutoff: 0 });
var yh = class {
  constructor() {
    this.name = Km.UIMask;
  }
  build(e8) {
    it(`UIMask`, vh);
  }
};
var bh = new yh();
var xh = k(`SafeArea`, { applyTop: true, applyBottom: true, applyLeft: true, applyRight: true });
function Sh() {
  let e8 = globalThis.wx?.getSystemInfoSync?.();
  if (!e8 || !e8.safeArea) return { top: 0, bottom: 0, left: 0, right: 0 };
  let { safeArea: t2, screenWidth: n2, screenHeight: r2 } = e8;
  return { top: t2.top, bottom: r2 - t2.bottom, left: t2.left, right: n2 - t2.right };
}
function Ch() {
  if (typeof document > `u` || typeof getComputedStyle > `u`) return { top: 0, bottom: 0, left: 0, right: 0 };
  let e8 = getComputedStyle(document.documentElement);
  return { top: parseFloat(e8.getPropertyValue(`--sat`) || `0`), bottom: parseFloat(e8.getPropertyValue(`--sab`) || `0`), left: parseFloat(e8.getPropertyValue(`--sal`) || `0`), right: parseFloat(e8.getPropertyValue(`--sar`) || `0`) };
}
function wh() {
  return gn() ? Sh() : Ch();
}
var Th = class {
  constructor() {
    this.name = Km.SafeArea, this.dependencies = [Km.UILayout], this.onResize_ = null;
  }
  cleanup() {
    this.onResize_ && typeof window < `u` && window.removeEventListener(`resize`, this.onResize_), this.onResize_ = null;
  }
  build(e8) {
    it(`SafeArea`, xh);
    let t2 = e8.world, n2 = { top: 0, bottom: 0, left: 0, right: 0 }, r2 = true, i2 = 0, a2 = 0;
    gn() ? globalThis.wx?.onWindowResize?.(() => {
      r2 = true;
    }) : typeof window < `u` && (this.onResize_ = () => {
      r2 = true;
    }, window.addEventListener(`resize`, this.onResize_)), e8.addSystemToSchedule(2, Wi([ta(Wu)], (e9) => {
      if (!e9.valid || e9.screenH === 0) return;
      let o2 = e9.worldTop - e9.worldBottom;
      (e9.screenH !== i2 || o2 !== a2) && (i2 = e9.screenH, a2 = o2, r2 = true), r2 && (r2 = false, n2 = wh());
      let s2 = ir(), c2 = gn() ? o2 / e9.screenH : s2 * o2 / e9.screenH;
      for (let e10 of t2.getEntitiesWithComponents([xh, K])) {
        let r3 = t2.get(e10, xh), i3 = t2.get(e10, K), a3 = r3.applyTop ? n2.top * c2 : 0, o3 = r3.applyBottom ? n2.bottom * c2 : 0, s3 = r3.applyLeft ? n2.left * c2 : 0, l2 = r3.applyRight ? n2.right * c2 : 0, u2 = false, d2 = (e11, t3) => {
          (i3[e11].value !== t3 || i3[e11].unit !== 0) && (i3[e11] = W2(t3), u2 = true);
        };
        d2(`insetLeft`, s3), d2(`insetBottom`, o3), d2(`insetRight`, l2), d2(`insetTop`, a3), u2 && t2.insert(e10, K, i3);
      }
    }, { name: `SafeAreaSystem` }), { runBefore: [qm.UILayout] });
  }
};
var Eh = new Th();
var Dh = class {
  constructor(e8, t2) {
    this.shelves = [], this.yCursor = 0, this.width = e8, this.height = t2;
  }
  pack(e8, t2) {
    if (e8 <= 0 || t2 <= 0 || e8 > this.width || t2 > this.height) return null;
    for (let n3 of this.shelves) if (t2 <= n3.height && n3.x + e8 <= this.width) {
      let t3 = { x: n3.x, y: n3.y };
      return n3.x += e8, t3;
    }
    if (this.yCursor + t2 > this.height) return null;
    let n2 = { x: 0, y: this.yCursor };
    return this.shelves.push({ y: this.yCursor, height: t2, x: e8 }), this.yCursor += t2, n2;
  }
  reset() {
    this.shelves = [], this.yCursor = 0;
  }
};
var Oh = class {
  constructor(e8, t2, n2 = {}) {
    this.rasterizer = e8, this.store = t2, this.contentScale_ = 1, this.generation_ = 0, this.cache = /* @__PURE__ */ new Map(), this.pages = [], this.packers = [], this.pageSize = n2.pageSize ?? 1024, this.padding = n2.padding ?? 1, this.sdf = n2.sdf ?? true, this.dpr = n2.dpr ?? 1;
  }
  get pageCount() {
    return this.pages.length;
  }
  get generation() {
    return this.generation_;
  }
  get renderSize() {
    return this.rasterizer.renderSize;
  }
  get distancePerTexel() {
    let e8 = this.rasterizer.spread;
    return this.sdf && e8 > 0 ? 0.5 / e8 : 0;
  }
  setContentScale(e8) {
    let t2 = Number.isFinite(e8) && e8 > 0 ? e8 : 1;
    t2 !== this.contentScale_ && (this.contentScale_ = t2, this.generation_++);
  }
  pixelSizeFor(e8) {
    return this.sdf ? this.renderSize : Math.max(1, Math.round(e8 * this.dpr * this.contentScale_));
  }
  key(e8, t2, n2, r2) {
    return `${t2}|${e8}|${n2 % 4}|${r2}`;
  }
  getGlyph(e8, t2, n2 = 0, r2 = this.renderSize) {
    let i2 = this.key(e8, t2, n2, r2), a2 = this.cache.get(i2);
    if (a2 !== void 0) return a2;
    let o2 = this.rasterizer.rasterize(e8, t2, n2, r2);
    if (!o2) return this.cache.set(i2, null), null;
    if (o2.width <= 0 || o2.height <= 0) {
      let e9 = { pageId: this.pages.length > 0 ? this.pages[0] : -1, u0: 0, v0: 0, u1: 0, v1: 0, width: 0, height: 0, advance: o2.advance, bearingX: o2.bearingX, bearingY: o2.bearingY };
      return this.cache.set(i2, e9), e9;
    }
    let s2 = this.place(o2.width, o2.height);
    if (!s2) return this.cache.set(i2, null), null;
    this.store.uploadSubRegion(s2.pageId, s2.x, s2.y, o2.width, o2.height, o2.pixels);
    let c2 = 1 / this.pageSize, l2 = { pageId: s2.pageId, u0: s2.x * c2, v0: s2.y * c2, u1: (s2.x + o2.width) * c2, v1: (s2.y + o2.height) * c2, width: o2.width, height: o2.height, advance: o2.advance, bearingX: o2.bearingX, bearingY: o2.bearingY };
    return this.cache.set(i2, l2), l2;
  }
  place(e8, t2) {
    let n2 = e8 + this.padding, r2 = t2 + this.padding;
    if (n2 > this.pageSize || r2 > this.pageSize) return null;
    this.packers.length === 0 && this.addPage();
    for (let e9 = 0; e9 < 2; e9++) {
      let e10 = this.packers.length - 1, t3 = this.packers[e10].pack(n2, r2);
      if (t3) return { pageId: this.pages[e10], x: t3.x, y: t3.y };
      this.addPage();
    }
    return null;
  }
  addPage() {
    let e8 = this.store.createPage(this.pageSize);
    this.pages.push(e8), this.packers.push(new Dh(this.pageSize, this.pageSize));
  }
};
function kh(e8, t2, n2, r2, i2) {
  if (!e8.sdfFromAlpha) return null;
  let a2 = n2 * r2;
  if (a2 === 0 || t2.length < a2) return null;
  let o2 = new Uint8Array(a2);
  return C(e8, (s2) => {
    let c2 = s2(a2), l2 = s2(a2);
    e8.HEAPU8.set(t2.subarray(0, a2), c2), e8.sdfFromAlpha(c2, l2, n2, r2, i2), o2.set(e8.HEAPU8.subarray(l2, l2 + a2));
  }), o2;
}
function Ah(e8, t2, n2) {
  let r2 = t2 * n2, i2 = new Uint8Array(r2);
  for (let t3 = 0; t3 < r2; t3++) i2[t3] = e8[t3 * 4 + 3];
  return i2;
}
function jh(e8, t2, n2) {
  let r2 = t2 * n2, i2 = new Uint8Array(r2 * 4);
  for (let t3 = 0; t3 < r2; t3++) {
    let n3 = t3 * 4;
    i2[n3] = 255, i2[n3 + 1] = 255, i2[n3 + 2] = 255, i2[n3 + 3] = e8[t3];
  }
  return i2;
}
function Mh(e8, t2, n2, r2) {
  if (r2 <= 1) return e8;
  let i2 = Math.floor(t2 / r2), a2 = Math.floor(n2 / r2), o2 = new Uint8Array(i2 * a2), s2 = r2 * r2;
  for (let n3 = 0; n3 < a2; n3++) for (let a3 = 0; a3 < i2; a3++) {
    let c2 = 0, l2 = n3 * r2, u2 = a3 * r2;
    for (let n4 = 0; n4 < r2; n4++) {
      let i3 = (l2 + n4) * t2 + u2;
      for (let t3 = 0; t3 < r2; t3++) c2 += e8[i3 + t3];
    }
    o2[n3 * i2 + a3] = Math.round(c2 / s2);
  }
  return o2;
}
var Nh = class {
  get spread() {
    return this.sdf ? this.pad : 0;
  }
  constructor(e8, t2 = {}) {
    this.module = e8, this.renderSize = t2.renderSize ?? 48, this.pad = t2.padding ?? 6, this.sdf = t2.sdf ?? true;
    let n2 = this.sdf ? 4 : 1, r2 = Math.ceil((this.renderSize * 2 + this.pad * 2) * n2);
    this.canvas = Tn(r2, r2), this.ctx = this.canvas.getContext(`2d`, { willReadFrequently: true });
  }
  rasterize(e8, t2, n2, r2 = this.renderSize) {
    let i2 = this.ctx;
    if (!i2) return null;
    let a2 = String.fromCodePoint(e8), o2 = this.sdf ? 4 : 1, s2 = n2 & 1 ? `bold ` : ``;
    i2.font = `${n2 & 2 ? `italic ` : ``}${s2}${r2 * o2}px ${t2}`, i2.textBaseline = `alphabetic`, i2.textAlign = `left`;
    let c2 = i2.measureText(a2), l2 = c2.width, u2 = c2.actualBoundingBoxLeft ?? 0, d2 = c2.actualBoundingBoxRight ?? l2, f2 = c2.actualBoundingBoxAscent ?? r2 * o2 * 0.8, p3 = c2.actualBoundingBoxDescent ?? r2 * o2 * 0.2, m3 = Math.ceil((u2 + d2) / o2), h3 = Math.ceil((f2 + p3) / o2);
    if (m3 <= 0 || h3 <= 0) return { pixels: new Uint8Array(), width: 0, height: 0, advance: l2 / o2, bearingX: 0, bearingY: 0 };
    let g3 = this.pad, _3 = m3 + g3 * 2, v4 = h3 + g3 * 2, y5 = _3 * o2, b5 = v4 * o2;
    if (y5 > this.canvas.width || b5 > this.canvas.height) return null;
    i2.clearRect(0, 0, y5, b5), i2.fillStyle = `#ffffff`, i2.fillText(a2, g3 * o2 + u2, g3 * o2 + f2);
    let x5 = Ah(i2.getImageData(0, 0, y5, b5).data, y5, b5), S5 = x5;
    if (this.sdf) {
      let e9 = this.module ? kh(this.module, x5, y5, b5, g3 * o2) : null;
      if (!e9) return null;
      S5 = Mh(e9, y5, b5, o2);
    }
    return { pixels: jh(S5, _3, v4), width: _3, height: v4, advance: l2 / o2, bearingX: -(u2 / o2 + g3), bearingY: f2 / o2 + g3 };
  }
};
var Ph = class {
  get spread() {
    return this.sdf ? this.pad : 0;
  }
  constructor(e8 = {}) {
    this.renderSize = e8.renderSize ?? 48, this.pad = e8.padding ?? 6, this.sdf = e8.sdf ?? true;
  }
  rasterize(e8, t2, n2, r2 = this.renderSize) {
    let i2 = On({ codepoint: e8, fontFamily: t2, style: n2, pixelSize: r2, sdf: this.sdf, padding: this.pad });
    return i2 ? { pixels: i2.pixels, width: i2.width, height: i2.height, advance: i2.advance, bearingX: i2.bearingX, bearingY: i2.bearingY } : null;
  }
};
var Fh = class {
  constructor(e8) {
    this.module = e8, this.handleByGlId = /* @__PURE__ */ new Map();
  }
  createPage(e8) {
    let t2 = new Uint8Array(e8 * e8 * 4), n2 = ee2(this.module, { width: e8, height: e8, pixels: t2 }, false, { filterMode: `linear`, wrapMode: `clamp` }), r2 = le().getTextureGLId(n2);
    return this.handleByGlId.set(r2, n2), r2;
  }
  uploadSubRegion(e8, t2, n2, r2, i2, a2) {
    let o2 = this.handleByGlId.get(e8) ?? e8;
    te2(this.module, o2, t2, n2, r2, i2, a2);
  }
};
var Ih = null;
function Rh(e8, t2, n2, r2, i2, a2, o2, s2, c2, l2 = 0) {
  let u2 = t2.length / 9 | 0;
  if (u2 <= 0 || n2.length <= 0 || i2.length < 16) return;
  if (!e8?.renderer_submitTextBatch) {
    Ih?.(t2, u2, n2, r2, i2, a2, o2, s2, c2);
    return;
  }
  let d2 = new Uint8Array(t2.buffer, t2.byteOffset, t2.byteLength), f2 = new Uint8Array(n2.buffer, n2.byteOffset, n2.byteLength), p3 = new Uint8Array(i2.buffer, i2.byteOffset, 64);
  C(e8, (t3) => {
    let i3 = t3(d2.byteLength), m3 = t3(f2.byteLength), h3 = t3(p3.byteLength);
    e8.HEAPU8.set(d2, i3), e8.HEAPU8.set(f2, m3), e8.HEAPU8.set(p3, h3), e8.renderer_submitTextBatch(i3, u2, m3, n2.length, r2, h3, a2, o2, s2, +!!c2, l2);
  });
}
var zh = /^color=(#[0-9a-fA-F]{6,8})$/;
var Bh = /^font\s+size=(?:"(\d+)"|(\d+))$/;
function Vh(e8) {
  if (e8.length !== 7 && e8.length !== 9) return null;
  let t2 = parseInt(e8.slice(1, 3), 16), n2 = parseInt(e8.slice(3, 5), 16), r2 = parseInt(e8.slice(5, 7), 16), i2 = e8.length === 9 ? parseInt(e8.slice(7, 9), 16) : 255;
  return isNaN(t2) || isNaN(n2) || isNaN(r2) || isNaN(i2) ? null : { r: t2 / 255, g: n2 / 255, b: r2 / 255, a: i2 / 255 };
}
function Hh(e8, t2, n2) {
  t2.length !== 0 && e8.push({ type: `text`, text: t2, bold: n2.bold, italic: n2.italic, color: n2.color, fontSize: n2.fontSize });
}
var Uh = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;
var Wh = /* @__PURE__ */ new Set([`baseline`, `middle`, `top`, `bottom`]);
function Gh(e8) {
  let t2 = /* @__PURE__ */ new Map(), n2;
  for (Uh.lastIndex = 0; (n2 = Uh.exec(e8)) !== null; ) t2.set(n2[1], n2[2] ?? n2[3]);
  let r2 = t2.get(`src`);
  if (!r2) return null;
  let i2 = parseInt(t2.get(`width`) ?? `0`, 10), a2 = parseInt(t2.get(`height`) ?? `0`, 10), o2 = t2.get(`valign`), s2 = o2 && Wh.has(o2) ? o2 : `baseline`, c2 = parseFloat(t2.get(`offsetX`) ?? `0`), l2 = parseFloat(t2.get(`offsetY`) ?? `0`), u2 = parseFloat(t2.get(`scale`) ?? `1`), d2 = t2.get(`tint`), f2 = d2 ? Vh(d2) : null;
  return { type: `image`, src: r2, width: isNaN(i2) ? 0 : i2, height: isNaN(a2) ? 0 : a2, valign: s2, offsetX: isNaN(c2) ? 0 : c2, offsetY: isNaN(l2) ? 0 : l2, scale: isNaN(u2) || u2 <= 0 ? 1 : u2, tint: f2 };
}
function Kh(e8) {
  let t2 = [];
  if (!e8) return t2;
  let n2 = [{ bold: false, italic: false, color: null, fontSize: null }], r2 = ``, i2 = 0;
  for (; i2 < e8.length; ) {
    if (e8[i2] !== `<`) {
      r2 += e8[i2], i2++;
      continue;
    }
    let a2 = e8.indexOf(`>`, i2 + 1);
    if (a2 === -1) {
      r2 += e8[i2], i2++;
      continue;
    }
    let o2 = e8.slice(i2 + 1, a2), s2 = n2[n2.length - 1];
    if (o2 === `b`) Hh(t2, r2, s2), r2 = ``, n2.push({ ...s2, bold: true });
    else if (o2 === `i`) Hh(t2, r2, s2), r2 = ``, n2.push({ ...s2, italic: true });
    else if (o2 === `/b` || o2 === `/i` || o2 === `/color` || o2 === `/font`) Hh(t2, r2, s2), r2 = ``, n2.length > 1 && n2.pop();
    else if (o2.startsWith(`img `) && o2.endsWith(`/`)) {
      let n3 = Gh(o2.slice(0, -1));
      if (n3) Hh(t2, r2, s2), r2 = ``, t2.push(n3);
      else {
        r2 += e8.slice(i2, a2 + 1), i2 = a2 + 1;
        continue;
      }
    } else {
      let c2 = o2.match(zh), l2 = c2 ? Vh(c2[1]) : null, u2 = o2.match(Bh), d2 = u2 ? parseInt(u2[1] ?? u2[2], 10) : NaN;
      if (l2) Hh(t2, r2, s2), r2 = ``, n2.push({ ...s2, color: l2 });
      else if (!isNaN(d2) && d2 > 0) Hh(t2, r2, s2), r2 = ``, n2.push({ ...s2, fontSize: d2 });
      else {
        r2 += e8.slice(i2, a2 + 1), i2 = a2 + 1;
        continue;
      }
    }
    i2 = a2 + 1;
  }
  return Hh(t2, r2, n2[n2.length - 1]), t2;
}
function qh(e8, t2, n2, r2) {
  let { x: i2, y: a2, z: o2, w: s2 } = n2, c2 = i2 + i2, l2 = a2 + a2, u2 = o2 + o2, d2 = i2 * c2, f2 = i2 * l2, p3 = i2 * u2, m3 = a2 * l2, h3 = a2 * u2, g3 = o2 * u2, _3 = s2 * c2, v4 = s2 * l2, y5 = s2 * u2, b5 = r2.x, x5 = r2.y, S5 = r2.z;
  return e8[0] = (1 - (m3 + g3)) * b5, e8[1] = (f2 + y5) * b5, e8[2] = (p3 - v4) * b5, e8[3] = 0, e8[4] = (f2 - y5) * x5, e8[5] = (1 - (d2 + g3)) * x5, e8[6] = (h3 + _3) * x5, e8[7] = 0, e8[8] = (p3 + v4) * S5, e8[9] = (h3 - _3) * S5, e8[10] = (1 - (d2 + m3)) * S5, e8[11] = 0, e8[12] = t2.x, e8[13] = t2.y, e8[14] = t2.z, e8[15] = 1, e8;
}
function Jh(e8, t2, n2, r2, i2) {
  return { originX: -e8 * n2, originY: (1 - t2) * r2 - i2 * 0.8, maxWidth: n2, boxHeight: r2 };
}
function Yh(e8, t2, n2, r2, i2 = 0) {
  let a2 = t2.pixelSizeFor(r2.fontSizePx), o2 = r2.fontSizePx / a2, s2 = r2.letterSpacing ?? 0, c2 = [], l2 = 0;
  for (let r3 of e8) {
    let e9 = r3.codePointAt(0);
    if (e9 === void 0) continue;
    let u2 = t2.getGlyph(e9, n2, i2, a2);
    if (u2) {
      if (u2.width > 0 && u2.height > 0) {
        let e10 = l2 + u2.bearingX * o2, t3 = u2.bearingY * o2, n3 = e10 + u2.width * o2, r4 = t3 - u2.height * o2;
        c2.push({ u0: u2.u0, v0: u2.v0, u1: u2.u1, v1: u2.v1, x0: e10, y0: r4, x1: n3, y1: t3, pageId: u2.pageId });
      }
      l2 += u2.advance * o2 + s2;
    }
  }
  return { glyphs: c2, width: l2, lineHeight: r2.fontSizePx };
}
function Xh(e8, t2, n2 = 0, r2 = 0, i2 = 0) {
  let a2 = e8.length, o2 = new Float32Array(a2 * 4 * 9), s2 = new Uint16Array(a2 * 6);
  for (let c2 = 0; c2 < a2; c2++) {
    let a3 = e8[c2], [l2, u2, d2, f2] = a3.color ?? t2, p3 = a3.x0 + n2, m3 = a3.x1 + n2, h3 = a3.y0 + r2, g3 = a3.y1 + r2, _3 = c2 * 4 * 9;
    Zh(o2, _3 + 0, p3, h3, a3.u0, a3.v1, l2, u2, d2, f2, i2), Zh(o2, _3 + 9, m3, h3, a3.u1, a3.v1, l2, u2, d2, f2, i2), Zh(o2, _3 + 18, m3, g3, a3.u1, a3.v0, l2, u2, d2, f2, i2), Zh(o2, _3 + 27, p3, g3, a3.u0, a3.v0, l2, u2, d2, f2, i2);
    let v4 = c2 * 6, y5 = c2 * 4;
    s2[v4] = y5, s2[v4 + 1] = y5 + 1, s2[v4 + 2] = y5 + 2, s2[v4 + 3] = y5, s2[v4 + 4] = y5 + 2, s2[v4 + 5] = y5 + 3;
  }
  return { vertices: o2, indices: s2 };
}
function Zh(e8, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2) {
  e8[t2] = n2, e8[t2 + 1] = r2, e8[t2 + 2] = i2, e8[t2 + 3] = a2, e8[t2 + 4] = o2, e8[t2 + 5] = s2, e8[t2 + 6] = c2, e8[t2 + 7] = l2, e8[t2 + 8] = u2;
}
function Qh(e8, t2, n2, r2) {
  if (n2 <= 0 || t2(e8) <= n2) return e8;
  let i2 = r2 ? `\u2026` : ``, a2 = [...e8];
  for (; a2.length > 0; ) {
    a2.pop();
    let e9 = a2.join(``).trimEnd();
    if (t2(e9 + i2) <= n2) return e9 + i2;
  }
  return i2;
}
function $h(e8, t2, n2, r2, i2, a2 = 0) {
  let o2 = t2.pixelSizeFor(r2), s2 = r2 / o2, c2 = 0;
  for (let r3 of e8) {
    let e9 = r3.codePointAt(0);
    if (e9 === void 0) continue;
    let l2 = t2.getGlyph(e9, n2, i2, o2);
    l2 && (c2 += l2.advance * s2 + a2);
  }
  return c2;
}
function eg(e8, t2, n2) {
  let r2 = [], i2 = ``, a2 = () => {
    let e9 = i2.replace(/\s+$/, ``);
    e9 && r2.push(e9), i2 = ``;
  }, o2 = (e9) => {
    for (let r3 of e9) i2 && t2(i2 + r3) > n2 && a2(), i2 += r3;
  };
  for (let r3 of e8.split(/(\s+)/)) if (r3 !== ``) {
    if (/^\s+$/.test(r3)) {
      i2 && (i2 += r3);
      continue;
    }
    i2 ? t2(i2 + r3) <= n2 ? i2 += r3 : (a2(), t2(r3) <= n2 ? i2 = r3 : o2(r3)) : t2(r3) <= n2 ? i2 = r3 : o2(r3);
  }
  return a2(), r2.length ? r2 : [``];
}
function tg(e8, t2, n2, r2, i2, a2, o2 = 0) {
  return eg(e8, (e9) => $h(e9, t2, n2, r2, i2, o2), a2);
}
function ng(e8, t2, n2, r2, i2 = 0) {
  let a2 = r2.lineHeight ?? r2.fontSizePx * 1.2, o2 = r2.align ?? 0, s2 = r2.color ?? [1, 1, 1, 1], c2 = e8.split(`
`), l2 = !!(r2.maxWidth && r2.maxWidth > 0), u2 = { fontSizePx: r2.fontSizePx, letterSpacing: r2.letterSpacing, color: s2 }, d2 = r2.overflow ?? 0, f2 = r2.boxHeight ?? 0, p3 = d2 !== 0 && f2 > 0 ? Math.max(1, Math.floor(f2 / a2)) : 1 / 0, m3 = d2 === 2, h3 = d2 === 0 ? 0 : r2.maxWidth && r2.maxWidth > 0 ? r2.maxWidth : r2.boxWidth ?? 0, g3;
  if (r2.rich) {
    let e9 = c2.map((e10) => Kh(e10)).flatMap((e10) => l2 ? ig(e10.filter((e11) => e11.type === `text`), t2, n2, r2.fontSizePx, i2, r2.maxWidth, r2.letterSpacing ?? 0) : [e10]), a3 = e9.slice(0, p3 === 1 / 0 ? void 0 : p3);
    m3 && a3.length < e9.length && a3.length > 0 && (a3[a3.length - 1] = [...a3[a3.length - 1], { type: `text`, text: `\u2026` }]), g3 = a3.map((e10) => og(e10, t2, n2, u2, i2));
  } else {
    let e9 = l2 ? c2.flatMap((e10) => tg(e10, t2, n2, r2.fontSizePx, i2, r2.maxWidth, r2.letterSpacing ?? 0)) : c2, a3 = e9.slice(0, p3 === 1 / 0 ? void 0 : p3), o3 = a3.length < e9.length, s3 = (e10) => $h(e10, t2, n2, r2.fontSizePx, i2, r2.letterSpacing ?? 0);
    g3 = a3.map((e10, t3) => {
      let n3 = t3 === a3.length - 1;
      return o3 && n3 && m3 ? Qh(e10 + `\u2026`, s3, h3 || 1 / 0, true) : h3 > 0 ? Qh(e10, s3, h3, m3) : e10;
    }).map((e10) => Yh(e10, t2, n2, r2, i2));
  }
  let _3 = g3, v4 = g3.reduce((e9, t3) => Math.max(e9, t3.width), 0), y5 = r2.boxWidth && r2.boxWidth > 0 ? r2.boxWidth : r2.maxWidth && r2.maxWidth > 0 ? r2.maxWidth : v4, b5 = [], x5 = [];
  for (let e9 = 0; e9 < g3.length; e9++) {
    let t3 = g3[e9], n3 = o2 === 1 ? (y5 - t3.width) / 2 : o2 === 2 ? y5 - t3.width : 0, r3 = -e9 * a2;
    for (let e10 of t3.glyphs) b5.push({ ...e10, x0: e10.x0 + n3, x1: e10.x1 + n3, y0: e10.y0 + r3, y1: e10.y1 + r3 });
    if (t3.images) for (let e10 of t3.images) x5.push({ ...e10, x: e10.x + n3, y: e10.y + r3 });
  }
  return { glyphs: b5, images: x5, width: v4, lineHeight: _3.length * a2 };
}
function rg(e8, t2, n2, r2, i2, a2, o2) {
  let s2 = t2.fontSize ?? i2, c2 = n2.pixelSizeFor(s2), l2 = s2 / c2, u2 = a2 | +!!t2.bold | (t2.italic ? 2 : 0), d2 = 0;
  for (let t3 of e8) {
    let e9 = t3.codePointAt(0);
    if (e9 === void 0) continue;
    let i3 = n2.getGlyph(e9, r2, u2, c2);
    i3 && (d2 += i3.advance * l2 + o2);
  }
  return d2;
}
function ig(e8, t2, n2, r2, i2, a2, o2 = 0) {
  let s2 = [];
  for (let t3 of e8) for (let e9 of t3.text.split(/(\s+)/)) e9 !== `` && s2.push({ run: t3, text: e9, space: /^\s+$/.test(e9) });
  let c2 = [], l2 = [], u2 = 0, d2 = (e9) => rg(e9.text, e9.run, t2, n2, r2, i2, o2), f2 = () => {
    for (; l2.length > 0 && l2[l2.length - 1].space; ) l2.pop();
    let e9 = [];
    for (let t3 of l2) {
      let n3 = e9[e9.length - 1];
      n3 && n3.bold === t3.run.bold && n3.italic === t3.run.italic && n3.color === t3.run.color && n3.fontSize === t3.run.fontSize ? n3.text += t3.text : e9.push({ ...t3.run, text: t3.text });
    }
    e9.length > 0 && c2.push(e9), l2 = [], u2 = 0;
  }, p3 = (e9) => {
    l2.push(e9), u2 += d2(e9);
  }, m3 = (e9) => {
    for (let s3 of e9.text) {
      let c3 = rg(s3, e9.run, t2, n2, r2, i2, o2);
      l2.length > 0 && u2 + c3 > a2 && f2(), p3({ run: e9.run, text: s3, space: false });
    }
  };
  for (let e9 of s2) {
    if (e9.space) {
      l2.length > 0 && p3(e9);
      continue;
    }
    let t3 = d2(e9);
    l2.length === 0 ? t3 <= a2 ? p3(e9) : m3(e9) : u2 + t3 <= a2 ? p3(e9) : (f2(), t3 <= a2 ? p3(e9) : m3(e9));
  }
  return f2(), c2.length ? c2 : [[]];
}
function ag(e8, t2, n2) {
  let r2 = e8.width * e8.scale, i2 = e8.height * e8.scale, a2 = n2 * 0.8, o2 = n2 * 0.2, s2;
  switch (e8.valign) {
    case `top`:
      s2 = a2 - i2;
      break;
    case `bottom`:
      s2 = -o2;
      break;
    case `middle`:
      s2 = (a2 - o2) / 2 - i2 / 2;
      break;
    default:
      s2 = 0;
  }
  return { src: e8.src, x: t2 + e8.offsetX, y: s2 + e8.offsetY, w: r2, h: i2, tint: e8.tint ? [e8.tint.r, e8.tint.g, e8.tint.b, e8.tint.a] : null };
}
function og(e8, t2, n2, r2, i2 = 0) {
  let a2 = r2.letterSpacing ?? 0, o2 = [], s2 = [], c2 = 0, l2 = r2.fontSizePx;
  for (let u2 of e8) {
    if (u2.type === `image`) {
      let e10 = ag(u2, c2, r2.fontSizePx);
      s2.push(e10), e10.h > l2 && (l2 = e10.h), c2 += u2.width * u2.scale;
      continue;
    }
    let e9 = u2.fontSize ?? r2.fontSizePx, d2 = t2.pixelSizeFor(e9), f2 = e9 / d2, p3 = i2 | +!!u2.bold | (u2.italic ? 2 : 0), m3 = u2.color ? [u2.color.r, u2.color.g, u2.color.b, u2.color.a] : r2.color;
    e9 > l2 && (l2 = e9);
    for (let e10 of u2.text) {
      let r3 = e10.codePointAt(0);
      if (r3 === void 0) continue;
      let i3 = t2.getGlyph(r3, n2, p3, d2);
      if (i3) {
        if (i3.width > 0 && i3.height > 0) {
          let e11 = c2 + i3.bearingX * f2, t3 = i3.bearingY * f2;
          o2.push({ u0: i3.u0, v0: i3.v0, u1: i3.u1, v1: i3.v1, x0: e11, y0: t3 - i3.height * f2, x1: e11 + i3.width * f2, y1: t3, pageId: i3.pageId, color: m3 });
        }
        c2 += i3.advance * f2 + a2;
      }
    }
  }
  return { glyphs: o2, images: s2, width: c2, lineHeight: l2 };
}
var sg = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function cg(e8, t2, n2) {
  let r2 = e8.distancePerTexel;
  return r2 <= 0 || t2 <= 0 ? 0 : n2 * (e8.renderSize / t2) * r2;
}
var lg = [[0, 0, 0], [-0.55, -0.55, 1], [0, -0.78, 1], [0.55, -0.55, 1], [-0.78, 0, 1], [0.78, 0, 1], [-0.55, 0.55, 1], [0, 0.78, 1], [0.55, 0.55, 1]];
function ug(e8, t2) {
  return t2 <= 1 ? e8 : 1 - (1 - Math.min(1, Math.max(0, e8))) ** (1 / t2);
}
function dg(e8, t2, n2) {
  return t2 > 0 || !e8 ? 0 : -(e8 === 1 ? n2 / 2 : n2);
}
function fg(e8, t2, n2, r2, i2, a2) {
  let o2 = e8;
  if (t2 <= 0 && (o2 -= r2 * 0.8), i2) {
    let e9 = t2 - n2;
    o2 -= i2 === 1 ? e9 / 2 : e9;
  }
  return o2 - Math.max(0, ((a2 ?? r2 * 1.2) - r2) / 2);
}
function pg(e8, t2, n2) {
  let r2 = ng(n2.text, e8, n2.fontFamily, { fontSizePx: n2.fontSizePx, letterSpacing: n2.letterSpacing, lineHeight: n2.lineHeight, align: n2.align, rich: n2.richText, color: n2.color, maxWidth: n2.maxWidth, boxWidth: n2.boxWidth, boxHeight: n2.boxHeight, overflow: n2.overflow }, n2.style ?? 0);
  if (r2.glyphs.length === 0) return;
  let i2 = n2.boxHeight ?? 0, a2 = n2.boxWidth ?? 0, o2 = fg(n2.originY ?? 0, i2, r2.lineHeight, n2.fontSizePx, n2.verticalAlign, n2.lineHeight), s2 = /* @__PURE__ */ new Map();
  for (let e9 of r2.glyphs) {
    let t3 = s2.get(e9.pageId);
    t3 || (t3 = [], s2.set(e9.pageId, t3)), t3.push(e9);
  }
  let c2 = (n2.originX ?? 0) + dg(n2.align, a2, r2.width), l2 = (e9, n3, r3, i3 = 0) => {
    for (let [a3, l3] of s2) {
      let { vertices: s3, indices: u2 } = Xh(l3, e9, c2 + n3, o2 + r3, i3);
      t2(s3, u2, a3);
    }
  };
  if (n2.shadow && n2.shadow.color[3] > 0) {
    let { color: e9, dx: t3, dy: r3 } = n2.shadow, i3 = n2.shadow.blur ?? 0;
    if (i3 > 0) {
      let n3 = ug(e9[3], lg.length), a3 = [e9[0], e9[1], e9[2], n3];
      for (let [e10, n4, o3] of lg) l2(a3, t3 + e10 * i3 * o3, -r3 + n4 * i3 * o3);
    } else l2(e9, t3, -r3);
  }
  if (n2.outline && n2.outline.width > 0 && n2.outline.color[3] > 0) {
    let t3 = n2.outline.width, r3 = cg(e8, n2.fontSizePx, t3);
    if (r3 > 0) l2(n2.outline.color, 0, 0, r3);
    else for (let [e9, r4] of sg) l2(n2.outline.color, e9 * t3, r4 * t3);
  }
  l2(n2.color, 0, 0);
}
var mg = class {
  constructor(e8, t2 = {}) {
    this.module = e8, this.cache_ = /* @__PURE__ */ new Map(), this.sdf = t2.sdf ?? true;
    let n2 = Dn() ? new Ph({ renderSize: t2.renderSize, padding: t2.padding, sdf: this.sdf }) : new Nh(e8, t2);
    this.atlas = new Oh(n2, new Fh(e8), { pageSize: t2.pageSize, sdf: this.sdf, dpr: t2.dpr });
  }
  setContentScale(e8) {
    this.atlas.setContentScale(e8);
  }
  drawText(e8, t2, n2, r2, i2, a2 = 0) {
    let o2 = this.atlas.generation, s2 = hg(e8), c2 = this.cache_.get(n2);
    if (!c2 || c2.gen !== o2 || c2.sig !== s2) {
      let t3 = [];
      pg(this.atlas, (e9, n3, r3) => {
        t3.push({ vertices: e9, indices: n3, pageId: r3 });
      }, e8), c2 = { sig: s2, gen: o2, batches: t3 }, this.cache_.set(n2, c2);
    }
    for (let e9 of c2.batches) Rh(this.module, e9.vertices, e9.indices, e9.pageId, t2, n2, r2, i2, this.sdf, a2);
  }
  retainOnly(e8) {
    if (this.cache_.size !== 0) for (let t2 of this.cache_.keys()) e8.has(t2) || this.cache_.delete(t2);
  }
};
function hg(e8) {
  let t2 = e8.shadow ? `${e8.shadow.color.join(`,`)}:${e8.shadow.dx}:${e8.shadow.dy}:${e8.shadow.blur ?? 0}` : ``, n2 = e8.outline ? `${e8.outline.color.join(`,`)}:${e8.outline.width}` : ``;
  return [e8.text, e8.fontFamily, e8.fontSizePx, e8.style ?? 0, +!!e8.richText, e8.align ?? 0, e8.verticalAlign ?? 0, e8.lineHeight ?? 0, e8.letterSpacing ?? 0, e8.maxWidth ?? 0, e8.boxWidth ?? 0, e8.boxHeight ?? 0, e8.originX ?? 0, e8.originY ?? 0, e8.color.join(`,`), t2, n2].join(`|`);
}
var gg = { Left: 0, Center: 1, Right: 2 };
var _g = { Top: 0, Middle: 1, Bottom: 2 };
var vg = { Visible: 0, Clip: 1, Ellipsis: 2 };
var yg = { Auto: 0, Bitmap: 1, Sdf: 2 };
var bg = k(`Text`, { content: ``, i18nKey: ``, font: 0, fontFamily: `Arial`, fontSize: 24, color: { r: 1, g: 1, b: 1, a: 1 }, align: gg.Left, verticalAlign: _g.Top, wordWrap: true, overflow: vg.Visible, lineHeight: 1.2, bold: false, italic: false, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidth: 0, shadowColor: { r: 0, g: 0, b: 0, a: 1 }, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, richText: false, renderMode: yg.Auto, layer: 0, enabled: true }, { renderableField: `enabled`, assetFields: [{ field: `font`, type: `font` }], fields: { font: { label: `Font`, tooltip: `A font file this project ships (.ttf / .otf). Overrides Font Family when set; leave empty to use a font the host already has.` }, fontFamily: { tooltip: `A font the HOST already has (system or page-loaded). Ignored when Font is set.` }, i18nKey: { label: `I18n Key`, enumSource: `localeKeys`, tooltip: `Localization key \u2014 when set, content is resolved from the Localization catalogs (and re-resolved on locale switch). Leave empty for plain text.` }, align: { enum: Ge(gg), tooltip: `Horizontal alignment: within the layout box when the entity has a UINode, else it anchors the text to the entity origin (left/center/right edge).` }, verticalAlign: { enum: Ge(_g), tooltip: `Vertical alignment: within the layout box when the entity has a UINode, else it anchors the text to the entity origin (top/middle/bottom).` }, overflow: { enum: Ge(vg), tooltip: `What text too big for its box does. Needs a layout box: Clip and Ellipsis drop the lines past its height and trim a line past its width.` }, renderMode: { enum: Ge(yg) }, layer: { tooltip: `Draw layer for a text standing in the WORLD (no UINode) \u2014 read like Sprite/ShapeRenderer layer, so a label can sit in front of the content around it. Ignored inside a Canvas, where the UI render order decides.` } } });
function xg(e8, t2) {
  let n2 = 0;
  for (let r2 of e8.getEntitiesWithComponents([bg])) {
    let i2 = r2, a2 = e8.get(i2, bg);
    if (!a2.i18nKey) continue;
    let o2 = t2.t(a2.i18nKey);
    o2 !== a2.content && (a2.content = o2, e8.insert(i2, bg, a2), n2++);
  }
  return n2;
}
var Sg = 1e3;
function Cg(e8, t2) {
  return e8 === yg.Bitmap ? `bitmap` : e8 === yg.Sdf ? `sdf` : !Number.isFinite(t2) || t2 <= 0 || Math.abs(t2 - 1) <= 0.02 ? `bitmap` : `sdf`;
}
function wg(e8, t2) {
  if (!e8?.valid || !(t2 > 0)) return 1;
  let n2 = e8.viewProjection?.[0] ?? 0, r2 = e8.worldRight - e8.worldLeft, i2 = n2 === 0 ? r2 : Math.abs(2 / n2);
  return i2 > 0 ? e8.vpW / (i2 * t2) : 1;
}
var Tg = class {
  constructor() {
    this.name = `text`, this.bitmapRenderer_ = null, this.sdfRenderer_ = null, this.matrix_ = new Float32Array(16);
  }
  build(e8) {
    it(`Text`, bg);
    let t2 = e8.world;
    e8.addSystemToSchedule(2, Wi([], () => {
      for (let e9 of t2.getEntitiesWithComponents([bg, K])) ph(t2, e9);
    }, { name: `TextRenderNodeSystem` })), e8.addSystemToSchedule(2, Wi([], () => {
      e8.hasResource(Lc) && xg(t2, e8.getResource(Lc));
    }, { name: `TextLocalizeSystem` }));
    let n2 = e8.pipeline;
    if (!n2) return;
    let r2 = t2.getCppRegistry();
    n2.addPreFlushCallback(() => {
      let n3 = ci(e8), i2 = wg(e8.getResource(Wu), ir()), a2 = /* @__PURE__ */ new Set();
      for (let o2 of t2.getEntitiesWithComponents([bg, I])) {
        let s2 = o2, c2 = t2.get(s2, bg);
        if (!c2.content || c2.enabled === false || n3?.getUINodeHiddenInTree?.(r2, s2)) continue;
        let l2 = n3?.getUINodeAlphaInTree?.(r2, s2) ?? 1;
        a2.add(s2);
        let u2 = t2.get(s2, I), d2 = this.rendererFor(e8, Cg(c2.renderMode, u2.worldScale.x), i2);
        qh(this.matrix_, u2.worldPosition, u2.worldRotation, u2.worldScale);
        let f2 = !!c2.bold | (c2.italic ? 2 : 0), p3 = c2.lineHeight > 0 ? c2.lineHeight * c2.fontSize : void 0, m3, h3, g3, _3, v4, y5 = c2.layer | 0, b5 = 0, x5 = 0, C5 = false;
        if (t2.has(s2, K) && (b5 = lh(s2), x5 = uh(s2), C5 = b5 > 0 || x5 > 0), C5) {
          let e9 = Jh(0.5, 0.5, b5, x5, c2.fontSize);
          m3 = e9.originX, h3 = e9.originY, _3 = e9.maxWidth, v4 = e9.boxHeight, c2.wordWrap && (g3 = e9.maxWidth);
          let t3 = n3?.ui_getRenderOrder?.(r2, s2) ?? -1;
          y5 = t3 >= 0 ? Sg + t3 : Sg;
        }
        let ee4 = c2.shadowColor.a > 0 && (c2.shadowOffsetX !== 0 || c2.shadowOffsetY !== 0 || c2.shadowBlur > 0) ? { color: [c2.shadowColor.r, c2.shadowColor.g, c2.shadowColor.b, c2.shadowColor.a], dx: c2.shadowOffsetX, dy: c2.shadowOffsetY, blur: c2.shadowBlur } : void 0, w5 = c2.strokeWidth > 0 && c2.strokeColor.a > 0 ? { color: [c2.strokeColor.r, c2.strokeColor.g, c2.strokeColor.b, c2.strokeColor.a], width: c2.strokeWidth } : void 0;
        d2.drawText({ text: c2.content, fontFamily: Na(c2.font, c2.fontFamily), fontSizePx: c2.fontSize, color: [c2.color.r, c2.color.g, c2.color.b, c2.color.a * l2], style: f2, richText: c2.richText, align: c2.align, verticalAlign: c2.verticalAlign, lineHeight: p3, maxWidth: g3, boxWidth: _3, boxHeight: v4, overflow: c2.overflow, originX: m3, originY: h3, shadow: ee4, outline: w5 }, this.matrix_, s2, y5, u2.worldPosition.z, n3?.ui_getCullBit?.(r2, s2) ?? 0);
      }
      this.bitmapRenderer_?.retainOnly(a2), this.sdfRenderer_?.retainOnly(a2);
    });
  }
  rendererFor(e8, t2, n2) {
    let r2 = e8.wasmModule;
    if (t2 === `sdf`) return this.sdfRenderer_ ||= new mg(r2, { sdf: true }), this.sdfRenderer_;
    if (!this.bitmapRenderer_) {
      let e9 = ir();
      this.bitmapRenderer_ = new mg(r2, { sdf: false, dpr: e9, renderSize: Math.round(64 * e9) });
    }
    return this.bitmapRenderer_.setContentScale(n2), this.bitmapRenderer_;
  }
};
var Eg = new Tg();
function Dg() {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, worldPosition: { x: 0, y: 0, z: 0 }, worldRotation: { w: 1, x: 0, y: 0, z: 0 }, worldScale: { x: 1, y: 1, z: 1 } };
}
function Og(e8 = {}) {
  let t2 = e8.fill ?? false;
  return { position: e8.position ?? +!!t2, display: 0, opacity: e8.opacity ?? 1, pointerEvents: e8.pointerEvents ?? 0, width: e8.width ?? G3(), height: e8.height ?? G3(), minWidth: G3(), minHeight: G3(), maxWidth: G3(), maxHeight: G3(), flexGrow: e8.flexGrow ?? 0, flexShrink: e8.flexShrink ?? 1, flexBasis: G3(), alignSelf: 0, marginLeft: e8.marginLeft ?? W2(0), marginTop: e8.marginTop ?? W2(0), marginRight: e8.marginRight ?? W2(0), marginBottom: e8.marginBottom ?? W2(0), insetLeft: e8.insetLeft ?? (t2 ? W2(0) : G3()), insetTop: e8.insetTop ?? (t2 ? W2(0) : G3()), insetRight: e8.insetRight ?? (t2 ? W2(0) : G3()), insetBottom: e8.insetBottom ?? (t2 ? W2(0) : G3()) };
}
function kg(e8 = {}) {
  return { visualType: e8.visualType ?? 1, texture: e8.texture ?? 0, color: e8.color ?? { r: 1, g: 1, b: 1, a: 1 }, fit: e8.fit ?? 0, uvOffset: e8.uvOffset ?? { x: 0, y: 0 }, uvScale: e8.uvScale ?? { x: 1, y: 1 }, sliceBorder: e8.sliceBorder ?? { x: 0, y: 0, z: 0, w: 0 }, tileSize: e8.tileSize ?? { x: 32, y: 32 }, fillMethod: e8.fillMethod ?? 0, fillOrigin: e8.fillOrigin ?? 0, fillAmount: e8.fillAmount ?? 1, material: e8.material ?? 0, enabled: e8.enabled ?? true };
}
function jg(e8 = {}) {
  return { content: e8.content ?? ``, i18nKey: e8.i18nKey ?? ``, font: e8.font ?? 0, fontFamily: e8.fontFamily ?? `Arial`, fontSize: e8.fontSize ?? 14, color: e8.color ?? { r: 1, g: 1, b: 1, a: 1 }, align: e8.align ?? gg.Center, verticalAlign: e8.verticalAlign ?? _g.Middle, wordWrap: e8.wordWrap ?? false, overflow: e8.overflow ?? 0, lineHeight: e8.lineHeight ?? 1.2, bold: e8.bold ?? false, italic: e8.italic ?? false, strokeColor: e8.strokeColor ?? { r: 0, g: 0, b: 0, a: 1 }, strokeWidth: e8.strokeWidth ?? 0, shadowColor: e8.shadowColor ?? { r: 0, g: 0, b: 0, a: 1 }, shadowBlur: e8.shadowBlur ?? 0, shadowOffsetX: e8.shadowOffsetX ?? 0, shadowOffsetY: e8.shadowOffsetY ?? 0, richText: e8.richText ?? false, renderMode: e8.renderMode ?? yg.Auto, layer: e8.layer ?? 0, enabled: e8.enabled ?? true };
}
function J3(e8) {
  let { world: t2 } = e8, n2 = t2.spawn();
  return t2.insert(n2, I, Dg()), t2.insert(n2, K, Og(e8.node)), e8.visual && t2.insert(n2, q3, kg(e8.visual)), e8.text && t2.insert(n2, bg, jg(e8.text)), e8.parent !== void 0 && t2.setParent(n2, e8.parent), n2;
}
function Mg(e8, t2, n2) {
  if (!e8.valid(t2) || !e8.has(t2, q3)) return;
  let r2 = e8.get(t2, q3);
  r2.enabled !== n2 && (r2.enabled = n2, e8.insert(t2, q3, r2));
}
var Ng = { r: 1, g: 1, b: 1, a: 1 };
var Pg = new class {
  constructor() {
    this.name = `ui-inline-image`, this.profileDomain = `ui`, this.cleanup_ = null;
  }
  cleanup() {
    this.cleanup_?.(), this.cleanup_ = null;
  }
  build(e8) {
    if (!e8.pipeline) return;
    let t2 = e8.wasmModule, r2 = e8.world, i2 = null, a2 = () => (i2 ??= new mg(t2)).atlas, o2 = /* @__PURE__ */ new Map(), s2 = /* @__PURE__ */ new Map(), c2 = /* @__PURE__ */ new Set(), l2 = (t3) => {
      let r3 = s2.get(t3);
      return r3 === void 0 ? (!c2.has(t3) && e8.hasResource(U4) && (c2.add(t3), e8.getResource(U4).loadTexture(t3).then((e9) => s2.set(t3, e9.handle)).catch((e9) => {
        s2.set(t3, 0), T.warn(`ui`, `inline image failed to load: ${t3}`, e9);
      })), null) : r3 === 0 ? null : r3;
    }, u2 = (e9) => {
      for (let t3 of e9) r2.valid(t3) && r2.despawn(t3);
    };
    e8.addSystemToSchedule(2, Wi([], () => {
      let e9 = /* @__PURE__ */ new Set();
      for (let t3 of r2.getEntitiesWithComponents([bg, K])) {
        let n2 = r2.get(t3, bg);
        if (!n2.richText || n2.enabled === false || !n2.content || !n2.content.includes(`<img`)) continue;
        let i3 = lh(t3), o3 = uh(t3);
        if (i3 <= 0 || o3 <= 0) continue;
        let s3 = Jh(0.5, 0.5, i3, o3, n2.fontSize), c3 = !!n2.bold | (n2.italic ? 2 : 0), l3 = ng(n2.content, a2(), Na(n2.font, n2.fontFamily), { fontSizePx: n2.fontSize, lineHeight: n2.lineHeight > 0 ? n2.lineHeight * n2.fontSize : void 0, align: n2.align, rich: true, color: [1, 1, 1, 1], maxWidth: n2.wordWrap ? s3.maxWidth : void 0, boxWidth: s3.maxWidth }, c3), u3 = l3.images ?? [];
        if (u3.length === 0) {
          d2(t3);
          continue;
        }
        e9.add(t3);
        let p4 = o3 - l3.lineHeight, m3 = n2.lineHeight > 0 ? n2.lineHeight * n2.fontSize : n2.fontSize * 1.2;
        f2(t3, n2, u3, Math.max(0, (m3 - n2.fontSize) / 2) + (n2.verticalAlign === _g.Middle ? p4 / 2 : n2.verticalAlign === _g.Bottom ? p4 : 0));
      }
      for (let [t3, n2] of o2) e9.has(t3) || (u2(n2), o2.delete(t3));
    }, { name: `InlineImageSystem` }));
    function d2(e9) {
      let t3 = o2.get(e9);
      t3 && (u2(t3), o2.delete(e9));
    }
    function f2(e9, t3, n2, i3) {
      let a3 = o2.get(e9);
      for (a3 || (a3 = [], o2.set(e9, a3)); a3.length < n2.length; ) a3.push(J3({ world: r2, parent: e9, node: { position: 1, insetLeft: W2(0), insetTop: W2(0), width: W2(0), height: W2(0) }, visual: { visualType: 2, texture: 0, color: { ...Ng }, enabled: false } }));
      for (; a3.length > n2.length; ) {
        let e10 = a3.pop();
        r2.valid(e10) && r2.despawn(e10);
      }
      let s3 = t3.fontSize * 0.8;
      for (let e10 = 0; e10 < n2.length; e10++) {
        let t4 = n2[e10], r3 = l2(t4.src);
        p3(a3[e10], t4.x, s3 + i3 - t4.y - t4.h, t4.w, t4.h, r3, t4.tint);
      }
    }
    function p3(e9, t3, n2, i3, a3, o3, s3) {
      let c3 = r2.get(e9, K);
      (c3.insetLeft.value !== t3 || c3.insetTop.value !== n2 || c3.width.value !== i3 || c3.height.value !== a3) && (c3.insetLeft = W2(t3), c3.insetTop = W2(n2), c3.width = W2(i3), c3.height = W2(a3), r2.insert(e9, K, c3));
      let l3 = r2.get(e9, q3), u3 = o3 !== null && o3 !== 0, d3 = s3 ? { r: s3[0], g: s3[1], b: s3[2], a: s3[3] } : Ng;
      (l3.enabled !== u3 || l3.texture !== (o3 ?? 0) || l3.color.r !== d3.r || l3.color.g !== d3.g || l3.color.b !== d3.b || l3.color.a !== d3.a) && (l3.enabled = u3, l3.texture = o3 ?? 0, l3.visualType = 2, l3.color = { ...d3 }, r2.insert(e9, q3, l3));
    }
    this.cleanup_ = () => {
      for (let e9 of o2.values()) u2(e9);
      o2.clear();
    };
  }
}();
var Fg = k(`Focusable`, { tabIndex: 0, isFocused: false });
var Ig = class {
  constructor() {
    this.focusedEntity = null, this.focusVisible = false;
  }
  focus(e8, t2 = false) {
    let n2 = this.focusedEntity;
    return this.focusedEntity = e8, this.focusVisible = t2, n2;
  }
  blur() {
    let e8 = this.focusedEntity;
    return this.focusedEntity = null, this.focusVisible = false, e8;
  }
  isVisiblyFocused(e8) {
    return this.focusedEntity === e8 && this.focusVisible;
  }
};
var Lg = ea(new Ig(), `FocusManager`);
var Rg = P(`Interactable`, { enabled: true, blockRaycast: true, raycastTarget: true });
var Y = P(`UIInteraction`, { hovered: false, pressed: false, justPressed: false, justReleased: false });
function zg(e8, t2, n2 = {}) {
  e8.insert(t2, Rg, { enabled: !n2.disabled, blockRaycast: true, raycastTarget: true }), (n2.focusable ?? true) && e8.insert(t2, Fg, { tabIndex: n2.tabIndex ?? 0, isFocused: false });
}
var X4 = { Click: `click`, Press: `press`, Release: `release`, HoverEnter: `hover_enter`, HoverExit: `hover_exit`, Focus: `focus`, Blur: `blur`, Change: `change`, Submit: `submit`, DragStart: `drag_start`, DragMove: `drag_move`, DragEnd: `drag_end`, Scroll: `scroll`, Shown: `shown`, Hidden: `hidden`, Select: `select`, Deselect: `deselect` };
var Bg = 4294967295;
var Vg = Of();
function Hg(e8, t2, n2) {
  return Vg.update(e8.viewProjection), wf(t2, n2, Vg.getInverse(e8.viewProjection), e8.vpX, e8.vpY, e8.vpW, e8.vpH);
}
function Ug(e8, t2, n2) {
  let [r2, i2] = Df(t2, n2, e8.viewProjection, e8.vpX, e8.vpY, e8.vpW, e8.vpH);
  return { x: r2, y: i2 };
}
function Wg(e8) {
  let t2 = li(e8), n2 = e8.getCppRegistry();
  return t2 && n2 ? { engine: t2, registry: n2 } : null;
}
function Gg(e8, t2, n2, r2 = false, i2 = false, a2 = false) {
  let o2 = Wg(e8);
  if (!o2?.engine.uiHitTest_update || !o2.engine.uiHitTest_getHitEntity) return null;
  o2.engine.uiHitTest_update(o2.registry, t2, n2, r2, i2, a2);
  let s2 = o2.engine.uiHitTest_getHitEntity();
  return s2 === Bg ? null : s2;
}
function Jg(e8, t2, n2, r2) {
  let i2 = t2.emit(n2, r2);
  dh(e8, n2, (n3) => {
    if (i2.propagationStopped) return true;
    if (!e8.has(n3, Rg)) return false;
    let r3 = e8.get(n3, Rg);
    return r3.enabled && t2.emitBubbled(n3, i2), r3.blockRaycast;
  });
}
var Yg = class {
  constructor() {
    this.name = Km.UIInteraction, this.dependencies = [Km.UILayout];
  }
  build(e8) {
    it(`Interactable`, Rg);
    let t2 = e8.world;
    ci(e8), t2.getCppRegistry();
    let n2 = Ht2(e8), r2 = null, i2 = null, a2 = NaN, o2 = NaN, s2 = -1;
    e8.addSystemToSchedule(2, Wi([ta(Ql), ta(Wu), ta(rh)], (e9, c2, l2) => {
      n2.drain();
      let u2 = t2.getEntitiesWithComponents([Y]);
      for (let e10 of u2) {
        let n3 = t2.get(e10, Y);
        (n3.justPressed || n3.justReleased) && (n3.justPressed = false, n3.justReleased = false, t2.insert(e10, Y, n3));
      }
      if (!c2.valid) {
        e9.pointerOverUI = false;
        return;
      }
      let d2 = ir(), f2 = Hg(c2, e9.mouseX * d2, c2.screenH - e9.mouseY * d2);
      c2.worldMouseX = f2.x, c2.worldMouseY = f2.y;
      let p3 = e9.isMouseButtonDown(0), m3 = e9.isMouseButtonPressed(0), h3 = e9.isMouseButtonReleased(0), g3 = f2.x !== a2 || f2.y !== o2, _3 = l2.generation !== s2, v4 = g3 || _3 || m3 || h3;
      a2 = f2.x, o2 = f2.y, s2 = l2.generation;
      let y5 = r2;
      if (v4 && (y5 = Gg(t2, f2.x, f2.y, p3, m3, h3)), r2 !== null && !t2.valid(r2) && (r2 = null), e9.pointerOverUI = y5 !== null, r2 !== y5) {
        if (r2 !== null && t2.valid(r2) && t2.has(r2, Y)) {
          let e10 = t2.get(r2, Y);
          e10.hovered = false, t2.insert(r2, Y, e10), n2.emit(r2, X4.HoverExit);
        }
        if (y5 !== null) {
          fh(t2, y5, Y);
          let e10 = t2.get(y5, Y);
          e10.hovered = true, t2.insert(y5, Y, e10), n2.emit(y5, X4.HoverEnter);
        }
        r2 = y5;
      }
      if (m3 && y5 !== null) {
        let e10 = t2.get(y5, Y);
        e10.pressed = true, e10.justPressed = true, t2.insert(y5, Y, e10), i2 = y5, Jg(t2, n2, y5, X4.Press);
      }
      if (h3 && i2 !== null) {
        if (t2.valid(i2) && t2.has(i2, Y)) {
          let e10 = t2.get(i2, Y);
          e10.pressed = false, e10.justReleased = true, t2.insert(i2, Y, e10), Jg(t2, n2, i2, X4.Release), i2 === r2 && Jg(t2, n2, i2, X4.Click);
        }
        i2 = null;
      }
    }, { name: `UIInteractionSystem` }), { runAfter: [qm.UILayout], runIf: l });
  }
};
var Xg = new Yg();
var e_ = class {
  constructor() {
    this.instances_ = /* @__PURE__ */ new Set();
  }
  add(e8) {
    this.instances_.add(e8);
  }
  remove(e8) {
    this.instances_.delete(e8);
  }
  tick() {
    for (let e8 of this.instances_) e8.update();
  }
  count() {
    return this.instances_.size;
  }
};
var t_ = class {
  constructor(e8) {
    this.offset_ = { x: 0, y: 0 }, this.listeners_ = /* @__PURE__ */ new Set(), this.viewportSize_ = { x: e8.viewportSize.x, y: e8.viewportSize.y }, this.contentSize_ = { x: e8.contentSize.x, y: e8.contentSize.y }, this.direction_ = e8.direction ?? `vertical`, this.wheelSpeed_ = e8.wheelSpeed ?? 1, this.dragScroll_ = e8.dragScroll ?? true, this.decelerationRate_ = e8.decelerationRate ?? 0.135, this.showScrollbar_ = e8.showScrollbar ?? true, this.setOffset(e8.initialOffset ?? { x: 0, y: 0 });
  }
  getOffset() {
    return { x: this.offset_.x, y: this.offset_.y };
  }
  getViewportSize() {
    return { x: this.viewportSize_.x, y: this.viewportSize_.y };
  }
  getContentSize() {
    return { x: this.contentSize_.x, y: this.contentSize_.y };
  }
  getMaxOffset() {
    return { x: Math.max(0, this.contentSize_.x - this.viewportSize_.x), y: Math.max(0, this.contentSize_.y - this.viewportSize_.y) };
  }
  getShowScrollbar() {
    return this.showScrollbar_;
  }
  getWheelSpeed() {
    return this.wheelSpeed_;
  }
  getDragScroll() {
    return this.dragScroll_;
  }
  getDecelerationRate() {
    return this.decelerationRate_;
  }
  setOffset(e8) {
    let t2 = this.getMaxOffset(), r2 = this.direction_ === `vertical`, i2 = this.direction_ === `horizontal`, a2 = { x: r2 ? 0 : r_(e8.x, 0, t2.x), y: i2 ? 0 : r_(e8.y, 0, t2.y) };
    if (a2.x !== this.offset_.x || a2.y !== this.offset_.y) {
      this.offset_ = a2;
      for (let e9 of Array.from(this.listeners_)) try {
        e9({ x: a2.x, y: a2.y });
      } catch (e10) {
        T.error(`ui`, `ScrollContainer listener error`, e10);
      }
    }
  }
  scrollBy(e8) {
    this.setOffset({ x: this.offset_.x + e8.x, y: this.offset_.y + e8.y });
  }
  setViewportSize(e8) {
    (e8.x !== this.viewportSize_.x || e8.y !== this.viewportSize_.y) && (this.viewportSize_ = { x: e8.x, y: e8.y }, this.setOffset(this.offset_));
  }
  setContentSize(e8) {
    (e8.x !== this.contentSize_.x || e8.y !== this.contentSize_.y) && (this.contentSize_ = { x: e8.x, y: e8.y }, this.setOffset(this.offset_));
  }
  onScroll(e8) {
    return this.listeners_.add(e8), () => {
      this.listeners_.delete(e8);
    };
  }
  dispose() {
    this.listeners_.clear();
  }
};
var n_ = class {
  constructor() {
    this.entries_ = /* @__PURE__ */ new Map();
  }
  attach(e8, t2) {
    this.entries_.set(e8, t2);
  }
  detach(e8) {
    this.entries_.delete(e8);
  }
  get(e8) {
    return this.entries_.get(e8);
  }
  entries() {
    return this.entries_.entries();
  }
  size() {
    return this.entries_.size;
  }
  clear() {
    this.entries_.clear();
  }
};
function r_(e8, t2, n2) {
  return e8 < t2 ? t2 : e8 > n2 ? n2 : e8;
}
var i_ = { Clamped: 0, Elastic: 1 };
var a_ = P(`UIScroll`, { enabled: true, content: 0, horizontal: false, vertical: true, movement: i_.Clamped, wheelSpeed: 1, dragScroll: true, decelerationRate: 0.135 });
var o_ = (e8) => ({ value: e8, unit: 0 });
function s_(e8) {
  return e8.horizontal && e8.vertical ? `both` : e8.horizontal ? `horizontal` : `vertical`;
}
function c_(e8, t2, n2, r2) {
  let i2 = /* @__PURE__ */ new Map(), a2 = (e9) => ({ x: t2?.uiNode_computedWidth?.(n2, e9) ?? 0, y: t2?.uiNode_computedHeight?.(n2, e9) ?? 0 }), o2 = (e9, t3) => {
    if (t3.content) return t3.content;
    if (!n2?.hasChildren?.(e9)) return null;
    let r3 = n2.getChildren(e9).entities;
    try {
      return r3.size() > 0 ? r3.get(0) : null;
    } finally {
      r3.delete();
    }
  }, s2 = (e9) => {
    let t3 = i2.get(e9);
    t3 && (t3.unsubscribe(), r2.detachScrollContainer(e9), i2.delete(e9));
  }, c2 = (t3, n3) => {
    let s3 = o2(t3, n3);
    if (s3 == null) return;
    let c3 = new t_({ viewportSize: a2(t3), contentSize: a2(s3), direction: s_(n3), wheelSpeed: n3.wheelSpeed, dragScroll: n3.dragScroll, decelerationRate: n3.movement === i_.Elastic ? n3.decelerationRate : 0 }), l2 = c3.onScroll((t4) => {
      let n4 = e8.get(s3, K);
      n4 && (n4.position = 1, n4.insetLeft = o_(-t4.x), n4.insetTop = o_(-t4.y), e8.insert(s3, K, n4));
    });
    r2.attachScrollContainer(t3, c3), i2.set(t3, { container: c3, content: s3, unsubscribe: l2 });
  };
  return Wi([Oi(a_)], (t3) => {
    let n3 = /* @__PURE__ */ new Set();
    for (let [r3, o3] of t3) {
      let t4 = o3;
      if (!t4.enabled) continue;
      n3.add(r3);
      let l2 = i2.get(r3);
      if (!l2) {
        c2(r3, t4);
        continue;
      }
      if (t4.content ? t4.content !== l2.content : !e8.valid(l2.content)) {
        s2(r3), c2(r3, t4);
        continue;
      }
      let u2 = l2.content;
      l2.container.setViewportSize(a2(r3)), l2.container.setContentSize(a2(u2));
    }
    for (let e9 of [...i2.keys()]) n3.has(e9) || s2(e9);
  }, { name: `UIScrollAdoptSystem` });
}
var l_ = class {
  constructor(e8 = {}) {
    this.velocity_ = { x: 0, y: 0 }, this.dragging_ = false, this.decelerationRate_ = e8.decelerationRate ?? 0.135, this.restVelocity_ = e8.restVelocity ?? 4, this.sampleRate_ = e8.sampleRate ?? 12;
  }
  beginDrag() {
    this.dragging_ = true, this.velocity_ = { x: 0, y: 0 };
  }
  sample(e8, t2) {
    if (!this.dragging_ || t2 <= 0) return;
    let n2 = { x: e8.x / t2, y: e8.y / t2 }, r2 = 1 - Math.exp(-this.sampleRate_ * t2);
    this.velocity_.x += (n2.x - this.velocity_.x) * r2, this.velocity_.y += (n2.y - this.velocity_.y) * r2;
  }
  endDrag() {
    this.dragging_ = false;
  }
  stop() {
    this.dragging_ = false, this.velocity_ = { x: 0, y: 0 };
  }
  killAxis(e8) {
    this.velocity_[e8] = 0;
  }
  isDragging() {
    return this.dragging_;
  }
  isCoasting() {
    if (this.dragging_) return false;
    let { x: e8, y: t2 } = this.velocity_;
    return Math.hypot(e8, t2) > this.restVelocity_;
  }
  getVelocity() {
    return { x: this.velocity_.x, y: this.velocity_.y };
  }
  tick(e8) {
    if (!this.isCoasting() || e8 <= 0) return { x: 0, y: 0 };
    let t2 = { x: this.velocity_.x * e8, y: this.velocity_.y * e8 }, n2 = this.decelerationRate_ ** +e8;
    return this.velocity_.x *= n2, this.velocity_.y *= n2, this.isCoasting() || (this.velocity_ = { x: 0, y: 0 }), t2;
  }
};
var u_ = k(`UIDialog`, { closeOnEscape: true, closeOnBackdrop: true });
function d_(e8, t2) {
  return e8.has(t2, K) ? e8.get(t2, K).display !== 1 : false;
}
function p_(e8, t2, n2) {
  m_(e8, t2, n2, false);
}
function m_(e8, t2, n2, r2) {
  if (!e8.has(n2, K) || d_(e8, n2) === r2) return;
  let i2 = e8.get(n2, K);
  i2.display = +!r2, e8.insert(n2, K, i2), t2.emit(n2, X4.Change, { open: r2 });
}
function h_(e8, t2) {
  return Wi([ta(Ql)], (n2) => {
    let r2 = n2.isKeyPressed(`Escape`);
    for (let n3 of e8.getEntitiesWithComponents([u_, K])) {
      if (!d_(e8, n3)) continue;
      let i2 = e8.get(n3, u_), a2 = i2.closeOnBackdrop && e8.has(n3, Y) && e8.get(n3, Y).justPressed;
      (i2.closeOnEscape && r2 || a2) && p_(e8, t2, n3);
    }
  }, { name: `UIDialogSystem` });
}
var g_ = k(`UISlider`, { min: 0, max: 1, step: 0, value: 0, fill: 0, handle: 0 }, { entityFields: [`fill`, `handle`] });
function __(e8, t2) {
  let n2 = e8 < t2.min ? t2.min : e8 > t2.max ? t2.max : e8;
  if (t2.step <= 0) return n2;
  let r2 = Math.round((n2 - t2.min) / t2.step) * t2.step + t2.min;
  return r2 < t2.min ? t2.min : r2 > t2.max ? t2.max : r2;
}
function v_(e8) {
  if (e8.max <= e8.min) return 0;
  let t2 = (e8.value - e8.min) / (e8.max - e8.min);
  return t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
}
function y_(e8) {
  return e8.step > 0 ? e8.step : (e8.max - e8.min) / 100;
}
function b_(e8, t2) {
  let n2 = null, r2 = new mh();
  return Wi([ta(Ql), ta(Wu)], (i2, a2) => {
    for (let o2 of e8.getEntitiesWithComponents([g_])) {
      let s2 = e8.get(o2, g_), c2 = s2.value, l2 = !e8.has(o2, Rg) || e8.get(o2, Rg).enabled;
      if (l2 && e8.has(o2, Y) && e8.get(o2, Y).justPressed && (n2 = o2), n2 === o2) {
        if (!i2.isMouseButtonDown(0)) n2 = null;
        else if (a2.valid && e8.has(o2, I)) {
          let t3 = e8.get(o2, I), n3 = lh(o2) * t3.worldScale.x;
          if (n3 > 0) {
            let e9 = t3.worldPosition.x - n3 / 2;
            c2 = __(s2.min + (a2.worldMouseX - e9) / n3 * (s2.max - s2.min), s2);
          }
        }
      }
      if (l2 && e8.has(o2, Fg) && e8.get(o2, Fg).isFocused) {
        let e9 = y_(s2);
        (i2.isKeyPressed(`ArrowLeft`) || i2.isKeyPressed(`ArrowDown`)) && (c2 = __(c2 - e9, s2)), (i2.isKeyPressed(`ArrowRight`) || i2.isKeyPressed(`ArrowUp`)) && (c2 = __(c2 + e9, s2)), i2.isKeyPressed(`Home`) && (c2 = s2.min), i2.isKeyPressed(`End`) && (c2 = s2.max);
      }
      if (c2 !== s2.value && (s2.value = c2, e8.insert(o2, g_, s2)), r2.get(o2) !== s2.value) {
        let n3 = r2.has(o2);
        r2.set(o2, s2.value);
        let i3 = v_(s2);
        if (e8.valid(s2.fill) && e8.has(s2.fill, q3)) {
          let t3 = e8.get(s2.fill, q3);
          t3.fillAmount !== i3 && (t3.fillAmount = i3, e8.insert(s2.fill, q3, t3));
        }
        if (e8.valid(s2.handle) && e8.has(s2.handle, K)) {
          let t3 = e8.get(s2.handle, K);
          t3.insetLeft = Ym(i3 * 100), e8.insert(s2.handle, K, t3);
        }
        n3 && t2.emit(o2, X4.Change, { value: s2.value });
      }
    }
    r2.cleanup(e8);
  }, { name: `UISliderSystem` });
}
var x_ = k(`UIToggle`, { isOn: false, check: 0 }, { entityFields: [`check`] });
function S_(e8, t2) {
  let n2 = new mh();
  return t2.on(X4.Click, (t3) => {
    let n3 = t3.target;
    if (!e8.valid(n3) || !e8.has(n3, x_) || e8.has(n3, Rg) && !e8.get(n3, Rg).enabled) return;
    let r2 = e8.get(n3, x_);
    r2.isOn = !r2.isOn, e8.insert(n3, x_, r2);
  }), Wi([], () => {
    for (let r2 of e8.getEntitiesWithComponents([x_])) {
      let i2 = e8.get(r2, x_);
      if (n2.get(r2) === i2.isOn) continue;
      let a2 = n2.has(r2);
      n2.set(r2, i2.isOn), Mg(e8, i2.check, i2.isOn), a2 && t2.emit(r2, X4.Change, { isOn: i2.isOn });
    }
    n2.cleanup(e8);
  }, { name: `UIToggleSystem` });
}
var C_ = k(`UIController`, { controllers: [] });
var w_ = `$interaction`;
var T_ = [`normal`, `hover`, `pressed`, `disabled`, `focused`];
function E_(e8 = [...T_]) {
  return { name: w_, pages: e8, current: e8[0] ?? `normal` };
}
function O_(e8, t2, n2) {
  return e8.has(t2, C_) ? e8.get(t2, C_).controllers.find((e9) => e9.name === n2) ?? null : null;
}
function k_(e8, t2, n2) {
  if (O_(e8, t2, n2)) return t2;
  let r2 = null;
  return dh(e8, t2, (t3) => O_(e8, t3, n2) ? (r2 = t3, true) : false), r2;
}
function A_(e8, t2, n2) {
  let r2 = k_(e8, t2, n2);
  return r2 === null ? null : O_(e8, r2, n2).current;
}
function j_(e8, t2, n2, r2) {
  let i2 = k_(e8, t2, n2);
  if (i2 === null) return false;
  let a2 = e8.get(i2, C_), o2 = a2.controllers.find((e9) => e9.name === n2);
  return !o2 || o2.current === r2 || !o2.pages.includes(r2) ? false : (o2.current = r2, e8.insert(i2, C_, a2), true);
}
var M_ = k(`UIGear`, { bindings: [] });
function N_(e8, t2, n2, r2, i2) {
  return { controller: e8, component: t2, property: n2, pages: r2, ...i2 ? { tween: i2 } : {} };
}
function P_(e8, t2 = 0) {
  let n2 = {}, r2 = {}, i2 = {};
  for (let [t3, a3] of Object.entries(e8)) a3.color !== void 0 && (n2[t3] = { ...a3.color }), a3.sprite !== void 0 && (r2[t3] = a3.sprite), a3.scale !== void 0 && (i2[t3] = { x: a3.scale, y: a3.scale, z: 1 });
  let a2 = t2 > 0 ? { easing: vp.Linear, duration: t2 } : void 0, o2 = [];
  return Object.keys(n2).length > 0 && o2.push(N_(w_, `UIVisual`, `color`, n2, a2)), Object.keys(r2).length > 0 && o2.push(N_(w_, `UIVisual`, `texture`, r2)), Object.keys(i2).length > 0 && o2.push(N_(w_, `Transform`, `scale`, i2, a2)), o2;
}
var I_ = { label: 14, body: 15, title: 20 };
var L_ = { colors: { surface: { r: 0.16, g: 0.16, b: 0.18, a: 1 }, surfaceElevated: { r: 0.14, g: 0.14, b: 0.16, a: 1 }, control: { r: 0.22, g: 0.22, b: 0.26, a: 1 }, controlHover: { r: 0.28, g: 0.28, b: 0.32, a: 1 }, controlActive: { r: 0.18, g: 0.18, b: 0.22, a: 1 }, controlFocus: { r: 0.3, g: 0.34, b: 0.44, a: 1 }, track: { r: 0.15, g: 0.15, b: 0.15, a: 1 }, primary: { r: 0.25, g: 0.56, b: 0.96, a: 1 }, primaryHover: { r: 0.3, g: 0.5, b: 0.9, a: 1 }, primaryActive: { r: 0.2, g: 0.4, b: 0.75, a: 1 }, onPrimary: { r: 1, g: 1, b: 1, a: 1 }, text: { r: 0.92, g: 0.92, b: 0.94, a: 1 }, backdrop: { r: 0, g: 0, b: 0, a: 0.5 } }, type: I_ };
var V_ = L_;
function W_() {
  return V_.colors;
}
var K_ = k(`ThemeStyle`, { visual: void 0, text: void 0, states: {}, input: void 0 });
function q_(e8, t2, n2) {
  e8.insert(t2, K_, n2);
}
var J_ = k(`UIDropdown`, { options: [], selectedIndex: 0, optionHeight: 32, label: 0 }, { entityFields: [`label`] });
var Y_ = /* @__PURE__ */ new WeakMap();
function X_(e8) {
  let t2 = Y_.get(e8);
  return t2 || (t2 = /* @__PURE__ */ new Map(), Y_.set(e8, t2)), t2;
}
function Z_(e8, t2) {
  return X_(e8).has(t2);
}
function Q_(e8, t2) {
  let n2 = X_(e8), r2 = n2.get(t2);
  if (r2) {
    n2.delete(t2);
    for (let e9 of r2.unsubs) e9();
    e8.valid(r2.panel) && e8.despawn(r2.panel);
  }
}
function $_(e8, t2, n2) {
  let r2 = X_(e8);
  if (r2.has(n2) || !e8.has(n2, J_)) return;
  let i2 = e8.get(n2, J_), a2 = W_(), o2 = J3({ world: e8, parent: n2, node: { position: 1, insetLeft: W2(0), insetRight: W2(0), insetTop: Ym(100), height: W2(i2.options.length * i2.optionHeight) }, visual: { color: a2.surfaceElevated } });
  q_(e8, o2, { visual: `surfaceElevated` });
  let s2 = [], c2 = [];
  for (let r3 = 0; r3 < i2.options.length; r3++) {
    let l2 = J3({ world: e8, parent: o2, node: { position: 1, insetLeft: W2(0), insetRight: W2(0), insetTop: W2(r3 * i2.optionHeight), height: W2(i2.optionHeight) }, visual: { color: a2.control } });
    zg(e8, l2, { focusable: false }), e8.insert(l2, C_, { controllers: [E_([`normal`, `hover`, `pressed`, `selected`])] }), e8.insert(l2, M_, { bindings: P_({ normal: { color: a2.control }, hover: { color: a2.primaryHover }, pressed: { color: a2.primaryActive }, selected: { color: a2.primaryActive } }) }), q_(e8, l2, { states: { normal: `control`, hover: `primaryHover`, pressed: `primaryActive`, selected: `primaryActive` } }), q_(e8, J3({ world: e8, parent: l2, node: { fill: true }, text: { content: i2.options[r3], color: a2.text } }), { text: `text` });
    let u2 = r3;
    s2.push(t2.on(l2, X4.Click, () => {
      let t3 = e8.get(n2, J_);
      Q_(e8, n2), t3.selectedIndex !== u2 && (t3.selectedIndex = u2, e8.insert(n2, J_, t3));
    })), c2.push(l2);
  }
  r2.set(n2, { panel: o2, rows: c2, unsubs: s2 }), ev(e8, c2, i2.selectedIndex);
}
function ev(e8, t2, n2) {
  for (let r2 = 0; r2 < t2.length; r2++) {
    let i2 = t2[r2];
    if (!e8.valid(i2) || !e8.has(i2, C_)) continue;
    let a2 = e8.get(i2, C_), o2 = a2.controllers.find((e9) => e9.name === w_);
    if (!o2) continue;
    let s2 = r2 === n2 ? `selected` : o2.current === `selected` ? `normal` : o2.current;
    o2.current !== s2 && (o2.current = s2, e8.insert(i2, C_, a2));
  }
}
function tv(e8, t2) {
  let n2 = X_(e8);
  if (n2.size === 0) return false;
  let r2 = /* @__PURE__ */ new Set();
  for (let e9 of n2.values()) r2.add(e9.panel);
  if (r2.has(t2)) return true;
  let i2 = false;
  return dh(e8, t2, (e9) => r2.has(e9) ? (i2 = true, true) : false), i2;
}
function nv(e8, t2) {
  let n2 = new mh();
  return t2.on(X4.Click, (n3) => {
    let r2 = n3.target;
    if (e8.valid(r2) && e8.has(r2, J_)) {
      if (!(!e8.has(r2, Rg) || e8.get(r2, Rg).enabled)) return;
      Z_(e8, r2) ? Q_(e8, r2) : $_(e8, t2, r2);
      return;
    }
    if (!tv(e8, r2)) for (let t3 of [...X_(e8).keys()]) Q_(e8, t3);
  }), e8.onDespawn((t3) => {
    X_(e8).has(t3) && Q_(e8, t3);
  }), Wi([ta(Ql)], (r2) => {
    for (let i2 of e8.getEntitiesWithComponents([J_])) {
      let a2 = e8.get(i2, J_), o2 = e8.has(i2, Fg) && e8.get(i2, Fg).isFocused, s2 = !e8.has(i2, Rg) || e8.get(i2, Rg).enabled, c2 = Z_(e8, i2);
      if (o2 && s2 && a2.options.length > 0) {
        let t3 = a2.selectedIndex;
        r2.isKeyPressed(`ArrowDown`) && (t3 = Math.min(t3 + 1, a2.options.length - 1)), r2.isKeyPressed(`ArrowUp`) && (t3 = Math.max(t3 - 1, 0)), t3 !== a2.selectedIndex && (a2.selectedIndex = t3, e8.insert(i2, J_, a2)), c2 && (r2.isKeyPressed(`Enter`) || r2.isKeyPressed(`Escape`)) && Q_(e8, i2);
      }
      if (n2.get(i2) !== a2.selectedIndex) {
        let r3 = n2.has(i2);
        if (n2.set(i2, a2.selectedIndex), e8.valid(a2.label) && e8.has(a2.label, bg)) {
          let t3 = e8.get(a2.label, bg), n3 = a2.options[a2.selectedIndex] ?? ``;
          t3.content !== n3 && (t3.content = n3, e8.insert(a2.label, bg, t3));
        }
        let o3 = X_(e8).get(i2);
        o3 && ev(e8, o3.rows, a2.selectedIndex), r3 && t2.emit(i2, X4.Change, { index: a2.selectedIndex });
      }
    }
    n2.cleanup(e8);
  }, { name: `UIDropdownSystem` });
}
var rv = 0.8;
function iv(e8, t2, n2) {
  let r2 = J3({ world: e8, parent: t2, node: n2 === `v` ? { position: 1, insetRight: W2(2), insetTop: W2(0), width: W2(4), height: W2(20) } : { position: 1, insetBottom: W2(2), insetLeft: W2(0), height: W2(4), width: W2(20) }, visual: { color: { ...W_().text, a: 0 } } });
  return q_(e8, r2, { visual: `text` }), r2;
}
function av(e8, t2, n2, r2, i2, a2, o2, s2) {
  if (!e8.valid(t2)) return;
  let c2 = Math.max(20, a2 / o2 * a2), l2 = Math.max(0, a2 - c2), u2 = i2 > 0 ? r2 / i2 * l2 : 0, d2 = e8.get(t2, K);
  n2 === `v` ? (d2.insetTop = W2(u2), d2.height = W2(c2)) : (d2.insetLeft = W2(u2), d2.width = W2(c2)), e8.insert(t2, K, d2);
  let f2 = e8.get(t2, q3), p3 = 0.35 * s2;
  Math.abs(f2.color.a - p3) > 1e-3 && (f2.color = { ...f2.color, a: p3 }, e8.insert(t2, q3, f2));
}
function ov(e8, t2) {
  let n2 = new mh();
  return Wi([ta(aa)], (r2) => {
    let i2 = /* @__PURE__ */ new Set();
    for (let [a2, o2] of t2.entries()) {
      let t3 = a2;
      if (!e8.valid(t3) || !o2.getShowScrollbar()) continue;
      i2.add(t3);
      let s2 = o2.getOffset(), c2 = o2.getViewportSize(), l2 = o2.getContentSize(), u2 = o2.getMaxOffset(), d2 = n2.get(t3);
      d2 || (d2 = { v: null, h: null, last: s2, idle: 1.1 }, n2.set(t3, d2)), s2.x !== d2.last.x || s2.y !== d2.last.y ? (d2.last = s2, d2.idle = 0) : d2.idle += r2.delta;
      let f2 = d2.idle <= rv ? 1 : Math.max(0, 1 - (d2.idle - rv) / 0.3);
      u2.y > 0 && d2.v === null && f2 > 0 && (d2.v = iv(e8, t3, `v`)), u2.x > 0 && d2.h === null && f2 > 0 && (d2.h = iv(e8, t3, `h`)), d2.v !== null && av(e8, d2.v, `v`, s2.y, u2.y, c2.y, l2.y, u2.y > 0 ? f2 : 0), d2.h !== null && av(e8, d2.h, `h`, s2.x, u2.x, c2.x, l2.x, u2.x > 0 ? f2 : 0);
    }
    for (let [t3, r3] of n2) i2.has(t3) || (r3.v !== null && e8.valid(r3.v) && e8.despawn(r3.v), r3.h !== null && e8.valid(r3.h) && e8.despawn(r3.h), n2.delete(t3));
  }, { name: `UIScrollbarSystem` });
}
var sv = new class {
  constructor() {
    this.name = `uiBehavior`, this.profileDomain = `ui`, this.dependencies = [Km.UIInteraction], this.events_ = null, this.listViews_ = null, this.scrollContainers_ = null;
  }
  get events() {
    if (!this.events_) throw Error(`UIBehaviorPlugin.events accessed before build()`);
    return this.events_;
  }
  registerListView(e8) {
    if (!this.listViews_) throw Error(`UIBehaviorPlugin.registerListView called before build()`);
    this.listViews_.add(e8);
  }
  unregisterListView(e8) {
    this.listViews_?.remove(e8);
  }
  attachScrollContainer(e8, t2) {
    if (!this.scrollContainers_) throw Error(`UIBehaviorPlugin.attachScrollContainer called before build()`);
    this.scrollContainers_.attach(e8, t2);
  }
  detachScrollContainer(e8) {
    this.scrollContainers_?.detach(e8);
  }
  build(e8) {
    let t2 = e8.getResource(Vt2);
    this.events_ = t2;
    let n2 = new e_();
    this.listViews_ = n2;
    let r2 = new n_();
    this.scrollContainers_ = r2, e8.world.onDespawn((e9) => r2.detach(e9));
    let i2 = e8.world;
    it(`UIDialog`, u_), e8.addSystemToSchedule(3, h_(i2, t2), { runIf: l }), it(`UISlider`, g_), e8.addSystemToSchedule(3, b_(i2, t2), { runIf: l }), it(`UIToggle`, x_), e8.addSystemToSchedule(3, S_(i2, t2), { runIf: l }), it(`UIDropdown`, J_), e8.addSystemToSchedule(3, nv(i2, t2), { runIf: l }), e8.addSystemToSchedule(3, c_(i2, ci(e8), i2.getCppRegistry(), this), { runIf: l }), e8.addSystemToSchedule(3, ov(i2, r2), { runIf: l }), e8.addSystemToSchedule(3, Wi([], () => n2.tick(), { name: `ListViewSystem` }));
    let a2 = /* @__PURE__ */ new Map(), o2 = (e9, t3) => {
      let n3 = a2.get(e9);
      return n3 || (n3 = new l_({ decelerationRate: t3.getDecelerationRate() }), a2.set(e9, n3)), n3;
    };
    e8.world.onDespawn((e9) => a2.delete(e9));
    let s2 = (e9) => {
      let t3 = null, n3 = -1;
      for (let e10 of i2.getEntitiesWithComponents([Y])) {
        if (!i2.get(e10, Y).hovered) continue;
        let r3 = ch(i2, e10);
        r3 > n3 && (n3 = r3, t3 = e10);
      }
      if (t3 === null) return null;
      let a3 = (t4) => {
        let n4 = r2.get(t4);
        return !!n4 && (!e9 || n4.getDragScroll());
      };
      if (a3(t3)) return t3;
      let o3 = null;
      return dh(i2, t3, (e10) => a3(e10) ? (o3 = e10, true) : false), o3;
    };
    e8.addSystemToSchedule(3, Wi([ta(Ql)], (e9) => {
      let t3 = e9.scrollDeltaX, n3 = e9.scrollDeltaY;
      if (t3 === 0 && n3 === 0) return;
      let i3 = s2(false);
      if (i3 !== null) {
        let e10 = r2.get(i3);
        a2.get(i3)?.stop();
        let o3 = e10.getWheelSpeed();
        e10.scrollBy({ x: t3 * o3, y: n3 * o3 });
      }
    }, { name: `ScrollWheelSystem` }));
    let c2 = null, l2 = null, u2 = { x: 0, y: 0 }, d2 = { x: 0, y: 0 }, f2 = { x: 0, y: 0 };
    e8.addSystemToSchedule(2, Wi([ta(Ql), ta(Wu), ta(aa)], (e9, t3, n3) => {
      if (!t3.valid) return;
      let p3 = { x: t3.worldMouseX, y: t3.worldMouseY };
      if (e9.isMouseButtonPressed(0)) {
        let e10 = s2(true);
        if (e10 !== null) {
          let t4 = r2.get(e10);
          o2(e10, t4).stop(), c2 = e10, u2 = { x: p3.x, y: p3.y };
        }
      }
      if (c2 !== null && !e9.isMouseButtonDown(0) && (c2 = null), c2 !== null && l2 === null) {
        let e10 = r2.get(c2);
        if (!e10) c2 = null;
        else {
          let n4 = p3.x - u2.x, r3 = p3.y - u2.y, i3 = t3.worldRight - t3.worldLeft;
          Math.hypot(n4, r3) * (i3 === 0 ? 1 : t3.vpW / i3) >= 5 && (l2 = c2, c2 = null, d2 = e10.getOffset(), f2 = { x: d2.x, y: d2.y }, o2(l2, e10).beginDrag());
        }
      }
      if (l2 !== null) {
        let t4 = r2.get(l2);
        if (!t4 || !i2.valid(l2)) {
          l2 = null;
          return;
        }
        let a3 = 1, s3 = 1;
        if (i2.has(l2, I)) {
          let e10 = i2.get(l2, I);
          e10.worldScale.x !== 0 && (a3 = e10.worldScale.x), e10.worldScale.y !== 0 && (s3 = e10.worldScale.y);
        }
        let c3 = p3.x - u2.x, m3 = p3.y - u2.y;
        t4.setOffset({ x: d2.x - c3 / a3, y: d2.y + m3 / s3 });
        let h3 = t4.getOffset(), g3 = o2(l2, t4);
        g3.sample({ x: h3.x - f2.x, y: h3.y - f2.y }, n3.delta), f2 = h3, e9.isMouseButtonDown(0) || (g3.endDrag(), l2 = null);
      }
      for (let [e10, t4] of a2) {
        if (!t4.isCoasting()) continue;
        let i3 = r2.get(e10);
        if (!i3) {
          a2.delete(e10);
          continue;
        }
        let o3 = t4.tick(n3.delta), s3 = i3.getOffset();
        i3.scrollBy(o3);
        let c3 = i3.getOffset();
        o3.x !== 0 && c3.x === s3.x && t4.killAxis(`x`), o3.y !== 0 && c3.y === s3.y && t4.killAxis(`y`);
      }
    }, { name: `ScrollDragSystem`, runAfter: [qm.UIInteraction] }), { runIf: l });
  }
}();
function cv(e8, t2) {
  let n2 = t2.split(`.`), r2 = e8;
  for (let e9 of n2) {
    if (typeof r2 != `object` || !r2) return;
    r2 = r2[e9];
  }
  return r2;
}
function lv(e8, t2, n2) {
  let r2 = t2.split(`.`), i2 = e8;
  for (let e9 = 0; e9 < r2.length - 1; e9++) if (i2 = i2[r2[e9]], typeof i2 != `object` || !i2) return false;
  let a2 = r2[r2.length - 1];
  return typeof i2 != `object` || !i2 || !(a2 in i2) ? false : (i2[a2] = typeof n2 == `object` && n2 ? { ...n2 } : n2, true);
}
function uv(e8) {
  if (typeof e8 == `number`) return true;
  if (typeof e8 == `object` && e8) {
    let t2 = e8;
    return typeof t2.r == `number` || typeof t2.x == `number`;
  }
  return false;
}
function dv(e8, t2, n2) {
  return e8 + (t2 - e8) * n2;
}
function fv(e8, t2, n2) {
  if (typeof t2 == `number`) return typeof e8 == `number` ? dv(e8, t2, n2) : t2;
  if (typeof t2 == `object` && t2 && typeof e8 == `object` && e8) {
    let r2 = e8, i2 = t2;
    if (typeof i2.r == `number` && typeof r2.r == `number`) return { r: dv(r2.r, i2.r, n2), g: dv(r2.g, i2.g, n2), b: dv(r2.b, i2.b, n2), a: dv(r2.a ?? 1, i2.a ?? 1, n2) };
    if (typeof i2.x == `number` && typeof r2.x == `number`) {
      let e9 = { x: dv(r2.x, i2.x, n2), y: dv(r2.y, i2.y, n2) };
      return `z` in i2 && (e9.z = dv(r2.z ?? 0, i2.z ?? 0, n2)), e9;
    }
  }
  return t2;
}
var pv = /* @__PURE__ */ new Set([``, `normal`, `hover`, `pressed`, `disabled`, `focused`]);
function mv(e8, t2, n2 = false) {
  return e8 ? t2?.pressed ? `pressed` : t2?.hovered ? `hover` : n2 ? `focused` : `normal` : `disabled`;
}
function hv(e8) {
  return Wi([ta(Lg)], (t2) => {
    for (let n2 of e8.getEntitiesWithComponents([Rg, C_])) {
      let r2 = e8.get(n2, C_), i2 = r2.controllers.find((e9) => e9.name === w_);
      if (!i2 || !pv.has(i2.current)) continue;
      let a2 = e8.has(n2, Y) ? e8.get(n2, Y) : null, o2 = e8.get(n2, Rg), s2 = e8.has(n2, Fg) && t2.isVisiblyFocused(n2), c2 = mv(o2.enabled, a2, s2);
      c2 !== i2.current && i2.pages.includes(c2) && (i2.current = c2, e8.insert(n2, C_, r2));
    }
  }, { name: `InteractionControllerDriverSystem` });
}
function gv(e8) {
  let t2 = new mh();
  return Wi([ta(aa)], (n2) => {
    let r2 = n2.delta, i2 = /* @__PURE__ */ new Set();
    for (let n3 of e8.getEntitiesWithComponents([M_])) {
      i2.add(n3);
      let a2 = e8.get(n3, M_).bindings, o2 = t2.get(n3);
      (!o2 || o2.ref !== a2 || o2.txs.length !== a2.length) && (o2 = { ref: a2, txs: a2.map(() => null) }, t2.set(n3, o2));
      let s2 = o2.txs;
      for (let t3 = 0; t3 < a2.length; t3++) {
        let i3 = a2[t3], o3 = A_(e8, n3, i3.controller);
        if (o3 === null) continue;
        let c2 = i3.pages[o3];
        if (c2 === void 0) continue;
        let l2 = M(i3.component);
        if (!l2 || !e8.has(n3, l2)) continue;
        let u2 = Math.max(0, i3.tween?.duration ?? 0), d2 = u2 > 0 && uv(c2), f2 = s2[t3];
        if (!f2 || f2.page !== o3) {
          let r3 = cv(e8.get(n3, l2), i3.property);
          f2 = { page: o3, elapsed: 0, from: d2 ? r3 : c2, done: false }, s2[t3] = f2;
        } else if (f2.done) continue;
        else f2.elapsed += r2;
        let m3 = d2 ? Math.min(f2.elapsed / u2, 1) : 1, h3 = d2 && m3 < 1 ? fv(f2.from, c2, Up(i3.tween.easing, m3)) : c2, g3 = e8.get(n3, l2);
        lv(g3, i3.property, h3) && e8.insert(n3, l2, g3), m3 >= 1 && (f2.done = true);
      }
    }
    for (let [e9] of t2) i2.has(e9) || t2.delete(e9);
  }, { name: `GearApplySystem` });
}
function _v() {
  vv(), !I5.hasAction(`ui.setPage`) && I5.registerAction(`ui.setPage`, { params: [{ name: `controller`, type: `enum`, optionsSource: `uiController` }, { name: `page`, type: `enum`, optionsSource: `uiControllerPage` }], run: (e8, t2, n2, r2) => {
    let i2 = r2?.controller, a2 = r2?.page;
    typeof i2 != `string` || typeof a2 != `string` || !i2 || !a2 || j_(e8.world, e8.entity, i2, a2);
  } });
}
function vv() {
  I5.hasAction(`ui.setVisible`) || I5.registerAction(`ui.setVisible`, { params: [{ name: `visible`, type: `bool` }], run: (e8, t2, n2, r2) => {
    if (!e8.has(K)) return;
    let i2 = r2?.visible === true, a2 = e8.get(K), o2 = +!i2;
    a2.display !== o2 && (a2.display = o2, e8.set(K, a2));
  } });
}
var yv = new class {
  constructor() {
    this.name = `uiController`, this.profileDomain = `ui`;
  }
  build(e8) {
    _v(), e8.addSystemToSchedule(3, hv(e8.world), { runAfter: [qm.UIInteraction] }), e8.addSystemToSchedule(3, gv(e8.world), { runAfter: [`InteractionControllerDriverSystem`] });
  }
}();
var bv = k(`Draggable`, { enabled: true, dragThreshold: 5, lockX: false, lockY: false, constraintMin: null, constraintMax: null });
var xv = k(`DragState`, { isDragging: false, startWorldPos: { x: 0, y: 0 }, currentWorldPos: { x: 0, y: 0 }, deltaWorld: { x: 0, y: 0 }, totalDeltaWorld: { x: 0, y: 0 }, pointerStartWorld: { x: 0, y: 0 } }, { transient: true });
function Sv(e8, t2, n2, r2) {
  if (!e8.has(t2, L)) return { x: n2, y: r2 };
  let i2 = e8.get(t2, L).entity;
  if (!e8.valid(i2) || !e8.has(i2, I)) return { x: n2, y: r2 };
  let a2 = e8.get(i2, I), o2 = a2.worldScale.x === 0 ? 1 : a2.worldScale.x, s2 = a2.worldScale.y === 0 ? 1 : a2.worldScale.y, c2 = Ef(a2.worldRotation.z, a2.worldRotation.w), l2 = Math.sin(-c2), u2 = Math.cos(-c2);
  return { x: (n2 * u2 - r2 * l2) / o2, y: (n2 * l2 + r2 * u2) / s2 };
}
function Cv(e8, t2, n2, r2) {
  let i2 = e8.lockX ? t2.startWorldPos.x : n2, a2 = e8.lockY ? t2.startWorldPos.y : r2;
  return e8.constraintMin !== null && (i2 = Math.max(i2, e8.constraintMin.x), a2 = Math.max(a2, e8.constraintMin.y)), e8.constraintMax !== null && (i2 = Math.min(i2, e8.constraintMax.x), a2 = Math.min(a2, e8.constraintMax.y)), { x: i2, y: a2 };
}
var wv = class {
  constructor() {
    this.name = Km.Drag, this.dependencies = [Km.UIInteraction];
  }
  build(e8) {
    it(`Draggable`, bv), it(`DragState`, xv);
    let t2 = e8.world, n2 = e8.getResource(Vt2), i2 = null, a2 = { x: 0, y: 0 }, o2 = null;
    e8.addSystemToSchedule(2, Wi([ta(Ql), ta(Wu)], (e9, s2) => {
      if (!s2.valid) return;
      let c2 = { x: s2.worldMouseX, y: s2.worldMouseY };
      if (e9.isMouseButtonPressed(0)) {
        let e10 = t2.getEntitiesWithComponents([bv, Y]), n3 = null, o3 = -1 / 0, s3 = -1;
        for (let i3 of e10) if (t2.get(i3, bv).enabled && t2.get(i3, Y).hovered) {
          let e11 = 0;
          t2.has(i3, bt) && (e11 = t2.get(i3, bt).layer);
          let a3 = ch(t2, i3);
          (e11 > o3 || e11 === o3 && a3 >= s3) && (o3 = e11, s3 = a3, n3 = i3);
        }
        if (n3 !== null) {
          i2 = n3, a2 = { x: c2.x, y: c2.y }, t2.has(n3, xv) || t2.insert(n3, xv);
          let e11 = t2.get(n3, xv), r2 = t2.get(n3, I);
          e11.startWorldPos = { x: r2.worldPosition.x, y: r2.worldPosition.y }, e11.currentWorldPos = { x: r2.worldPosition.x, y: r2.worldPosition.y }, e11.pointerStartWorld = { x: c2.x, y: c2.y }, e11.deltaWorld = { x: 0, y: 0 }, e11.totalDeltaWorld = { x: 0, y: 0 }, e11.isDragging = false;
        }
      }
      if (i2 !== null && !e9.isMouseButtonDown(0)) {
        if (t2.valid(i2) && t2.has(i2, xv)) {
          let e10 = t2.get(i2, xv);
          e10.isDragging = false;
        }
        i2 = null;
      }
      if (i2 !== null && o2 === null) {
        if (!t2.valid(i2)) {
          i2 = null;
          return;
        }
        let e10 = c2.x - a2.x, r2 = c2.y - a2.y, l2 = Math.sqrt(e10 * e10 + r2 * r2), u2 = t2.get(i2, bv);
        if (l2 * (s2.vpW / (s2.worldRight - s2.worldLeft)) >= u2.dragThreshold) {
          o2 = i2, i2 = null;
          let e11 = t2.get(o2, xv);
          e11.isDragging = true, n2.emit(o2, `drag_start`);
        }
      }
      if (o2 !== null) {
        if (!t2.valid(o2) || !t2.has(o2, xv)) {
          o2 = null;
          return;
        }
        let r2 = t2.get(o2, xv), i3 = t2.get(o2, bv), a3 = c2.x - r2.pointerStartWorld.x, s3 = c2.y - r2.pointerStartWorld.y, l2 = r2.startWorldPos.x + a3, u2 = r2.startWorldPos.y + s3, d2 = Cv(i3, r2, l2, u2);
        l2 = d2.x, u2 = d2.y;
        let f2 = r2.currentWorldPos.x, p3 = r2.currentWorldPos.y;
        if (r2.deltaWorld = { x: l2 - f2, y: u2 - p3 }, r2.currentWorldPos = { x: l2, y: u2 }, r2.totalDeltaWorld = { x: l2 - r2.startWorldPos.x, y: u2 - r2.startWorldPos.y }, t2.has(o2, K)) {
          let e10 = t2.get(o2, K), n3 = Sv(t2, o2, r2.deltaWorld.x, r2.deltaWorld.y), i4 = e10.insetLeft.unit === 0 ? e10.insetLeft.value : 0, a4 = e10.insetTop.unit === 0 ? e10.insetTop.value : 0;
          e10.insetLeft = W2(i4 + n3.x), e10.insetTop = W2(a4 - n3.y), t2.insert(o2, K, e10);
        } else if (t2.has(o2, I)) {
          let e10 = Sv(t2, o2, r2.deltaWorld.x, r2.deltaWorld.y), n3 = t2.get(o2, I);
          n3.position.x += e10.x, n3.position.y += e10.y, t2.insert(o2, I, n3);
        }
        n2.emit(o2, `drag_move`), e9.isMouseButtonReleased(0) && (r2.isDragging = false, n2.emit(o2, `drag_end`), o2 = null);
      }
    }, { name: `DragSystem`, runAfter: [qm.UIInteraction] }), { runIf: l });
  }
};
var Tv = new wv();
var Z4 = k(`TextInput`, { value: ``, placeholder: ``, placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 }, font: 0, fontFamily: `Arial`, fontSize: 16, color: { r: 1, g: 1, b: 1, a: 1 }, backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 }, padding: 6, maxLength: 0, multiline: false, password: false, readOnly: false, focused: false, cursorPos: 0, dirty: true, textAlign: gg.Left, renderMode: yg.Auto }, { assetFields: [{ field: `font`, type: `font` }], fields: { font: { label: `Font`, tooltip: `A font file this project ships (.ttf / .otf). Overrides Font Family when set; leave empty to use a font the host already has.` }, fontFamily: { tooltip: `A font the HOST already has (system or page-loaded). Ignored when Font is set.` }, textAlign: { enum: Ge(gg), tooltip: `Where the value sits in the field. A single line holds the alignment while it fits, then scrolls to follow the caret.` }, renderMode: { enum: Ge(yg), tooltip: `Glyph pipeline for the field text \u2014 Auto (hinted bitmap when unscaled, SDF once scaled), always Bitmap, or always SDF.` } } });
var Ev = class {
  constructor() {
    this.name = Km.Focus, this.dependencies = [Km.UIInteraction];
  }
  build(e8) {
    it(`Focusable`, Fg);
    let t2 = e8.world, n2 = ci(e8), r2 = n2 ? t2.getCppRegistry() : void 0, i2 = new Ig();
    e8.insertResource(Lg, i2);
    let a2 = (e9) => !!(n2?.getUINodeHiddenInTree && r2 && n2.getUINodeHiddenInTree(r2, e9)), o2 = () => t2.getEntitiesWithComponents([u_]).filter((e9) => d_(t2, e9)), s2 = (e9, n3) => {
      if (n3.length === 0) return true;
      let r3 = new Set(n3.map((e10) => e10));
      if (r3.has(e9)) return true;
      let i3 = false;
      return dh(t2, e9, (e10) => r3.has(e10) ? (i3 = true, true) : false), i3;
    };
    e8.addSystemToSchedule(3, Wi([ta(Ql), ta(Vt2)], (e9, n3) => {
      i2.focusedEntity !== null && !t2.valid(i2.focusedEntity) ? i2.focusedEntity = null : i2.focusedEntity !== null && a2(i2.focusedEntity) && f2();
      let r3 = t2.getEntitiesWithComponents([Fg]), c2 = false;
      for (let e10 of r3) t2.has(e10, Y) && t2.get(e10, Y).justPressed && (c2 = true, d2(e10, false));
      i2.focusedEntity !== null && (e9.isMouseButtonPressed(0) && !c2 || e9.isKeyPressed(`Escape`)) && f2();
      let l2 = i2.focusedEntity;
      if (l2 !== null && t2.valid(l2) && !t2.has(l2, Z4) && (e9.isKeyPressed(`Enter`) || e9.isKeyPressed(`Space`)) && (!t2.has(l2, Rg) || t2.get(l2, Rg).enabled) && n3.emit(l2, X4.Click), e9.isKeyPressed(`Tab`)) {
        let t3 = u2();
        if (t3.length === 0) return;
        let n4 = i2.focusedEntity === null ? -1 : t3.findIndex((e10) => e10 === i2.focusedEntity), r4 = e9.isKeyDown(`Shift`), a3;
        a3 = n4 === -1 ? r4 ? t3.length - 1 : 0 : r4 ? (n4 - 1 + t3.length) % t3.length : (n4 + 1) % t3.length, d2(t3[a3], true);
      }
      function u2() {
        let e10 = o2(), n4 = [];
        for (let i3 of r3) {
          if (!t2.valid(i3) || t2.has(i3, Rg) && !t2.get(i3, Rg).enabled || a2(i3) || !s2(i3, e10)) continue;
          let r4 = t2.get(i3, Fg);
          n4.push({ entity: i3, tabIndex: r4.tabIndex });
        }
        return n4.sort((e11, t3) => e11.tabIndex - t3.tabIndex), n4.map((e11) => e11.entity);
      }
      function d2(e10, r4) {
        let a3 = i2.focusedEntity;
        if (a3 === e10) {
          i2.focusVisible = r4;
          return;
        }
        p3(a3), i2.focus(e10, r4);
        let o3 = t2.get(e10, Fg);
        o3.isFocused = true, t2.insert(e10, Fg, o3), n3.emit(e10, X4.Focus);
      }
      function f2() {
        p3(i2.focusedEntity), i2.blur();
      }
      function p3(e10) {
        if (e10 === null || !t2.valid(e10) || !t2.has(e10, Fg)) return;
        let r4 = t2.get(e10, Fg);
        r4.isFocused = false, t2.insert(e10, Fg, r4), n3.emit(e10, X4.Blur);
      }
    }, { name: `FocusSystem` }), { runIf: l });
  }
};
var Dv = new Ev();
function Ov(e8, t2, n2, r2) {
  return e8.length === 0 ? { text: n2, isPlaceholder: true } : { text: t2 ? r2.repeat(e8.length) : e8, isPlaceholder: false };
}
function kv(e8, t2, n2, r2) {
  let i2 = Math.max(0, Math.min(t2, e8.length));
  return n2 ? r2.repeat(i2) : e8.slice(0, i2);
}
function Av(e8, t2, n2, r2) {
  let i2 = Math.max(0, Math.min(e8, r2)), a2 = Math.max(0, Math.min(t2, r2)), o2 = Math.min(i2, a2), s2 = Math.max(i2, a2);
  return { lo: o2, hi: s2, caret: n2 ? o2 : s2, hasRange: s2 > o2 };
}
function jv(e8, t2) {
  let n2 = 0, r2 = 1 / 0;
  for (let i2 = 0; i2 < e8.length; i2++) {
    let a2 = Math.abs(e8[i2] - t2);
    a2 < r2 && (r2 = a2, n2 = i2);
  }
  return n2;
}
function Mv(e8, t2, n2, r2) {
  let i2 = r2 > 0 ? r2 : 1;
  return { left: e8 / i2, top: (n2 - t2) / i2 };
}
function Nv(e8) {
  let t2 = [], n2 = 0;
  for (; ; ) {
    let r2 = e8.indexOf(`
`, n2);
    if (r2 < 0) {
      t2.push({ text: e8.slice(n2), start: n2 });
      break;
    }
    t2.push({ text: e8.slice(n2, r2), start: n2 }), n2 = r2 + 1;
  }
  return t2;
}
function Pv(e8, t2) {
  let n2 = Math.max(0, Math.min(t2, e8.length)), r2 = Nv(e8);
  for (let e9 = 0; e9 < r2.length; e9++) if (n2 <= r2[e9].start + r2[e9].text.length) return { line: e9, col: n2 - r2[e9].start, lineStart: r2[e9].start };
  let i2 = r2[r2.length - 1];
  return { line: r2.length - 1, col: i2.text.length, lineStart: i2.start };
}
function Fv(e8, t2, n2) {
  let r2 = Math.max(0, Math.min(Math.min(t2, n2), e8.length)), i2 = Math.max(0, Math.min(Math.max(t2, n2), e8.length)), a2 = [], o2 = Nv(e8);
  for (let e9 = 0; e9 < o2.length; e9++) {
    let t3 = o2[e9].start, n3 = t3 + o2[e9].text.length, s2 = Math.max(r2, t3), c2 = Math.min(i2, n3);
    c2 > s2 && a2.push({ line: e9, from: s2 - t3, to: c2 - t3 });
  }
  return a2;
}
function Iv(e8, t2, n2) {
  let r2 = Math.max(0, t2 - n2);
  return e8 === 1 ? r2 / 2 : e8 === 2 ? r2 : 0;
}
var Lv = 1.2;
var Rv = { r: 0.3, g: 0.55, b: 1, a: 0.35 };
var zv = class {
  constructor() {
    this.name = Km.TextInput, this.dependencies = [Km.Focus], this.cleanupListeners_ = null;
  }
  cleanup() {
    this.cleanupListeners_ &&= (this.cleanupListeners_(), null);
  }
  build(e8) {
    if (it(`TextInput`, Z4), !l()) return;
    let t2 = kn();
    if (!t2) {
      T.info(`ui`, `TextInput: this realm has no text-editing surface \u2014 fields render, typing is off`);
      return;
    }
    let r2 = e8.wasmModule, i2 = e8.world, a2 = /* @__PURE__ */ new Map(), o2 = /* @__PURE__ */ new Map(), s2 = /* @__PURE__ */ new Map(), c2 = null, l2 = () => (c2 ||= new mg(r2), c2), u2 = false, d2 = true, f2 = 0, p3 = 0;
    function m3() {
      let t3 = e8.getResource(Lg);
      if (!t3 || t3.focusedEntity === null) return null;
      let n2 = t3.focusedEntity;
      return !i2.valid(n2) || !i2.has(n2, Z4) ? null : n2;
    }
    let h3 = t2.subscribe((t3) => {
      let n2 = m3();
      switch (t3.kind) {
        case `change`:
          !u2 && n2 !== null && g3();
          break;
        case `composition`:
          u2 = t3.composing, n2 !== null && (i2.get(n2, Z4).dirty = true), !t3.composing && n2 !== null && g3(), x5();
          break;
        case `submit`:
          n2 !== null && (e8.getResource(Vt2).emit(n2, `submit`), y5());
          break;
        case `cancel`:
          n2 !== null && y5();
          break;
        case `blur`:
          if (n2 !== null) {
            let t4 = i2.get(n2, Z4);
            if (t4.focused = false, t4.dirty = true, e8.getResource(Lg).blur(), i2.valid(n2) && i2.has(n2, Fg)) {
              let e9 = i2.get(n2, Fg);
              e9.isFocused = false, i2.insert(n2, Fg, e9);
            }
          }
      }
    });
    this.cleanupListeners_ = () => {
      h3(), t2.dispose();
      for (let e9 of a2.values()) i2.valid(e9.sel) && i2.despawn(e9.sel), i2.valid(e9.text) && i2.despawn(e9.text), i2.valid(e9.caret) && i2.despawn(e9.caret);
      a2.clear();
    };
    function g3() {
      let n2 = m3();
      if (n2 === null) return;
      let r3 = i2.get(n2, Z4);
      if (r3.readOnly) return;
      let a3 = t2.read(), o3 = a3.value;
      r3.maxLength > 0 && o3.length > r3.maxLength && (o3 = o3.substring(0, r3.maxLength), t2.write({ ...a3, value: o3, selectionStart: o3.length, selectionEnd: o3.length })), o3 !== r3.value && (r3.value = o3, e8.getResource(Vt2).emit(n2, `change`)), r3.cursorPos = Math.min(a3.selectionStart, o3.length), r3.dirty = true, x5();
    }
    function _3(n2) {
      let r3 = e8.getResource(Wu);
      if (!r3 || !r3.valid || !i2.has(n2, I) || !i2.has(n2, K)) return null;
      let a3 = i2.get(n2, Z4), c3 = lh(n2);
      if (c3 <= 0) return null;
      let u3 = i2.get(n2, I), d3 = u3.worldPosition.x - c3 / 2, f3 = t2.read().value, p4 = l2().atlas, m4 = Na(a3.font, a3.fontFamily), h4 = (e9) => $h(e9, p4, m4, a3.fontSize, 0), g4 = Math.max(0, c3 - 2 * a3.padding);
      if (a3.multiline) {
        let e9 = uh(n2), t3 = a3.fontSize * Lv, i3 = u3.worldPosition.y + e9 / 2 - r3.worldMouseY, o3 = Nv(f3), s3 = o3[Math.max(0, Math.min(Math.floor(i3 / t3), o3.length - 1))], c4 = r3.worldMouseX - d3 - a3.padding - Iv(a3.textAlign, g4, h4(s3.text)), l3 = [];
        for (let e10 = 0; e10 <= s3.text.length; e10++) l3.push(h4(s3.text.slice(0, e10)));
        return s3.start + jv(l3, c4);
      }
      let _4 = o2.get(n2) ?? 0, v5 = s2.get(n2) ?? 0, y6 = r3.worldMouseX - d3 - a3.padding - v5 + _4, b6 = [];
      for (let e9 = 0; e9 <= f3.length; e9++) b6.push(h4(kv(f3, e9, a3.password, `\u25CF`)));
      return jv(b6, y6);
    }
    function v4(e9) {
      let n2 = i2.get(e9, Z4);
      n2.readOnly || (n2.focused = true, n2.dirty = true, t2.focus({ value: n2.value, selectionStart: n2.cursorPos, selectionEnd: n2.cursorPos, backward: false }, { multiline: n2.multiline, maxLength: n2.maxLength, password: n2.password }), x5());
    }
    function y5() {
      let n2 = m3();
      if (n2 !== null) {
        let e9 = i2.get(n2, Z4);
        e9.focused = false, e9.dirty = true;
      }
      e8.getResource(Lg).blur(), t2.blur();
    }
    function b5(n2, r3, a3) {
      let o3 = e8.getResource(Wu);
      if (!o3 || !o3.valid || !i2.has(n2, I)) return;
      let s3 = i2.get(n2, I), c3 = lh(n2), l3 = uh(n2), u3 = Ug(o3, s3.worldPosition.x - c3 / 2 + r3, s3.worldPosition.y + l3 / 2 - a3), d3 = Mv(u3.x, u3.y, o3.screenH, ir());
      t2.setCaretAnchor?.(d3.left, d3.top);
    }
    function x5() {
      d2 = true, f2 = 0;
    }
    let C5 = null;
    e8.addSystemToSchedule(3, Wi([ta(Lg)], (e9) => {
      let n2 = i2.getEntitiesWithComponents([Z4]);
      for (let e10 of n2) fh(i2, e10, Fg, { tabIndex: 0, isFocused: false }), fh(i2, e10, Rg, { enabled: true, blockRaycast: true });
      let r3 = m3(), a3 = r3 !== null && !i2.get(r3, Z4).focused;
      if (r3 !== C5 || a3) {
        if (C5 !== null && C5 !== r3 && i2.valid(C5) && i2.has(C5, Z4)) {
          let e10 = i2.get(C5, Z4);
          e10.focused = false, e10.dirty = true, t2.blur();
        }
        r3 !== null && v4(r3), C5 = r3;
      }
      if (r3 !== null && i2.has(r3, Y) && i2.get(r3, Y).justPressed) {
        let e10 = _3(r3);
        if (e10 !== null) {
          t2.write({ ...t2.read(), selectionStart: e10, selectionEnd: e10, backward: false });
          let n3 = i2.get(r3, Z4);
          n3.cursorPos = e10, n3.dirty = true, x5();
        }
      }
    }, { name: `TextInputFocusSystem` }), { runAfter: [qm.Focus] }), e8.addSystemToSchedule(2, Wi([], () => {
      let e9 = typeof performance < `u` ? performance.now() : Date.now(), n2 = p3 === 0 ? 0 : (e9 - p3) / 1e3;
      p3 = e9, n2 = Math.min(n2, 0.1);
      let r3 = m3();
      r3 !== null && (f2 += n2, f2 >= 0.5 && (f2 -= 0.5, d2 = !d2));
      for (let [e10, t3] of a2) (!i2.valid(e10) || !i2.has(e10, Z4)) && (i2.valid(t3.sel) && i2.despawn(t3.sel), i2.valid(t3.text) && i2.despawn(t3.text), i2.valid(t3.caret) && i2.despawn(t3.caret), a2.delete(e10), o2.delete(e10), s2.delete(e10));
      for (let e10 of i2.getEntitiesWithComponents([Z4, K])) {
        let n3 = i2.get(e10, Z4), a3 = lh(e10), c3 = uh(e10);
        if (a3 <= 0 || c3 <= 0) continue;
        ee4(e10, n3);
        let f3 = w5(e10, n3), p4 = r3 === e10, m4 = p4 ? t2.read() : null, h4 = m4 ? m4.value : n3.value, g4 = h4.length, _4 = m4 ? Av(m4.selectionStart, m4.selectionEnd, m4.backward, g4) : { lo: 0, hi: 0, caret: Math.max(0, Math.min(n3.cursorPos, g4)), hasRange: false };
        p4 && n3.cursorPos !== _4.caret && (n3.cursorPos = _4.caret);
        let v5 = Ov(h4, n3.password, n3.placeholder, `\u25CF`), y6 = l2().atlas, x6 = Na(n3.font, n3.fontFamily), S5 = (e11) => $h(e11, y6, x6, n3.fontSize, 0), C6 = Math.max(0, a3 - 2 * n3.padding), T5 = Math.max(0, (c3 - n3.fontSize) / 2), re5, D5, ie4, ae4, oe4 = false, se5 = 0, ce5 = 0, O5 = 0;
        if (n3.multiline) {
          let e11 = n3.fontSize * Lv;
          ie4 = 0, ae4 = 0;
          let t3 = Pv(h4, _4.caret), r4 = (e12) => Nv(h4)[e12]?.text ?? ``, i3 = (e12) => Iv(n3.textAlign, C6, S5(r4(e12)));
          re5 = n3.padding + i3(t3.line) + S5(h4.slice(t3.lineStart, _4.caret)), D5 = t3.line * e11;
          let a4 = _4.hasRange ? Fv(h4, _4.lo, _4.hi) : [];
          if (a4.length === 1) {
            let t4 = Nv(h4)[a4[0].line];
            se5 = n3.padding + i3(a4[0].line) + S5(t4.text.slice(0, a4[0].from)), O5 = S5(t4.text.slice(a4[0].from, a4[0].to)), ce5 = a4[0].line * e11, oe4 = true;
          }
        } else {
          let e11 = S5(kv(h4, _4.caret, n3.password, `\u25CF`));
          if (ie4 = Math.max(0, e11 - C6), ae4 = Iv(n3.textAlign, C6, S5(v5.text)), re5 = n3.padding + ae4 + e11 - ie4, D5 = T5, _4.hasRange) {
            let e12 = S5(kv(h4, _4.lo, n3.password, `\u25CF`));
            se5 = n3.padding + ae4 + e12 - ie4, O5 = S5(kv(h4, _4.hi, n3.password, `\u25CF`)) - e12, ce5 = T5, oe4 = true;
          }
        }
        o2.set(e10, ie4), s2.set(e10, ae4), te5(f3.sel, n3, oe4, se5, ce5, O5), E5(f3.text, n3, v5, C6, ie4, ae4), ne5(f3.caret, n3, re5, D5, n3.focused && d2 && !oe4), p4 && !u2 && b5(e10, re5, D5 + n3.fontSize);
      }
    }, { name: `TextInputRenderSystem` }));
    function ee4(e9, t3) {
      if (i2.has(e9, vh) || i2.insert(e9, vh, { enabled: true, mode: _h.Scissor }), !i2.has(e9, q3)) {
        i2.insert(e9, q3, { visualType: 1, texture: 0, color: { ...t3.backgroundColor }, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 }, fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true });
        return;
      }
      let n2 = i2.get(e9, q3);
      if (n2.visualType !== 1) return;
      let r3 = t3.backgroundColor;
      (!n2.enabled || n2.color.r !== r3.r || n2.color.g !== r3.g || n2.color.b !== r3.b || n2.color.a !== r3.a) && (n2.color = { ...r3 }, n2.enabled = true, i2.insert(e9, q3, n2));
    }
    function w5(e9, t3) {
      let n2 = a2.get(e9);
      if (n2 && i2.valid(n2.sel) && i2.valid(n2.text) && i2.valid(n2.caret)) return n2;
      let r3 = W2(t3.padding), o3 = { sel: J3({ world: i2, parent: e9, node: { position: 1, width: W2(0), height: W2(t3.fontSize), insetLeft: r3, insetTop: W2(0) }, visual: { visualType: 1, color: { ...Rv }, enabled: false } }), text: J3({ world: i2, parent: e9, node: { position: 1, insetLeft: r3, insetTop: W2(0), insetBottom: W2(0), width: W2(0) }, text: { content: ``, font: t3.font, fontFamily: t3.fontFamily, fontSize: t3.fontSize, align: gg.Left, verticalAlign: _g.Middle, wordWrap: t3.multiline, renderMode: t3.renderMode } }), caret: J3({ world: i2, parent: e9, node: { position: 1, width: W2(2), height: W2(t3.fontSize), insetLeft: W2(t3.padding), insetTop: W2(0) }, visual: { visualType: 1, color: t3.color, enabled: false } }) };
      return a2.set(e9, o3), o3;
    }
    function te5(e9, t3, n2, r3, a3, o3) {
      let s3 = Math.max(0, o3), c3 = i2.get(e9, K);
      (c3.insetLeft.value !== r3 || c3.insetTop.value !== a3 || c3.width.value !== s3 || c3.height.value !== t3.fontSize) && (c3.insetLeft = W2(r3), c3.insetTop = W2(a3), c3.width = W2(s3), c3.height = W2(t3.fontSize), i2.insert(e9, K, c3));
      let l3 = i2.get(e9, q3), u3 = n2 && s3 > 0;
      l3.enabled !== u3 && (l3.enabled = u3, i2.insert(e9, q3, l3));
    }
    function E5(e9, t3, n2, r3, a3, o3) {
      let s3 = i2.get(e9, bg), c3 = n2.text, l3 = n2.isPlaceholder ? t3.placeholderColor : t3.color, u3 = t3.multiline ? _g.Top : _g.Middle, d3 = t3.multiline ? t3.textAlign : gg.Left;
      (s3.content !== c3 || s3.font !== t3.font || s3.fontFamily !== t3.fontFamily || s3.fontSize !== t3.fontSize || s3.wordWrap !== t3.multiline || s3.renderMode !== t3.renderMode || s3.verticalAlign !== u3 || s3.align !== d3 || s3.color.r !== l3.r || s3.color.g !== l3.g || s3.color.b !== l3.b || s3.color.a !== l3.a) && (s3.content = c3, s3.font = t3.font, s3.fontFamily = t3.fontFamily, s3.fontSize = t3.fontSize, s3.wordWrap = t3.multiline, s3.verticalAlign = u3, s3.align = d3, s3.renderMode = t3.renderMode, s3.color = { ...l3 }, i2.insert(e9, bg, s3));
      let f3 = i2.get(e9, K), p4 = t3.padding + o3 - a3;
      (f3.insetLeft.value !== p4 || f3.width.value !== r3) && (f3.insetLeft = W2(p4), f3.width = W2(r3), i2.insert(e9, K, f3));
    }
    function ne5(e9, t3, n2, r3, a3) {
      let o3 = i2.get(e9, K);
      (o3.insetLeft.value !== n2 || o3.insetTop.value !== r3 || o3.height.value !== t3.fontSize) && (o3.insetLeft = W2(n2), o3.insetTop = W2(r3), o3.height = W2(t3.fontSize), i2.insert(e9, K, o3));
      let s3 = i2.get(e9, q3);
      (s3.enabled !== a3 || s3.color.r !== t3.color.r || s3.color.g !== t3.color.g || s3.color.b !== t3.color.b) && (s3.enabled = a3, s3.color = { ...t3.color }, i2.insert(e9, q3, s3));
    }
  }
};
var Bv = new zv();
var Vv = class {
  constructor() {
    this.name = Km.UIRenderOrder, this.dependencies = [Km.UILayout], this.after = [Km.Text, Km.UIMask, Km.UIInteraction];
  }
  build(e8) {
    let t2 = e8.world, n2 = ci(e8), r2 = t2.getCppRegistry();
    e8.addSystemToSchedule(4, Wi([], () => {
      n2?.uiRenderOrder_update?.(r2);
    }, { name: `UIRenderOrderSystem` }));
  }
};
var Hv = new Vv();
var Uv = class {
  constructor() {
    this.name = Km.UIVisibility, this.dependencies = [Km.UIInteraction];
  }
  build(e8) {
    let t2 = e8.world, n2 = ci(e8), r2 = n2 ? t2.getCppRegistry() : void 0;
    t2.enableChangeTracking(K);
    let i2 = /* @__PURE__ */ new Map(), a2 = -1, o2 = -1;
    t2.onDespawn((e9) => {
      i2.delete(e9);
    }), e8.addSystemToSchedule(3, Wi([ta(Vt2)], (e9) => {
      if (!(e9.hasListenersFor(X4.Shown) || e9.hasListenersFor(X4.Hidden))) {
        i2.size > 0 && i2.clear(), a2 = -1, o2 = -1;
        return;
      }
      if (!n2?.getUINodeHiddenInTree || !r2) return;
      let s2 = t2.getWorldVersion();
      if (s2 !== o2 || t2.anyChangedSince(K, a2)) {
        o2 = s2, a2 = t2.getWorldTick() - 1;
        for (let a3 of t2.getEntitiesWithComponents([K])) {
          let t3 = !n2.getUINodeHiddenInTree(r2, a3), o3 = i2.get(a3);
          i2.set(a3, t3), o3 !== void 0 && o3 !== t3 && e9.emit(a3, t3 ? X4.Shown : X4.Hidden);
        }
      }
    }, { name: `UIVisibilityEventSystem` }), { runAfter: [qm.UILayout], runIf: l });
  }
};
var Wv = new Uv();
var Gv = [gh, bh, Eh, Eg, Pg, Xg, Wv, sv, yv, Tv, Dv, Bv, Hv];
var Kv = class {
  constructor() {
    this.name = `ui`;
  }
  build(e8) {
    for (let t2 of Gv) t2.build(e8);
  }
  cleanup(e8) {
    for (let t2 = Gv.length - 1; t2 >= 0; t2--) Gv[t2].cleanup?.(e8);
  }
  get events() {
    return sv.events;
  }
  registerListView(e8) {
    sv.registerListView(e8);
  }
  unregisterListView(e8) {
    sv.unregisterListView(e8);
  }
  attachScrollContainer(e8, t2) {
    sv.attachScrollContainer(e8, t2);
  }
  detachScrollContainer(e8) {
    sv.detachScrollContainer(e8);
  }
};
var qv = new Kv();
var my = { x: 1 / 512, y: 1 / 512 };
var Cy = { enabled: false, spacing: 32, majorEvery: 10, color: [1, 1, 1, 0.05], majorColor: [1, 1, 1, 0.1], axisX: [0.812, 0.357, 0.325, 0.55], axisY: [0.502, 0.725, 0.29, 0.55] };
var wy = ea({ ...Cy }, `EditorGrid`);
var Qy = (function(e8) {
  return e8[e8.Painter = 0] = `Painter`, e8[e8.YSort = 1] = `YSort`, e8[e8.Depth = 2] = `Depth`, e8;
})({});
var rb = (function(e8) {
  return e8[e8.Start = 0] = `Start`, e8[e8.Center = 1] = `Center`, e8[e8.End = 2] = `End`, e8[e8.Stretch = 3] = `Stretch`, e8;
})({});
var ex = `achievements`;
function tx() {
  let e8 = (() => {
    let e9 = Hl.getJSON(ex);
    return { unlocked: e9?.unlocked ?? [], stats: e9?.stats ?? {} };
  })(), t2 = () => Hl.setJSON(ex, e8);
  return { platformBacked: false, unlock: (n2) => (e8.unlocked.includes(n2) || (e8.unlocked.push(n2), t2()), Promise.resolve()), unlocked: (t3) => e8.unlocked.includes(t3), setStat: (n2, r2) => {
    e8.stats[n2] = r2, t2();
  }, getStat: (t3) => e8.stats[t3] ?? 0, store: () => Promise.resolve(), reset: () => (e8 = { unlocked: [], stats: {} }, t2(), Promise.resolve()) };
}
var nx = class {
  constructor() {
    this.provider_ = tx(), this.known_ = null;
  }
  get available() {
    return this.provider_.platformBacked;
  }
  setKnown(e8) {
    this.known_ = e8 && e8.length > 0 ? [...e8] : null;
  }
  setProvider(e8) {
    this.provider_ = e8 ?? tx();
  }
  async unlock(e8) {
    this.check_(e8) && await this.provider_.unlock(e8);
  }
  unlocked(e8) {
    return this.provider_.unlocked(e8);
  }
  setStat(e8, t2) {
    this.provider_.setStat(e8, t2);
  }
  getStat(e8) {
    return this.provider_.getStat(e8);
  }
  store() {
    return this.provider_.store();
  }
  reset() {
    return this.provider_.reset();
  }
  check_(e8) {
    return !this.known_ || this.known_.includes(e8) ? true : (T.error(`achievements`, `"${e8}" is not one of this project's achievements (${this.known_.join(`, `)}) \u2014 a store would accept it and do nothing.`), false);
  }
};
var rx = ea(null, `Achievements`);
var ix = class {
  constructor(e8) {
    this.handles_ = /* @__PURE__ */ new Set(), this.refResolver_ = null, this.disposed_ = false, this.baseUrl = ``, this.backend_ = e8;
  }
  get backendName() {
    return this.backend_.name;
  }
  setRefResolver(e8) {
    this.refResolver_ = e8;
  }
  resolveUrl_(e8) {
    return this.refResolver_ ? this.refResolver_(e8) : !this.baseUrl || e8.includes(`://`) || e8.startsWith(`/`) || e8.startsWith(`blob:`) || e8.startsWith(`data:`) ? e8 : `${this.baseUrl}/${e8}`;
  }
  play(e8, t2 = {}) {
    let n2 = this.backend_.createStream(this.resolveUrl_(e8), { ...t2, audioTrackUrl: t2.audioTrackUrl ?? this.resolveAudioTrack_(e8) });
    return this.handles_.add(n2), n2;
  }
  resolveAudioTrack_(e8) {
    if (!this.refResolver_) return;
    let t2 = e8.startsWith(`@uuid:`) ? `${e8}-audio` : `${e8}.m4a`, n2 = this.refResolver_(t2);
    return n2 === t2 ? void 0 : n2;
  }
  update(e8) {
    if (!this.disposed_) for (let t2 of this.handles_) try {
      t2.pump(e8);
    } catch (e9) {
      T.error(`video`, `pump failed for stream #${t2.id} \u2014 stopping it`, e9), this.handles_.delete(t2);
      try {
        t2.stop();
      } catch {
      }
      t2.onError?.(e9);
    }
  }
  stop(e8) {
    this.handles_.delete(e8) && e8.stop();
  }
  stopAll() {
    for (let e8 of this.handles_) e8.stop();
    this.handles_.clear();
  }
  dispose() {
    this.disposed_ || (this.disposed_ = true, this.stopAll(), this.backend_.dispose());
  }
};
var ax = ea(null, `VideoPlayer`);
var ox = class {
  constructor(e8 = {}) {
    this.opts = e8, this.name = `localization`;
  }
  build(e8) {
    let t2 = new Ic(this.opts.locale, this.opts.fallback);
    if (this.opts.catalogs) for (let e9 of Object.keys(this.opts.catalogs)) t2.addCatalog(e9, this.opts.catalogs[e9]);
    e8.insertResource(Lc, t2);
    let r2 = this.opts.tables;
    r2 && r2.length > 0 && e8.addSystemToSchedule(0, Wi([], () => {
      if (!e8.hasResource(U4)) {
        T.error(`i18n`, `LocalizationPlugin: 'tables' needs the AssetPlugin \u2014 ${r2.length} table(s) not loaded`);
        return;
      }
      let t3 = e8.getResource(U4);
      for (let e9 of r2) t3.loadLocaleTable(e9).catch((t4) => {
        T.error(`i18n`, `failed to load locale table ${e9}: ${t4 instanceof Error ? t4.message : String(t4)}`);
      });
    }, { name: `LocaleTableStartupSystem` }));
  }
};
var sx = new ox();
var Q3 = { Running: 0, Paused: 1, Completed: 2, Cancelled: 3 };
var Ax = { None: 0, Restart: 1, PingPong: 2 };
var jx = class {
  constructor(e8, t2) {
    this.entries_ = /* @__PURE__ */ new Map(), this.nextId_ = 1, this.cppSequences_ = /* @__PURE__ */ new Map(), this.module_ = e8, this.registry_ = t2;
  }
  create(e8, t2, n2, r2, i2) {
    let a2 = this.nextId_++;
    return this.entries_.set(a2, { id: a2, from: e8, to: t2, duration: n2, elapsed: 0, delay: i2?.delay ?? 0, easing: i2?.easing ?? vp.Linear, bezierPoints: null, state: Q3.Running, loop: i2?.loop ?? Ax.None, loopCount: i2?.loopCount ?? 0, loopsRemaining: i2?.loopCount ?? 0, callback: r2, sequenceNext: null, sequenceNextExternal: null }), a2;
  }
  update(e8) {
    for (let [e9, t2] of this.cppSequences_) this.module_.anim_getTweenState?.(this.registry_, e9) === Q3.Completed && (this.resume(t2), this.cppSequences_.delete(e9));
    for (let [e9, t2] of this.entries_) (t2.state === Q3.Completed || t2.state === Q3.Cancelled) && this.entries_.delete(e9);
    for (let t2 of this.entries_.values()) {
      if (t2.state !== Q3.Running) continue;
      let n2 = e8;
      if (t2.delay > 0) {
        if (t2.delay -= n2, t2.delay > 0) continue;
        n2 = -t2.delay, t2.delay = 0;
      }
      t2.elapsed += n2;
      let r2 = Math.min(t2.elapsed / t2.duration, 1), i2 = Up(t2.easing, r2, t2.bezierPoints ?? void 0);
      if (t2.callback(t2.from + (t2.to - t2.from) * i2), r2 >= 1) {
        if (t2.loop !== Ax.None) {
          let e9 = t2.loopCount === 0;
          if (e9 || t2.loopsRemaining > 1) {
            if (e9 || t2.loopsRemaining--, t2.elapsed = 0, t2.loop === Ax.PingPong) {
              let e10 = t2.from;
              t2.from = t2.to, t2.to = e10;
            }
            continue;
          }
        }
        t2.state = Q3.Completed, t2.sequenceNext !== null && this.resume(t2.sequenceNext), t2.sequenceNextExternal && t2.sequenceNextExternal.resume();
      }
    }
  }
  pause(e8) {
    let t2 = this.entries_.get(e8);
    t2 && t2.state === Q3.Running && (t2.state = Q3.Paused);
  }
  resume(e8) {
    let t2 = this.entries_.get(e8);
    t2 && t2.state === Q3.Paused && (t2.state = Q3.Running);
  }
  cancel(e8) {
    let t2 = this.entries_.get(e8);
    t2 && (t2.state = Q3.Cancelled);
  }
  getState(e8) {
    let t2 = this.entries_.get(e8);
    return t2 ? t2.state : Q3.Cancelled;
  }
  setBezier(e8, t2, n2, r2, i2) {
    let a2 = this.entries_.get(e8);
    a2 && (a2.bezierPoints = { p1x: t2, p1y: n2, p2x: r2, p2y: i2 });
  }
  setSequenceNext(e8, t2) {
    let n2 = this.entries_.get(e8);
    n2 && (n2.sequenceNext = t2, this.pause(t2));
  }
  setSequenceNextExternal(e8, t2) {
    let n2 = this.entries_.get(e8);
    n2 && (n2.sequenceNextExternal = t2, t2.pause());
  }
  registerCppSequence(e8, t2) {
    this.cppSequences_.set(e8, t2), this.pause(t2);
  }
};
var Mx = class e6 {
  constructor(e8, t2) {
    this.manager_ = e8, this.id = t2;
  }
  get manager() {
    return this.manager_;
  }
  get state() {
    return this.manager_.getState(this.id);
  }
  bezier(e8, t2, n2, r2) {
    return this.manager_.setBezier(this.id, e8, t2, n2, r2), this;
  }
  then(t2) {
    return t2 instanceof e6 ? this.manager_.setSequenceNext(this.id, t2.id) : this.manager_.setSequenceNextExternal(this.id, t2), this;
  }
  pause() {
    this.manager_.pause(this.id);
  }
  resume() {
    this.manager_.resume(this.id);
  }
  cancel() {
    this.manager_.cancel(this.id);
  }
};
var Nx = class {
  constructor(e8) {
    this.onComplete_ = null, this.completed_ = false, this.tweens_ = [...e8];
  }
  get state() {
    return this.completed_ || this.tweens_.every((e8) => e8.state === Q3.Completed) ? Q3.Completed : this.tweens_.some((e8) => e8.state === Q3.Cancelled) ? Q3.Cancelled : this.tweens_.every((e8) => e8.state === Q3.Paused || e8.state === Q3.Completed) ? Q3.Paused : Q3.Running;
  }
  pause() {
    for (let e8 of this.tweens_) e8.state === Q3.Running && e8.pause();
  }
  resume() {
    for (let e8 of this.tweens_) e8.state === Q3.Paused && e8.resume();
  }
  cancel() {
    for (let e8 of this.tweens_) e8.cancel();
  }
  onComplete(e8) {
    return this.onComplete_ = e8, this;
  }
  checkComplete() {
    return this.completed_ ? true : this.state === Q3.Completed && (this.completed_ = true, this.onComplete_?.(), true);
  }
};
var Px = class {
  constructor(e8) {
    this.currentIndex_ = 0, this.currentTween_ = null, this.completed_ = false, this.cancelled_ = false, this.paused_ = false, this.onComplete_ = null, this.factories_ = [...e8], this.factories_.length > 0 ? this.currentTween_ = this.factories_[0]() : this.completed_ = true;
  }
  get state() {
    return this.cancelled_ ? Q3.Cancelled : this.completed_ ? Q3.Completed : this.paused_ ? Q3.Paused : Q3.Running;
  }
  pause() {
    this.paused_ = true, this.currentTween_?.pause();
  }
  resume() {
    this.paused_ = false, this.currentTween_?.resume();
  }
  cancel() {
    this.cancelled_ = true, this.currentTween_?.cancel();
  }
  onComplete(e8) {
    return this.onComplete_ = e8, this;
  }
  checkComplete() {
    if (this.completed_ || this.cancelled_) return true;
    if (this.paused_ || !this.currentTween_) return false;
    if (this.currentTween_.state === Q3.Completed) {
      if (this.currentIndex_++, this.currentIndex_ >= this.factories_.length) return this.completed_ = true, this.onComplete_?.(), true;
      this.currentTween_ = this.factories_[this.currentIndex_]();
    }
    return false;
  }
};
var Fx = class {
  constructor() {
    this.active_ = /* @__PURE__ */ new Set();
  }
  add(e8) {
    this.active_.add(e8);
  }
  update() {
    for (let e8 of this.active_) e8.checkComplete() && this.active_.delete(e8);
  }
  clear() {
    this.active_.clear();
  }
  get activeCount() {
    return this.active_.size;
  }
};
var Lx = class {
  constructor(e8, t2, n2, r2) {
    this.module_ = e8, this.registry_ = t2, this.valueManager_ = n2, this.entity = r2;
  }
  get state() {
    return this.module_.anim_getTweenState?.(this.registry_, this.entity) ?? Q3.Completed;
  }
  bezier(e8, t2, n2, r2) {
    return this.module_.anim_setTweenBezier?.(this.registry_, this.entity, e8, t2, n2, r2), this;
  }
  then(e8) {
    return e8 instanceof Mx ? (this.valueManager_.registerCppSequence(this.entity, e8.id), this) : (this.module_.anim_setSequenceNext?.(this.registry_, this.entity, e8.entity), this);
  }
  pause() {
    this.module_.anim_pauseTween?.(this.registry_, this.entity);
  }
  resume() {
    this.module_.anim_resumeTween?.(this.registry_, this.entity);
  }
  cancel() {
    this.module_.anim_cancelTween?.(this.registry_, this.entity);
  }
};
var Rx = class {
  constructor(e8, t2) {
    this.module_ = e8, this.registry_ = t2, this.valueManager_ = new jx(e8, t2), this.compositionManager_ = new Fx();
  }
  to(e8, t2, n2, r2, i2, a2) {
    let o2 = a2?.easing ?? vp.Linear, s2 = a2?.delay ?? 0, c2 = a2?.loop ?? Ax.None, l2 = a2?.loopCount ?? 0, u2 = this.module_.anim_createTween?.(this.registry_, e8, t2, n2, r2, i2, o2, s2, c2, l2) ?? 0;
    return new Lx(this.module_, this.registry_, this.valueManager_, u2);
  }
  value(e8, t2, n2, r2, i2) {
    let a2 = this.valueManager_.create(e8, t2, n2, r2, i2);
    return new Mx(this.valueManager_, a2);
  }
  cancel(e8) {
    this.module_.anim_cancelTween?.(this.registry_, e8.entity);
  }
  cancelAll(e8) {
    this.module_.anim_cancelAllTweens?.(this.registry_, e8);
  }
  update(e8) {
    this.module_.anim_updateTweens?.(this.registry_, e8), this.valueManager_.update(e8), this.compositionManager_.update();
  }
  parallel(e8) {
    let t2 = new Nx(e8);
    return this.compositionManager_.add(t2), t2;
  }
  sequence(e8) {
    let t2 = new Px(e8);
    return this.compositionManager_.add(t2), t2;
  }
  delay(e8) {
    let t2 = this.valueManager_.create(0, 0, e8, () => {
    });
    return new Mx(this.valueManager_, t2);
  }
  get activeCompositionCount() {
    return this.compositionManager_.activeCount;
  }
  clear() {
    this.compositionManager_.clear();
  }
};
var zx = ea(null, `Tween`);
var fS = class {
  constructor() {
    this.name = `animation`, this.offDespawn_ = null;
  }
  build(e8) {
    let t2 = ci(e8), r2 = e8.world.getCppRegistry();
    t2 && typeof t2.anim_createTween != `function` && T.warn(`animation`, `this engine core has no tween system \u2014 Tween.to() will not animate`);
    let i2 = new Rx(t2 ?? {}, r2);
    e8.insertResource(zx, i2);
    let a2 = new te4();
    e8.insertResource(ne4, a2);
    let o2 = new se3();
    e8.insertResource(I4, o2);
    let s2 = e8.world;
    this.offDespawn_ = s2.onDespawn((e9) => {
      i2.cancelAll(e9), a2.removeEntityListeners(e9), o2.removeEntity(e9);
    }), e8.addSystemToSchedule(3, Wi([ta(aa), ta(zx)], (e9, t3) => {
      t3.update(e9.delta);
    }, { name: `TweenSystem` }), { runIf: l });
    let c2 = (t3) => ol(e8.hasResource(U4) ? e8.getResource(U4) : null, t3);
    e8.addSystemToSchedule(3, Wi([ta(I4)], (e9) => {
      e9.update(s2, c2);
    }, { name: `AnimatorSystem` }), { runAfter: [qm.Tween], runIf: l }), e8.addSystemToSchedule(3, Wi([ta(aa), ta(ne4)], (e9, t3) => {
      t3.update(s2, e9.delta);
    }, { name: `SpriteAnimatorSystem` }), { runAfter: [qm.Tween, qm.Animator], runIf: l });
  }
  cleanup() {
    this.offDespawn_?.(), this.offDespawn_ = null;
  }
};
var pS = new fS();
var mS = (function(e8) {
  return e8[e8.Linear = 0] = `Linear`, e8[e8.Inverse = 1] = `Inverse`, e8[e8.Exponential = 2] = `Exponential`, e8;
})({});
var hS = { model: 1, refDistance: 100, maxDistance: 1e3, rolloff: 1 };
function gS(e8, t2 = hS) {
  let { model: n2, refDistance: r2, maxDistance: i2, rolloff: a2 } = t2, o2 = Math.max(e8, 1e-3), s2;
  switch (n2) {
    case 0: {
      let e9 = i2 - r2;
      if (e9 <= 0) return 1;
      s2 = 1 - (Math.min(Math.max(o2, r2), i2) - r2) / e9;
      break;
    }
    case 1:
      s2 = r2 / Math.max(o2, r2);
      break;
    case 2:
      s2 = (Math.max(o2, r2) / r2) ** +-a2;
      break;
    default:
      return 1;
  }
  return Math.max(0, Math.min(1, s2));
}
function _S(e8, t2, n2, r2, i2) {
  let a2 = e8 - n2;
  return Math.max(-1, Math.min(1, a2 / Math.max(i2, 1e-3)));
}
var vS = k(`AudioSource`, { clip: ``, bus: `sfx`, volume: 1, pitch: 1, loop: false, playOnAwake: false, spatial: false, minDistance: 100, maxDistance: 1e3, attenuationModel: 1, rolloff: 1, priority: 0, enabled: true }, { assetFields: [{ field: `clip`, type: `audio` }] });
var yS = k(`AudioListener`, { enabled: true });
var bS = class {
  constructor(e8 = {}) {
    this.name = `audio`, this.activeSourceHandles_ = null, this.playedEntities_ = null, this.audio_ = null, this.offMemoryWarning_ = null, this.offDespawn_ = null, this.config_ = e8;
  }
  build(e8) {
    let t2 = Mn(), r2 = this.config_;
    t2.initialize({ initialPoolSize: r2.initialPoolSize }).catch((e9) => {
      T.warn(`audio`, `backend initialization failed`, e9);
    });
    let i2 = t2.mixer, a2 = new el(t2, i2);
    this.audio_ = a2, e8.insertResource(tl, a2), this.offMemoryWarning_ = In(() => {
      let e9 = a2.trimBufferCache();
      e9 > 0 && T.info(`audio`, `memory warning: trimmed ${e9} cached buffer(s)`);
    }), i2 && (r2.masterVolume !== void 0 && (i2.master.volume = r2.masterVolume), r2.musicVolume !== void 0 && (i2.music.volume = r2.musicVolume), r2.sfxVolume !== void 0 && (i2.sfx.volume = r2.sfxVolume));
    let o2 = /* @__PURE__ */ new Map();
    this.activeSourceHandles_ = o2;
    let s2 = /* @__PURE__ */ new Set();
    this.playedEntities_ = s2, this.offDespawn_ = e8.world.onDespawn((e9) => {
      let t3 = o2.get(e9);
      t3 && (t3.stop(), o2.delete(e9)), s2.delete(e9);
    });
    let c2 = /* @__PURE__ */ new Set(), u2 = false, d2 = false;
    e8.addSystemToSchedule(2, Wi([ta(aa), ta(tl)], (r3, i3) => {
      if (!(!a() || c())) {
        d2 &&= (u2 = false, false);
        return;
      }
      d2 = true, i3.updateFades(r3.delta), i3.updateDucking();
      let a3 = e8.world, f2 = 0, p3 = 0, m3 = false, g3 = a3.getEntitiesWithComponents([yS, yt]);
      for (let e9 of g3) if (a3.get(e9, yS).enabled) {
        let t3 = a3.get(e9, yt);
        f2 = t3.position.x, p3 = t3.position.y, m3 = true;
        break;
      }
      let v4 = a3.getEntitiesWithComponents([vS]);
      c2.clear();
      for (let e9 of v4) {
        let r4 = a3.get(e9, vS);
        if (!r4.enabled || !r4.clip) continue;
        let d3 = e9;
        if (c2.add(d3), r4.playOnAwake && !s2.has(d3) && !o2.has(d3) && t2.isReady) {
          let e10 = i3.getBufferHandle(r4.clip);
          if (e10) {
            let n2 = t2.play(e10, { bus: r4.bus, volume: r4.volume, loop: r4.loop, playbackRate: r4.pitch });
            o2.set(d3, n2), s2.add(d3);
          } else s2.add(d3), T.warn(`audio`, `playOnAwake: clip "${r4.clip}" not preloaded`);
        }
        if (r4.spatial && o2.has(d3)) {
          let t3 = o2.get(d3);
          if (!t3.isPlaying) {
            o2.delete(d3);
            continue;
          }
          !m3 && !u2 && (T.warn(`audio`, `spatial audio used but no AudioListener entity found`), u2 = true);
          let i4 = a3.tryGet?.(e9, yt), s3 = i4?.position.x ?? 0, c3 = i4?.position.y ?? 0, h3 = s3 - f2, g4 = c3 - p3, _3 = gS(Math.sqrt(h3 * h3 + g4 * g4), { model: r4.attenuationModel, refDistance: r4.minDistance, maxDistance: r4.maxDistance, rolloff: r4.rolloff }), v5 = _S(s3, c3, f2, p3, r4.maxDistance);
          t3.setVolume(r4.volume * _3), t3.setPan(v5);
        }
      }
      for (let [e9, t3] of o2) (!c2.has(e9) || !t3.isPlaying) && o2.delete(e9);
    }, { name: `AudioUpdateSystem` }));
  }
  stopAllSources() {
    if (this.activeSourceHandles_) {
      for (let e8 of this.activeSourceHandles_.values()) e8.stop();
      this.activeSourceHandles_.clear();
    }
    this.playedEntities_?.clear();
  }
  cleanup() {
    this.offMemoryWarning_?.(), this.offMemoryWarning_ = null, this.offDespawn_?.(), this.offDespawn_ = null, this.stopAllSources(), this.audio_?.dispose(), this.audio_ = null;
  }
};
var xS = new bS();
var SS = Math.PI / 180;
var CS = 180 / Math.PI;
var ES = class e7 {
  constructor(e8) {
    this.provider_ = null, this.rewarded_ = /* @__PURE__ */ new Map(), this.interstitials_ = /* @__PURE__ */ new Map(), this.showing_ = false, this.takeover_ = e8;
  }
  get available() {
    return this.provider_ !== null || Un();
  }
  get showing() {
    return this.showing_;
  }
  setProvider(e8) {
    this.provider_ = e8, this.dropCachedUnits_();
  }
  preloadRewarded(e8) {
    let t2 = this.rewardedUnit_(e8);
    return t2 ? t2.preload().catch(() => {
    }) : Promise.resolve();
  }
  showRewarded(t2) {
    let n2 = this.rewardedUnit_(t2);
    return n2 ? this.withTakeover_(() => n2.show()) : Promise.reject(Error(e7.NO_SOURCE));
  }
  showInterstitial(t2) {
    let n2 = this.interstitialUnit_(t2);
    return n2 ? this.withTakeover_(() => n2.show()) : Promise.reject(Error(e7.NO_SOURCE));
  }
  static {
    this.NO_SOURCE = `no ad source on this platform \u2014 check Ads.available, or install a provider (the editor installs a mock in play mode)`;
  }
  async withTakeover_(e8) {
    this.showing_ = true;
    try {
      return await this.takeover_.around(e8);
    } finally {
      this.showing_ = false;
    }
  }
  rewardedUnit_(e8) {
    let t2 = this.rewarded_.get(e8) ?? null;
    return t2 || (t2 = this.provider_?.createRewardedAd(e8) ?? Wn(e8), t2 && this.rewarded_.set(e8, t2)), t2;
  }
  interstitialUnit_(e8) {
    let t2 = this.interstitials_.get(e8) ?? null;
    return t2 || (t2 = this.provider_?.createInterstitialAd(e8) ?? Gn(e8), t2 && this.interstitials_.set(e8, t2)), t2;
  }
  dropCachedUnits_() {
    for (let e8 of this.rewarded_.values()) e8.destroy();
    for (let e8 of this.interstitials_.values()) e8.destroy();
    this.rewarded_.clear(), this.interstitials_.clear();
  }
};
var DS = ea(null, `Ads`);
function OS(e8) {
  let t2 = 0, n2 = false, r2 = { begin() {
    t2++ > 0 || (n2 = e8.isPaused(), n2 || e8.setPaused(true), e8.suspendAudio());
  }, end() {
    t2 === 0 || --t2 > 0 || (e8.resumeAudio(), n2 || e8.setPaused(false));
  }, get active() {
    return t2 > 0;
  }, async around(e9) {
    r2.begin();
    try {
      return await e9();
    } finally {
      r2.end();
    }
  } };
  return r2;
}
var kS = class {
  get available() {
    return Yn();
  }
  async login() {
    return { code: await Xn() };
  }
  sessionValid() {
    return Zn();
  }
};
var AS = ea(null, `Identity`);
var jS = class {
  constructor() {
    this.name = `Services`, this.profileDomain = `services`;
  }
  build(e8) {
    let t2 = OS({ setPaused: (t3) => e8.setPaused(t3), isPaused: () => e8.isPaused(), suspendAudio: () => e8.getResource(tl)?.suspend(), resumeAudio: () => e8.getResource(tl)?.resume() });
    e8.insertResource(DS, new ES(t2)), P5().onStoreOverlay?.((e9) => {
      e9 ? t2.begin() : t2.end();
    }), e8.insertResource(rx, new nx()), e8.insertResource(AS, new kS());
  }
};
var MS = new jS();
var NS = k(`Video`, { source: ``, autoplay: true, loop: true, muted: true, volume: 1, playbackRate: 1, fitSize: true, enabled: true }, { assetFields: [{ field: `source`, type: `video` }] });
var PS = 1;
var FS = class {
  constructor(e8) {
    this.id = PS++, this.textureHandle = 0, this.width = 0, this.height = 0, this.isReady = false, this.playing_ = e8.autoplay ?? true;
  }
  get isPlaying() {
    return this.playing_;
  }
  get currentTime() {
    return 0;
  }
  get duration() {
    return 0;
  }
  play() {
    this.playing_ = true;
  }
  pause() {
    this.playing_ = false;
  }
  stop() {
    this.playing_ = false, this.onEnded = void 0;
  }
  seek() {
  }
  setVolume() {
  }
  setMuted() {
  }
  setLoop() {
  }
  setPlaybackRate() {
  }
  pump() {
  }
};
var IS = class {
  constructor() {
    this.name = `null`;
  }
  createStream(e8, t2) {
    return new FS(t2);
  }
  dispose() {
  }
};
function LS(e8, t2, n2, i2) {
  let a2 = n2.textureHandle, o2 = e8.tryGet(t2, bt);
  if (o2) {
    let s3 = false;
    return o2.texture !== a2 && (o2.texture = a2, s3 = true), i2.fitSize && n2.width > 0 && (o2.size.x !== n2.width || o2.size.y !== n2.height) && (o2.size = { x: n2.width, y: n2.height }, s3 = true), s3 && e8.insert(t2, bt, o2), true;
  }
  let s2 = e8.tryGet(t2, q3);
  if (s2) {
    let n3 = false;
    return s2.texture !== a2 && (s2.texture = a2, n3 = true), s2.visualType !== 2 && (s2.visualType = 2, n3 = true), n3 && e8.insert(t2, q3, s2), true;
  }
  let c2 = e8.tryGet(t2, At);
  return c2 ? (c2.texture !== a2 && (c2.texture = a2, e8.insert(t2, At, c2)), true) : false;
}
var RS = class {
  constructor() {
    this.name = `video`, this.video_ = null, this.handles_ = null;
  }
  build(e8) {
    let t2 = new ix(P5().createVideoBackend?.({ sideModules: () => e8.sideModules, audio: () => {
      try {
        return e8.getResource(tl);
      } catch {
        return null;
      }
    } }) ?? new IS());
    this.video_ = t2, e8.insertResource(ax, t2);
    let r2 = /* @__PURE__ */ new Map();
    this.handles_ = r2;
    let i2 = /* @__PURE__ */ new Set(), a2 = /* @__PURE__ */ new Set();
    e8.world.onDespawn((e9) => {
      let n2 = r2.get(e9);
      n2 && (t2.stop(n2), r2.delete(e9)), i2.delete(e9);
    }), e8.addSystemToSchedule(3, Wi([ta(aa), ta(ax)], (t3, o2) => {
      if (a() && !c()) return;
      let s2 = e8.world, c2 = s2.getWasmModule(), l2 = s2.getEntitiesWithComponents([NS]);
      a2.clear();
      for (let e9 of l2) {
        let t4 = s2.get(e9, NS);
        if (!t4.enabled || !t4.source) continue;
        let n2 = e9;
        a2.add(n2), r2.has(n2) || r2.set(n2, o2.play(t4.source, { autoplay: t4.autoplay, loop: t4.loop, muted: t4.muted, volume: t4.volume, playbackRate: t4.playbackRate }));
      }
      o2.update(c2);
      for (let e9 of l2) {
        let t4 = e9, a3 = r2.get(t4);
        !a3 || !a3.textureHandle || !LS(s2, e9, a3, s2.get(e9, NS)) && !i2.has(t4) && (T.warn(`video`, `entity ${t4} has a Video but no renderable (Sprite/UIVisual/Mesh2D) to show it on`), i2.add(t4));
      }
      for (let [e9, t4] of r2) a2.has(e9) || (o2.stop(t4), r2.delete(e9), i2.delete(e9));
    }, { name: `VideoUpdateSystem` }));
  }
  stopAll() {
    if (this.handles_) {
      for (let e8 of this.handles_.values()) e8.stop();
      this.handles_.clear();
    }
  }
  cleanup() {
    this.stopAll(), this.video_?.dispose(), this.video_ = null;
  }
};
var zS = new RS();
var BS = class {
  constructor(e8, t2) {
    this.module_ = e8, this.registry_ = t2;
  }
  update(e8) {
    this.module_.particle_update?.(this.registry_, e8);
  }
  play(e8) {
    this.module_.particle_play?.(this.registry_, e8);
  }
  stop(e8) {
    this.module_.particle_stop?.(this.registry_, e8);
  }
  reset(e8) {
    this.module_.particle_reset?.(this.registry_, e8);
  }
  getAliveCount(e8) {
    return this.module_.particle_getAliveCount?.(e8) ?? 0;
  }
  setColorLut(e8, t2) {
    this.uploadLut(this.module_.particle_set_color_lut, e8, t2, 4);
  }
  setSizeLut(e8, t2) {
    this.uploadLut(this.module_.particle_set_size_lut, e8, t2, 1);
  }
  uploadLut(e8, t2, n2, r2) {
    if (!e8) return;
    if (!n2 || n2.length === 0) {
      e8(t2, 0, 0);
      return;
    }
    let { _malloc: i2, _free: a2, HEAPF32: o2 } = this.module_;
    if (!i2 || !a2 || !o2) return;
    let s2 = i2(n2.length * 4);
    try {
      o2.set(n2, s2 / 4), e8(t2, s2, n2.length / r2);
    } finally {
      a2(s2);
    }
  }
};
var VS = ea(null, `Particle`);
function HS(e8, t2) {
  let n2 = e8[0];
  if (t2 <= n2.t) return n2.color;
  let r2 = e8[e8.length - 1];
  if (t2 >= r2.t) return r2.color;
  for (let n3 = 0; n3 < e8.length - 1; n3++) {
    let r3 = e8[n3], i2 = e8[n3 + 1];
    if (t2 >= r3.t && t2 <= i2.t) {
      let e9 = i2.t - r3.t, n4 = e9 > 1e-6 ? (t2 - r3.t) / e9 : 0;
      return { r: r3.color.r + (i2.color.r - r3.color.r) * n4, g: r3.color.g + (i2.color.g - r3.color.g) * n4, b: r3.color.b + (i2.color.b - r3.color.b) * n4, a: r3.color.a + (i2.color.a - r3.color.a) * n4 };
    }
  }
  return r2.color;
}
function US(e8, t2 = 32) {
  let n2 = e8?.stops;
  if (!n2 || n2.length === 0) return null;
  let r2 = [...n2].sort((e9, t3) => e9.t - t3.t), i2 = new Float32Array(t2 * 4);
  for (let e9 = 0; e9 < t2; e9++) {
    let n3 = HS(r2, t2 > 1 ? e9 / (t2 - 1) : 0);
    i2[e9 * 4] = n3.r, i2[e9 * 4 + 1] = n3.g, i2[e9 * 4 + 2] = n3.b, i2[e9 * 4 + 3] = n3.a;
  }
  return i2;
}
function WS(e8, t2) {
  let n2 = e8[0];
  if (t2 <= n2.t) return n2.v;
  let r2 = e8[e8.length - 1];
  if (t2 >= r2.t) return r2.v;
  for (let n3 = 0; n3 < e8.length - 1; n3++) {
    let r3 = e8[n3], i2 = e8[n3 + 1];
    if (t2 >= r3.t && t2 <= i2.t) {
      let e9 = i2.t - r3.t, n4 = e9 > 1e-6 ? (t2 - r3.t) / e9 : 0;
      return r3.v + (i2.v - r3.v) * n4;
    }
  }
  return r2.v;
}
function GS(e8, t2 = 32) {
  let n2 = e8?.keys;
  if (!n2 || n2.length === 0) return null;
  let r2 = [...n2].sort((e9, t3) => e9.t - t3.t), i2 = new Float32Array(t2);
  for (let e9 = 0; e9 < t2; e9++) i2[e9] = WS(r2, t2 > 1 ? e9 / (t2 - 1) : 0);
  return i2;
}
var KS = class {
  constructor() {
    this.name = `particle`, this.gradients_ = /* @__PURE__ */ new Map(), this.sizeCurves_ = /* @__PURE__ */ new Map(), this.offDespawn_ = null;
  }
  build(e8) {
    let t2 = new BS(ci(e8) ?? {}, e8.world.getCppRegistry());
    e8.insertResource(VS, t2);
    let n2 = this.gradients_, r2 = this.sizeCurves_;
    this.offDespawn_ = e8.world.onDespawn((e9) => {
      n2.delete(e9) && t2.setColorLut(e9, null), r2.delete(e9) && t2.setSizeLut(e9, null);
    }), ot(`ParticleEmitter`, { outOfBandFields: [`colorGradient`, `sizeCurve`], importData: (e9, i2) => {
      let a2 = i2.colorGradient;
      t2.setColorLut(e9, US(a2)), a2?.stops?.length ? n2.set(e9, a2) : n2.delete(e9);
      let o2 = i2.sizeCurve;
      t2.setSizeLut(e9, GS(o2)), o2?.keys?.length ? r2.set(e9, o2) : r2.delete(e9);
    }, exportData: (e9, t3) => {
      let i2 = n2.get(e9);
      i2 && (t3.colorGradient = i2);
      let a2 = r2.get(e9);
      a2 && (t3.sizeCurve = a2);
    } }), e8.addSystemToSchedule(3, Wi([ta(aa), ta(VS)], (e9, t3) => {
      t3.update(e9.delta);
    }, { name: `ParticleSystem` }), { runIf: p });
  }
  cleanup() {
    this.offDespawn_?.(), this.offDespawn_ = null, this.gradients_.clear(), this.sizeCurves_.clear();
  }
};
var qS = new KS();
var JS = class {
  constructor(e8, t2) {
    this.module_ = e8, this.registry_ = t2;
  }
  update(e8) {
    this.module_.trail_update?.(this.registry_, e8);
  }
  clear(e8) {
    this.module_.trail_clear?.(this.registry_, e8);
  }
};
var YS = ea(null, `Trail`);
var XS = class {
  constructor() {
    this.name = `trail`, this.offDespawn_ = null;
  }
  build(e8) {
    let t2 = new JS(ci(e8) ?? {}, e8.world.getCppRegistry());
    e8.insertResource(YS, t2), this.offDespawn_ = e8.world.onDespawn((n2) => {
      e8.world.has(n2, jt) && t2.clear(n2);
    }), e8.addSystemToSchedule(3, Wi([ta(aa), ta(YS)], (e9, t3) => {
      t3.update(e9.delta);
    }, { name: `TrailSystem` }), { runIf: p });
  }
  cleanup() {
    this.offDespawn_?.(), this.offDespawn_ = null;
  }
};
var ZS = new XS();
function QS(e8, t2) {
  let n2 = (e9) => Math.max(0, Math.min(255, Math.round(e9 * 255)));
  return (n2(e8[t2 * 4 + 0] ?? 1) | n2(e8[t2 * 4 + 1] ?? 1) << 8 | n2(e8[t2 * 4 + 2] ?? 1) << 16 | n2(e8[t2 * 4 + 3] ?? 1) << 24) >>> 0;
}
var $S = class {
  constructor(e8, t2) {
    this.module_ = e8, this.registry_ = t2, this.authored_ = /* @__PURE__ */ new Map();
  }
  setGeometry(e8, t2) {
    let n2 = this.module_, r2 = n2.mesh2d_setGeometry;
    if (!r2 || !n2._malloc || !n2._free || !n2.HEAPU8) return;
    let i2 = n2.HEAPU8, a2 = { _malloc: n2._malloc, _free: n2._free }, o2 = Math.floor(t2.positions.length / 2), s2 = t2.indices.length;
    if (o2 === 0 || s2 === 0) {
      this.clearGeometry(e8);
      return;
    }
    C(a2, (n3) => {
      let a3 = n3(o2 * 4 * 4), c2 = new Float32Array(i2.buffer, a3, o2 * 4), l2 = t2.uvs;
      for (let e9 = 0; e9 < o2; e9++) c2[e9 * 4 + 0] = t2.positions[e9 * 2 + 0] ?? 0, c2[e9 * 4 + 1] = t2.positions[e9 * 2 + 1] ?? 0, c2[e9 * 4 + 2] = l2?.[e9 * 2 + 0] ?? 0, c2[e9 * 4 + 3] = l2?.[e9 * 2 + 1] ?? 0;
      let u2 = 0, d2 = t2.colors;
      if (d2 && d2.length > 0) {
        u2 = n3(o2 * 4);
        let e9 = new Uint32Array(i2.buffer, u2, o2);
        for (let t3 = 0; t3 < o2; t3++) e9[t3] = QS(d2, t3);
      }
      let f2 = n3(s2 * 4);
      new Uint32Array(i2.buffer, f2, s2).set(t2.indices), r2(this.registry_, e8, a3, o2, u2, f2, s2);
    }), this.authored_.set(e8, t2);
  }
  clearGeometry(e8) {
    this.module_.mesh2d_setGeometry?.(this.registry_, e8, 0, 0, 0, 0, 0), this.authored_.delete(e8);
  }
  getGeometry(e8) {
    return this.authored_.get(e8);
  }
};
var eC = ea(null, `Meshes2D`);
var tC = class {
  constructor() {
    this.name = `mesh2d`, this.profileDomain = `render`, this.offDespawn_ = null;
  }
  build(e8) {
    let t2 = new $S(ci(e8) ?? {}, e8.world.getCppRegistry());
    e8.insertResource(eC, t2), this.offDespawn_ = e8.world.onDespawn((e9) => {
      t2.getGeometry(e9) && t2.clearGeometry(e9);
    }), ot(`Mesh2D`, { outOfBandFields: [`geometry`], importData: (e9, n2) => {
      let r2 = n2.geometry;
      r2 && r2.positions?.length && r2.indices?.length ? t2.setGeometry(e9, r2) : t2.clearGeometry(e9);
    }, exportData: (e9, n2) => {
      let r2 = t2.getGeometry(e9);
      r2 && (n2.geometry = r2);
    } });
  }
  cleanup() {
    this.offDespawn_?.(), this.offDespawn_ = null;
  }
};
var nC = new tC();
var rC = null;
var iC = { _bind(e8) {
  rC = e8;
}, setLayerTilesets(e8, t2) {
  rC?.(e8, t2);
} };
function aC(e8) {
  return e8.type === `box` && !e8.oneWay && !e8.sensor && e8.density === void 0 && e8.friction === void 0 && e8.restitution === void 0;
}
function oC(e8, t2, n2) {
  let r2;
  r2 = e8.type === `polygon` ? { type: `polygon`, points: e8.points.map(([e9, r3]) => [e9 / t2, r3 / n2]) } : e8.type === `circle` ? { type: `circle`, cx: e8.cx / t2, cy: e8.cy / n2, r: e8.r / t2 } : { type: `box` };
  let i2 = { shape: r2 };
  return e8.oneWay && (i2.oneWay = e8.oneWay), e8.sensor && (i2.sensor = true), e8.density !== void 0 && (i2.density = e8.density), e8.friction !== void 0 && (i2.friction = e8.friction), e8.restitution !== void 0 && (i2.restitution = e8.restitution), i2;
}
function sC(e8, t2) {
  if (typeof e8.tileCount == `number` && e8.tileCount > 0) return e8.tileCount;
  if (typeof t2 == `number` && t2 > 0) {
    let n3 = e8.tileHeight || 1, r2 = e8.margin || 0, i2 = e8.spacing || 0, a2 = Math.max(1, Math.floor((t2 - 2 * r2 + i2) / (n3 + i2)));
    return Math.max(1, e8.columns * a2);
  }
  let n2 = 0;
  for (let t3 of Object.keys(e8.tiles)) n2 = Math.max(n2, Number(t3));
  return n2;
}
function cC(e8) {
  let t2 = [], n2 = /* @__PURE__ */ new Map(), r2 = [], i2 = /* @__PURE__ */ new Map(), a2 = 1;
  for (let { asset: o2, textureHandle: s2, textureHeight: c2 } of e8) {
    t2.push({ firstId: a2, textureHandle: s2, columns: o2.columns, margin: o2.margin || 0, spacing: o2.spacing || 0 });
    let e9 = o2.tileWidth || 1, l2 = o2.tileHeight || 1;
    for (let t3 of Object.keys(o2.tiles)) {
      let s3 = Number(t3);
      if (!Number.isInteger(s3) || s3 <= 0) continue;
      let c3 = a2 + s3 - 1, u2 = o2.tiles[s3];
      u2.collision && (aC(u2.collision) ? r2.push(c3) : i2.set(c3, oC(u2.collision, e9, l2))), u2.animation && u2.animation.length > 0 && n2.set(c3, u2.animation.map((e10) => ({ tileId: a2 + e10.tile - 1, duration: e10.durationMs })));
    }
    a2 += Math.max(1, sC(o2, c2));
  }
  return r2.sort((e9, t3) => e9 - t3), { slots: t2, animations: n2, collidableTileIds: r2, tileShapes: i2 };
}
function uC(e8) {
  return e8 === `builtin:collision` || e8.startsWith(`builtin:collision?`);
}
function dC(e8) {
  return e8.some(uC);
}
function fC(e8) {
  let t2 = e8.find(uC) ?? ``, n2 = t2.indexOf(`?`);
  if (n2 < 0) return {};
  let r2 = {};
  for (let e9 of t2.slice(n2 + 1).split(`&`)) {
    let t3 = e9.indexOf(`=`);
    if (t3 < 0) continue;
    let n3 = e9.slice(0, t3), i2 = Number(e9.slice(t3 + 1));
    Number.isFinite(i2) && (n3 === `friction` ? r2.friction = i2 : n3 === `restitution` ? r2.restitution = i2 : n3 === `density` && (r2.density = i2));
  }
  return r2;
}
var mC = [{ id: 1, key: `solid`, collision: { shape: { type: `box` } } }, { id: 2, key: `rampR`, collision: { shape: { type: `polygon`, points: [[0, 1], [1, 1], [1, 0]] } } }, { id: 3, key: `rampL`, collision: { shape: { type: `polygon`, points: [[0, 0], [0, 1], [1, 1]] } } }, { id: 4, key: `halfBottom`, collision: { shape: { type: `polygon`, points: [[0, 0.5], [1, 0.5], [1, 1], [0, 1]] } } }, { id: 5, key: `halfTop`, collision: { shape: { type: `polygon`, points: [[0, 0], [1, 0], [1, 0.5], [0, 0.5]] } } }, { id: 6, key: `halfLeft`, collision: { shape: { type: `polygon`, points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] } } }, { id: 7, key: `halfRight`, collision: { shape: { type: `polygon`, points: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] } } }, { id: 8, key: `oneWay`, collision: { shape: { type: `box` }, oneWay: { nx: 0, ny: 1 } } }, { id: 9, key: `sensor`, collision: { shape: { type: `box` }, sensor: true } }];
function hC(e8) {
  return e8.shape.type === `box` && !e8.oneWay && !e8.sensor && e8.density === void 0 && e8.friction === void 0 && e8.restitution === void 0;
}
function gC(e8) {
  let t2 = e8 && (e8.friction !== void 0 || e8.restitution !== void 0 || e8.density !== void 0) ? e8 : void 0, n2 = [], r2 = /* @__PURE__ */ new Map();
  for (let e9 of mC) {
    let i2 = t2 ? { ...e9.collision, ...t2 } : e9.collision;
    hC(i2) ? n2.push(e9.id) : r2.set(e9.id, i2);
  }
  return n2.sort((e9, t3) => e9 - t3), { slots: [], animations: /* @__PURE__ */ new Map(), collidableTileIds: n2, tileShapes: r2 };
}
var _C = { orthogonal: 0, isometric: 1, staggered: 2, hexagonal: 3 };
var vC = class {
  constructor() {
    this.name = `tilemap`, this.initializedLayers_ = /* @__PURE__ */ new Set(), this.appliedCellSize_ = /* @__PURE__ */ new Map(), this.appliedGrid_ = /* @__PURE__ */ new Map(), this.animatedLayers_ = /* @__PURE__ */ new Set(), this.sourceLayerEntities_ = /* @__PURE__ */ new Map(), this.sourceDerivedFrom_ = /* @__PURE__ */ new Map(), this.collisionEntities_ = /* @__PURE__ */ new Map(), this.nativeCollisionIds_ = /* @__PURE__ */ new Map(), this.nativeTileShapes_ = /* @__PURE__ */ new Map(), this.tilesetRefs_ = /* @__PURE__ */ new Map(), this.liveResolved_ = /* @__PURE__ */ new Set(), this.requestedTilesetLoads_ = /* @__PURE__ */ new Set(), this.derivedQueryTables_ = /* @__PURE__ */ new Map(), this.queryTableCache_ = /* @__PURE__ */ new Map();
  }
  build(e8) {
    let t2 = ci(e8);
    if (!t2 || typeof t2.tilemap_initLayer != `function`) {
      T.warn(`tilemap`, `this engine core has no tilemap support \u2014 layers will not render`);
      return;
    }
    no(t2);
    let i2 = this.nativeCollisionIds_, a2 = this.nativeTileShapes_, o2 = this.tilesetRefs_, s2 = this.liveResolved_, c2 = this.requestedTilesetLoads_, l2 = (e9, t3) => {
      let n2 = t3.filter((e10) => typeof e10 == `string` && e10 !== ``);
      n2.length > 0 ? o2.set(e9, n2.slice()) : o2.delete(e9), s2.delete(e9);
    };
    iC._bind(l2), ot(`TilemapLayer`, { exportData: (e9, t3) => {
      let n2 = V3.exportChunks(e9);
      n2 && (t3.chunks = n2);
      let r2 = i2.get(e9);
      r2 && r2.length > 0 && (t3.collidableTileIds = r2.slice());
      let a3 = o2.get(e9);
      a3 && a3.length > 0 && (t3.tilesetAssets = a3.slice(), t3.tilesetAsset = a3[0]);
    }, outOfBandFields: [`chunks`, `collidableTileIds`, `tilesetAsset`, `tilesetAssets`], importData: (e9, t3) => {
      let n2 = t3.chunks;
      typeof n2 == `string` && n2 !== `` && V3.importChunks(e9, n2);
      let r2 = t3.collidableTileIds;
      Array.isArray(r2) && r2.length > 0 ? i2.set(e9, r2.map(Number).filter((e10) => Number.isInteger(e10))) : i2.delete(e9);
      let a3 = t3.tilesetAssets, o3 = t3.tilesetAsset, s3 = Array.isArray(a3) ? a3.filter((e10) => typeof e10 == `string` && e10 !== ``) : typeof o3 == `string` && o3 !== `` ? [o3] : [];
      l2(e9, s3);
    } });
    let u2 = e8.world, d2 = this.initializedLayers_, f2 = this.appliedCellSize_, p3 = this.appliedGrid_, m3 = this.animatedLayers_, h3 = this.sourceLayerEntities_, g3 = this.collisionEntities_, _3 = { _id: /* @__PURE__ */ Symbol(`TilemapSyncSystem`), _name: `TilemapSyncSystem`, _params: [], _fn: () => {
      let t3 = l(), l3 = e8.getResource(U4), _4 = 100;
      for (let e9 of u2.getEntitiesWithComponents([Tt])) {
        let t4 = u2.tryGet(e9, Tt);
        if (t4?.pixelsPerUnit) {
          _4 = t4.pixelsPerUnit;
          break;
        }
      }
      if (!t3 && g3.size > 0) {
        for (let [, e9] of g3) for (let t4 of e9) u2.despawn(t4);
        g3.clear();
      }
      let v4 = u2.getEntitiesWithComponents([Nt, I]), y5 = new Set(v4);
      for (let e9 of d2) if (!y5.has(e9)) {
        V3.destroyLayer(e9), d2.delete(e9), f2.delete(e9), p3.delete(e9), i2.delete(e9), a2.delete(e9), o2.delete(e9), s2.delete(e9), m3.delete(e9), this.queryTableCache_.delete(e9);
        let t4 = g3.get(e9);
        if (t4) {
          for (let e10 of t4) u2.despawn(e10);
          g3.delete(e9);
        }
      }
      for (let e9 of v4) {
        let r2 = u2.tryGet(e9, Nt);
        if (!r2) continue;
        let h4 = o2.get(e9);
        if (!r2.tileset && (!h4 || h4.length === 0)) continue;
        let v5 = r2.cellSize.x * 65536 + r2.cellSize.y, y6 = false;
        d2.has(e9) ? f2.get(e9) !== v5 && (V3.initInfiniteLayer(e9, r2.cellSize.x, r2.cellSize.y), f2.set(e9, v5), y6 = true) : (V3.initInfiniteLayer(e9, r2.cellSize.x, r2.cellSize.y), V3.setOriginEntity(e9, e9), d2.add(e9), f2.set(e9, v5), y6 = true);
        let b6 = `${r2.orientation ?? 0}|${r2.hexSideLength ?? 0}|${r2.staggerAxis ?? 0}|${r2.staggerIndex ?? 0}`;
        if ((y6 || p3.get(e9) !== b6) && (V3.setGridType(e9, r2.orientation ?? 0), V3.setHexParams(e9, r2.hexSideLength ?? 0, (r2.staggerAxis ?? 0) === 1, (r2.staggerIndex ?? 0) === 1), p3.set(e9, b6)), h4 && h4.length > 0 && dC(h4) && !s2.has(e9)) {
          let t4 = gC(fC(h4));
          t4.collidableTileIds.length > 0 ? i2.set(e9, t4.collidableTileIds) : i2.delete(e9), t4.tileShapes.size > 0 ? a2.set(e9, t4.tileShapes) : a2.delete(e9), s2.add(e9);
        } else if (h4 && h4.length > 0 && !s2.has(e9)) {
          let t4 = [];
          for (let e10 of h4) {
            let r3 = ol(l3, e10), i3 = Ss(r3) ?? Ss(e10);
            i3 ? t4.push(i3) : l3 && !c2.has(r3) && (c2.add(r3), l3.load(`tileset`, e10).catch((t5) => {
              T.warn(`tilemap`, `failed to load tileset asset '${e10}'`, t5);
            }));
          }
          if (t4.length === h4.length) {
            let n2 = cC(t4);
            V3.setTilesets(e9, n2.slots), V3.clearTileAnimations(e9);
            for (let [t5, r3] of n2.animations) V3.setTileAnimation(e9, t5, r3), m3.add(e9);
            n2.animations.size === 0 && m3.delete(e9), n2.collidableTileIds.length > 0 ? i2.set(e9, n2.collidableTileIds) : i2.delete(e9), n2.tileShapes.size > 0 ? a2.set(e9, n2.tileShapes) : a2.delete(e9), s2.add(e9);
          }
        }
        let x6 = i2.get(e9), C5 = a2.get(e9), ee4 = x6 != null && x6.length > 0, w5 = C5 != null && C5.size > 0;
        if (t3 && (ee4 || w5) && !g3.has(e9)) {
          let t4 = uo(V3.exportChunks(e9)), n2 = u2.tryGet(e9, I), i3 = n2?.position.x ?? 0, a3 = n2?.position.y ?? 0, o3 = [];
          ee4 && o3.push(...ss(u2, t4, new Set(x6), r2.cellSize.x, r2.cellSize.y, i3, a3, _4)), w5 && o3.push(...fs(u2, t4, C5, r2.cellSize.x, r2.cellSize.y, i3, a3, _4)), g3.set(e9, o3);
        }
      }
      let b5 = u2.getEntitiesWithComponents([ao, I]);
      for (let e9 of b5) {
        if (u2.tryGet(e9, Nt)) continue;
        let i3 = u2.tryGet(e9, ao), a3 = i3?.source ? _s(ol(l3, i3.source)) ?? _s(i3.source) : void 0;
        if (h3.has(e9) && this.sourceDerivedFrom_.get(e9) !== a3 && this.teardownDerived_(u2, e9), !a3) continue;
        if (!h3.has(e9)) {
          let t4 = [], i4 = _C[a3.orientation ?? `orthogonal`] ?? 0;
          for (let r2 = 0; r2 < a3.layers.length; r2++) {
            let o4 = a3.layers[r2], s4 = u2.spawn(o4.name || `TiledLayer_${r2}`);
            if (u2.insert(s4, I, { position: { x: 0, y: 0, z: 0 } }), u2.insert(s4, Nt, { cellSize: { x: a3.tileWidth, y: a3.tileHeight }, renderLayer: r2 }), u2.insert(s4, It, {}), u2.setParent(s4, e9), o4.infinite) {
              V3.initInfiniteLayer(s4, a3.tileWidth, a3.tileHeight);
              for (let e10 of o4.chunks) V3.setChunkTiles(s4, e10.x, e10.y, e10.tiles, e10.width, e10.height);
            } else V3.initLayer(s4, o4.width, o4.height, a3.tileWidth, a3.tileHeight), o4.tiles.length > 0 && V3.setTiles(s4, o4.tiles);
            if (V3.setOriginEntity(s4, s4), i4 !== 0 && V3.setGridType(s4, i4), (i4 === 2 || i4 === 3) && V3.setHexParams(s4, a3.hexSideLength ?? 0, a3.staggerAxis === `x`, a3.staggerIndex === `even`), a3.tileAnimations) {
              for (let [e10, t5] of a3.tileAnimations) V3.setTileAnimation(s4, e10, t5);
              a3.tileAnimations.size > 0 && m3.add(s4);
            }
            if (a3.tileProperties) for (let [e10, t5] of a3.tileProperties) for (let [n2, r3] of t5) V3.setTileProperty(s4, e10, n2, r3);
            let c3 = a3.tilesets.filter((e10) => e10.textureHandle).map((e10) => ({ firstId: e10.firstId, textureHandle: e10.textureHandle, columns: e10.columns, margin: e10.margin, spacing: e10.spacing }));
            c3.length > 0 ? V3.setTilesets(s4, c3) : a3.tilesets.length > 0 && T.error(`tilemap`, `Tiled map on entity ${e9}: none of its ${a3.tilesets.length} tileset texture(s) loaded \u2014 tiles will NOT render (collision still works). See earlier [tilemap] load errors for the failing image path(s).`), ((a3.collisionTileIds?.length ?? 0) > 0 || (a3.tileShapes?.size ?? 0) > 0) && this.derivedQueryTables_.set(s4, { boxIds: new Set(a3.collisionTileIds ?? []), shapes: a3.tileShapes ?? /* @__PURE__ */ new Map() }), t4.push(s4), d2.add(s4);
          }
          for (let n2 of a3.objectGroups ?? []) {
            if (n2.visible === false) continue;
            let i5 = Qo(n2);
            for (let o4 of n2.objects) {
              if (o4.visible === false) continue;
              if (o4.gid === void 0) {
                if (o4.shape === `point`) {
                  let n4 = {};
                  for (let [e10, t5] of o4.properties) n4[e10] = String(t5);
                  let r2 = u2.spawn(o4.name || `Marker_${o4.id}`);
                  u2.insert(r2, I, { position: { x: o4.x, y: -o4.y, z: 0 } }), u2.insert(r2, Rt, { type: o4.type || ``, properties: n4 }), u2.insert(r2, It, {}), u2.setParent(r2, e9), t4.push(r2);
                } else {
                  let n4 = rs(u2, o4, e9, _4, !i5);
                  n4 != null && t4.push(n4);
                }
                continue;
              }
              let n3 = Uo(o4.gid), s4;
              for (let e10 of a3.tilesets) e10.textureHandle && e10.firstId <= n3.globalId && (!s4 || e10.firstId > s4.firstId) && (s4 = e10);
              if (!s4) continue;
              let c3 = n3.globalId - s4.firstId, l4 = s4.columns || 1, d3 = s4.rows || 1, f3 = 1 / l4, p4 = 1 / d3, m4 = c3 % l4, h4 = Math.floor(c3 / l4), g4 = o4.width || a3.tileWidth, v5 = o4.height || a3.tileHeight, y6 = (o4.rotation || 0) * (Math.PI / 180), b6 = Math.cos(y6), x6 = Math.sin(y6), C5 = o4.x + g4 / 2 * b6 - -v5 / 2 * x6, ee4 = -(o4.y + g4 / 2 * x6 + -v5 / 2 * b6), w5 = n3.flipD ? y6 + Math.PI / 2 : y6, T5 = u2.spawn(o4.name || `TileObject_${o4.id}`);
              u2.insert(T5, I, w5 === 0 ? { position: { x: C5, y: ee4, z: 0 } } : { position: { x: C5, y: ee4, z: 0 }, rotation: { w: Math.cos(-w5 / 2), x: 0, y: 0, z: Math.sin(-w5 / 2) } }), u2.insert(T5, bt, { texture: s4.textureHandle, size: n3.flipD ? { x: v5, y: g4 } : { x: g4, y: v5 }, uvOffset: { x: m4 * f3, y: 1 - (h4 + 1) * p4 }, uvScale: { x: f3, y: p4 }, flipX: n3.flipD ? n3.flipV : n3.flipH, flipY: n3.flipD ? !n3.flipH : n3.flipV, layer: a3.layers.length }), u2.insert(T5, It, {}), u2.setParent(T5, e9), t4.push(T5);
            }
          }
          h3.set(e9, t4), this.sourceDerivedFrom_.set(e9, a3);
        }
        let o3 = !!(a3.collisionTileIds && a3.collisionTileIds.length > 0), s3 = !!(a3.tileShapes && a3.tileShapes.size > 0);
        if (t3 && !g3.has(e9) && (o3 || s3)) {
          let t4 = u2.tryGet(e9, I), n2 = t4?.position.x ?? 0, r2 = t4?.position.y ?? 0, i4 = [];
          if (o3 || s3) {
            let e10 = new Set(a3.collisionTileIds);
            for (let t5 of a3.layers) {
              if (t5.infinite) {
                if (t5.chunks.length === 0) continue;
                o3 && i4.push(...ss(u2, t5.chunks, e10, a3.tileWidth, a3.tileHeight, n2, r2, _4)), s3 && i4.push(...fs(u2, t5.chunks, a3.tileShapes, a3.tileWidth, a3.tileHeight, n2, r2, _4));
                continue;
              }
              t5.tiles.length !== 0 && (o3 && i4.push(...as(u2, t5.tiles, t5.width, t5.height, a3.tileWidth, a3.tileHeight, e10, n2, r2, _4)), s3 && i4.push(...ps(u2, t5.tiles, t5.width, t5.height, a3.tileShapes, a3.tileWidth, a3.tileHeight, n2, r2, _4)));
            }
          }
          g3.set(e9, i4);
        }
      }
      let x5 = new Set(b5);
      for (let e9 of [...h3.keys()]) x5.has(e9) || this.teardownDerived_(u2, e9);
      if (m3.size > 0) {
        let t4 = e8.getResource(aa).delta * 1e3;
        for (let e9 of m3) V3.advanceAnimations(e9, t4);
      }
    } };
    e8.addSystemToSchedule(2, _3);
  }
  teardownDerived_(e8, t2) {
    for (let n3 of this.sourceLayerEntities_.get(t2) ?? []) this.initializedLayers_.has(n3) && (V3.destroyLayer(n3), this.initializedLayers_.delete(n3)), this.animatedLayers_.delete(n3), this.derivedQueryTables_.delete(n3), e8.valid(n3) && e8.despawn(n3);
    this.sourceLayerEntities_.delete(t2), this.sourceDerivedFrom_.delete(t2);
    let n2 = this.collisionEntities_.get(t2);
    if (n2) {
      for (let t3 of n2) e8.valid(t3) && e8.despawn(t3);
      this.collisionEntities_.delete(t2);
    }
  }
  resetLayers() {
    for (let e8 of this.initializedLayers_) V3.destroyLayer(e8);
    this.initializedLayers_.clear(), this.appliedCellSize_.clear(), this.animatedLayers_.clear(), this.sourceLayerEntities_.clear(), this.sourceDerivedFrom_.clear(), this.collisionEntities_.clear(), this.nativeCollisionIds_.clear(), this.nativeTileShapes_.clear(), this.tilesetRefs_.clear(), this.liveResolved_.clear(), this.requestedTilesetLoads_.clear(), this.derivedQueryTables_.clear(), this.queryTableCache_.clear();
  }
  cleanup() {
    this.resetLayers(), iC._bind(null), ro();
  }
};
var yC = new vC();
var SC = (function(e8) {
  return e8[e8.Orthogonal = 0] = `Orthogonal`, e8[e8.Isometric = 1] = `Isometric`, e8[e8.Staggered = 2] = `Staggered`, e8[e8.Hexagonal = 3] = `Hexagonal`, e8;
})({});
var tw = Math.SQRT2;
var nw = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var rw = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
function iw(e8, t2, n2, r2 = {}) {
  let i2 = r2.diagonal ?? true, a2 = r2.snapRadius ?? 8, o2 = Math.max(0, r2.clearance ?? 0), s2 = sw(e8, t2, a2, o2), c2 = sw(e8, n2, a2, o2);
  if (!s2 || !c2) return null;
  let { width: l2, height: u2 } = e8, d2 = l2 * u2, f2 = s2.y * l2 + s2.x, p3 = c2.y * l2 + c2.x;
  if (f2 === p3) return [{ x: s2.x, y: s2.y }];
  let m3 = new Float64Array(d2).fill(1 / 0), h3 = new Int32Array(d2).fill(-1), g3 = new Uint8Array(d2);
  m3[f2] = 0;
  let _3 = new uw(d2);
  for (_3.push(f2, cw(s2.x, s2.y, c2.x, c2.y, i2)); _3.size > 0; ) {
    let t3 = _3.pop();
    if (t3 === p3) return lw(h3, t3, l2);
    if (g3[t3]) continue;
    g3[t3] = 1;
    let n3 = t3 % l2, r3 = (t3 - n3) / l2, a3 = m3[t3];
    for (let s3 = 0; s3 < (i2 ? 8 : 4); s3++) {
      let [u3, d3] = s3 < 4 ? nw[s3] : rw[s3 - 4], f3 = n3 + u3, p4 = r3 + d3;
      if (!ow(e8, f3, p4, o2) || s3 >= 4 && (!ow(e8, n3 + u3, r3, o2) || !ow(e8, n3, r3 + d3, o2))) continue;
      let v4 = p4 * l2 + f3;
      if (g3[v4]) continue;
      let y5 = a3 + (s3 < 4 ? 1 : tw);
      y5 < m3[v4] && (m3[v4] = y5, h3[v4] = t3, _3.push(v4, y5 + cw(f3, p4, c2.x, c2.y, i2)));
    }
  }
  return null;
}
function aw(e8, t2) {
  return t2.map((t3) => e8.cellToWorld(t3.x, t3.y));
}
function ow(e8, t2, n2, r2) {
  return e8.isWalkable(t2, n2) ? r2 <= 0 || e8.clearanceAt(t2, n2) >= r2 : false;
}
function sw(e8, t2, n2, r2) {
  return ow(e8, t2.x, t2.y, r2) ? t2 : n2 <= 0 ? null : e8.nearestWalkable(t2.x, t2.y, n2, r2) ?? e8.nearestWalkable(t2.x, t2.y, n2);
}
function cw(e8, t2, n2, r2, i2) {
  let a2 = Math.abs(e8 - n2), o2 = Math.abs(t2 - r2);
  return i2 ? a2 + o2 + (tw - 2) * Math.min(a2, o2) : a2 + o2;
}
function lw(e8, t2, n2) {
  let r2 = [], i2 = t2;
  for (; i2 !== -1; ) {
    let t3 = i2 % n2;
    r2.push({ x: t3, y: (i2 - t3) / n2 }), i2 = e8[i2];
  }
  return r2.reverse(), r2;
}
var uw = class {
  constructor(e8) {
    this.size = 0;
    let t2 = Math.max(16, e8);
    this.nodes = new Int32Array(t2), this.keys = new Float64Array(t2);
  }
  push(e8, t2) {
    this.size === this.nodes.length && this.grow();
    let n2 = this.size++;
    for (this.nodes[n2] = e8, this.keys[n2] = t2; n2 > 0; ) {
      let e9 = n2 - 1 >> 1;
      if (this.keys[e9] <= this.keys[n2]) break;
      this.swap(n2, e9), n2 = e9;
    }
  }
  pop() {
    let e8 = this.nodes[0], t2 = --this.size;
    this.nodes[0] = this.nodes[t2], this.keys[0] = this.keys[t2];
    let n2 = 0;
    for (; ; ) {
      let e9 = n2 * 2 + 1, t3 = e9 + 1, r2 = n2;
      if (e9 < this.size && this.keys[e9] < this.keys[r2] && (r2 = e9), t3 < this.size && this.keys[t3] < this.keys[r2] && (r2 = t3), r2 === n2) break;
      this.swap(n2, r2), n2 = r2;
    }
    return e8;
  }
  swap(e8, t2) {
    let n2 = this.nodes[e8];
    this.nodes[e8] = this.nodes[t2], this.nodes[t2] = n2;
    let r2 = this.keys[e8];
    this.keys[e8] = this.keys[t2], this.keys[t2] = r2;
  }
  grow() {
    let e8 = new Int32Array(this.nodes.length * 2), t2 = new Float64Array(this.keys.length * 2);
    e8.set(this.nodes), t2.set(this.keys), this.nodes = e8, this.keys = t2;
  }
};
var mw = class {
  constructor() {
    this.grid = null;
  }
  setGrid(e8) {
    this.grid = e8;
  }
  hasGrid() {
    return this.grid !== null;
  }
  findWorldPath(e8, t2, n2) {
    let r2 = this.grid;
    if (!r2) return null;
    let i2 = r2.worldToCell(e8.x, e8.y), a2 = r2.worldToCell(t2.x, t2.y), o2 = n2?.radius ?? 0, s2 = n2?.clearance ?? (o2 > 0 ? Math.ceil(o2 / r2.cellSize) : 0), c2 = iw(r2, i2, a2, { ...n2, clearance: s2 });
    return c2 ? aw(r2, c2) : null;
  }
};
var hw = ea(null, `Nav`);
var gw = k(`NavAgent`, { speed: 120, radius: 0, arriveRadius: 6, repathInterval: 0.5, hasTarget: false, targetX: 0, targetY: 0, arrived: false }, { fields: { speed: { min: 0, unit: `px/s`, category: `Navigation` }, radius: { min: 0, unit: `px`, category: `Navigation` }, arriveRadius: { min: 0, unit: `px`, category: `Navigation` }, repathInterval: { min: 0, unit: `s`, category: `Navigation`, tooltip: `Replan cadence while moving; 0 = only when the target changes.` }, hasTarget: { category: `Target` }, targetX: { unit: `px`, category: `Target` }, targetY: { unit: `px`, category: `Target` }, arrived: { category: `Target`, advanced: true } } });
function yw(e8, t2, n2, r2) {
  let i2 = n2, a2 = r2;
  for (; a2 > 0 && i2 < t2.length; ) {
    let n3 = t2[i2], r3 = n3.x - e8.x, o2 = n3.y - e8.y, s2 = Math.hypot(r3, o2);
    if (s2 === 0) {
      i2++;
      continue;
    }
    s2 <= a2 ? (e8.x = n3.x, e8.y = n3.y, a2 -= s2, i2++) : (e8.x += r3 / s2 * a2, e8.y += o2 / s2 * a2, a2 = 0);
  }
  return i2;
}
function bw(e8, t2, n2, r2) {
  if (!(n2 <= 0)) for (let i2 of e8.getEntitiesWithComponents([gw, I])) {
    let a2 = e8.get(i2, gw);
    if (!a2.hasTarget) {
      r2.delete(i2);
      continue;
    }
    let o2 = e8.get(i2, I), s2 = r2.get(i2), c2 = !s2 || s2.plannedX !== a2.targetX || s2.plannedY !== a2.targetY, l2 = s2 ? (s2.repathTimer -= n2) <= 0 : false;
    if (!s2 || c2 || a2.repathInterval > 0 && l2) {
      let e9 = t2.findWorldPath({ x: o2.position.x, y: o2.position.y }, { x: a2.targetX, y: a2.targetY }, { radius: a2.radius });
      s2 = { waypoints: e9 ?? [], index: e9 && e9.length > 1 ? 1 : 0, plannedX: a2.targetX, plannedY: a2.targetY, repathTimer: a2.repathInterval, reachable: e9 !== null }, r2.set(i2, s2);
    }
    if (!s2.reachable) continue;
    let u2 = { x: o2.position.x, y: o2.position.y };
    s2.index = yw(u2, s2.waypoints, s2.index, a2.speed * n2), o2.position.x = u2.x, o2.position.y = u2.y, e8.set(i2, I, o2), s2.index >= s2.waypoints.length && (a2.arrived = true, a2.hasTarget = false, e8.set(i2, gw, a2), r2.delete(i2));
  }
}
var xw = class {
  constructor() {
    this.name = `nav`;
  }
  build(e8) {
    e8.insertResource(hw, new mw());
    let t2 = /* @__PURE__ */ new Map();
    e8.world.onDespawn((e9) => t2.delete(e9)), e8.addSystemToSchedule(3, Wi([ta(hw), ta(aa), Hi()], (e9, n2, r2) => {
      bw(r2, e9, n2.delta, t2);
    }, { name: `NavAgentSystem`, touches: { writes: [gw._name, I._name] }, runAfter: [`VelocitySystem`] }), { runIf: l });
  }
};
var Sw = new xw();
var Fw = (function(e8) {
  return e8.Success = `success`, e8.Failure = `failure`, e8.Running = `running`, e8;
})({});
function Iw() {
  return /* @__PURE__ */ new Map();
}
function Lw(e8, t2, n2, r2, i2, a2) {
  return Rw(e8.root, `0`, t2, n2, r2, i2, a2);
}
function Rw(e8, t2, n2, r2, i2, a2, o2) {
  switch (e8.type) {
    case `action`: {
      let t3 = e8.name ?? ``;
      if (!i2.hasAction(t3)) return `failure`;
      let a3 = Fr(i2, t3, n2, r2, { arg: e8.arg, params: e8.params });
      return a3 === void 0 ? `success` : a3;
    }
    case `condition`: {
      let t3 = i2.getCondition(e8.name ?? ``);
      return t3 && t3(n2, r2) ? `success` : `failure`;
    }
    case `inverter`: {
      let s2 = zw(e8, t2, n2, r2, i2, a2, o2);
      return s2 === `running` ? s2 : s2 === `success` ? `failure` : `success`;
    }
    case `succeeder`:
      return zw(e8, t2, n2, r2, i2, a2, o2) === `running` ? `running` : `success`;
    case `repeater`: {
      if (zw(e8, t2, n2, r2, i2, a2, o2) === `running`) return `running`;
      let s2 = a2.get(t2) ?? {};
      s2.n = (s2.n ?? 0) + 1, a2.set(t2, s2);
      let c2 = e8.count ?? 0;
      return c2 > 0 && s2.n >= c2 ? (a2.delete(t2), `success`) : `running`;
    }
    case `wait`: {
      let n3 = a2.get(t2) ?? {};
      return n3.elapsed = (n3.elapsed ?? 0) + o2, a2.set(t2, n3), n3.elapsed >= (e8.seconds ?? 0) ? (a2.delete(t2), `success`) : `running`;
    }
    case `sequence`:
      return Bw(e8, t2, n2, r2, i2, a2, o2, false);
    case `selector`:
      return Bw(e8, t2, n2, r2, i2, a2, o2, true);
    case `parallel`:
      return Vw(e8, t2, n2, r2, i2, a2, o2);
    default:
      return `failure`;
  }
}
function zw(e8, t2, n2, r2, i2, a2, o2) {
  let s2 = e8.children?.[0];
  return s2 ? Rw(s2, `${t2}.0`, n2, r2, i2, a2, o2) : `failure`;
}
function Bw(e8, t2, n2, r2, i2, a2, o2, s2) {
  let c2 = e8.children ?? [], l2 = s2 ? `success` : `failure`;
  for (let e9 = 0; e9 < c2.length; e9++) {
    let s3 = Rw(c2[e9], `${t2}.${e9}`, n2, r2, i2, a2, o2);
    if (s3 === `running`) return `running`;
    if (s3 === l2) return l2;
  }
  return s2 ? `failure` : `success`;
}
function Vw(e8, t2, n2, r2, i2, a2, o2) {
  let s2 = e8.children ?? [], c2 = 0, l2 = 0;
  for (let e9 = 0; e9 < s2.length; e9++) {
    let u2 = Rw(s2[e9], `${t2}.${e9}`, n2, r2, i2, a2, o2);
    u2 === `success` ? c2++ : u2 === `failure` && l2++;
  }
  if ((e8.policy ?? `all`) === `one`) {
    if (c2 > 0) return `success`;
    if (l2 === s2.length) return `failure`;
  } else {
    if (l2 > 0) return `failure`;
    if (c2 === s2.length) return `success`;
  }
  return `running`;
}
function fT(e8, t2) {
  let n2 = e8.get(t2);
  return n2 || (n2 = { bb: new cc(), rs: Iw(), btKey: null, status: `` }, e8.set(t2, n2)), n2.bb;
}
function pT(e8, t2, n2, r2, i2) {
  if (n2 <= 0) return;
  let a2 = { entity: 0, dt: n2, blackboard: null, world: e8, commands: t2, get: (t3) => e8.get(a2.entity, t3), set: (t3, n3) => e8.set(a2.entity, t3, n3), has: (t3) => e8.has(a2.entity, t3) };
  for (let t3 of e8.getEntitiesWithComponents([Ec])) {
    let o2 = e8.get(t3, Ec);
    if (!o2.bt) continue;
    let s2 = kc(i2 ? i2(o2.bt) : o2.bt) ?? kc(o2.bt);
    if (!s2) continue;
    let c2 = r2.get(t3);
    c2 || (c2 = { bb: new cc(), rs: Iw(), btKey: null, status: `` }, r2.set(t3, c2)), c2.btKey !== o2.bt && (c2.rs = Iw(), c2.btKey = o2.bt), a2.entity = t3, a2.dt = n2, a2.blackboard = c2.bb;
    let l2 = Lw(s2, a2, c2.bb, I5, c2.rs, n2);
    c2.status = l2, o2.status !== l2 && (o2.status = l2, e8.set(t3, Ec, o2));
  }
}
var mT = class {
  constructor(e8) {
    this.states = e8;
  }
  blackboard(e8) {
    return fT(this.states, e8);
  }
  status(e8) {
    return this.states.get(e8)?.status ?? null;
  }
};
function* hT(e8) {
  e8.name && (e8.type === `action` || e8.type === `condition`) && (yield { kind: e8.type, name: e8.name, input: { arg: e8.arg, params: e8.params } });
  for (let t2 of e8.children ?? []) yield* hT(t2);
}
function gT() {
  let e8 = new bu().writing(Ec._name);
  for (let t2 of Ac()) xu(I5, hT(t2.root), e8);
  return e8.build();
}
var _T = ea(null, `AiBt`);
var vT = class {
  constructor() {
    this.name = `bt`;
  }
  build(e8) {
    Il();
    let t2 = /* @__PURE__ */ new Map();
    e8.world.onDespawn((e9) => t2.delete(e9)), e8.insertResource(_T, new mT(t2));
    let n2 = (t3) => ol(e8.hasResource(U4) ? e8.getResource(U4) : null, t3);
    e8.addSystemToSchedule(3, Wi([ta(aa), Mi(), Hi()], (e9, r2, i2) => {
      pT(i2, r2, e9.delta, t2, n2);
    }, { name: `BehaviorTreeSystem`, touches: gT }), { runIf: l });
  }
};
var yT = new vT();
function bT(e8, t2) {
  return 2 * Math.atan2(e8, t2);
}
function xT(e8) {
  let t2 = Math.PI * 2;
  return e8 %= t2, e8 > Math.PI ? e8 -= t2 : e8 <= -Math.PI && (e8 += t2), e8;
}
function ST(e8, t2, n2, r2, i2, a2, o2, s2) {
  let c2 = r2 - e8, l2 = i2 - t2, u2 = Math.hypot(c2, l2);
  if (u2 === 0) return { visible: true, distance: 0, dirX: 0, dirY: 0 };
  let d2 = { visible: false, distance: u2, dirX: 0, dirY: 0 };
  return u2 > a2 || o2 < Math.PI && Math.abs(xT(Math.atan2(l2, c2) - n2)) > o2 || s2?.(e8, t2, r2, i2) ? d2 : { visible: true, distance: u2, dirX: c2 / u2, dirY: l2 / u2 };
}
var CT = k(`Perceiver`, { range: 220, fovDegrees: 360 }, { fields: { range: { min: 0, unit: `px`, category: `Perception` }, fovDegrees: { min: 0, max: 360, unit: `\xB0`, category: `Perception` } } });
var wT = k(`Perception`, { visible: false, distance: 0, targetX: 0, targetY: 0, dirX: 0, dirY: 0 }, { transient: true, fields: { visible: { advanced: true, tooltip: `A target is seen (runtime, read-only).` } } });
var TT = Xe(`PerceptionTarget`);
function ET(e8, t2) {
  let n2 = e8.getEntitiesWithComponents([TT, I]).map((t3) => {
    let n3 = e8.get(t3, I);
    return { e: t3, x: n3.position.x, y: n3.position.y };
  });
  for (let r2 of e8.getEntitiesWithComponents([CT, I])) {
    let i2 = e8.get(r2, CT), a2 = e8.get(r2, I), o2 = a2.position.x, s2 = a2.position.y, c2 = bT(a2.rotation.z, a2.rotation.w), l2 = i2.fovDegrees * Math.PI / 180 / 2, u2 = null;
    for (let e9 of n2) {
      if (e9.e === r2) continue;
      let n3 = ST(o2, s2, c2, e9.x, e9.y, i2.range, l2, t2 && ((n4, i3, a3, o3) => t2(n4, i3, a3, o3, r2, e9.e)));
      n3.visible && (!u2 || n3.distance < u2.distance) && (u2 = { x: e9.x, y: e9.y, distance: n3.distance, dirX: n3.dirX, dirY: n3.dirY });
    }
    let d2 = u2 ? { visible: true, distance: u2.distance, targetX: u2.x, targetY: u2.y, dirX: u2.dirX, dirY: u2.dirY } : { visible: false, distance: 0, targetX: 0, targetY: 0, dirX: 0, dirY: 0 };
    e8.has(r2, wT) ? e8.set(r2, wT, d2) : e8.insert(r2, wT, d2);
  }
}
function DT(e8) {
  return (t2, n2, r2, i2, a2, o2) => {
    let s2 = r2 - t2, c2 = i2 - n2, l2 = Math.hypot(s2, c2);
    return l2 !== 0 && e8.raycast({ x: t2, y: n2 }, { x: s2 / l2, y: c2 / l2 }, l2).some((e9) => e9.fraction < 0.98 && e9.entity !== a2 && e9.entity !== o2);
  };
}
var OT = class {
  constructor() {
    this.name = `perception`;
  }
  build(e8) {
    e8.addSystemToSchedule(2, Wi([Hi()], (t2) => {
      let n2 = e8.hasResource(Z3) ? e8.getResource(Z3) : null;
      ET(t2, n2 ? DT(n2) : void 0);
    }, { name: `PerceptionSystem`, touches: { reads: [CT._name, TT._name, I._name], writes: [wT._name] } }), { runIf: l });
  }
};
var kT = new OT();
var XT = k(`CacheAsBitmap`, { enabled: true, dirty: true, width: 256, height: 256 });
var iE = (function(e8) {
  return e8.Portrait = `portrait`, e8.Landscape = `landscape`, e8;
})({});
var cE = class {
  constructor(e8, t2 = {}) {
    this.handlers = /* @__PURE__ */ new Map(), this.requestHandlers = /* @__PURE__ */ new Map(), this.binaryHandlers = /* @__PURE__ */ new Map(), this.pending = /* @__PURE__ */ new Map(), this.nextId = 1, this.transport = e8, this.defaultTimeout = t2.requestTimeoutMs ?? 1e4, this.offMessage_ = e8.on(`message`, (e9) => this.handleIncoming_(e9));
  }
  on(e8, t2) {
    let n2 = this.handlers.get(e8);
    return n2 || (n2 = /* @__PURE__ */ new Set(), this.handlers.set(e8, n2)), n2.add(t2), () => {
      let n3 = this.handlers.get(e8);
      n3 && (n3.delete(t2), n3.size === 0 && this.handlers.delete(e8));
    };
  }
  send(e8, t2) {
    this.send_({ k: `event`, t: e8, d: t2 });
  }
  handle(e8, t2) {
    return this.requestHandlers.set(e8, t2), () => {
      this.requestHandlers.get(e8) === t2 && this.requestHandlers.delete(e8);
    };
  }
  request(e8, t2, n2) {
    let r2 = this.nextId++, i2 = n2 ?? this.defaultTimeout;
    return new Promise((n3, a2) => {
      let o2 = i2 > 0 ? setTimeout(() => {
        this.pending.delete(r2), a2(Error(`net request "${e8}" timed out after ${i2}ms`));
      }, i2) : null;
      this.pending.set(r2, { resolve: n3, reject: a2, timer: o2 }), this.send_({ k: `req`, t: e8, id: r2, d: t2 });
    });
  }
  onBinary(e8, t2) {
    return this.binaryHandlers.set(e8, t2), () => {
      this.binaryHandlers.get(e8) === t2 && this.binaryHandlers.delete(e8);
    };
  }
  sendBinary(e8, t2) {
    let n2 = new Uint8Array(1 + t2.byteLength);
    n2[0] = e8, n2.set(t2, 1), this.transport.send(n2.buffer);
  }
  dispose(e8 = `net channel closed`) {
    this.offMessage_();
    for (let [, t2] of this.pending) t2.timer && clearTimeout(t2.timer), t2.reject(Error(e8));
    this.pending.clear(), this.handlers.clear(), this.requestHandlers.clear(), this.binaryHandlers.clear();
  }
  send_(e8) {
    this.transport.send(JSON.stringify(e8));
  }
  handleIncoming_(e8) {
    if (typeof e8 != `string`) {
      let t3 = new Uint8Array(e8);
      if (t3.byteLength === 0) return;
      this.binaryHandlers.get(t3[0])?.(t3.subarray(1));
      return;
    }
    let t2;
    try {
      t2 = JSON.parse(e8);
    } catch {
      return;
    }
    if (!(!t2 || typeof t2.k != `string`)) switch (t2.k) {
      case `event`:
        this.dispatchEvent_(t2.t, t2.d);
        break;
      case `req`:
        this.handleRequest_(t2);
        break;
      case `res`:
        this.resolvePending_(t2);
    }
  }
  dispatchEvent_(e8, t2) {
    let n2 = this.handlers.get(e8);
    if (n2) for (let e9 of [...n2]) e9(t2);
  }
  handleRequest_(e8) {
    let t2 = this.requestHandlers.get(e8.t);
    if (!t2) {
      this.send_({ k: `res`, id: e8.id, e: `no request handler for "${e8.t}"` });
      return;
    }
    Promise.resolve().then(() => t2(e8.d)).then((t3) => this.send_({ k: `res`, id: e8.id, d: t3 }), (t3) => this.send_({ k: `res`, id: e8.id, e: t3 instanceof Error ? t3.message : String(t3) }));
  }
  resolvePending_(e8) {
    let t2 = this.pending.get(e8.id);
    t2 && (this.pending.delete(e8.id), t2.timer && clearTimeout(t2.timer), e8.e === void 0 ? t2.resolve(e8.d) : t2.reject(Error(e8.e)));
  }
};
var mE = { hello: `repl:hello`, spawn: `repl:spawn`, despawn: `repl:despawn`, input: `repl:input`, ack: `repl:ack` };
var hE = 1163088464;
function gE(e8) {
  switch (typeof e8) {
    case `number`:
      return { kind: `f32` };
    case `boolean`:
      return { kind: `bool` };
    case `string`:
      return { kind: `string` };
    case `object`: {
      if (e8 === null || Array.isArray(e8)) return { kind: `json` };
      let t2 = Object.keys(e8);
      return { kind: `object`, keys: t2, shapes: t2.map((t3) => gE(e8[t3])) };
    }
    default:
      return { kind: `json` };
  }
}
function _E(e8) {
  if (typeof e8 != `object` || !e8) return e8;
  if (Array.isArray(e8)) return e8.map(_E);
  let t2 = {};
  for (let n2 in e8) t2[n2] = _E(e8[n2]);
  return t2;
}
function vE() {
  let e8 = [], t2 = [...at().entries()].filter(([, e9]) => e9.replicatedFields.length > 0).map(([e9]) => e9).sort();
  for (let n2 of t2) {
    let t3 = at().get(n2), r2 = [...t3.replicatedFields];
    if (r2.length > 32) throw Error(`[repl] component "${n2}" declares ${r2.length} replicated fields; the field mask caps at 32`);
    let i2 = t3._default, a2 = new Set(t3.entityFields);
    e8.push({ id: e8.length, name: n2, def: t3, fields: r2, shapes: r2.map((e9) => a2.has(e9) ? { kind: `entity` } : gE(i2[e9])) });
  }
  return { entries: e8, byName: new Map(e8.map((e9) => [e9.name, e9])) };
}
function yE(e8) {
  return e8.entries.map((e9) => ({ name: e9.name, fields: [...e9.fields] }));
}
function bE(e8, t2) {
  if (e8.length !== t2.length) return `replication table size mismatch (${e8.length} vs ${t2.length})`;
  for (let n2 = 0; n2 < e8.length; n2++) {
    if (e8[n2].name !== t2[n2].name) return `component #${n2} differs ("${e8[n2].name}" vs "${t2[n2].name}")`;
    if (e8[n2].fields.join(`,`) !== t2[n2].fields.join(`,`)) return `component "${e8[n2].name}" field list differs ([${e8[n2].fields}] vs [${t2[n2].fields}])`;
  }
  return null;
}
var xE;
var SE;
var CE = () => xE ??= new TextEncoder();
var wE = () => SE ??= new TextDecoder();
var TE = class {
  constructor(e8 = 256) {
    this.len_ = 0, this.buf_ = new Uint8Array(e8), this.view_ = new DataView(this.buf_.buffer);
  }
  get length() {
    return this.len_;
  }
  ensure_(e8) {
    if (this.len_ + e8 <= this.buf_.byteLength) return;
    let t2 = this.buf_.byteLength * 2;
    for (; t2 < this.len_ + e8; ) t2 *= 2;
    let n2 = new Uint8Array(t2);
    n2.set(this.buf_.subarray(0, this.len_)), this.buf_ = n2, this.view_ = new DataView(n2.buffer);
  }
  u8(e8) {
    this.ensure_(1), this.view_.setUint8(this.len_, e8), this.len_ += 1;
  }
  u16(e8) {
    this.ensure_(2), this.view_.setUint16(this.len_, e8, true), this.len_ += 2;
  }
  u32(e8) {
    this.ensure_(4), this.view_.setUint32(this.len_, e8 >>> 0, true), this.len_ += 4;
  }
  f32(e8) {
    this.ensure_(4), this.view_.setFloat32(this.len_, e8, true), this.len_ += 4;
  }
  string(e8) {
    let t2 = CE().encode(e8);
    if (t2.byteLength > 65535) throw Error(`[repl] string field exceeds 65535 utf-8 bytes`);
    this.u16(t2.byteLength), this.ensure_(t2.byteLength), this.buf_.set(t2, this.len_), this.len_ += t2.byteLength;
  }
  patchU16(e8, t2) {
    this.view_.setUint16(e8, t2, true);
  }
  finish() {
    return this.buf_.slice(0, this.len_);
  }
};
var EE = class {
  constructor(e8) {
    this.pos_ = 0, this.bytes_ = e8, this.view_ = new DataView(e8.buffer, e8.byteOffset, e8.byteLength);
  }
  get remaining() {
    return this.bytes_.byteLength - this.pos_;
  }
  u8() {
    let e8 = this.view_.getUint8(this.pos_);
    return this.pos_ += 1, e8;
  }
  u16() {
    let e8 = this.view_.getUint16(this.pos_, true);
    return this.pos_ += 2, e8;
  }
  u32() {
    let e8 = this.view_.getUint32(this.pos_, true);
    return this.pos_ += 4, e8;
  }
  f32() {
    let e8 = this.view_.getFloat32(this.pos_, true);
    return this.pos_ += 4, e8;
  }
  string() {
    let e8 = this.u16(), t2 = wE().decode(this.bytes_.subarray(this.pos_, this.pos_ + e8));
    return this.pos_ += e8, t2;
  }
};
var DE = { toWire: (e8) => e8, fromWire: (e8) => e8 };
function OE(e8, t2, n2, r2 = DE) {
  switch (t2.kind) {
    case `f32`:
      e8.f32(typeof n2 == `number` ? n2 : 0);
      break;
    case `bool`:
      e8.u8(+!!n2);
      break;
    case `string`:
      e8.string(typeof n2 == `string` ? n2 : ``);
      break;
    case `entity`:
      e8.u32(r2.toWire(typeof n2 == `number` ? n2 : 0));
      break;
    case `object`: {
      let i2 = n2 ?? {};
      for (let n3 = 0; n3 < t2.keys.length; n3++) OE(e8, t2.shapes[n3], i2[t2.keys[n3]], r2);
      break;
    }
    case `json`:
      e8.string(JSON.stringify(n2 ?? null));
  }
}
function kE(e8, t2, n2 = DE) {
  switch (t2.kind) {
    case `f32`:
      return e8.f32();
    case `bool`:
      return e8.u8() !== 0;
    case `string`:
      return e8.string();
    case `entity`:
      return n2.fromWire(e8.u32());
    case `object`: {
      let r2 = {};
      for (let i2 = 0; i2 < t2.keys.length; i2++) r2[t2.keys[i2]] = kE(e8, t2.shapes[i2], n2);
      return r2;
    }
    case `json`:
      return JSON.parse(e8.string());
  }
}
var AE = class {
  constructor(e8) {
    this.w_ = new TE(), this.count_ = 0, this.w_.u32(hE), this.w_.u8(2), this.w_.u32(e8), this.countOffset_ = this.w_.length, this.w_.u16(0);
  }
  get entryCount() {
    return this.count_;
  }
  entry(e8, t2, n2, r2, i2) {
    this.w_.u32(e8), this.w_.u16(t2.id), this.w_.u32(n2);
    for (let e9 = 0; e9 < t2.fields.length; e9++) n2 & 1 << e9 && OE(this.w_, t2.shapes[e9], r2[t2.fields[e9]], i2);
    this.count_++;
  }
  finish() {
    return this.w_.patchU16(this.countOffset_, this.count_), this.w_.finish();
  }
};
function jE(e8, t2, n2) {
  let r2 = new EE(e8);
  if (r2.u32() !== hE) throw Error(`[repl] bad state frame magic`);
  let i2 = r2.u8();
  if (i2 !== 2) throw Error(`[repl] state frame protocol v${i2}, expected v2`);
  let a2 = r2.u32(), o2 = r2.u16(), s2 = [];
  for (let e9 = 0; e9 < o2; e9++) {
    let e10 = r2.u32(), i3 = r2.u16(), a3 = r2.u32(), o3 = t2.entries[i3];
    if (!o3) throw Error(`[repl] state frame names unknown component id ${i3}`);
    let c2 = [];
    for (let e11 = 0; e11 < o3.fields.length; e11++) a3 & 1 << e11 && c2.push(kE(r2, o3.shapes[e11], n2));
    s2.push({ netId: e10, componentId: i3, fieldMask: a3, values: c2 });
  }
  return { tick: a2, entries: s2 };
}
var ME = k(`Replicated`, { netId: 0, owner: 0 });
var NE = Xe(`NetGhost`);
function PE() {
  k(`Replicated`, { netId: 0, owner: 0 }), Xe(`NetGhost`);
}
var LE = class {
  constructor() {
    this.byNetId_ = /* @__PURE__ */ new Map(), this.byEntity_ = /* @__PURE__ */ new Map(), this.nextId_ = 1;
  }
  allocate() {
    return this.nextId_++;
  }
  register(e8, t2) {
    this.byNetId_.set(e8, t2), this.byEntity_.set(t2, e8);
  }
  unregister(e8) {
    let t2 = this.byNetId_.get(e8);
    this.byNetId_.delete(e8), t2 !== void 0 && this.byEntity_.delete(t2);
  }
  unregisterEntity(e8) {
    let t2 = this.byEntity_.get(e8);
    this.byEntity_.delete(e8), t2 !== void 0 && this.byNetId_.delete(t2);
  }
  entityOf(e8) {
    return this.byNetId_.get(e8);
  }
  netIdOf(e8) {
    return this.byEntity_.get(e8);
  }
  get size() {
    return this.byNetId_.size;
  }
  clear() {
    this.byNetId_.clear(), this.byEntity_.clear(), this.nextId_ = 1;
  }
};
function RE(e8, t2) {
  if (e8 === t2) return true;
  if (e8 === null || t2 === null || typeof e8 != `object` || typeof t2 != `object`) return false;
  let n2 = e8, r2 = t2, i2 = Object.keys(n2);
  if (i2.length !== Object.keys(r2).length) return false;
  for (let e9 of i2) if (!RE(n2[e9], r2[e9])) return false;
  return true;
}
var zE = class {
  constructor(e8) {
    this.netIds_ = new LE(), this.connections_ = /* @__PURE__ */ new Map(), this.nextConnectionId_ = 1, this.table_ = null, this.shadow_ = /* @__PURE__ */ new Map(), this.known_ = /* @__PURE__ */ new Set(), this.knownNetIds_ = /* @__PURE__ */ new Map(), this.policy_ = null, this.tick_ = 0, this.fixedDelta_ = 0, this.world_ = e8, e8.onDespawn((e9) => {
      this.netIds_.unregisterEntity(e9);
    });
  }
  get table() {
    return this.table_ ??= vE();
  }
  get netIds() {
    return this.netIds_;
  }
  get connectionCount() {
    return this.connections_.size;
  }
  get clientIds() {
    let e8 = [];
    for (let t2 of this.connections_.values()) t2.ready && e8.push(t2.id);
    return e8;
  }
  get refs_() {
    return { toWire: (e8) => this.netIds_.netIdOf(e8) ?? 0, fromWire: (e8) => this.netIds_.entityOf(e8) ?? 0 };
  }
  setInterestPolicy(e8) {
    this.policy_ = e8;
  }
  attachConnection(e8) {
    let t2 = this.nextConnectionId_++, n2 = new cE(e8), r2 = { id: t2, channel: n2, ready: false, input: null, queue: [], applied: null, ackedSeq: 0, interest: /* @__PURE__ */ new Set() };
    return this.connections_.set(t2, r2), n2.on(mE.input, (e9) => {
      (!r2.input || e9.seq > r2.input.seq) && (r2.input = e9), r2.queue.push(e9), r2.queue.length > 128 && r2.queue.shift();
    }), n2.handle(mE.hello, (e9) => {
      if (e9.protocolVersion !== 2) return { ok: false, error: `protocol v${e9.protocolVersion}, server runs v2` };
      if (e9.abiHash !== `310236a4dffb268f`) return { ok: false, error: `component ABI hash mismatch \u2014 client and server run different builds` };
      let n3 = bE(yE(this.table), e9.components);
      return n3 ? { ok: false, error: `replication schema mismatch: ${n3}` } : (Promise.resolve().then(() => this.sendInitialState_(r2)), { ok: true, connectionId: t2, tick: this.tick_, fixedDelta: this.fixedDelta_ });
    }), t2;
  }
  detachConnection(e8) {
    let t2 = this.connections_.get(e8);
    t2 && (t2.channel.dispose(), this.connections_.delete(e8));
  }
  inputOf(e8) {
    return this.connections_.get(e8)?.input ?? null;
  }
  tickInputOf(e8) {
    return this.connections_.get(e8)?.applied ?? null;
  }
  beginTick(e8) {
    e8 > 0 && (this.fixedDelta_ = e8);
    for (let e9 of this.connections_.values()) {
      let t2 = e9.queue.shift();
      t2 && (e9.applied = t2);
    }
  }
  sample(e8) {
    if (this.tick_ = e8, this.connections_.size === 0) return;
    let t2 = this.world_.getEntitiesWithComponents([ME]), n2 = new Set(t2), r2 = [];
    for (let e9 of t2) this.known_.has(e9) || (this.registerEntity_(e9), r2.push(e9));
    let i2 = [];
    for (let e9 of [...this.known_]) if (!n2.has(e9) || !this.world_.valid(e9)) {
      let t3 = this.knownNetIds_.get(e9);
      t3 !== void 0 && (i2.push({ entity: e9, netId: t3 }), this.netIds_.unregister(t3)), this.known_.delete(e9), this.knownNetIds_.delete(e9), this.shadow_.delete(e9);
    }
    let a2 = this.collectDirty_();
    this.policy_ ? this.sampleWithInterest_(e8, i2, a2) : this.sampleBroadcast_(e8, r2, i2, a2);
    for (let t3 of this.connections_.values()) !t3.ready || !t3.applied || t3.applied.seq <= t3.ackedSeq || (t3.ackedSeq = t3.applied.seq, this.sendTo_(t3, (n3) => n3.channel.send(mE.ack, { tick: e8, seq: t3.ackedSeq })));
  }
  sampleBroadcast_(e8, t2, n2, r2) {
    if (t2.length > 0) {
      let n3 = t2.map((e9) => this.spawnPayload_(e9, this.knownNetIds_.get(e9)));
      this.broadcast_((t3) => t3.channel.send(mE.spawn, { tick: e8, entities: n3 }));
    }
    if (n2.length > 0) {
      let t3 = n2.map((e9) => e9.netId);
      this.broadcast_((n3) => n3.channel.send(mE.despawn, { tick: e8, netIds: t3 }));
    }
    for (let r3 of this.connections_.values()) if (r3.ready) {
      for (let e9 of t2) r3.interest.add(e9);
      for (let e9 of n2) r3.interest.delete(e9.entity);
      if (r3.interest.size !== this.known_.size) {
        let t3 = [];
        for (let e9 of this.known_) r3.interest.has(e9) || (r3.interest.add(e9), t3.push(this.spawnPayload_(e9, this.knownNetIds_.get(e9))));
        t3.length > 0 && this.sendTo_(r3, (n3) => n3.channel.send(mE.spawn, { tick: e8, entities: t3 }));
      }
    }
    if (r2.length > 0) {
      let t3 = new AE(e8);
      for (let e9 of r2) t3.entry(e9.netId, e9.te, e9.mask, e9.data, this.refs_);
      let n3 = t3.finish();
      this.broadcast_((e9) => e9.channel.sendBinary(1, n3));
    }
  }
  sampleWithInterest_(e8, t2, n2) {
    let r2 = new Map(t2.map((e9) => [e9.entity, e9.netId])), i2 = [...this.known_], a2 = /* @__PURE__ */ new Map(), o2 = (e9) => {
      let t3 = a2.get(e9);
      return t3 || (t3 = this.spawnPayload_(e9, this.knownNetIds_.get(e9)), a2.set(e9, t3)), t3;
    };
    for (let t3 of this.connections_.values()) {
      if (!t3.ready) continue;
      let a3 = this.visibleFor_(t3.id, i2), s2 = [];
      for (let e9 of a3) t3.interest.has(e9) || s2.push(e9);
      let c2 = [];
      for (let e9 of t3.interest) {
        if (a3.has(e9)) continue;
        let t4 = this.knownNetIds_.get(e9) ?? r2.get(e9);
        t4 !== void 0 && c2.push(t4);
      }
      t3.interest = a3, this.sendTo_(t3, (t4) => {
        s2.length > 0 && t4.channel.send(mE.spawn, { tick: e8, entities: s2.map(o2) }), c2.length > 0 && t4.channel.send(mE.despawn, { tick: e8, netIds: c2 });
        let r3 = null, i3 = new Set(s2);
        for (let t5 of n2) !a3.has(t5.entity) || i3.has(t5.entity) || (r3 ??= new AE(e8), r3.entry(t5.netId, t5.te, t5.mask, t5.data, this.refs_));
        r3 && r3.entryCount > 0 && t4.channel.sendBinary(1, r3.finish());
      });
    }
  }
  visibleFor_(e8, t2) {
    let n2 = this.policy_({ connectionId: e8, world: this.world_, candidates: t2 }), r2 = n2 === `all` ? new Set(t2) : new Set(n2);
    for (let n3 of t2) {
      if (r2.has(n3)) continue;
      let t3 = this.world_.tryGet(n3, ME);
      t3 && t3.owner === e8 && r2.add(n3);
    }
    return r2;
  }
  registerEntity_(e8) {
    let t2 = this.world_.tryGet(e8, ME);
    t2.netId === 0 && (t2.netId = this.netIds_.allocate(), this.world_.set(e8, ME, t2)), this.netIds_.register(t2.netId, e8), this.known_.add(e8), this.knownNetIds_.set(e8, t2.netId), this.seedShadow_(e8);
  }
  seedShadow_(e8) {
    let t2 = /* @__PURE__ */ new Map();
    for (let n2 of this.table.entries) {
      if (!this.world_.has(e8, n2.def)) continue;
      let r2 = this.world_.tryGet(e8, n2.def), i2 = {};
      for (let e9 of n2.fields) i2[e9] = _E(r2[e9]);
      t2.set(n2.id, i2);
    }
    this.shadow_.set(e8, t2);
  }
  spawnPayload_(e8, t2) {
    let n2 = Ct2(this.world_, e8).map((e9) => this.rewriteEntityRefs_(e9)), r2 = this.world_.tryGet(e8, z), i2 = this.world_.tryGet(e8, L), a2 = i2 ? this.netIds_.netIdOf(i2.entity) ?? 0 : 0;
    return { netId: t2, name: r2?.value ?? ``, parentNetId: a2, components: n2 };
  }
  rewriteEntityRefs_(e8) {
    let t2 = M(e8.type)?.entityFields ?? [];
    if (t2.length === 0) return e8;
    let n2 = { ...e8.data };
    for (let e9 of t2) typeof n2[e9] == `number` && (n2[e9] = this.netIds_.netIdOf(n2[e9]) ?? 0);
    return { type: e8.type, data: n2 };
  }
  collectDirty_() {
    let e8 = [];
    for (let t2 of this.known_) {
      let n2 = this.shadow_.get(t2);
      if (!n2) continue;
      let r2 = this.knownNetIds_.get(t2);
      if (r2 !== void 0) for (let i2 of this.table.entries) {
        if (!this.world_.has(t2, i2.def)) continue;
        let a2 = this.world_.tryGet(t2, i2.def), o2 = n2.get(i2.id);
        o2 || (o2 = {}, n2.set(i2.id, o2));
        let s2 = 0;
        for (let e9 = 0; e9 < i2.fields.length; e9++) {
          let t3 = i2.fields[e9];
          (!(t3 in o2) || !RE(a2[t3], o2[t3])) && (s2 |= 1 << e9, o2[t3] = _E(a2[t3]));
        }
        s2 !== 0 && e8.push({ entity: t2, netId: r2, te: i2, mask: s2, data: a2 });
      }
    }
    return e8;
  }
  sendInitialState_(e8) {
    if (!this.connections_.has(e8.id)) return;
    let t2 = [...this.known_], n2 = this.policy_ ? this.visibleFor_(e8.id, t2) : new Set(t2), r2 = [];
    for (let e9 of n2) {
      let t3 = this.knownNetIds_.get(e9);
      t3 !== void 0 && r2.push(this.spawnPayload_(e9, t3));
    }
    r2.length > 0 && e8.channel.send(mE.spawn, { tick: this.tick_, entities: r2 }), e8.interest = n2, e8.ready = true;
  }
  broadcast_(e8) {
    for (let t2 of this.connections_.values()) t2.ready && this.sendTo_(t2, e8);
  }
  sendTo_(e8, t2) {
    try {
      t2(e8);
    } catch (t3) {
      T.warn(`repl`, `send to connection ${e8.id} failed`, t3);
    }
  }
};
var BE = -Math.log(0.9);
function VE(e8) {
  if (e8.length !== 4) return false;
  let t2 = new Set(e8);
  return t2.has(`x`) && t2.has(`y`) && t2.has(`z`) && t2.has(`w`);
}
function HE(e8, t2, n2) {
  return e8 + (t2 - e8) * n2;
}
function UE(e8, t2, n2) {
  let r2 = e8.x * t2.x + e8.y * t2.y + e8.z * t2.z + e8.w * t2.w < 0 ? -1 : 1, i2 = HE(e8.x, t2.x * r2, n2), a2 = HE(e8.y, t2.y * r2, n2), o2 = HE(e8.z, t2.z * r2, n2), s2 = HE(e8.w, t2.w * r2, n2), c2 = Math.hypot(i2, a2, o2, s2);
  return c2 > 1e-8 && (i2 /= c2, a2 /= c2, o2 /= c2, s2 /= c2), { x: i2, y: a2, z: o2, w: s2 };
}
function WE(e8, t2, n2, r2) {
  switch (e8.kind) {
    case `f32`:
      return HE(t2, n2, r2);
    case `object`: {
      let i2 = t2, a2 = n2;
      if (VE(e8.keys)) return UE(i2, a2, r2);
      let o2 = {};
      for (let t3 = 0; t3 < e8.keys.length; t3++) {
        let n3 = e8.keys[t3];
        o2[n3] = WE(e8.shapes[t3], i2[n3], a2[n3], r2);
      }
      return o2;
    }
    default:
      return t2;
  }
}
var GE = class {
  constructor() {
    this.samples = [];
  }
  push(e8, t2) {
    let n2 = this.samples[this.samples.length - 1];
    if (n2 && e8 <= n2.tick) {
      n2.value = t2;
      return;
    }
    this.samples.push({ tick: e8, value: t2 });
  }
  trim(e8) {
    let t2 = 0;
    for (; t2 < this.samples.length - 1 && this.samples[t2 + 1].tick <= e8; ) t2++;
    t2 > 0 && this.samples.splice(0, t2);
  }
  sample(e8, t2) {
    let n2 = this.samples;
    if (n2.length !== 0) {
      if (t2 <= n2[0].tick) return t2 === n2[0].tick ? n2[0].value : void 0;
      for (let r2 = n2.length - 1; r2 >= 0; r2--) if (n2[r2].tick <= t2) {
        let i2 = n2[r2], a2 = n2[r2 + 1];
        return a2 ? WE(e8, i2.value, a2.value, (t2 - i2.tick) / (a2.tick - i2.tick)) : i2.value;
      }
    }
  }
};
var KE = class {
  constructor() {
    this.byField = /* @__PURE__ */ new Map();
  }
  push(e8, t2, n2) {
    let r2 = this.byField.get(e8);
    r2 || (r2 = new GE(), this.byField.set(e8, r2)), r2.push(t2, n2);
  }
};
var qE = class {
  constructor(e8) {
    this.delayTicks = e8, this.buffers = /* @__PURE__ */ new Map(), this.newestTick = 0, this.renderTime_ = null;
  }
  push(e8, t2, n2, r2, i2) {
    r2 > this.newestTick && (this.newestTick = r2);
    let a2 = this.buffers.get(e8);
    a2 || (a2 = /* @__PURE__ */ new Map(), this.buffers.set(e8, a2));
    let o2 = a2.get(t2);
    o2 || (o2 = new KE(), a2.set(t2, o2)), o2.push(n2, r2, i2);
  }
  drop(e8) {
    this.buffers.delete(e8);
  }
  advance(e8) {
    let t2 = this.newestTick - this.delayTicks;
    if (this.renderTime_ === null) this.renderTime_ = t2;
    else {
      this.renderTime_ += e8;
      let n2 = 1 - Math.exp(-Math.max(e8, 0) * BE);
      this.renderTime_ += (t2 - this.renderTime_) * n2;
      let r2 = this.newestTick, i2 = t2 - this.delayTicks;
      this.renderTime_ > r2 && (this.renderTime_ = r2), this.renderTime_ < i2 && (this.renderTime_ = i2);
    }
    for (let e9 of this.buffers.values()) for (let t3 of e9.values()) for (let e10 of t3.byField.values()) e10.trim(this.renderTime_);
    return this.renderTime_;
  }
};
function JE(e8, t2, n2, r2, i2) {
  if (e8.kind === `f32`) {
    if (typeof t2 != `number` || typeof n2 != `number`) return n2;
    let e9 = t2 - n2;
    return Math.abs(e9) > i2 ? n2 : n2 + e9 * r2;
  }
  if (e8.kind === `object`) {
    if (t2 === null || n2 === null || typeof t2 != `object` || typeof n2 != `object`) return n2;
    let a2 = { ...n2 };
    for (let o2 = 0; o2 < e8.keys.length; o2++) {
      let s2 = e8.keys[o2];
      a2[s2] = JE(e8.shapes[o2], t2[s2], n2[s2], r2, i2);
    }
    return a2;
  }
  return n2;
}
var YE = class {
  constructor(e8, t2 = {}) {
    this.netIds_ = new LE(), this.offDespawn_ = null, this.channel_ = null, this.table_ = null, this.connectionId_ = 0, this.serverTick_ = 0, this.pendingFrames_ = [], this.pendingSpawns_ = [], this.pendingDespawns_ = [], this.inputSeq_ = 0, this.pendingInputs_ = [], this.ackedSeq_ = 0, this.authority_ = /* @__PURE__ */ new Map(), this.fixedDelta_ = 1 / 60, this.world_ = e8;
    let n2 = t2.interpolationDelayTicks ?? 2;
    this.interp_ = n2 > 0 ? new qE(n2) : null, this.prediction_ = t2.prediction ?? null, this.offDespawn_ = e8.onDespawn((e9) => this.netIds_.unregisterEntity(e9));
  }
  get table() {
    return this.table_ ??= vE();
  }
  get netIds() {
    return this.netIds_;
  }
  get connected() {
    return this.channel_ !== null && this.connectionId_ !== 0;
  }
  get connectionId() {
    return this.connectionId_;
  }
  get serverTick() {
    return this.serverTick_;
  }
  get refs_() {
    return { toWire: (e8) => this.netIds_.netIdOf(e8) ?? 0, fromWire: (e8) => this.netIds_.entityOf(e8) ?? 0 };
  }
  async connect(e8) {
    if (this.channel_) throw Error(`[repl] client already connected`);
    let t2 = new cE(e8);
    this.channel_ = t2, t2.on(mE.spawn, (e9) => this.pendingSpawns_.push(e9)), t2.on(mE.despawn, (e9) => this.pendingDespawns_.push(e9)), t2.on(mE.ack, (e9) => {
      e9.seq > this.ackedSeq_ && (this.ackedSeq_ = e9.seq);
    }), t2.onBinary(1, (e9) => {
      this.pendingFrames_.push(e9.slice());
    });
    let n2 = { protocolVersion: 2, abiHash: Te, components: yE(this.table) }, r2;
    try {
      r2 = await t2.request(mE.hello, n2);
    } catch (e9) {
      throw this.disconnect(), e9;
    }
    if (!r2.ok) throw this.disconnect(), Error(`[repl] server refused connection: ${r2.error}`);
    this.connectionId_ = r2.connectionId, this.serverTick_ = r2.tick, r2.fixedDelta > 0 && (this.fixedDelta_ = r2.fixedDelta);
  }
  setFixedDelta(e8) {
    e8 > 0 && (this.fixedDelta_ = e8);
  }
  get predictionEnabled() {
    return this.prediction_ !== null;
  }
  enablePrediction(e8) {
    this.prediction_ = e8;
    for (let e9 of this.ownedEntities_()) {
      let t2 = this.netIds_.netIdOf(e9);
      t2 !== void 0 && !this.authority_.has(t2) && this.seedAuthority_(t2, e9);
    }
  }
  disconnect() {
    this.channel_?.dispose(), this.channel_ = null, this.connectionId_ = 0, this.offDespawn_?.(), this.offDespawn_ = null, this.netIds_.clear(), this.authority_.clear(), this.pendingFrames_.length = 0, this.pendingSpawns_.length = 0, this.pendingDespawns_.length = 0, this.pendingInputs_.length = 0;
  }
  sendInput(e8) {
    if (!this.channel_) return;
    let t2 = { seq: ++this.inputSeq_, actions: e8 };
    if (this.channel_.send(mE.input, t2), !this.prediction_) return;
    this.pendingInputs_.push(t2);
    let n2 = this.prediction_.maxPendingInputs ?? 120;
    this.pendingInputs_.length > n2 && this.pendingInputs_.shift();
    for (let t3 of this.ownedEntities_()) this.prediction_.apply(this.world_, t3, e8, this.fixedDelta_);
  }
  ownsEntity(e8) {
    let t2 = this.world_.tryGet(e8, ME);
    return t2 !== null && t2.owner === this.connectionId_ && this.connectionId_ !== 0;
  }
  applyPending() {
    for (; this.pendingSpawns_.length > 0; ) this.applySpawnBatch_(this.pendingSpawns_.shift());
    for (; this.pendingFrames_.length > 0; ) this.applyStateFrame_(jE(this.pendingFrames_.shift(), this.table, this.refs_));
    for (; this.pendingDespawns_.length > 0; ) this.applyDespawnBatch_(this.pendingDespawns_.shift());
    if (this.prediction_) {
      for (; this.pendingInputs_.length > 0 && this.pendingInputs_[0].seq <= this.ackedSeq_; ) this.pendingInputs_.shift();
      this.reconcilePredicted_();
    }
  }
  reconcilePredicted_() {
    let e8 = this.ownedEntities_();
    if (e8.length === 0) return;
    let t2 = this.prediction_.smoothing, n2 = t2 ? /* @__PURE__ */ new Map() : null;
    if (n2) for (let t3 of e8) {
      let e9 = /* @__PURE__ */ new Map();
      for (let n3 of this.table.entries) {
        if (!this.world_.has(t3, n3.def)) continue;
        let r2 = this.world_.tryGet(t3, n3.def), i2 = {};
        for (let e10 of n3.fields) i2[e10] = r2[e10];
        e9.set(n3.id, i2);
      }
      n2.set(t3, e9);
    }
    for (let t3 of e8) {
      let e9 = this.netIds_.netIdOf(t3);
      if (e9 === void 0) continue;
      let n3 = this.authority_.get(e9);
      if (n3) for (let [e10, r2] of n3) {
        let n4 = this.table.entries[e10];
        if (!n4) continue;
        let i2 = this.world_.tryGet(t3, n4.def), a2 = i2 ?? {};
        for (let e11 of n4.fields) e11 in r2 && (a2[e11] = _E(r2[e11]));
        i2 ? this.world_.set(t3, n4.def, a2) : this.world_.insert(t3, n4.def, a2);
      }
    }
    for (let t3 of this.pendingInputs_) for (let n3 of e8) this.prediction_.apply(this.world_, n3, t3.actions, this.fixedDelta_);
    if (t2 && n2) {
      let r2 = 0.5 ** (this.fixedDelta_ / t2.halfLife), i2 = t2.maxError ?? 1 / 0;
      for (let t3 of e8) {
        let e9 = n2.get(t3);
        if (e9) for (let [n3, a2] of e9) {
          let e10 = this.table.entries[n3];
          if (!e10 || !this.world_.has(t3, e10.def)) continue;
          let o2 = this.world_.tryGet(t3, e10.def), s2 = false;
          for (let t4 = 0; t4 < e10.fields.length; t4++) {
            let n4 = e10.fields[t4];
            if (!(n4 in a2)) continue;
            let c2 = JE(e10.shapes[t4], a2[n4], o2[n4], r2, i2);
            c2 !== o2[n4] && (o2[n4] = c2, s2 = true);
          }
          s2 && this.world_.set(t3, e10.def, o2);
        }
      }
    }
  }
  ownedEntities_() {
    let e8 = [];
    if (this.connectionId_ === 0) return e8;
    for (let t2 of this.world_.getEntitiesWithComponents([ME])) {
      let n2 = this.world_.tryGet(t2, ME);
      n2 && n2.owner === this.connectionId_ && e8.push(t2);
    }
    return e8;
  }
  isPredicted_(e8) {
    if (!this.prediction_) return false;
    let t2 = this.netIds_.entityOf(e8);
    if (t2 === void 0 || !this.world_.valid(t2)) return false;
    let n2 = this.world_.tryGet(t2, ME);
    return n2 !== null && n2.owner === this.connectionId_;
  }
  applySpawnBatch_(e8) {
    for (let t2 of e8.entities) this.spawnGhost_(t2);
    for (let t2 of e8.entities) if (t2.parentNetId !== 0) {
      let e9 = this.netIds_.entityOf(t2.netId), n2 = this.netIds_.entityOf(t2.parentNetId);
      e9 !== void 0 && n2 !== void 0 && this.world_.setParent(e9, n2);
    }
  }
  spawnGhost_(e8) {
    if (this.netIds_.entityOf(e8.netId) !== void 0) return;
    let t2 = this.world_.spawn(e8.name || void 0);
    for (let n2 of e8.components) {
      let r2 = this.remapEntityRefs_(n2.type, n2.data);
      xt2(this.world_, t2, { type: n2.type, data: r2 }, e8.name);
    }
    this.world_.insert(t2, NE, {}), this.netIds_.register(e8.netId, t2), this.seedAuthority_(e8.netId, t2);
  }
  seedAuthority_(e8, t2) {
    if (!this.isPredicted_(e8)) return;
    let n2 = /* @__PURE__ */ new Map();
    for (let e9 of this.table.entries) {
      if (!this.world_.has(t2, e9.def)) continue;
      let r2 = this.world_.tryGet(t2, e9.def), i2 = {};
      for (let t3 of e9.fields) i2[t3] = _E(r2[t3]);
      n2.set(e9.id, i2);
    }
    this.authority_.set(e8, n2);
  }
  remapEntityRefs_(e8, t2) {
    let n2 = M(e8)?.entityFields ?? [];
    if (n2.length === 0) return { ...t2 };
    let r2 = { ...t2 };
    for (let e9 of n2) typeof r2[e9] == `number` && (r2[e9] = this.netIds_.entityOf(r2[e9]) ?? 0);
    return r2;
  }
  applyDespawnBatch_(e8) {
    for (let t2 of e8.netIds) {
      let e9 = this.netIds_.entityOf(t2);
      this.netIds_.unregister(t2), this.interp_?.drop(t2), this.authority_.delete(t2), e9 !== void 0 && this.world_.valid(e9) && this.world_.despawn(e9);
    }
  }
  applyStateFrame_(e8) {
    e8.tick > this.serverTick_ && (this.serverTick_ = e8.tick);
    for (let t2 of e8.entries) {
      if (this.isPredicted_(t2.netId)) {
        this.updateAuthority_(t2.netId, t2.componentId, t2.fieldMask, t2.values);
        continue;
      }
      if (this.interp_) {
        let n2 = 0, r2 = this.table.entries[t2.componentId];
        if (!r2) continue;
        for (let i2 = 0; i2 < r2.fields.length; i2++) t2.fieldMask & 1 << i2 && this.interp_.push(t2.netId, t2.componentId, i2, e8.tick, t2.values[n2++]);
      } else this.applyEntryNow_(t2.netId, t2.componentId, t2.fieldMask, t2.values);
    }
  }
  updateAuthority_(e8, t2, n2, r2) {
    let i2 = this.table.entries[t2];
    if (!i2) return;
    let a2 = this.authority_.get(e8);
    a2 || (a2 = /* @__PURE__ */ new Map(), this.authority_.set(e8, a2));
    let o2 = a2.get(t2);
    o2 || (o2 = {}, a2.set(t2, o2));
    let s2 = 0;
    for (let e9 = 0; e9 < i2.fields.length; e9++) n2 & 1 << e9 && (o2[i2.fields[e9]] = r2[s2++]);
  }
  applyEntryNow_(e8, t2, n2, r2) {
    let i2 = this.netIds_.entityOf(e8);
    if (i2 === void 0 || !this.world_.valid(i2)) return;
    let a2 = this.table.entries[t2];
    if (!a2) return;
    let o2 = this.world_.tryGet(i2, a2.def), s2 = o2 ?? {}, c2 = 0;
    for (let e9 = 0; e9 < a2.fields.length; e9++) n2 & 1 << e9 && (s2[a2.fields[e9]] = r2[c2++]);
    o2 ? this.world_.set(i2, a2.def, s2) : this.world_.insert(i2, a2.def, s2);
  }
  sampleInterpolation(e8) {
    if (!this.interp_ || this.interp_.newestTick === 0) return;
    let t2 = this.interp_.advance(e8);
    for (let [e9, n2] of this.interp_.buffers) {
      let r2 = this.netIds_.entityOf(e9);
      if (!(r2 === void 0 || !this.world_.valid(r2))) for (let [e10, i2] of n2) {
        let n3 = this.table.entries[e10];
        if (!n3) continue;
        let a2 = this.world_.tryGet(r2, n3.def), o2 = a2 ?? {}, s2 = false;
        for (let [e11, r3] of i2.byField) {
          let i3 = r3.sample(n3.shapes[e11], t2);
          i3 !== void 0 && (o2[n3.fields[e11]] = i3, s2 = true);
        }
        s2 && (a2 ? this.world_.set(r2, n3.def, o2) : this.world_.insert(r2, n3.def, o2));
      }
    }
  }
};
var XE = class {
  constructor(e8) {
    this.app_ = e8, this.role_ = `offline`, this.server_ = null, this.client_ = null;
  }
  get role() {
    return this.role_;
  }
  get server() {
    return this.server_;
  }
  get client() {
    return this.client_;
  }
  startServer() {
    if (this.role_ !== `offline`) throw Error(`[repl] session already ${this.role_}`);
    return this.role_ = `server`, this.server_ = new zE(this.app_.world), this.server_;
  }
  async connect(e8, t2) {
    if (this.role_ !== `offline`) throw Error(`[repl] session already ${this.role_}`);
    let n2 = new YE(this.app_.world, t2);
    this.role_ = `client`, this.client_ = n2;
    try {
      await n2.connect(e8);
    } catch (e9) {
      throw this.client_ = null, this.role_ = `offline`, e9;
    }
    return n2;
  }
  stop() {
    this.client_?.disconnect(), this.client_ = null, this.server_ = null, this.role_ = `offline`;
  }
};
var ZE = ea(null, `Net`);
var QE = class {
  constructor() {
    this.name = `replication`;
  }
  build(e8) {
    PE();
    let t2 = new XE(e8);
    e8.insertResource(ZE, t2), e8.addSystemToSchedule(10, Wi([ta(aa)], (e9) => {
      t2.client?.setFixedDelta(e9.fixedDelta), t2.client?.applyPending();
    }, { name: `ReplicationApplySystem` }), { runIf: () => t2.role === `client` }), e8.addSystemToSchedule(10, Wi([ta(aa)], (e9) => {
      t2.server?.beginTick(e9.fixedDelta);
    }, { name: `ReplicationBeginTickSystem` }), { runIf: () => t2.role === `server` }), e8.addSystemToSchedule(12, Wi([ta(aa)], (e9) => {
      t2.server?.sample(e9.fixedTick);
    }, { name: `ReplicationSampleSystem` }), { runIf: () => t2.role === `server` }), e8.addSystemToSchedule(4, Wi([ta(aa)], (e9) => {
      t2.client?.sampleInterpolation(e9.fixedDelta > 0 ? e9.delta / e9.fixedDelta : 0);
    }, { name: `ReplicationInterpolateSystem` }), { runIf: () => t2.role === `client` });
  }
};
var $E = new QE();
function tD(e8) {
  if (!e8 || typeof e8 != `object`) return;
  let t2 = e8.stack;
  return typeof t2 == `string` ? t2 : void 0;
}
function nD(e8) {
  if (typeof e8 == `string`) return e8;
  if (e8 && typeof e8 == `object`) {
    let t2 = e8.message;
    if (typeof t2 == `string`) return t2;
  }
  return String(e8);
}
function rD(e8) {
  let t2 = aD(tD(e8.error));
  return [e8.kind, e8.source ?? ``, iD(e8.message), t2].join(`|`);
}
var iD = (e8) => e8.replace(/\b\d[\d.]*\b/g, `#`).replace(/\s+/g, ` `).trim().slice(0, 200);
function aD(e8) {
  if (!e8) return ``;
  for (let t2 of e8.split(`
`)) {
    let e9 = t2.trim();
    if (!(!e9 || !e9.startsWith(`at `) && !e9.includes(`@`))) return e9.slice(0, 200);
  }
  return ``;
}
var oD = { maxDistinct: 64, flushIntervalSec: 10 };
var sD = class {
  constructor(e8 = {}) {
    this.events_ = /* @__PURE__ */ new Map(), this.sink_ = null, this.sinceFlush_ = 0, this.dropped_ = 0, this.inSink_ = false, this.maxDistinct_ = Math.max(1, e8.maxDistinct ?? oD.maxDistinct), this.flushInterval_ = Math.max(0, e8.flushIntervalSec ?? oD.flushIntervalSec);
  }
  setSink(e8) {
    this.sink_ = e8, e8 && this.events_.size > 0 && this.flush();
  }
  report(e8) {
    if (this.inSink_) return;
    let t2 = rD(e8), n2 = Date.now(), r2 = this.events_.get(t2);
    if (r2) {
      r2.count++, r2.lastAt = n2, e8.context && (r2.context = e8.context);
      return;
    }
    if (this.events_.size >= this.maxDistinct_) {
      this.dropped_++;
      return;
    }
    let i2 = { kind: e8.kind, id: t2, message: e8.message, count: 1, firstAt: n2, lastAt: n2 };
    e8.source && (i2.source = e8.source);
    let a2 = tD(e8.error);
    a2 && (i2.stack = a2), e8.context && (i2.context = e8.context), this.events_.set(t2, i2);
  }
  reportError(e8, t2, n2) {
    this.report({ kind: e8, message: nD(t2), error: t2, source: n2 });
  }
  get events() {
    return [...this.events_.values()];
  }
  get dropped() {
    return this.dropped_;
  }
  flush() {
    if (this.sinceFlush_ = 0, this.events_.size === 0) return;
    let e8 = [...this.events_.values()];
    this.events_.clear(), this.dropped_ = 0;
    let t2 = this.sink_;
    if (t2) {
      this.inSink_ = true;
      try {
        t2(e8);
      } catch {
      } finally {
        this.inSink_ = false;
      }
    }
  }
  tick(e8) {
    this.events_.size !== 0 && (this.sinceFlush_ += e8, this.sinceFlush_ >= this.flushInterval_ && this.flush());
  }
  clear() {
    this.events_.clear(), this.dropped_ = 0, this.sinceFlush_ = 0;
  }
};
var cD = ea(null, `Diagnostics`);
var lD = class {
  constructor(e8, t2) {
    this.api_ = e8, this.minLevel_ = t2;
  }
  handle(e8) {
    e8.level < this.minLevel_ || this.api_.report({ kind: `engine`, message: e8.message, source: e8.category, error: e8.data });
  }
};
var uD = class {
  constructor(e8 = {}) {
    this.options_ = e8, this.name = `Diagnostics`, this.profileDomain = `diagnostics`, this.unsubscribes_ = [], this.handler_ = null;
  }
  build(e8) {
    let t2 = new sD(this.options_);
    e8.insertResource(cD, t2), this.handler_ = new lD(t2, this.options_.captureLevel ?? 3), T.addHandler(this.handler_);
    let r2 = ti2.Live, i2 = (e9) => {
      r2 = ri(), t2.report({ kind: `context-lost`, message: ii() || e9 });
    };
    this.unsubscribes_.push(Ln((e9) => t2.reportError(`unhandled`, e9)), Rn(() => {
      oi2(ni.ContextLost, `The host reported the rendering context was lost`), i2(`The rendering context was lost`);
    }), In(() => t2.report({ kind: `memory`, message: `The host warned that memory is running low` }))), e8.addSystemToSchedule(5, Wi([], () => {
      let t3 = ri();
      t3 !== r2 && (r2 = t3, t3 !== ti2.Live && i2(`The GPU device was lost`));
      let n2 = e8.getResource(aa);
      e8.getResource(cD)?.tick(n2?.delta ?? 0);
    }, { name: `DiagnosticsFlush` }));
  }
  cleanup(e8) {
    for (let e9 of this.unsubscribes_) try {
      e9();
    } catch {
    }
    this.unsubscribes_ = [], this.handler_ &&= (T.removeHandler(this.handler_), null), e8.getResource(cD)?.flush();
  }
};
var dD = new uD();
function FD(e8) {
  switch (e8) {
    case `top-left`:
      return `top: 12px; left: 12px;`;
    case `top-right`:
      return `top: 12px; right: 12px;`;
    case `bottom-left`:
      return `bottom: 12px; left: 12px;`;
    case `bottom-right`:
      return `bottom: 12px; right: 12px;`;
  }
}
function ID(e8, t2) {
  return e8.toFixed(t2);
}
function LD(e8) {
  return e8.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`).replace(/"/g, `&quot;`);
}
var RD = class {
  constructor(e8, t2 = `bottom-left`) {
    this.visible_ = true, this.disposed_ = false, this.lastUpdateTime_ = 0, this.lastStats_ = null, this.accumulatedTimings_ = /* @__PURE__ */ new Map(), this.el_ = document.createElement(`div`), this.el_.style.cssText = `
position: fixed;
z-index: 99999;
pointer-events: none;
background: rgba(30, 30, 30, 0.85);
border: 1px solid rgba(60, 60, 60, 0.8);
border-radius: 4px;
padding: 6px 10px;
font: 11px monospace;
color: #cccccc;
line-height: 1.6;
min-width: 220px;
white-space: pre;
` + FD(t2), e8.appendChild(this.el_);
  }
  update(e8) {
    if (!this.visible_ || this.disposed_) return;
    this.lastStats_ = e8, this.accumulateTimings_(e8.systemTimings);
    let t2 = performance.now();
    this.lastUpdateTime_ > 0 && t2 - this.lastUpdateTime_ < 500 || (this.lastUpdateTime_ = t2, this.render_());
  }
  show() {
    this.visible_ = true, this.lastUpdateTime_ = 0, this.el_.style.display = ``;
  }
  hide() {
    this.visible_ = false, this.el_.style.display = `none`;
  }
  dispose() {
    this.disposed_ = true, this.el_.parentElement?.removeChild(this.el_);
  }
  accumulateTimings_(e8) {
    for (let [t2, n2] of e8) {
      let e9 = this.accumulatedTimings_.get(t2);
      e9 ? (e9.sum += n2, e9.count++, n2 > e9.max && (e9.max = n2)) : this.accumulatedTimings_.set(t2, { sum: n2, max: n2, count: 1 });
    }
  }
  render_() {
    let e8 = this.lastStats_;
    if (!e8) return;
    let t2 = [];
    if (t2.push(`<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px">Performance</div><div>FPS: <span style="color:#d19a66">${ID(e8.fps, 1)}</span>    Frame: <span style="color:#d19a66">${ID(e8.frameTimeMs, 1)}ms</span></div>`), t2.push(`<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">Rendering</div><div>DC: <span style="color:#d19a66">${e8.drawCalls}</span>    Tri: <span style="color:#d19a66">${e8.triangles}</span></div><div>Sprites: <span style="color:#d19a66">${e8.sprites}</span>  Culled: <span style="color:#d19a66">${e8.culled}</span></div>`), t2.push(`<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">World</div><div>Entities: <span style="color:#d19a66">${e8.entityCount}</span></div>`), this.accumulatedTimings_.size > 0) {
      let e9 = [];
      for (let [t3, n3] of this.accumulatedTimings_) {
        let r3 = n3.sum / n3.count;
        e9.push([t3, r3, n3.max]);
      }
      e9.sort((e10, t3) => t3[2] - e10[2]);
      let n2 = e9.slice(0, 5), r2 = `<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">Systems (top 5)</div>`;
      for (let [e10, t3, i2] of n2) {
        let n3 = LD(e10.length > 20 ? e10.slice(0, 20) + `...` : e10);
        r2 += `<div>${n3.padEnd(22)}<span style="color:#d19a66">${ID(t3, 1)} / ${ID(i2, 1)}ms</span></div>`;
      }
      t2.push(r2);
    }
    this.el_.innerHTML = t2.join(``), this.accumulatedTimings_.clear();
  }
};
function zD() {
  return { fps: 0, frameTimeMs: 0, entityCount: 0, systemTimings: /* @__PURE__ */ new Map(), phaseTimings: /* @__PURE__ */ new Map(), drawCalls: 0, triangles: 0, sprites: 0, text: 0, spine: 0, meshes: 0, culled: 0 };
}
var BD = ea(zD(), `Stats`);
var HD = `StatsCollect`;
var UD = class {
  constructor() {
    this.deltas_ = [], this.cursor_ = 0, this.count_ = 0, this.sum_ = 0;
  }
  pushFrame(e8) {
    !Number.isFinite(e8) || e8 < 0 || (this.count_ < 60 ? (this.deltas_.push(e8), this.sum_ += e8, this.count_++) : (this.sum_ -= this.deltas_[this.cursor_], this.deltas_[this.cursor_] = e8, this.sum_ += e8, this.cursor_ = (this.cursor_ + 1) % 60));
  }
  getFps() {
    return this.count_ === 0 || this.sum_ <= 0 ? 0 : this.count_ / this.sum_;
  }
  getFrameTimeMs() {
    return this.count_ === 0 || this.sum_ <= 0 ? 0 : this.sum_ / this.count_ * 1e3;
  }
  reset() {
    this.deltas_.length = 0, this.cursor_ = 0, this.count_ = 0, this.sum_ = 0;
  }
};
var WD = class {
  constructor(e8) {
    this.name = `stats`, this.collector_ = new UD(), this.overlay_ = null, this.options_ = e8 ?? {};
  }
  build(e8) {
    if (this.collector_.reset(), e8.enableStats(), e8.insertResource(BD, zD()), this.options_.overlay !== false && typeof document < `u`) {
      let e9 = this.options_.container ?? document.body;
      this.overlay_ = new RD(e9, this.options_.position);
    }
    let t2 = this.collector_, n2 = this.overlay_, r2 = Wi([ta(aa), Hi()], (r3, i2) => {
      t2.pushFrame(r3.delta);
      let a2 = e8.getResource(BD);
      a2.fps = t2.getFps(), a2.frameTimeMs = t2.getFrameTimeMs(), a2.entityCount = i2.entityCount();
      let o2 = e8.getSystemTimings();
      if (o2) {
        let e9 = new Map(o2);
        e9.delete(HD), a2.systemTimings = e9;
      } else a2.systemTimings = /* @__PURE__ */ new Map();
      let s2 = e8.getPhaseTimings();
      a2.phaseTimings = s2 ? new Map(s2) : /* @__PURE__ */ new Map();
      let c2 = R3.getStats();
      a2.drawCalls = c2.drawCalls, a2.triangles = c2.triangles, a2.sprites = c2.sprites, a2.text = c2.text, a2.spine = c2.spine, a2.meshes = c2.meshes, a2.culled = c2.culled, n2?.update(a2);
    }, { name: HD, touches: {} });
    e8.addSystemToSchedule(5, r2);
  }
  cleanup() {
    this.overlay_?.dispose(), this.overlay_ = null;
  }
};
var GD = new WD();
var iO = class {
  constructor(e8, t2) {
    this.manager_ = e8, this.id_ = t2;
  }
  get id() {
    return this.id_;
  }
  get isActive() {
    return this.manager_.has(this.id_);
  }
  get elapsed() {
    return this.manager_.getElapsed(this.id_);
  }
  get repeatCount() {
    return this.manager_.getRepeatCount(this.id_);
  }
  pause() {
    return this.manager_.pause(this.id_), this;
  }
  resume() {
    return this.manager_.resume(this.id_), this;
  }
  cancel() {
    this.manager_.cancel(this.id_);
  }
  reset() {
    return this.manager_.reset(this.id_), this;
  }
};
var aO = class {
  constructor() {
    this.nextId_ = 0, this.timers_ = /* @__PURE__ */ new Map(), this.timeScale_ = 1;
  }
  delay(e8, t2) {
    return this.addTimer_(e8, false, 0, 1, t2);
  }
  interval(e8, t2, n2 = 0) {
    return this.addTimer_(e8, true, e8, n2, t2);
  }
  addTimer_(e8, t2, n2, r2, i2) {
    let a2 = ++this.nextId_;
    return this.timers_.set(a2, { id: a2, delay: e8, elapsed: 0, repeat: t2, interval: n2, callback: i2, paused: false, repeatCount: 0, maxRepeatCount: r2, handle: null }), new iO(this, a2);
  }
  has(e8) {
    return this.timers_.has(e8);
  }
  getElapsed(e8) {
    return this.timers_.get(e8)?.elapsed ?? 0;
  }
  getRepeatCount(e8) {
    return this.timers_.get(e8)?.repeatCount ?? 0;
  }
  pause(e8) {
    let t2 = this.timers_.get(e8);
    t2 && (t2.paused = true);
  }
  resume(e8) {
    let t2 = this.timers_.get(e8);
    t2 && (t2.paused = false);
  }
  cancel(e8) {
    this.timers_.delete(e8);
  }
  reset(e8) {
    let t2 = this.timers_.get(e8);
    t2 && (t2.elapsed = 0, t2.repeatCount = 0);
  }
  cancelAll() {
    this.timers_.clear();
  }
  get activeCount() {
    return this.timers_.size;
  }
  get timeScale() {
    return this.timeScale_;
  }
  set timeScale(e8) {
    this.timeScale_ = Math.max(0, e8);
  }
  tick(e8) {
    let t2 = e8 * this.timeScale_, r2 = [], i2 = [...this.timers_.keys()];
    for (let e9 of i2) {
      let i3 = this.timers_.get(e9);
      if (!(!i3 || i3.paused) && (i3.elapsed += t2, i3.elapsed >= i3.delay)) {
        i3.handle ||= new iO(this, e9);
        try {
          i3.callback(i3.handle);
        } catch (t3) {
          T.error(`timer`, `Timer callback error (id=${e9})`, t3);
        }
        i3.repeatCount++, i3.repeat ? i3.maxRepeatCount > 0 && i3.repeatCount >= i3.maxRepeatCount ? r2.push(e9) : (i3.elapsed -= i3.delay, i3.delay = i3.interval) : r2.push(e9);
      }
    }
    for (let e9 of r2) this.timers_.delete(e9);
  }
};
var oO = ea(new aO(), `Timer`);
var sO = Wi([ta(oO), ta(aa)], (e8, t2) => {
  e8.tick(t2.delta);
}, { name: `TimerSystem` });
var lO = Wi([Oi(hi(I), Et), ta(aa), Hi()], (e8, t2, n2) => {
  let r2 = t2.delta;
  if (r2 <= 0) return;
  let i2 = at().get(`RigidBody`);
  for (let [t3, a2, o2] of e8) {
    if (i2 && n2.has(t3, i2)) continue;
    let e9 = o2.linear;
    if (e9.x !== 0 || e9.y !== 0 || e9.z !== 0) {
      let t4 = a2.position;
      a2.position = { x: t4.x + e9.x * r2, y: t4.y + e9.y * r2, z: t4.z + e9.z * r2 };
    }
    let s2 = o2.angular;
    if (s2.x !== 0 || s2.y !== 0 || s2.z !== 0) {
      let e10 = a2.rotation, t4 = Math.hypot(s2.x, s2.y, s2.z), n3 = t4 * r2 * 0.5, i3 = Math.sin(n3) / t4, o3 = Math.cos(n3), c2 = s2.x * i3, l2 = s2.y * i3, u2 = s2.z * i3;
      a2.rotation = { w: o3 * e10.w - c2 * e10.x - l2 * e10.y - u2 * e10.z, x: o3 * e10.x + c2 * e10.w + l2 * e10.z - u2 * e10.y, y: o3 * e10.y - c2 * e10.z + l2 * e10.w + u2 * e10.x, z: o3 * e10.z + c2 * e10.y - l2 * e10.x + u2 * e10.w };
    }
  }
}, { name: `VelocitySystem`, touches: { reads: [`RigidBody`] } });
var dO = class {
  constructor(e8 = true) {
    this.listeners_ = [], this.visible_ = true, this.focused_ = true, this.autoPause_ = e8;
  }
  get visible() {
    return this.visible_;
  }
  get focused() {
    return this.focused_;
  }
  get autoPause() {
    return this.autoPause_;
  }
  set autoPause(e8) {
    this.autoPause_ = e8;
  }
  on(e8) {
    return this.listeners_.push(e8), () => {
      let t2 = this.listeners_.indexOf(e8);
      t2 >= 0 && this.listeners_.splice(t2, 1);
    };
  }
  off(e8) {
    let t2 = this.listeners_.indexOf(e8);
    t2 >= 0 && this.listeners_.splice(t2, 1);
  }
  setVisible_(e8) {
    this.visible_ !== e8 && (this.visible_ = e8, this.emit_(e8 ? `show` : `hide`));
  }
  setFocused_(e8) {
    this.focused_ !== e8 && (this.focused_ = e8);
  }
  emit_(e8) {
    for (let t2 of this.listeners_) try {
      t2(e8);
    } catch (e9) {
      T.error(`lifecycle`, `Listener error`, e9);
    }
  }
  removeAllListeners() {
    this.listeners_.length = 0;
  }
};
var fO = ea(new dO(), `Lifecycle`);
var pO = class {
  constructor(e8) {
    this.options_ = e8, this.name = `Lifecycle`, this.cleanupFn_ = null;
  }
  build(e8) {
    let t2 = new dO(this.options_?.autoPause ?? true);
    e8.insertResource(fO, t2);
    let n2 = hn();
    n2 === `wechat` ? this.cleanupFn_ = gO(t2, e8) : n2 === `native` ? this.cleanupFn_ = _O(t2, e8) : typeof document < `u` && typeof window < `u` && (this.cleanupFn_ = hO(t2, e8));
  }
  cleanup() {
    this.cleanupFn_?.(), this.cleanupFn_ = null;
  }
};
var mO = new pO();
function hO(e8, t2) {
  let n2 = false, r2 = () => {
    let r3 = document.hidden;
    e8.setVisible_(!r3), r3 ? e8.autoPause && !t2.isPaused() && (t2.setPaused(true), n2 = true, e8.emit_(`pause`)) : n2 && (t2.setPaused(false), n2 = false, e8.emit_(`resume`));
  }, i2 = () => {
    e8.setFocused_(true);
  }, a2 = () => {
    e8.setFocused_(false);
  };
  return document.addEventListener(`visibilitychange`, r2), window.addEventListener(`focus`, i2), window.addEventListener(`blur`, a2), () => {
    document.removeEventListener(`visibilitychange`, r2), window.removeEventListener(`focus`, i2), window.removeEventListener(`blur`, a2), e8.removeAllListeners();
  };
}
function gO(e8, t2) {
  let n2 = false, r2 = globalThis.wx;
  if (!r2) return null;
  let i2 = () => {
    e8.setVisible_(true), n2 && (t2.setPaused(false), n2 = false, e8.emit_(`resume`));
  }, a2 = () => {
    e8.setVisible_(false), e8.autoPause && !t2.isPaused() && (t2.setPaused(true), n2 = true, e8.emit_(`pause`));
  };
  return r2.onShow(i2), r2.onHide(a2), () => {
    r2.offShow?.(i2), r2.offHide?.(a2), e8.removeAllListeners();
  };
}
function _O(e8, t2) {
  let n2 = false, r2 = zn(() => {
    e8.setVisible_(true), n2 && (t2.setPaused(false), n2 = false, e8.emit_(`resume`));
  }), i2 = Bn(() => {
    e8.setVisible_(false), e8.autoPause && !t2.isPaused() && (t2.setPaused(true), n2 = true, e8.emit_(`pause`));
  });
  return () => {
    r2(), i2(), e8.removeAllListeners();
  };
}

// sdk/dist/index.js
var Z5 = `-9999px`;
function F_2() {
  if (typeof document > `u` || !document.body) return null;
  let e8 = document.createElement(`textarea`);
  return e8.style.position = `fixed`, e8.style.left = Z5, e8.style.top = Z5, e8.style.width = `1px`, e8.style.height = `1px`, e8.style.opacity = `0`, e8.style.zIndex = `-1`, e8.style.pointerEvents = `none`, e8.style.border = `0`, e8.style.padding = `0`, e8.autocomplete = `off`, e8.setAttribute(`autocorrect`, `off`), e8.setAttribute(`autocapitalize`, `off`), e8.setAttribute(`spellcheck`, `false`), document.body.appendChild(e8), e8;
}
function I_2() {
  let e8 = F_2();
  if (!e8) return null;
  let t2 = /* @__PURE__ */ new Set(), n2 = (e9) => {
    for (let n3 of t2) n3(e9);
  }, r2 = false, i2 = false, a2 = () => {
    r2 || n2({ kind: `change` });
  }, o2 = () => {
    r2 = true, n2({ kind: `composition`, composing: true });
  }, s2 = () => n2({ kind: `composition`, composing: true }), c2 = () => {
    r2 = false, n2({ kind: `composition`, composing: false }), n2({ kind: `change` });
  }, l2 = (e9) => {
    if (e9.key === `Escape`) {
      n2({ kind: `cancel` });
      return;
    }
    if (e9.key === `Enter` && !i2) {
      e9.preventDefault(), n2({ kind: `submit` });
      return;
    }
    n2({ kind: `change` });
  }, u2 = () => n2({ kind: `blur` });
  e8.addEventListener(`input`, a2), e8.addEventListener(`compositionstart`, o2), e8.addEventListener(`compositionupdate`, s2), e8.addEventListener(`compositionend`, c2), e8.addEventListener(`keydown`, l2), e8.addEventListener(`blur`, u2);
  let d2 = () => {
    e8.style.left !== Z5 && (e8.style.left = Z5, e8.style.top = Z5);
  };
  return { focus(t3, n3) {
    i2 = n3.multiline, n3.maxLength > 0 ? e8.maxLength = n3.maxLength : e8.removeAttribute(`maxlength`), e8.value = t3.value, e8.selectionStart = t3.selectionStart, e8.selectionEnd = t3.selectionEnd, e8.focus();
  }, blur() {
    d2(), e8.blur();
  }, read() {
    let t3 = e8.value;
    return { value: t3, selectionStart: e8.selectionStart ?? t3.length, selectionEnd: e8.selectionEnd ?? t3.length, backward: e8.selectionDirection === `backward` };
  }, write(t3) {
    e8.value !== t3.value && (e8.value = t3.value), e8.selectionStart = t3.selectionStart, e8.selectionEnd = t3.selectionEnd;
  }, setCaretAnchor(t3, n3) {
    e8.style.left = Math.round(t3) + `px`, e8.style.top = Math.round(n3) + `px`;
  }, subscribe(e9) {
    return t2.add(e9), () => {
      t2.delete(e9);
    };
  }, dispose() {
    e8.removeEventListener(`input`, a2), e8.removeEventListener(`compositionstart`, o2), e8.removeEventListener(`compositionupdate`, s2), e8.removeEventListener(`compositionend`, c2), e8.removeEventListener(`keydown`, l2), e8.removeEventListener(`blur`, u2), e8.remove(), t2.clear();
  } };
}
var L_2 = class {
  constructor(e8, t2, n2, r2, i2, a2, o2) {
    this.playing_ = true, this.stopped_ = false, this.pausedAt_ = 0, this.id = e8, this.source_ = t2, this.buffer_ = n2, this.poolNode_ = r2, this.pool_ = i2, this.context_ = a2, this.startOffset_ = o2, this.startedAt_ = a2.currentTime, this.playbackRate_ = t2.playbackRate.value, this.loop_ = t2.loop, this.bindOnEnded_(t2);
  }
  bindOnEnded_(e8) {
    e8.onended = () => {
      !this.stopped_ && !this.loop_ && (this.playing_ = false, this.stopped_ = true, this.pool_.release(this.poolNode_), this.onEnd?.());
    };
  }
  stop() {
    this.stopped_ || (this.stopped_ = true, this.playing_ = false, this.source_.onended = null, this.pool_.release(this.poolNode_));
  }
  pause() {
    if (!this.playing_ || this.stopped_) return;
    this.playing_ = false;
    let e8 = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
    this.pausedAt_ = this.startOffset_ + e8, this.loop_ && this.buffer_.duration > 0 && (this.pausedAt_ %= this.buffer_.duration), this.source_.onended = null;
    try {
      this.source_.stop();
    } catch {
    }
    this.source_.disconnect();
  }
  resume() {
    if (this.playing_ || this.stopped_) return;
    this.playing_ = true;
    let e8 = this.context_.createBufferSource();
    e8.buffer = this.buffer_, e8.loop = this.loop_, e8.playbackRate.value = this.playbackRate_, e8.connect(this.poolNode_.gain), this.source_ = e8, this.poolNode_.source = e8, this.startOffset_ = this.pausedAt_, this.startedAt_ = this.context_.currentTime, this.bindOnEnded_(e8), e8.start(0, this.pausedAt_);
  }
  setVolume(e8) {
    this.poolNode_.gain.gain.value = e8;
  }
  setPan(e8) {
    this.poolNode_.panner.pan.value = e8;
  }
  setLoop(e8) {
    this.loop_ = e8, this.source_.loop = e8;
  }
  setPlaybackRate(e8) {
    this.playbackRate_ = e8, this.playing_ && (this.source_.playbackRate.value = e8);
  }
  get isPlaying() {
    return this.playing_;
  }
  get currentTime() {
    if (this.stopped_) return 0;
    if (!this.playing_) return this.pausedAt_;
    let e8 = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
    return this.startOffset_ + e8;
  }
  get duration() {
    return this.buffer_.duration;
  }
};
function Q5(e8) {
  return e8.length * e8.numberOfChannels * 4;
}
var R_2 = class {
  constructor() {
    this.name = `WebAudio`, this.context_ = null, this.mixer_ = null, this.pool_ = null, this.buffers_ = /* @__PURE__ */ new Map(), this.urlToId_ = /* @__PURE__ */ new Map(), this.loadingUrls_ = /* @__PURE__ */ new Map(), this.nextBufferId_ = 0, this.nextHandleId_ = 0, this.resumeHandler_ = null, this.analyser_ = null;
  }
  get mixer() {
    return this.mixer_;
  }
  get isReady() {
    return this.context_?.state === `running`;
  }
  async initialize(e8 = {}) {
    if (this.context_ = new AudioContext(), this.mixer_ = new hr(this.context_, e8.mixerConfig), this.pool_ = new gr(this.context_, e8.initialPoolSize), this.analyser_ = this.context_.createAnalyser(), this.analyser_.fftSize = 128, this.analyser_.smoothingTimeConstant = 0.7, this.mixer_.master.node.connect(this.analyser_), this.context_.state === `suspended`) {
      let e9 = () => {
        this.context_.resume(), document.removeEventListener(`touchstart`, e9), document.removeEventListener(`mousedown`, e9), document.removeEventListener(`keydown`, e9), this.resumeHandler_ = null;
      };
      document.addEventListener(`touchstart`, e9), document.addEventListener(`mousedown`, e9), document.addEventListener(`keydown`, e9), this.resumeHandler_ = e9;
    }
  }
  async ensureResumed() {
    this.context_ && this.context_.state === `suspended` && await this.context_.resume();
  }
  async loadBuffer(e8) {
    if (!this.context_) throw Error(`AudioContext not initialized`);
    let t2 = this.urlToId_.get(e8);
    if (t2 !== void 0 && this.buffers_.has(t2)) {
      let e9 = this.buffers_.get(t2);
      return { id: t2, duration: e9.duration, bytes: Q5(e9) };
    }
    let n2 = this.loadingUrls_.get(e8);
    if (n2) return n2;
    let r2 = this.doLoadBuffer_(e8);
    this.loadingUrls_.set(e8, r2);
    try {
      return await r2;
    } finally {
      this.loadingUrls_.delete(e8);
    }
  }
  async loadBufferFromData(e8, t2) {
    if (!this.context_) throw Error(`AudioContext not initialized`);
    let n2 = this.urlToId_.get(e8);
    if (n2 !== void 0 && this.buffers_.has(n2)) {
      let e9 = this.buffers_.get(n2);
      return { id: n2, duration: e9.duration, bytes: Q5(e9) };
    }
    let r2;
    try {
      r2 = await this.context_.decodeAudioData(t2);
    } catch (t3) {
      throw Error(`Failed to decode audio ${e8}: ${t3.message}`);
    }
    let i2 = ++this.nextBufferId_;
    return this.buffers_.set(i2, r2), this.urlToId_.set(e8, i2), { id: i2, duration: r2.duration, bytes: Q5(r2) };
  }
  async doLoadBuffer_(e8) {
    let t2 = await P5().readFile(e8);
    return this.loadBufferFromData(e8, t2);
  }
  unloadBuffer(e8) {
    this.buffers_.delete(e8.id);
  }
  play(e8, t2) {
    if (!this.context_ || !this.pool_ || !this.mixer_) throw Error(`Audio system not initialized`);
    let n2 = this.buffers_.get(e8.id);
    if (!n2) throw Error(`Buffer ${e8.id} not found`);
    let r2 = this.pool_.acquire(), i2 = this.context_.createBufferSource();
    i2.buffer = n2, i2.loop = t2.loop ?? false, i2.playbackRate.value = t2.playbackRate ?? 1, i2.connect(r2.gain), r2.source = i2, r2.gain.gain.value = t2.volume ?? 1, r2.panner.pan.value = t2.pan ?? 0;
    let a2 = t2.bus ?? `sfx`, o2 = this.mixer_.getBus(a2) ?? this.mixer_.sfx;
    r2.panner.connect(o2.input);
    let s2 = t2.startOffset ?? 0;
    return i2.start(0, s2), new L_2(++this.nextHandleId_, i2, n2, r2, this.pool_, this.context_, s2);
  }
  getFrequencyData(e8) {
    return this.analyser_ ? (this.analyser_.getByteFrequencyData(e8), true) : false;
  }
  suspend() {
    this.context_?.suspend();
  }
  resume() {
    this.context_?.resume();
  }
  dispose() {
    this.resumeHandler_ &&= (document.removeEventListener(`touchstart`, this.resumeHandler_), document.removeEventListener(`mousedown`, this.resumeHandler_), document.removeEventListener(`keydown`, this.resumeHandler_), null), this.analyser_ = null, this.pool_ = null, this.mixer_ = null, this.buffers_.clear(), this.urlToId_.clear(), this.loadingUrls_.clear(), this.context_?.close(), this.context_ = null;
  }
};
var z_2 = 1;
var $3 = (e8) => e8 < 0 ? 0 : e8 > 1 ? 1 : e8;
var B_2 = class {
  constructor(e8, t2) {
    this.id = z_2++, this.gl_ = null, this.glTexture_ = null, this.glTexId_ = 0, this.glPool_ = null, this.pathChosen_ = false, this.canvas_ = null, this.ctx_ = null, this.texture_ = 0, this.width_ = 0, this.height_ = 0, this.ready_ = false, this.disposed_ = false, this.newFrame_ = true, this.lastUploadTime_ = -1, this.rvfcId_ = 0, this.onLoadedMetadata_ = () => {
      this.width_ = this.video_.videoWidth | 0, this.height_ = this.video_.videoHeight | 0, this.scheduleFrame_();
    }, this.onEndedEvent_ = () => {
      this.video_.loop || this.onEnded?.();
    }, this.onErrorEvent_ = () => {
      let e9 = this.video_.error;
      T.warn(`video`, `decode error (code ${e9?.code ?? `?`}): ${e9?.message ?? `unknown`}`), this.onError?.(e9 ?? Error(`video decode error`));
    };
    let n2 = document.createElement(`video`);
    this.rvfcSupported_ = typeof n2.requestVideoFrameCallback == `function`, n2.crossOrigin = `anonymous`, n2.playsInline = true, n2.setAttribute(`playsinline`, ``), n2.loop = t2.loop ?? false, n2.muted = t2.muted ?? false, n2.volume = $3(t2.volume ?? 1), n2.playbackRate = t2.playbackRate ?? 1, n2.preload = `auto`, this.wantsPlay_ = t2.autoplay ?? true, n2.addEventListener(`loadedmetadata`, this.onLoadedMetadata_), n2.addEventListener(`ended`, this.onEndedEvent_), n2.addEventListener(`error`, this.onErrorEvent_), n2.src = e8, n2.load(), this.video_ = n2, this.wantsPlay_ && this.tryPlay_();
  }
  tryPlay_() {
    let e8 = this.video_.play();
    e8 && typeof e8.catch == `function` && e8.catch((e9) => T.warn(`video`, `autoplay blocked (mute the video or start on input)`, e9));
  }
  scheduleFrame_() {
    this.disposed_ || !this.rvfcSupported_ || (this.rvfcId_ = this.video_.requestVideoFrameCallback(() => {
      this.newFrame_ = true, this.scheduleFrame_();
    }));
  }
  ensureCanvas_() {
    if (this.canvas_ || this.width_ <= 0 || this.height_ <= 0) return;
    let e8 = document.createElement(`canvas`);
    e8.width = this.width_, e8.height = this.height_, this.canvas_ = e8, this.ctx_ = e8.getContext(`2d`, { willReadFrequently: true });
  }
  pump(e8) {
    if (!e8 || this.disposed_ || this.width_ <= 0 || this.height_ <= 0 || this.video_.readyState < 2) return;
    let t2 = this.video_.currentTime !== this.lastUploadTime_;
    if (!(this.ready_ && !this.newFrame_ && !t2)) {
      this.pathChosen_ ||= (this.gl_ = Tr(e8.GL), true);
      try {
        this.gl_ ? this.uploadGL_(e8, this.gl_) : this.uploadCPU_(e8);
      } catch (e9) {
        this.onError?.(e9), this.disposed_ = true;
        return;
      }
      this.newFrame_ = false, this.lastUploadTime_ = this.video_.currentTime, this.ready_ || (this.ready_ = true, this.onReady?.());
    }
  }
  uploadGL_(e8, t2) {
    if (this.glTexture_) {
      t2.bindTexture(t2.TEXTURE_2D, this.glTexture_), t2.pixelStorei(t2.UNPACK_FLIP_Y_WEBGL, 1), t2.texSubImage2D(t2.TEXTURE_2D, 0, 0, 0, t2.RGBA, t2.UNSIGNED_BYTE, this.video_), t2.pixelStorei(t2.UNPACK_FLIP_Y_WEBGL, 0);
      return;
    }
    let n2 = t2.createTexture();
    if (!n2) throw Error(`gl.createTexture failed`);
    this.glTexture_ = n2, t2.bindTexture(t2.TEXTURE_2D, n2), t2.pixelStorei(t2.UNPACK_FLIP_Y_WEBGL, 1);
    let r2 = g() ? t2.SRGB8_ALPHA8 : t2.RGBA;
    t2.texImage2D(t2.TEXTURE_2D, 0, r2, t2.RGBA, t2.UNSIGNED_BYTE, this.video_), t2.pixelStorei(t2.UNPACK_FLIP_Y_WEBGL, 0), t2.texParameteri(t2.TEXTURE_2D, t2.TEXTURE_MIN_FILTER, t2.LINEAR), t2.texParameteri(t2.TEXTURE_2D, t2.TEXTURE_MAG_FILTER, t2.LINEAR), t2.texParameteri(t2.TEXTURE_2D, t2.TEXTURE_WRAP_S, t2.CLAMP_TO_EDGE), t2.texParameteri(t2.TEXTURE_2D, t2.TEXTURE_WRAP_T, t2.CLAMP_TO_EDGE);
    let i2 = e8.GL.textures, a2 = e8.GL.getNewId(i2);
    i2[a2] = n2, this.glTexId_ = a2, this.glPool_ = i2, this.texture_ = le().registerExternalTexture(a2, this.width_, this.height_);
  }
  uploadCPU_(e8) {
    this.ensureCanvas_();
    let t2 = this.ctx_;
    if (!t2) return;
    t2.save(), t2.translate(0, this.height_), t2.scale(1, -1), t2.drawImage(this.video_, 0, 0, this.width_, this.height_), t2.restore();
    let n2 = t2.getImageData(0, 0, this.width_, this.height_), r2 = new Uint8Array(n2.data.buffer, n2.data.byteOffset, n2.data.byteLength);
    this.texture_ ? te2(e8, this.texture_, 0, 0, this.width_, this.height_, r2) : this.texture_ = ee2(e8, { width: this.width_, height: this.height_, pixels: r2 }, false, { filterMode: `linear`, wrapMode: `clamp` });
  }
  get textureHandle() {
    return this.texture_;
  }
  get width() {
    return this.width_;
  }
  get height() {
    return this.height_;
  }
  get bytes() {
    return this.width_ * this.height_ * 4;
  }
  get isReady() {
    return this.ready_;
  }
  get isPlaying() {
    return !this.video_.paused && !this.video_.ended;
  }
  get currentTime() {
    return this.video_.currentTime;
  }
  get duration() {
    return Number.isFinite(this.video_.duration) ? this.video_.duration : 0;
  }
  play() {
    this.wantsPlay_ = true, this.tryPlay_();
  }
  pause() {
    this.wantsPlay_ = false, this.video_.pause();
  }
  seek(e8) {
    try {
      this.video_.currentTime = e8, this.newFrame_ = true;
    } catch {
    }
  }
  setVolume(e8) {
    this.video_.volume = $3(e8);
  }
  setMuted(e8) {
    this.video_.muted = e8;
  }
  setLoop(e8) {
    this.video_.loop = e8;
  }
  setPlaybackRate(e8) {
    this.video_.playbackRate = e8 > 0 ? e8 : 0;
  }
  stop() {
    if (!this.disposed_) {
      this.disposed_ = true, this.rvfcId_ && this.rvfcSupported_ && this.video_.cancelVideoFrameCallback(this.rvfcId_), this.video_.removeEventListener(`loadedmetadata`, this.onLoadedMetadata_), this.video_.removeEventListener(`ended`, this.onEndedEvent_), this.video_.removeEventListener(`error`, this.onErrorEvent_);
      try {
        this.video_.pause();
      } catch {
      }
      this.video_.removeAttribute(`src`);
      try {
        this.video_.load();
      } catch {
      }
      this.texture_ &&= (le().releaseTexture(this.texture_), 0), this.gl_ && this.glTexture_ && (this.gl_.deleteTexture(this.glTexture_), this.glPool_ && this.glTexId_ && delete this.glPool_[this.glTexId_], this.glTexture_ = null), this.canvas_ = null, this.ctx_ = null;
    }
  }
};
var V_2 = class {
  constructor() {
    this.name = `web`;
  }
  createStream(e8, t2) {
    return new B_2(e8, t2);
  }
  dispose() {
  }
};
var H_2 = new class {
  constructor() {
    this.name = `web`, this.inputCleanup_ = null;
  }
  hasTouch() {
    return typeof navigator < `u` && ((navigator.maxTouchPoints ?? 0) > 0 || `ontouchstart` in globalThis);
  }
  async fetch(e8, t2) {
    let n2 = await globalThis.fetch(e8, { method: t2?.method ?? `GET`, headers: t2?.headers, body: t2?.body }), r2 = {};
    return n2.headers.forEach((e9, t3) => {
      r2[t3] = e9;
    }), { ok: n2.ok, status: n2.status, statusText: n2.statusText, headers: r2, json: () => n2.json(), text: () => n2.text(), arrayBuffer: () => n2.arrayBuffer() };
  }
  async readFile(e8) {
    let t2 = await this.fetch(e8);
    if (!t2.ok) throw Error(`Failed to read file: ${e8} (${t2.status})`);
    return t2.arrayBuffer();
  }
  async readTextFile(e8) {
    let t2 = await this.fetch(e8);
    if (!t2.ok) throw Error(`Failed to read file: ${e8} (${t2.status})`);
    return t2.text();
  }
  async fileExists(e8) {
    try {
      let t2 = await globalThis.fetch(e8), n2 = t2.ok;
      return t2.body?.cancel(), n2;
    } catch {
      return false;
    }
  }
  async loadImagePixels(e8) {
    let t2 = this.createImage();
    await new Promise((n3, r3) => {
      t2.crossOrigin = `anonymous`, t2.onload = () => n3(), t2.onerror = () => r3(Error(`Failed to load image: ${e8}`)), t2.src = e8;
    });
    let n2 = this.createCanvas(t2.width, t2.height).getContext(`2d`);
    n2.drawImage(t2, 0, 0);
    let r2 = n2.getImageData(0, 0, t2.width, t2.height);
    return { width: t2.width, height: t2.height, pixels: new Uint8Array(r2.data.buffer) };
  }
  async instantiateWasm(e8, t2) {
    let n2;
    n2 = typeof e8 == `string` ? await this.readFile(e8) : e8;
    let r2 = await WebAssembly.instantiate(n2, t2);
    return { instance: r2.instance, module: r2.module };
  }
  createImage() {
    return new Image();
  }
  createTextEditor() {
    return I_2();
  }
  async registerFont(e8, t2) {
    if (typeof FontFace > `u` || typeof document > `u`) return;
    let n2 = new FontFace(e8, t2);
    await n2.load(), document.fonts.add(n2);
  }
  createCanvas(e8, t2) {
    let n2;
    return n2 = typeof OffscreenCanvas < `u` ? new OffscreenCanvas(e8, t2) : document.createElement(`canvas`), n2.width = e8, n2.height = t2, n2;
  }
  now() {
    return performance.now();
  }
  bindInputEvents(e8, t2) {
    this.inputCleanup_ &&= (this.inputCleanup_(), null);
    let n2 = t2 ?? document.querySelector(`canvas`) ?? document.body, r2 = (t3) => e8.onKeyDown(t3.code), i2 = (t3) => e8.onKeyUp(t3.code), a2 = (t3) => {
      let n3 = t3;
      e8.onPointerMove(n3.offsetX, n3.offsetY);
    }, o2 = (t3) => {
      let n3 = t3;
      e8.onPointerDown(n3.button, n3.offsetX, n3.offsetY);
    }, s2 = (t3) => {
      e8.onPointerUp(t3.button);
    }, c2 = jr(e8), l2 = (e9) => {
      e9.preventDefault();
      let t3 = e9, r3 = n2.getBoundingClientRect();
      for (let e10 = 0; e10 < t3.changedTouches.length; e10++) {
        let n3 = t3.changedTouches[e10];
        c2.start(n3.identifier, n3.clientX - r3.left, n3.clientY - r3.top);
      }
    }, u2 = (e9) => {
      e9.preventDefault();
      let t3 = e9, r3 = n2.getBoundingClientRect();
      for (let e10 = 0; e10 < t3.changedTouches.length; e10++) {
        let n3 = t3.changedTouches[e10];
        c2.move(n3.identifier, n3.clientX - r3.left, n3.clientY - r3.top);
      }
    }, d2 = (e9) => {
      e9.preventDefault();
      let t3 = e9;
      for (let e10 = 0; e10 < t3.changedTouches.length; e10++) c2.end(t3.changedTouches[e10].identifier);
    }, f2 = (e9) => {
      let t3 = e9;
      for (let e10 = 0; e10 < t3.changedTouches.length; e10++) c2.cancel(t3.changedTouches[e10].identifier);
    }, p3 = (t3) => {
      let n3 = t3, r3 = n3.deltaX, i3 = n3.deltaY;
      n3.deltaMode === 1 ? (r3 *= 16, i3 *= 16) : n3.deltaMode === 2 && (r3 *= window.innerWidth, i3 *= window.innerHeight), e8.onWheel(r3, i3);
    };
    document.addEventListener(`keydown`, r2), document.addEventListener(`keyup`, i2), n2.addEventListener(`mousemove`, a2), n2.addEventListener(`mousedown`, o2), document.addEventListener(`mouseup`, s2), n2.addEventListener(`touchstart`, l2, { passive: false }), n2.addEventListener(`touchmove`, u2, { passive: false }), n2.addEventListener(`touchend`, d2, { passive: false }), n2.addEventListener(`touchcancel`, f2), n2.addEventListener(`wheel`, p3), this.inputCleanup_ = () => {
      document.removeEventListener(`keydown`, r2), document.removeEventListener(`keyup`, i2), n2.removeEventListener(`mousemove`, a2), n2.removeEventListener(`mousedown`, o2), document.removeEventListener(`mouseup`, s2), n2.removeEventListener(`touchstart`, l2), n2.removeEventListener(`touchmove`, u2), n2.removeEventListener(`touchend`, d2), n2.removeEventListener(`touchcancel`, f2), n2.removeEventListener(`wheel`, p3);
    };
  }
  unbindInputEvents() {
    this.inputCleanup_ &&= (this.inputCleanup_(), null);
  }
  pollGamepads() {
    let e8 = typeof navigator < `u` ? navigator : void 0;
    if (!e8 || typeof e8.getGamepads != `function`) return [];
    let t2 = [];
    for (let n2 of e8.getGamepads()) n2 && t2.push({ index: n2.index, connected: n2.connected, buttons: n2.buttons.map((e9) => e9.value), axes: n2.axes.slice(), mapping: n2.mapping });
    return t2;
  }
  createAudioBackend() {
    return new R_2();
  }
  createVideoBackend() {
    return new V_2();
  }
  createSocket(e8) {
    return new Ar(e8);
  }
  getStorageItem(e8) {
    return localStorage.getItem(e8);
  }
  setStorageItem(e8, t2) {
    localStorage.setItem(e8, t2);
  }
  removeStorageItem(e8) {
    localStorage.removeItem(e8);
  }
  devicePixelRatio() {
    return typeof window < `u` && window.devicePixelRatio || 1;
  }
  onUnhandledError(e8) {
    if (typeof window > `u`) return () => {
    };
    let t2 = (t3) => {
      e8(t3.error ?? t3.message);
    }, n2 = (t3) => {
      e8(t3.reason);
    };
    return window.addEventListener(`error`, t2), window.addEventListener(`unhandledrejection`, n2), () => {
      window.removeEventListener(`error`, t2), window.removeEventListener(`unhandledrejection`, n2);
    };
  }
  onContextLost(e8) {
    if (typeof window > `u`) return () => {
    };
    let t2 = (t3) => {
      t3.preventDefault(), e8();
    };
    return window.addEventListener(`webglcontextlost`, t2, true), () => window.removeEventListener(`webglcontextlost`, t2, true);
  }
  clearStorage(e8) {
    let t2 = [];
    for (let n2 = 0; n2 < localStorage.length; n2++) {
      let r2 = localStorage.key(n2);
      r2 !== null && r2.startsWith(e8) && t2.push(r2);
    }
    for (let e9 of t2) localStorage.removeItem(e9);
  }
}();
pn(H_2), gt(), Il(), tt();

// pipeline/src/assets/gltfImport.ts
var GLB_MAGIC = 1179937895;
var CHUNK_JSON = 1313821514;
var CHUNK_BIN = 5130562;
var COMPONENT_BYTES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};
var TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};
function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a .glb container");
  let at3 = 12;
  let json = null;
  let bin = null;
  while (at3 + 8 <= bytes.byteLength) {
    const length = view.getUint32(at3, true);
    const kind = view.getUint32(at3 + 4, true);
    const body = bytes.subarray(at3 + 8, at3 + 8 + length);
    if (kind === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (kind === CHUNK_BIN) bin = body;
    at3 += 8 + length + (4 - length % 4) % 4;
  }
  if (!json) throw new Error(".glb has no JSON chunk");
  return { json, bin };
}
function decodeDataUri(uri) {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) return null;
  return Uint8Array.from(Buffer.from(uri.slice(comma + 1), "base64"));
}
function readAccessor(json, bin, buffers, index) {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`accessor ${index} is missing`);
  const comps = TYPE_COMPONENTS[acc.type];
  if (!comps) throw new Error(`accessor ${index} has unsupported type ${acc.type}`);
  const compBytes = COMPONENT_BYTES[acc.componentType];
  if (!compBytes) throw new Error(`accessor ${index} has unsupported componentType ${acc.componentType}`);
  const out = new Float32Array(acc.count * comps);
  if (acc.bufferView === void 0) return out;
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) throw new Error(`bufferView ${acc.bufferView} is missing`);
  const source = view.buffer === 0 && bin ? bin : buffers[view.buffer];
  if (!source) throw new Error(`buffer ${view.buffer} has no bytes (external .bin not loaded?)`);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : comps * compBytes;
  const dv2 = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const scale = acc.normalized ? normalizedScale(acc.componentType) : 0;
  for (let i2 = 0; i2 < acc.count; i2++) {
    for (let c2 = 0; c2 < comps; c2++) {
      const at3 = base + i2 * stride + c2 * compBytes;
      const raw = readComponent(dv2, at3, acc.componentType);
      out[i2 * comps + c2] = acc.normalized ? raw * scale : raw;
    }
  }
  return out;
}
function normalizedScale(componentType) {
  switch (componentType) {
    case 5120:
      return 1 / 127;
    case 5121:
      return 1 / 255;
    case 5122:
      return 1 / 32767;
    case 5123:
      return 1 / 65535;
    default:
      return 1;
  }
}
function readComponent(dv2, at3, componentType) {
  switch (componentType) {
    case 5120:
      return dv2.getInt8(at3);
    case 5121:
      return dv2.getUint8(at3);
    case 5122:
      return dv2.getInt16(at3, true);
    case 5123:
      return dv2.getUint16(at3, true);
    case 5125:
      return dv2.getUint32(at3, true);
    default:
      return dv2.getFloat32(at3, true);
  }
}
function importGltfMeshes(bytes, stem, externalBuffers) {
  const warnings = [];
  let json;
  let bin = null;
  const looksBinary = bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC;
  if (looksBinary) {
    ({ json, bin } = parseGlb(bytes));
  } else {
    json = JSON.parse(new TextDecoder().decode(bytes));
  }
  const buffers = (json.buffers ?? []).map((b5, i2) => {
    if (!b5.uri) return i2 === 0 ? bin : null;
    const inline = decodeDataUri(b5.uri);
    if (inline) return inline;
    const external = externalBuffers?.(b5.uri) ?? null;
    if (!external) warnings.push(`buffer ${i2}: ${b5.uri} could not be read`);
    return external;
  });
  const meshes = [];
  const single = (json.meshes ?? []).reduce((n2, m3) => n2 + m3.primitives.length, 0) === 1;
  (json.meshes ?? []).forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((prim, primIndex) => {
      const label = mesh.name ? `${mesh.name}[${primIndex}]` : `mesh ${meshIndex}[${primIndex}]`;
      const mode = prim.mode ?? 4;
      if (mode !== 4) {
        warnings.push(`${label}: mode ${mode} is not TRIANGLES \u2014 skipped`);
        return;
      }
      const posIndex = prim.attributes.POSITION;
      if (posIndex === void 0) {
        warnings.push(`${label}: no POSITION \u2014 skipped`);
        return;
      }
      try {
        const positions = readAccessor(json, bin, buffers, posIndex);
        const vertexCount = positions.length / 3;
        const uvIndex = prim.attributes.TEXCOORD_0;
        const colorIndex = prim.attributes.COLOR_0;
        const uvs = uvIndex !== void 0 ? readAccessor(json, bin, buffers, uvIndex) : null;
        const normalIndex = prim.attributes.NORMAL;
        const normals = normalIndex !== void 0 ? readAccessor(json, bin, buffers, normalIndex) : null;
        const colorsRaw = colorIndex !== void 0 ? readAccessor(json, bin, buffers, colorIndex) : null;
        const colorComps = colorIndex !== void 0 ? TYPE_COMPONENTS[json.accessors?.[colorIndex]?.type ?? "VEC4"] ?? 4 : 4;
        const indices = prim.indices !== void 0 ? Uint32Array.from(readAccessor(json, bin, buffers, prim.indices)) : Uint32Array.from({ length: vertexCount }, (_3, i2) => i2);
        if (indices.length % 3 !== 0) {
          warnings.push(`${label}: ${indices.length} indices is not a triangle list \u2014 skipped`);
          return;
        }
        const { channels, vertexStride } = xa([
          { semantic: va.Position, components: 3, type: ya.Float32 },
          { semantic: va.TexCoord0, components: 2, type: ya.Float32 },
          { semantic: va.Color, components: 4, type: ya.UNorm8 },
          ...normals ? [{
            semantic: va.Normal,
            components: 3,
            type: ya.Float32
          }] : []
        ]);
        const vertices = new Uint8Array(vertexCount * vertexStride);
        const dv2 = new DataView(vertices.buffer);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i2 = 0; i2 < vertexCount; i2++) {
          const at3 = i2 * vertexStride;
          for (let c2 = 0; c2 < 3; c2++) {
            const v4 = positions[i2 * 3 + c2] ?? 0;
            dv2.setFloat32(at3 + channels[0].offset + c2 * 4, v4, true);
            if (v4 < min[c2]) min[c2] = v4;
            if (v4 > max[c2]) max[c2] = v4;
          }
          dv2.setFloat32(at3 + channels[1].offset, uvs ? uvs[i2 * 2] ?? 0 : 0, true);
          dv2.setFloat32(at3 + channels[1].offset + 4, uvs ? uvs[i2 * 2 + 1] ?? 0 : 0, true);
          for (let c2 = 0; c2 < 4; c2++) {
            const v4 = colorsRaw ? c2 < colorComps ? colorsRaw[i2 * colorComps + c2] ?? 1 : 1 : 1;
            dv2.setUint8(at3 + channels[2].offset + c2, Math.max(0, Math.min(255, Math.round(v4 * 255))));
          }
          if (normals && channels[3]) {
            for (let c2 = 0; c2 < 3; c2++) {
              dv2.setFloat32(at3 + channels[3].offset + c2 * 4, normals[i2 * 3 + c2] ?? 0, true);
            }
          }
        }
        meshes.push({
          name: single ? stem : `${stem}_${meshIndex}_${primIndex}`,
          data: { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max },
          vertexCount,
          triangleCount: indices.length / 3
        });
      } catch (err) {
        warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });
  if (meshes.length === 0 && warnings.length === 0) {
    warnings.push("no triangle geometry found");
  }
  return { meshes, warnings };
}
function encodeImportedMesh(mesh) {
  return Sa(mesh.data);
}
export {
  encodeImportedMesh,
  importGltfMeshes
};
