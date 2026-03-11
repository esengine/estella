export const SDK_API_REFERENCE = `
# ESEngine SDK API Reference

## Imports
\`\`\`typescript
import {
    // Component
    defineComponent, defineTag, getComponent,
    // System
    defineSystem, addSystem, addStartupSystem, addSystemToSchedule, Schedule,
    // Query
    Query, Removed,
    // Resources
    Res, ResMut, defineResource,
    // Commands
    Commands,
    // Events
    defineEvent, EventReader, EventWriter,
    // World access
    GetWorld,
    // Built-in components
    Transform, Sprite, Camera, Name, Parent, Children, Velocity,
    SpriteAnimator, SpineAnimation, Tilemap, TilemapLayer,
    AudioSource, AudioListener, ParticleEmitter, ShapeRenderer,
    PostProcessVolume, TimelinePlayer,
    // Types
    type Entity, type World, type ComponentDef,
} from 'esengine';

import {
    // Physics
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    PolygonCollider, ChainCollider, SegmentCollider,
    RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint,
    Physics,
} from 'esengine/physics';

import {
    // UI
    UIRect, Canvas, Image, Text, BitmapText, Button, Toggle, ToggleGroup,
    Slider, ProgressBar, ScrollView, Dropdown, TextInput, ListView,
    Interactable, Focusable, UIMask, FlexContainer, FlexItem,
    LayoutGroup, SafeArea, Draggable, DragState, UIRenderer,
} from 'esengine';
\`\`\`

## defineComponent
Define a custom component with default values. The editor auto-registers it.
\`\`\`typescript
export const Health = defineComponent('Health', {
    current: 100,
    max: 100,
    invincible: false,
});

// With nested objects
export const Movement = defineComponent('Movement', {
    speed: 5,
    direction: { x: 0, y: 0 },
    grounded: false,
});
\`\`\`

## defineTag
Define a tag component (no data, just marks entities).
\`\`\`typescript
export const Enemy = defineTag('Enemy');
export const Player = defineTag('Player');
\`\`\`

## defineSystem
Define a system with typed parameters. Parameters are injected automatically.
\`\`\`typescript
// Query entities with Transform and Velocity
const movementSystem = defineSystem(
    [Query(Transform, Velocity)],
    (query) => {
        for (const [transform, velocity] of query) {
            transform.position.x += velocity.linear.x;
            transform.position.y += velocity.linear.y;
        }
    },
);

// Access resources
const scoreSystem = defineSystem(
    [Query(Player), Res(ScoreResource)],
    (players, score) => {
        // score is read-only
    },
);

// Mutable resource access
const timerSystem = defineSystem(
    [ResMut(GameTimer)],
    (timer) => {
        timer.elapsed += timer.deltaTime;
    },
);

// Spawn/despawn entities
const spawnerSystem = defineSystem(
    [Commands(), Query(Spawner)],
    (commands, spawners) => {
        for (const [spawner] of spawners) {
            if (spawner.shouldSpawn) {
                const e = commands.spawn();
                commands.insert(e, Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
                commands.insert(e, Sprite, { size: { x: 32, y: 32 } });
            }
        }
    },
);

// Events
const damageSystem = defineSystem(
    [EventReader(DamageEvent), Query(Health)],
    (events, healths) => {
        for (const event of events) {
            // handle damage
        }
    },
);

// Direct world access
const worldSystem = defineSystem(
    [GetWorld()],
    (world) => {
        const entity = world.spawn();
        world.insert(entity, Transform, { ... });
        if (world.valid(entity)) {
            const t = world.tryGet(entity, Transform);
        }
        world.despawn(entity);
    },
);

// Removed query (entities that just had a component removed)
const cleanupSystem = defineSystem(
    [Removed(Health)],
    (removed) => {
        for (const entity of removed) {
            console.log('Entity lost Health:', entity);
        }
    },
);
\`\`\`

## Schedule (execution order)
\`\`\`
Startup        — runs once at app start
First          — runs every frame, before everything
FixedPreUpdate — fixed timestep, before physics
FixedUpdate    — fixed timestep, physics step
FixedPostUpdate— fixed timestep, after physics
PreUpdate      — before main update
Update         — main game logic (default)
PostUpdate     — after main update (cleanup, camera follow)
Last           — end of frame
\`\`\`

### Registering systems
\`\`\`typescript
addSystem(movementSystem);                              // Update schedule (default)
addStartupSystem(initSystem);                           // Startup (runs once)
addSystemToSchedule(Schedule.PostUpdate, cameraSystem); // Specific schedule
addSystemToSchedule(Schedule.FixedUpdate, physicsStep); // Fixed timestep
\`\`\`

## defineResource
\`\`\`typescript
export const GameState = defineResource('GameState', {
    score: 0,
    level: 1,
    paused: false,
});
\`\`\`

## defineEvent
\`\`\`typescript
export const DamageEvent = defineEvent<{ target: Entity; amount: number }>('DamageEvent');

// Write events
const attackSystem = defineSystem(
    [EventWriter(DamageEvent)],
    (writer) => {
        writer.send({ target: someEntity, amount: 10 });
    },
);
\`\`\`

## Query Filters
\`\`\`typescript
// With: entities that have both Transform AND Sprite
Query(Transform, Sprite)

// Optional component (may be undefined)
Query(Transform).optionally(Velocity)

// Without: exclude entities that have Enemy tag
Query(Transform).without(Enemy)

// Iteration
for (const [transform, sprite] of query) { ... }

// Get specific entity's components
const result = query.get(entity);  // returns tuple or undefined
\`\`\`

## Built-in Component Defaults

### Transform
\`\`\`typescript
{
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },  // quaternion
    scale: { x: 1, y: 1, z: 1 },
}
\`\`\`

### Sprite
\`\`\`typescript
{
    texture: "",          // asset UUID or relative path (empty = no texture)
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
    color: { r: 1, g: 1, b: 1, a: 1 },
    flipX: false,
    flipY: false,
    layer: 0,
    enabled: true,
}
\`\`\`

### Camera
\`\`\`typescript
{
    size: 5,           // orthographic half-height
    near: -1000,
    far: 1000,
    clearColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
    enabled: true,
}
\`\`\`

### RigidBody
\`\`\`typescript
{
    bodyType: 0,       // 0=Dynamic, 1=Kinematic, 2=Static
    gravityScale: 1,
    linearDamping: 0,
    angularDamping: 0,
    fixedRotation: false,
    bullet: false,
    enabled: true,
}
\`\`\`

### UIRect
\`\`\`typescript
{
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    offsetMin: { x: -50, y: -50 },
    offsetMax: { x: 50, y: 50 },
    pivot: { x: 0.5, y: 0.5 },
}
\`\`\`

## Script File Template
A typical user script file:
\`\`\`typescript
import {
    defineComponent, defineSystem, defineTag,
    Query, Commands, Res, addSystem, addSystemToSchedule, Schedule,
    Transform, Sprite,
    type Entity, type World,
} from 'esengine';

// 1. Define components
export const PlayerData = defineComponent('PlayerData', {
    speed: 200,
    jumpForce: 400,
    health: 100,
});

export const IsPlayer = defineTag('IsPlayer');

// 2. Define systems
const playerMovement = defineSystem(
    [Query(Transform, PlayerData)],
    (query) => {
        for (const [transform, player] of query) {
            // movement logic
        }
    },
    { name: 'PlayerMovement' },
);

// 3. Register systems
addSystem(playerMovement);
\`\`\`

## Property Value Types
When using \`set_property\`, values must match these formats:
\`\`\`
number    → 42 or 3.14
string    → "hello"
boolean   → true / false
vec2      → { x: number, y: number }
vec3      → { x: number, y: number, z: number }
vec4      → { x: number, y: number, z: number, w: number }
color     → { r: 0-1, g: 0-1, b: 0-1, a: 0-1 }
padding   → { left: number, top: number, right: number, bottom: number }
vec2-array→ [{ x, y }, { x, y }, ...]
\`\`\`

## Asset Referencing
In the editor and scene files, asset fields (texture, clip, font, material, etc.) store **UUID strings** (preferred) or **relative paths**.
- **UUIDs** (stable, preferred): \`"a1b2c3d4-e5f6-7890-abcd-ef1234567890"\`
- **Relative paths** (fallback): \`"assets/textures/player.png"\`
- Use \`list_assets\` to find assets and get their UUIDs
- When setting asset fields via \`set_property\`, pass the UUID or relative path as a string
- To clear an asset field, set it to \`""\` (empty string)
- At runtime (C++/WASM), these are resolved to numeric handles internally — you don't need to deal with handles

## UI Components

### Canvas
Root container for UI elements. All UI entities must be children of a Canvas entity.
\`\`\`typescript
{ renderMode: 0, designResolution: { x: 1080, y: 1920 }, matchMode: 0 }
\`\`\`

### UIRect
Anchored rectangle layout (required on all UI elements under Canvas).
\`\`\`typescript
{
    anchorMin: { x: 0.5, y: 0.5 },  // 0-1, relative to parent
    anchorMax: { x: 0.5, y: 0.5 },
    offsetMin: { x: -50, y: -50 },   // pixels from anchor
    offsetMax: { x: 50, y: 50 },
    pivot: { x: 0.5, y: 0.5 },
}
\`\`\`

### Image
\`\`\`typescript
{ source: "", color: { r: 1, g: 1, b: 1, a: 1 }, type: 0, enabled: true }
// source: asset UUID or relative path (empty = no image)
// type: 0=Simple, 1=Sliced, 2=Tiled, 3=Filled
\`\`\`

### Text
\`\`\`typescript
{
    content: "Hello",
    fontSize: 24,
    color: { r: 1, g: 1, b: 1, a: 1 },
    align: 0,        // 0=Left, 1=Center, 2=Right
    verticalAlign: 0, // 0=Top, 1=Middle, 2=Bottom
    lineSpacing: 0,
    overflow: 0,      // 0=Overflow, 1=Truncate, 2=Wrap
}
\`\`\`

### Button
Requires: Interactable + Image on same entity. Use a child Text entity for the label.
\`\`\`typescript
{ normalColor: { r: 1, g: 1, b: 1, a: 1 }, pressedColor: ..., disabledColor: ... }
\`\`\`

### Toggle
\`\`\`typescript
{ isOn: false, toggleGroup: null }
\`\`\`

### Slider
\`\`\`typescript
{ value: 0, minValue: 0, maxValue: 1, wholeNumbers: false, direction: 0 }
\`\`\`

### ScrollView
\`\`\`typescript
{ horizontal: true, vertical: true, movementType: 0, elasticity: 0.1, inertia: true }
\`\`\`

### Interactable
Required for any interactive UI element (Button, Toggle, Slider, etc.).
\`\`\`typescript
{ interactable: true }
\`\`\`

## Query Advanced Patterns
\`\`\`typescript
// Optional component (may be undefined in tuple)
const q = Query(Transform).optionally(Velocity);
for (const [transform, velocity] of q) {
    if (velocity) { /* has velocity */ }
}

// Without filter (exclude entities)
Query(Transform, Sprite).without(Disabled)

// Combining
Query(Transform).with(Sprite).without(Enemy).optionally(Health)

// Removed query (entities that just lost a component this frame)
const cleanup = defineSystem(
    [Removed(Health)],
    (removed) => { for (const entity of removed) { ... } },
);
\`\`\`

## Draw API (Immediate Mode Drawing)
\`\`\`typescript
import { Draw } from 'esengine';

const debugDrawSystem = defineSystem(
    [Query(Transform)],
    (query) => {
        for (const [transform] of query) {
            Draw.circle(transform.position, 10, { r: 0, g: 1, b: 0, a: 0.5 });
            Draw.rect(transform.position, { x: 20, y: 20 }, { r: 1, g: 0, b: 0, a: 0.3 });
            Draw.line({ x: 0, y: 0 }, transform.position, { r: 1, g: 1, b: 1, a: 1 });
        }
    },
);
addSystemToSchedule(Schedule.PostUpdate, debugDrawSystem);
\`\`\`

## Audio
\`\`\`typescript
import { Audio } from 'esengine';

Audio.play('assets/audio/click.wav');
Audio.playMusic('assets/audio/bgm.mp3', { loop: true, volume: 0.5 });
Audio.stopAll();
Audio.setMasterVolume(0.8);
\`\`\`

## Common Entity Patterns

### Sprite Entity
\`\`\`
create_entity: { name, components: [
    { type: "Transform", data: { position: { x, y, z: 0 } } },
    { type: "Sprite", data: { texture: "<uuid-or-path>", size: { x, y } } }
]}
// Use list_assets to find the asset UUID, then pass it as the texture value
\`\`\`

### UI Button
\`\`\`
1. Create Canvas entity (if not exists): Canvas + UIRect + Transform
2. Create Button entity as child:
   - Transform + UIRect + Image + Interactable + Button
3. Create Label as child of Button:
   - Transform + UIRect + Text (content: "Click Me")
\`\`\`

### Physics Entity
\`\`\`
create_entity: { name, components: [
    { type: "Transform" },
    { type: "Sprite" },
    { type: "RigidBody", data: { bodyType: 0 } },  // 0=Dynamic
    { type: "BoxCollider", data: { size: { x: 1, y: 1 } } }
]}
\`\`\`
\`\`\`
`;
