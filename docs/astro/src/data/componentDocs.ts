// The curated half of the component reference: what each component is for, and
// which guide explains it. The exhaustive half — every field, its type and its
// authoring default — is derived from the engine's own registry into
// `components.generated.json` by `tools/component-reference.mjs`, so it cannot
// drift from the code.
//
// Keep one entry per registered component: `--check` fails when the engine gains
// or loses one. `doc: null` means nothing in the manual explains it yet — the
// reference still lists it, and the check prints it as a documentation gap.
//
// The anchors are real heading ids read off the built pages, not guesses (a
// heading slug is not hand-derivable: "Bodies & colliders" is `bodies--colliders`,
// with two hyphens). `npm run verify:links` resolves every one of them after the
// build, so a wrong anchor fails there.

export type ComponentCategory =
  | 'core'
  | 'graphics'
  | 'ui'
  | 'physics'
  | 'animation'
  | 'world'
  | 'gameplay';

export interface ComponentDoc {
  /** Which reference page lists it. */
  category: ComponentCategory;
  /** One line: what it is for. */
  summary: string;
  /** Slug of the guide that explains it, or null when none does yet. */
  doc: string | null;
  /** Heading id on that guide, when a section is dedicated to it. */
  anchor?: string;
  /**
   * The same heading on the Chinese page, whose id is its Chinese text. Derived
   * by position — the translations are structural mirrors — and then verified
   * like every other link by `npm run verify:links`.
   */
  anchorZh?: string;
}

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  core: 'Core',
  graphics: 'Graphics',
  ui: 'UI',
  physics: 'Physics',
  animation: 'Animation',
  world: 'World',
  gameplay: 'Gameplay',
};

export const COMPONENT_DOCS: Record<string, ComponentDoc> = {
  // ── Core ───────────────────────────────────────────────────────────────────
  NodeVisibility: { category: 'core', summary: 'An animatable visual gate for an entity subtree that preserves authored renderer flags; particle emitters use their enabled flag while hidden.', doc: 'world/scenes' },
  Transform: { category: 'core', summary: 'Position, rotation and scale — plus the read-only world-space values the engine composes down the parent chain.', doc: 'core-concepts/transforms', anchor: 'the-transform-component', anchorZh: 'transform-组件' },
  Parent: { category: 'core', summary: 'The entity this one hangs under. The engine keeps it and `Children` in step; set it through the hierarchy API.', doc: 'core-concepts/transforms', anchor: 'parenting-and-hierarchy', anchorZh: '父子层级' },
  Children: { category: 'core', summary: "The entity's children, maintained by the engine alongside `Parent`. Its order is the order UI lays out and draws children in, and what hierarchy-order layers stack by.", doc: 'core-concepts/transforms', anchor: 'parenting-and-hierarchy', anchorZh: '父子层级' },
  Name: { category: 'core', summary: "The entity's display name — what the World Outliner shows and what name lookups resolve against.", doc: 'core-concepts/components', anchor: 'entity-metadata-components', anchorZh: '实体元数据组件' },
  Velocity: { category: 'core', summary: 'Constant linear and angular motion applied every frame, with no physics body involved.', doc: 'scripting/timers', anchor: 'the-velocity-component', anchorZh: 'velocity-组件' },
  SceneOwner: { category: 'core', summary: 'Which additively-loaded scene owns the entity, and whether it survives that scene being unloaded.', doc: 'world/scenes', anchor: 'persistent-entities', anchorZh: '持久化实体' },
  Disabled: { category: 'core', summary: 'Tag added by `setEntityActive(false)`: an entity counts as active exactly while it is absent.', doc: 'core-concepts/components', anchor: 'entity-metadata-components', anchorZh: '实体元数据组件' },
  RuntimeOnly: { category: 'core', summary: 'Tag for a world-only derived entity (the layers a `Tilemap` projects, runtime tile colliders). Scene saves skip it, because persisting one would duplicate it against the next derivation.', doc: 'core-concepts/components', anchor: 'entity-metadata-components', anchorZh: '实体元数据组件' },

  // ── Graphics ───────────────────────────────────────────────────────────────
  Sprite: { category: 'graphics', summary: 'Draws a texture in the world — tint, size, pivot, sorting layer, flipping, tiling and parallax.', doc: 'graphics/sprites/overview', anchor: 'sprite-fields', anchorZh: 'sprite-字段' },
  BitmapText: { category: 'graphics', summary: 'Text drawn in world space from a bitmap font, sorted alongside sprites (UI text is `Text`).', doc: 'graphics/sprites/effects', anchor: 'world-space-text-bitmaptext', anchorZh: '世界空间文字bitmaptext' },
  ShapeRenderer: { category: 'graphics', summary: 'A filled primitive — circle, capsule or rounded rectangle — with no texture asset.', doc: 'graphics/sprites/effects', anchor: 'shapes-shaperenderer', anchorZh: '图元shaperenderer' },
  TrailRenderer: { category: 'graphics', summary: 'A ribbon trailing the entity as it moves, tapering and fading over its lifetime.', doc: 'graphics/sprites/effects', anchor: 'motion-trails-trailrenderer', anchorZh: '拖尾trailrenderer' },
  Camera: { category: 'graphics', summary: 'A view onto the world — projection, zoom, viewport rect, clear flags and render priority.', doc: 'graphics/camera/overview', anchor: 'the-camera-component', anchorZh: 'camera-组件' },
  FollowTarget: { category: 'graphics', summary: 'Makes a camera chase an entity, with an offset, a dead zone and eased catch-up.', doc: 'graphics/camera/follow', anchor: 'follow-a-target', anchorZh: '跟随目标' },
  LookAtTarget: { category: 'graphics', summary: 'Turns a 3D camera so a target sits at a chosen point of the screen, with a dead zone and eased turning.', doc: 'graphics/camera/follow', anchor: 'look-at-a-target', anchorZh: '看向目标' },
  CameraDolly: { category: 'graphics', summary: 'Puts a camera on a Spline track: at a set place, level with a target, or moving at a speed.', doc: 'graphics/camera/follow', anchor: 'ride-a-track', anchorZh: '沿轨道移动' },
  CameraNoise: { category: 'graphics', summary: 'Makes a camera drift and nod like one held by hand, on the drawn view and never its Transform.', doc: 'graphics/camera/shake', anchor: 'handheld-noise', anchorZh: '手持噪声' },
  PositionComposer: { category: 'graphics', summary: 'Moves a 2D or 3D camera, without turning it, so its target sits at a screen point, with dead and soft zones.', doc: 'graphics/camera/follow', anchor: 'frame-a-target-by-moving-the-camera', anchorZh: '移动相机来构图' },
  CameraTargetGroup: { category: 'graphics', summary: 'Several entities framed as one target: stands at their centre, so a camera given it frames them all.', doc: 'graphics/camera/follow', anchor: 'frame-several-targets', anchorZh: '同时框住多个目标' },
  XRController: { category: 'graphics', summary: 'Places an entity at a VR controller each frame while a headset presents: where the hand holds it, or where it points.', doc: 'graphics/camera/vr', anchor: 'controllers-and-the-head', anchorZh: '手柄与头部' },
  XRHead: { category: 'graphics', summary: 'Places an entity at the head of the player each frame while a headset presents.', doc: 'graphics/camera/vr', anchor: 'controllers-and-the-head', anchorZh: '手柄与头部' },
  GroupFraming: { category: 'graphics', summary: 'Zooms or dollies a camera so a target group fills its share of the screen.', doc: 'graphics/camera/follow', anchor: 'frame-several-targets', anchorZh: '同时框住多个目标' },
  CameraImpulseSource: { category: 'graphics', summary: 'A jolt fired from a place, felt by listening cameras by how near they are: an explosion, a landing.', doc: 'graphics/camera/shake', anchor: 'impulses-shakes-from-a-place', anchorZh: '冲击来自某处的震动' },
  CameraImpulseListener: { category: 'graphics', summary: 'Lets a camera feel impulses fired in the scene, on its channels, at its gain.', doc: 'graphics/camera/shake', anchor: 'impulses-shakes-from-a-place', anchorZh: '冲击来自某处的震动' },
  StateDrivenCamera: { category: 'graphics', summary: 'Picks the live camera by what an Animator is doing: a camera per state, with a wait and a hold.', doc: 'graphics/camera/blending', anchor: 'cameras-by-animation-state', anchorZh: '按动画状态切换相机' },
  CameraDeoccluder: { category: 'graphics', summary: 'Draws a camera in toward its target when something solid comes between them, and back out when it is gone.', doc: 'graphics/camera/follow', anchor: 'keep-the-target-in-sight', anchorZh: '保持目标可见' },
  CameraBrain: { category: 'graphics', summary: 'How the view changes cameras: the blend when the live camera changes by priority or by turning one on or off.', doc: 'graphics/camera/blending', anchor: 'switching-cameras-by-priority', anchorZh: '按优先级切换相机' },
  CameraBounds: { category: 'graphics', summary: 'The world rectangle a camera may not look outside of, so the level edge stays at the screen edge.', doc: 'graphics/camera/follow', anchor: 'keep-the-camera-inside-the-level', anchorZh: '把相机限制在关卡内' },
  Canvas: { category: 'graphics', summary: 'The design resolution and scale mode a scene is authored against — one per scene root.', doc: 'core-concepts/screen/overview', anchor: 'the-canvas-component', anchorZh: 'canvas-组件' },
  Light: { category: 'graphics', summary: 'A light — point, directional, spot or ambient — read by lit renderers, Lit materials and mesh shadow maps.', doc: 'graphics/lighting/lights', anchor: 'light-types', anchorZh: '光源类型' },
  ShadowCaster2D: { category: 'graphics', summary: 'Marks a renderer as an occluder, so 2D lights cast shadows from its silhouette.', doc: 'graphics/lighting/shadows', anchor: '2d-shadows', anchorZh: '2d-阴影' },
  PostProcessVolume: { category: 'graphics', summary: 'A stack of full-screen effects (bloom, vignette, colour grading) applied after the scene is drawn.', doc: 'graphics/post-processing/overview', anchor: 'postprocessvolume', anchorZh: 'postprocessvolume' },
  TimeOfDay: { category: 'graphics', summary: 'The time of day of a scene — where the sun and the moon are, and the light, sky, fog and exposure that follow — driving lights, a procedural sky, fog and exposure.', doc: 'graphics/time-of-day' },
  Weather: { category: 'graphics', summary: 'The weather of a scene — a preset, a turn toward another, and an optional cycle — driving lights, fog, rain, grade, exposure and reflections.', doc: 'graphics/weather' },
  MeshRenderer: { category: 'graphics', summary: 'Geometry drawn as an entity — your own vertices or an imported mesh, with a material and a sorting layer.', doc: 'graphics/drawing/meshes', anchor: 'custom-meshes-meshrenderer', anchorZh: '自定义网格meshrenderer' },
  MeshSkin: { category: 'graphics', summary: 'The joint entities that deform a MeshRenderer — an imported skin, in the order its bind matrices are in.', doc: 'assets/models/animation', anchor: 'skinning', anchorZh: '蒙皮' },
  MeshMorph: { category: 'graphics', summary: 'How far a MeshRenderer is blended towards each of the shapes its mesh carries — one weight per morph target.', doc: 'assets/models/animation', anchor: 'morph-targets', anchorZh: 'morph-target' },
  MeshLightmap: { category: 'graphics', summary: 'Where a MeshRenderer\'s baked light comes from — the atlas, and the rectangle of it this object occupies.', doc: 'graphics/lighting/baked', anchor: 'meshlightmap', anchorZh: 'meshlightmap' },
  LightProbeVolume: { category: 'graphics', summary: 'A box of baked irradiance on a grid — what lights the things a lightmap cannot hold still, characters included.', doc: 'graphics/lighting/baked', anchor: 'light-probe-volumes', anchorZh: '光照探针体积' },
  BakedLighting: { category: 'graphics', summary: 'How this scene is baked — atlas size, density, bounces — and a record of what the last bake read.', doc: 'graphics/lighting/baked', anchor: 'bake-settings', anchorZh: '烘焙设置' },
  DecalProjector: { category: 'graphics', summary: 'Prints this entity\'s material onto what its box covers — the surface is cut to the box and drawn again, so a decal is lit and shadowed as the surface under it.', doc: null },
  BlobShadow: { category: 'graphics', summary: 'A soft dark disc on the ground under an entity — no shadow map, no light, no extra pass — that fades and shrinks as the entity leaves the ground.', doc: 'graphics/lighting/shadows', anchor: 'blob-shadows', anchorZh: '圆片阴影' },
  Footsteps: { category: 'graphics', summary: 'Makes what walks leave rings on water and prints on soft ground, by the StepSurface under each step.', doc: 'graphics/sprites/visibility', anchor: 'footsteps-and-ripples', anchorZh: '脚印与涟漪' },
  StepSurface: { category: 'graphics', summary: 'Makes the ground this sprite covers a surface that steps leave water rings or footprints on.', doc: 'graphics/sprites/visibility', anchor: 'footsteps-and-ripples', anchorZh: '脚印与涟漪' },
  SwayPusher: { category: 'graphics', summary: 'A body the plants of a sprite-sway material lean away from as it walks through them: the eight nearest the camera are told to the shader.', doc: 'graphics/materials/overview', anchor: 'core-templates', anchorZh: '核心模板' },
  FogOfWar: { category: 'graphics', summary: 'Names the world rectangle a 2D fog of war covers: ground no SightViewer has seen is dark, ground seen and left is remembered, ground in view is clear.', doc: 'graphics/sprites/visibility', anchor: 'fog-of-war', anchorZh: '战争迷雾' },
  SightViewer: { category: 'graphics', summary: 'An eye: sprites with a SightTarget are seen while some viewer has a clear line to them past the ShadowCaster2D walls.', doc: 'graphics/sprites/visibility', anchor: 'line-of-sight', anchorZh: '视线' },
  SightTarget: { category: 'graphics', summary: 'Hides the sprite while no SightViewer has a clear line to it, for what is not lit and so is not hidden by the shadows of walls.', doc: 'graphics/sprites/visibility', anchor: 'line-of-sight', anchorZh: '视线' },
  CoverFade: { category: 'graphics', summary: 'A roof or a tree crown that thins out while a CoverFadeTarget stands under it, so the player is never hidden by what they walked into.', doc: 'graphics/sprites/visibility', anchor: 'cover-fade', anchorZh: '遮挡淡出' },
  CoverFadeTarget: { category: 'graphics', summary: 'Marks what a CoverFade keeps visible — the player, and anything else that must not be hidden by a roof or a crown.', doc: 'graphics/sprites/visibility', anchor: 'cover-fade', anchorZh: '遮挡淡出' },
  RainUpright: { category: 'graphics', summary: 'Marks a sprite that stands on the ground (a character, a trunk), so the 2D rain draws no rings, splashes or wet darkening over it.', doc: 'graphics/sprites/visibility', anchor: 'upright-sprites', anchorZh: '直立的精灵' },
  RainShelter: { category: 'graphics', summary: 'A roof, awning or crown that keeps the ground under it dry in the 2D rain, as far as the sprite lets that ground be seen.', doc: 'graphics/sprites/visibility', anchor: 'rain-shelter', anchorZh: '遮雨' },
  StreamedWorld: { category: 'world', summary: 'Declares the scene a streamed world and how big the cook cuts its cells.', doc: 'world/streaming', anchor: 'declaring-a-streamed-world', anchorZh: '声明一个流送世界' },
  RememberState: { category: 'world', summary: 'Keeps an entity as it was left when its cell unloads, and keeps it gone once destroyed.', doc: 'world/streaming', anchor: 'remembered-state', anchorZh: '记住的状态' },
  ExcludeFromFarProxy: { category: 'world', summary: 'Keeps an entity and everything under it out of its cell far proxy: for what a game moves with its own systems.', doc: 'world/streaming', anchor: 'far-proxies', anchorZh: '远景代理' },
  WorldPersistent: { category: 'world', summary: 'Keeps an entity\'s whole subtree out of the partition — it belongs to the persistent world.', doc: 'world/streaming', anchor: 'declaring-a-streamed-world', anchorZh: '声明一个流送世界' },
  WorldGen: { category: 'world', summary: 'A generated world: names the game\'s rules (biomes, recipes, layers), their version, the world and its seed; what the rules place is laid out round the streaming sources.', doc: 'world/generation', anchor: 'the-worldgen-component', anchorZh: 'worldgen-组件' },
  WorldZone: { category: 'world', summary: 'An area of a generated world planned by hand: kept clear of what it excludes, held to a biome, its edge fading out.', doc: 'world/generation', anchor: 'zones', anchorZh: '区域' },
  PlacedObject: { category: 'world', summary: 'Written by a generated world on what the game interacts with (ore, a tree to fell): its stable placement id and kind.', doc: 'world/generation', anchor: 'interactive-placements-and-changes', anchorZh: '可交互的放置物与变化' },
  WorldStreamingSource: { category: 'world', summary: 'Asks for the places near it to exist; several sources are unioned.', doc: 'world/streaming', anchor: 'streaming-sources', anchorZh: '流送源' },
  SpriteMask: { category: 'graphics', summary: "Turns this entity's Sprite into a stencil that cuts the sprites drawn after it — a window, or a hole.", doc: 'graphics/sprites/sorting', anchor: 'sprite-masks', anchorZh: '精灵遮罩' },
  SortingGroup: { category: 'graphics', summary: 'Makes an entity and its whole subtree sort as one unit — the group states the layer and order, members state their place inside it.', doc: 'graphics/sprites/sorting', anchor: 'sorting-groups', anchorZh: '排序组' },
  GroupOpacity: { category: 'graphics', summary: 'Fades an entity and everything under it; the opacities multiply down the hierarchy into each descendant\'s own alpha.', doc: 'graphics/sprites/overview', anchor: 'group-opacity', anchorZh: '组不透明度' },
  CompositeBatch: { category: 'graphics', summary: 'Marks the root of a model built from many parts that moves as a whole, so its parts are drawn in a few draws that follow the root: repeated meshes as instanced sets, the rest merged in chunks of the root\'s space.', doc: 'performance/static-batching', anchor: 'compositebatch-moving-models', anchorZh: 'compositebatch移动模型' },
  StaticBatch: { category: 'graphics', summary: 'Marks a mesh that will not move, so the meshes sharing its material are merged into one draw while the game runs; it also records what became of this one.', doc: 'performance/static-batching', anchor: 'staticbatch', anchorZh: 'staticbatch' },
  Terrain: { category: 'graphics', summary: 'Ground made from a heightmap or noise, painted by height and slope, and drawn in chunks that coarsen with distance.', doc: 'graphics/terrain/overview', anchor: 'component', anchorZh: '组件' },
  Planet: { category: 'graphics', summary: 'Ground on a sphere, drawn as six quadtrees round the eye from a generator the game registers, finest underfoot and a handful of coarse nodes from space.', doc: 'graphics/terrain/large-worlds', anchor: 'planet', anchorZh: '星球' },
  Foliage: { category: 'graphics', summary: 'Scatters grass or a mesh across an area and over a terrain, drawn a cell at a time, swaying in the wind and thinning out with distance.', doc: 'graphics/foliage', anchor: 'component', anchorZh: '组件' },
  Groom: { category: 'graphics', summary: 'Draws hair or fur as strands from a .esgroom, exported from Blender or grown in the engine from parameters, each group with its own material, width and shadow settings.', doc: null },
  PlacedFoliage: { category: 'graphics', summary: 'Keeps every plant an artist placed by hand as data in one entity, grown a cell at a time as instances of the plants\' own meshes.', doc: 'graphics/foliage', anchor: 'placed-plants', anchorZh: '手摆植物' },
  MeshInstances: { category: 'graphics', summary: 'Draws the mesh of a MeshRenderer at many places as one renderable, culling each place and choosing its mesh by distance.', doc: 'graphics/foliage', anchor: 'placed-plants', anchorZh: '手摆植物' },
  Floating: { category: 'graphics', summary: 'Holds a RigidBody3D up in water and carries it with the current, by forces at a few points of the body.', doc: 'graphics/water/interaction-and-shader', anchor: 'floating', anchorZh: '漂浮' },
  Spline: { category: 'graphics', summary: 'A curve through points, each with a width, read by what follows it (a river\'s WaterBody on the same entity); measured by the distance along it.', doc: 'graphics/water/rivers-and-shores', anchor: 'splines', anchorZh: '样条' },
  Waterfall: { category: 'graphics', summary: 'Water falling from a lip: sheets thrown level at a speed and taken by gravity until they meet the ground or other water, drawn as the mesh of the entity itself.', doc: 'graphics/water/rivers-and-shores', anchor: 'waterfalls', anchorZh: '瀑布' },
  WaterfallAnchor: { category: 'graphics', summary: 'Keeps a child of a Waterfall on the middle of the fall: at its foot wherever the water lands, or a share of the time down. Where the mist goes.', doc: 'graphics/water/rivers-and-shores', anchor: 'waterfalls', anchorZh: '瀑布' },
  WaterBody: { category: 'graphics', summary: 'An ocean, a lake, a river, an island, an exclusion volume or a custom shape: where the water is (or is kept out), how high its waves stand and how it flows; drawn as part of its zone\'s one surface.', doc: 'graphics/water/overview', anchor: 'water-bodies', anchorZh: '水体' },
  WaterZone: { category: 'graphics', summary: 'The region the bodies of water are baked over and drawn from as one surface: the waves they share, the material, the mesh and the ripples.', doc: 'graphics/water/overview', anchor: 'water-zone', anchorZh: '水体区域' },
  Billboard: { category: 'graphics', summary: 'Turns the MeshRenderer beside it to face each view that draws it: flat in the view plane, or upright about world up.', doc: 'graphics/drawing/meshes', anchor: 'cards-that-face-the-camera-billboard', anchorZh: '朝向相机的卡片billboard' },
  Impostor: { category: 'graphics', summary: 'Stands a card showing a picture of the mesh in for the MeshRenderer once the object is small on screen; the pictures are taken from many directions while the game runs.', doc: 'performance/level-of-detail', anchor: 'impostors', anchorZh: 'impostor' },
  LODMember: { category: 'graphics', summary: 'Draws its MeshRenderer only while another entity’s LODGroup, as each view measures it, chooses its level: levels that are whole entities, such as a groom’s strands and its cards.', doc: 'performance/level-of-detail', anchor: 'the-lodgroup-component', anchorZh: 'lodgroup-组件' },
  LODGroup: { category: 'graphics', summary: 'Cheaper stand-in meshes for a MeshRenderer, chosen by how much of the screen the object covers.', doc: 'performance/level-of-detail', anchor: 'the-lodgroup-component', anchorZh: 'lodgroup-组件' },
  ReflectionProbe: { category: 'graphics', summary: 'A box inside which reflections come from a bake rather than from the sky — the specular half of what a light probe volume answers.', doc: 'graphics/lighting/baked', anchor: 'reflection-probes', anchorZh: '反射探针' },
  PlanarReflection: { category: 'graphics', summary: 'Captures a mirrored view for flat lit surfaces, with layer filtering, capture quality and update controls.', doc: 'graphics/lighting/planar-reflections' },
  Occluder: { category: 'graphics', summary: 'A box sight does not pass through — what stands behind it is not collected, and the picture is unchanged.', doc: 'performance/occlusion-culling', anchor: 'fields', anchorZh: '字段' },
  Video: { category: 'graphics', summary: 'Plays a video stream onto a surface in the world or the UI.', doc: 'graphics/video', anchor: 'the-video-component', anchorZh: 'video-组件' },

  // ── UI ─────────────────────────────────────────────────────────────────────
  UINode: { category: 'ui', summary: 'The UI box: size, position, margins and padding in design pixels. Every UI entity has one.', doc: 'ui/layout', anchor: 'uinode--the-box', anchorZh: 'uinode盒子' },
  UIVisual: { category: 'ui', summary: 'What a UI node paints — a colour, an image, a 9-slice frame, a tiled pattern or a filled bar. A picture in the UI is this, not a Sprite.', doc: 'ui/images', anchor: 'inspector', anchorZh: '检视器' },
  UIMask: { category: 'ui', summary: "Clips descendants to this node's rect, with an optional alpha cutoff.", doc: 'ui/masks', anchor: 'uimask', anchorZh: 'uimask' },
  ContentRect: { category: 'ui', summary: 'The rectangle world content occupies — a size and the pivot the transform sits on — that its sprite, text and clip mask follow.', doc: 'ui/world-ui', anchor: 'contentrect--a-rectangle-for-world-content', anchorZh: 'contentrect--世界内容的矩形' },
  RectAnchors: { category: 'ui', summary: 'Pins content placed by its transform to the edges or the centre of its parent\'s ContentRect, or of the screen: each axis stretched, pinned to an edge, or centred, with margins in units or as a fraction.', doc: 'ui/world-ui', anchor: 'rectanchors--world-content-that-follows-its-parent', anchorZh: 'rectanchors--跟随父级的世界内容' },
  UIWorldAnchor: { category: 'ui', summary: 'Stands a UI node over a point in the 3D world — an objective marker, a name over a head — and keeps it on the screen\'s edge when the point is out of view.', doc: 'ui/world-ui', anchor: 'uiworldanchor--ui-over-a-point-in-the-world', anchorZh: 'uiworldanchor--立在世界某一点上的-ui' },
  CanvasEffect: { category: 'ui', summary: 'Draws the screen UI of its Canvas\'s sorting layer into a picture of its own and lays it on the frame through a material: a lens, scan lines, a glow over a whole HUD.', doc: 'ui/world-ui', anchor: 'canvaseffect--a-canvas-drawn-through-a-material', anchorZh: 'canvaseffect--经由一个材质画出的-canvas' },
  UIScroll: { category: 'ui', summary: 'Scrollable content inside a clipped viewport, with momentum and scrollbars.', doc: 'ui/lists', anchor: 'scroll-areas-in-a-scene--uiscroll', anchorZh: '场景里的滚动区域--uiscroll' },
  FlexContainer: { category: 'ui', summary: 'Lays children out along an axis — direction, justification, alignment, wrapping and gaps.', doc: 'ui/layout', anchor: 'flexcontainer--laying-out-children', anchorZh: 'flexcontainer排布子项' },
  Interactable: { category: 'ui', summary: 'Makes a UI node hit-testable, so pointer events can land on it.', doc: 'ui/interaction', anchor: 'hit-testing-interactable--uiinteraction', anchorZh: '命中测试interactable--uiinteraction' },
  UIInteraction: { category: 'ui', summary: "Live pointer state for an interactable node — hovered, pressed, and the frame's transitions.", doc: 'ui/interaction', anchor: 'hit-testing-interactable--uiinteraction', anchorZh: '命中测试interactable--uiinteraction' },
  Text: { category: 'ui', summary: 'UI text — font, size, alignment, colour, outline, shadow, rich-text markup and a localization key.', doc: 'ui/text', anchor: 'text-properties', anchorZh: 'text-属性' },
  TextInput: { category: 'ui', summary: 'An editable text field with a caret, selection and IME support.', doc: 'ui/widgets', anchor: 'text-input', anchorZh: '文本输入' },
  Draggable: { category: 'ui', summary: 'Lets the pointer drag a UI node, optionally constrained to an axis.', doc: 'ui/interaction', anchor: 'drag--drop', anchorZh: '拖放' },
  DragState: { category: 'ui', summary: 'Transient per-frame geometry of a drag in progress; the drag system rebuilds it, scene saves omit it.', doc: 'ui/interaction', anchor: 'drag--drop', anchorZh: '拖放' },
  UIConsumesDrag: { category: 'ui', summary: 'Transient input ownership for drag controls: enclosing lists keep wheel input but do not start a competing drag scroll.', doc: 'ui/widgets', anchor: 'treeview', anchorZh: 'treeview' },
  Focusable: { category: 'ui', summary: 'Puts a widget in the keyboard focus order.', doc: 'ui/interaction', anchor: 'focus--keyboard', anchorZh: '焦点与键盘' },
  SafeArea: { category: 'ui', summary: 'Insets an absolute UI node clear of notches and rounded corners.', doc: 'core-concepts/screen/devices', anchor: 'safe-areas', anchorZh: '安全区' },
  ThemeStyle: { category: 'ui', summary: "Records which theme role an entity's colours came from, so a live theme swap can repaint it.", doc: 'ui/theming', anchor: 'how-widgets-consume-tokens', anchorZh: '控件如何消费令牌' },
  UIController: { category: 'ui', summary: 'Shared named page state a whole subtree switches on — no bespoke per-widget state.', doc: 'ui/controllers', anchor: 'controllers', anchorZh: '控制器' },
  UIGear: { category: 'ui', summary: 'Per-page field values a controller drives declaratively, authored from the Details panel.', doc: 'ui/controllers', anchor: 'gears', anchorZh: '属性绑定' },
  UIDialog: { category: 'ui', summary: 'A modal dialog surface — backdrop, result, and open/close state.', doc: 'ui/widgets', anchor: 'dialog', anchorZh: 'dialog-对话框' },
  UIDropdown: { category: 'ui', summary: 'A dropdown selector: its options and the selected index.', doc: 'ui/widgets', anchor: 'dropdown', anchorZh: 'dropdown-下拉框' },
  VirtualJoystick: { category: 'ui', summary: 'An independently captured fixed or follow joystick, feeding a named virtual InputMap axis.', doc: 'ui/widgets', anchor: 'virtualjoystick', anchorZh: 'virtualjoystick' },
  VirtualButton: { category: 'ui', summary: 'A held virtual InputMap action with independent pointer ownership and normal button appearance.', doc: 'ui/widgets', anchor: 'virtualbutton', anchorZh: 'virtualbutton' },
  UISlider: { category: 'ui', summary: 'A draggable value along a range, with an optional step.', doc: 'ui/widgets', anchor: 'slider', anchorZh: 'slider-滑块' },
  UIMeter: { category: 'ui', summary: 'A health or stamina bar whose ghost holds the old amount a moment after a blow, then eases down to the new one.', doc: 'ui/widgets', anchor: 'meter', anchorZh: 'meter-血条' },
  UIToggle: { category: 'ui', summary: 'A two-state widget — checkbox or switch — and its group membership.', doc: 'ui/widgets', anchor: 'toggle', anchorZh: 'toggle-开关' },
  UIToggleGroup: { category: 'ui', summary: 'Makes the toggles beneath it exclusive — a radio group or tab bar. Put it on their common ancestor.', doc: 'ui/widgets', anchor: 'toggle', anchorZh: 'toggle-开关' },
  UITabView: { category: 'ui', summary: 'Connects an ordered ToggleGroup to content pages, with keyboard navigation.', doc: 'ui/widgets', anchor: 'tabview', anchorZh: 'tabview' },
  UITooltip: { category: 'ui', summary: 'A themed engine tooltip with hover, focus, long press and screen-edge placement.', doc: 'ui/widgets', anchor: 'tooltip', anchorZh: 'tooltip' },
  UITreeView: { category: 'ui', summary: 'Adapts project hierarchy data to a virtualized tree with stable IDs and host-owned drop requests.', doc: 'ui/widgets', anchor: 'treeview', anchorZh: 'treeview' },
  UIColorPicker: { category: 'ui', summary: 'HSV/RGB/HEX and alpha editing with canonical RGBA events for UI, sprites and materials.', doc: 'ui/widgets', anchor: 'colorpicker', anchorZh: 'colorpicker' },

  // ── Physics ────────────────────────────────────────────────────────────────
  RigidBody2D: { category: 'physics', summary: 'Puts the entity under the flat solver: static, kinematic or dynamic, with damping, gravity scale and sleep.', doc: 'gameplay/physics-2d/bodies', anchor: 'rigidbody2d', anchorZh: 'rigidbody2d' },
  BoxCollider2D: { category: 'physics', summary: 'A rectangular collision shape. Sizes are in **metres**, not pixels.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  CircleCollider2D: { category: 'physics', summary: 'A circular collision shape. Radius is in **metres**.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  CapsuleCollider2D: { category: 'physics', summary: 'A capsule collision shape — the usual choice for a character body.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  SegmentCollider2D: { category: 'physics', summary: 'A single line segment — a one-sided wall or edge.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  PolygonCollider2D: { category: 'physics', summary: 'A convex polygon collision shape from your own points.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  ChainCollider2D: { category: 'physics', summary: 'A polyline of edges — open or looped — for static terrain.', doc: 'gameplay/physics-2d/bodies', anchor: 'colliders', anchorZh: '碰撞体' },
  RigidBody3D: { category: 'physics', summary: 'Puts the entity under the 3D solver — its own component set, so a 2D scene keeps the world it already has.', doc: 'gameplay/physics-3d/bodies', anchor: 'rigidbody3d', anchorZh: 'rigidbody3d' },
  CompoundCollider3D: { category: 'physics', summary: 'Boxes, spheres and capsules with local positions and rotations, combined into one native rigid body using the model placement scale.', doc: 'gameplay/physics-3d/bodies', anchor: 'compound-colliders', anchorZh: '复合碰撞体' },
  BoxCollider3D: { category: 'physics', summary: 'A box collision shape in 3D. Half-extents are in world units.', doc: 'gameplay/physics-3d/bodies', anchor: 'primitive-shapes', anchorZh: '基本形状' },
  SphereCollider3D: { category: 'physics', summary: 'A sphere collision shape in 3D.', doc: 'gameplay/physics-3d/bodies', anchor: 'primitive-shapes', anchorZh: '基本形状' },
  CapsuleCollider3D: { category: 'physics', summary: 'An upright capsule — what a 3D character is. Total height is 2*(halfHeight + radius).', doc: 'gameplay/physics-3d/bodies', anchor: 'primitive-shapes', anchorZh: '基本形状' },
  MeshCollider3D: { category: 'physics', summary: 'Collides against an imported mesh\u2019s own triangles — terrain, stairs, a room. Always static, and one-sided.', doc: 'gameplay/physics-3d/bodies', anchor: 'meshcollider3d', anchorZh: 'meshcollider3d' },
  ConvexCollider3D: { category: 'physics', summary: 'Collides against the convex hull of an imported mesh — the shape a solver can push, unlike a mesh collider.', doc: 'gameplay/physics-3d/bodies', anchor: 'convexcollider3d', anchorZh: 'convexcollider3d' },
  Breakable: { category: 'physics', summary: 'A thing that breaks: drawn whole until `broken` is raised, then its pieces, cut beforehand, are put where it stood and thrown out from where it was struck.', doc: 'gameplay/physics-3d/breakables' },
  CharacterController3D: { category: 'physics', summary: 'A kinematic 3D mover: swept against the world, climbs steps, stays glued to slopes, and reports the ground it is on.', doc: 'gameplay/physics-3d/characters', anchor: 'charactercontroller3d', anchorZh: 'charactercontroller3d' },
  ThirdPersonController: { category: 'physics', summary: 'Turns input into a movement request for a CharacterController3D, and reports what the character actually did to its Animator.', doc: 'gameplay/physics-3d/characters', anchor: 'thirdpersoncontroller', anchorZh: 'thirdpersoncontroller' },
  ThirdPersonCamera: { category: 'physics', summary: 'An eye that orbits a target under pointer control and pulls in when something solid stands between.', doc: 'gameplay/physics-3d/characters', anchor: 'thirdpersoncamera', anchorZh: 'thirdpersoncamera' },
  MeleeAttack: { category: 'physics', summary: 'A swing whose timing is the animation’s and whose reach is the physics world’s: a `hit` beat asks what is around an animated anchor, and gameplay decides who may be hurt.', doc: 'gameplay/physics-3d/combat', anchor: 'meleeattack', anchorZh: 'meleeattack' },
  Hunter: { category: 'physics', summary: 'A character that hunts what it perceives: it asks navigation for a route, the character controller for the movement, and the animator for a swing — the concrete twin of ThirdPersonController.', doc: 'gameplay/ai/hunter' },
  Health: { category: 'physics', summary: 'What something has left, and what makes it damageable at all — written only by the system that answers the Damage bus.', doc: 'gameplay/physics-3d/combat', anchor: 'damage-and-health', anchorZh: '伤害与-health' },
  Stamina: { category: 'physics', summary: 'The one pool a character\'s sprint, dodge, attack, jump and dash draw on; an empty bar refuses them, and it comes back after a moment of spending nothing.', doc: 'gameplay/physics-3d/combat', anchor: 'stamina', anchorZh: '体力-stamina' },
  Ragdoll: { category: 'physics', summary: 'Turns a skinned character\'s bones into jointed bodies while active, with limits by part of the body and one-way knees and elbows, and blends back to the animation when it is switched off.', doc: 'gameplay/physics-3d/ragdolls', anchor: 'ragdoll', anchorZh: 'ragdoll' },
  Hitboxes: { category: 'physics', summary: 'A box on each bone of a skinned character that follows the animation: a kinematic sensor a ray meets and names, so a shot can tell a head from a boot.', doc: 'gameplay/physics-3d/combat', anchor: 'hitboxes', anchorZh: '命中盒' },
  RagdollJoint: { category: 'physics', summary: 'What the author says of one bone of a ragdoll: no body of its own, or limits (and a one-way bend) of its own.', doc: 'gameplay/physics-3d/ragdolls', anchor: 'ragdolljoint', anchorZh: 'ragdolljoint' },
  FirstPersonController: { category: 'physics', summary: 'Looks, walks, jumps and crouches in a CharacterController3D from the keyboard, the pointer and the touch screen, through a camera on a child.', doc: 'gameplay/physics-3d/characters', anchor: 'first-person', anchorZh: '第一人称' },
  FirstPersonViewModel: { category: 'physics', summary: 'On the player\'s camera: draws what is held with a second camera over the world\'s, with its own field of view and near plane, so it does not go through walls.', doc: 'gameplay/physics-3d/characters', anchor: 'view-model', anchorZh: '视图模型' },
  Bone2D: { category: 'animation', summary: 'A bone of a 2D rig: an entity whose Transform is its joint, reaching a length along its own +x.', doc: 'animation/rig-2d', anchor: 'structure', anchorZh: '结构' },
  IK2D: { category: 'animation', summary: 'Bends the last bones of a limb after the animation has played, so the end of this bone reaches a target.', doc: 'animation/rig-2d', anchor: 'ik', anchorZh: 'ik' },
  BoneConstraint2D: { category: 'animation', summary: "Limits a bone's rotation, or makes it copy another entity's rotation or position, or look at it.", doc: 'animation/rig-2d', anchor: 'constraints', anchorZh: '约束' },
  PathFollower: { category: 'graphics', summary: 'Moves its entity along the Spline of another at a steady speed, once, round or back and forth, turning to face along it if asked.', doc: null },
  TerrainBand2D: { category: 'graphics', summary: 'A 2D ground drawn along the Spline of the same entity: a filled body, a lip along the surface with an optional image, and an optional chain collider.', doc: null },
  SwingTwistJoint3D: { category: 'physics', summary: 'A ball joint with independent twist limits, an elliptical swing cone and optional angular velocity motors.', doc: 'gameplay/physics-3d/joints', anchor: 'swingtwist-and-six-axis-joints', anchorZh: '摆动扭转关节与六轴关节' },
  SixDOFJoint3D: { category: 'physics', summary: 'Locks, limits or frees each translation and rotation axis independently, with optional velocity motors.', doc: 'gameplay/physics-3d/joints', anchor: 'swingtwist-and-six-axis-joints', anchorZh: '摆动扭转关节与六轴关节' },
  PointJoint3D: { category: 'physics', summary: 'Holds two 3D bodies at a shared point, free to turn on all three axes — a chain link, a ragdoll limb.', doc: 'gameplay/physics-3d/joints' },
  HingeJoint3D: { category: 'physics', summary: 'One axis of rotation between two 3D bodies — a door or a driven wheel, with optional limits and a motor.', doc: 'gameplay/physics-3d/joints' },
  SliderJoint3D: { category: 'physics', summary: 'One axis of travel between two 3D bodies — a lift or a piston, with optional limits and a motor.', doc: 'gameplay/physics-3d/joints' },
  DistanceJoint3D: { category: 'physics', summary: 'Keeps two 3D bodies a distance apart: a rope, a rod, or a spring when a frequency is given.', doc: 'gameplay/physics-3d/joints' },
  FixedJoint3D: { category: 'physics', summary: 'Locks two 3D bodies together in the pose they were placed in — no freedom at all.', doc: 'gameplay/physics-3d/joints' },
  CharacterController2D: { category: 'physics', summary: 'Kinematic character movement that slides along walls, climbs slopes and reports ground contact.', doc: 'gameplay/physics-2d/characters', anchor: 'charactercontroller2d', anchorZh: 'charactercontroller2d' },
  PlatformerController2D: { category: 'physics', summary: 'Runs and jumps a CharacterController2D from the keyboard or a game, with coyote time, a jump buffer and dropping through one-way platforms.', doc: 'gameplay/physics-2d/characters', anchor: 'platformercontroller2d', anchorZh: 'platformercontroller2d' },
  WindWake: { category: 'graphics', summary: 'Leaves a wake in the air as it moves: plants it passes are pushed along its path, spring back and ring down after it has gone.', doc: 'graphics/foliage', anchor: 'wakes-and-blasts', anchorZh: '尾流与冲击波' },
  WindBurst: { category: 'graphics', summary: 'A pressure front from where the entity appears: a ring that travels outward and pushes each plant over as it reaches it.', doc: 'graphics/foliage', anchor: 'wakes-and-blasts', anchorZh: '尾流与冲击波' },
  FoliageContact: { category: 'physics', summary: 'Something plants feel: grass parts around it, shrubs lean away, and placed plants near it become entities with colliders.', doc: 'graphics/foliage', anchor: 'touching-plants', anchorZh: '触碰植物' },
  PlantProxy: { category: 'physics', summary: 'The entity standing in for a placed plant while something is near it, which a ray or a collision finds.', doc: 'graphics/foliage', anchor: 'touching-plants', anchorZh: '触碰植物' },
  VoxelTerrain: { category: 'world', summary: 'Ground that is a volume, so it can hold caves and overhangs, and be carved while the game runs.', doc: 'world/voxel-terrain', anchor: 'adding-a-voxel-terrain', anchorZh: '添加体积地形' },
  RoadDecal: { category: 'world', summary: 'Lays the entity\'s mesh along a Spline and over the ground, its edges fading into what it lies on.', doc: 'graphics/terrain/overview', anchor: 'roaddecal', anchorZh: 'roaddecal' },
  OneWayPlatform2D: { category: 'physics', summary: 'Makes a collider solid from one side only, so a body passes up through it and lands on top.', doc: 'gameplay/physics-2d/bodies', anchor: 'one-way-platforms', anchorZh: '单向平台' },
  DistanceJoint2D: { category: 'physics', summary: 'Holds two bodies a fixed (or spring-limited) distance apart.', doc: 'gameplay/physics-2d/joints', anchor: 'joint-components', anchorZh: '关节组件' },
  HingeJoint2D: { category: 'physics', summary: 'Pins two bodies at a point and lets them rotate — a hinge, with optional limits and a motor.', doc: 'gameplay/physics-2d/joints', anchor: 'joint-components', anchorZh: '关节组件' },
  SliderJoint2D: { category: 'physics', summary: 'Constrains two bodies to slide along one axis — a piston or lift.', doc: 'gameplay/physics-2d/joints', anchor: 'joint-components', anchorZh: '关节组件' },
  FixedJoint2D: { category: 'physics', summary: 'Locks two bodies rigidly together, with optional spring give.', doc: 'gameplay/physics-2d/joints', anchor: 'joint-components', anchorZh: '关节组件' },
  MotorJoint2D: { category: 'physics', summary: 'Drives one body toward a target offset and angle — moving platforms and conveyors.', doc: 'gameplay/physics-2d/joints', anchor: 'motor-joints', anchorZh: '马达关节' },
  WheelJoint2D: { category: 'physics', summary: 'A suspension axis plus a spinning axle — the wheel half of a vehicle.', doc: 'gameplay/physics-2d/joints', anchor: 'joint-components', anchorZh: '关节组件' },

  // ── Animation ──────────────────────────────────────────────────────────────
  Animator: { category: 'animation', summary: 'Runs an animator controller — states, transitions and blend trees — over the entity.', doc: 'animation/animator', anchor: 'animator-component', anchorZh: 'animator-组件' },
  AnimatorRootMotion: { category: 'animation', summary: 'Publishes how far the active animation asks the character to move, for gameplay to hand to a character controller — a request, never a result.', doc: 'animation/animator-layers', anchor: 'animatorrootmotion-component', anchorZh: 'animatorrootmotion-组件' },
  AnimatorSpritePlayback: { category: 'animation', summary: 'Tracks the sprite clip requested by the active animator state and its playback position when the entity has no Sprite Animator. The state machine recreates this component at runtime.', doc: 'animation/animator', anchor: 'sprite-clip-states', anchorZh: '精灵剪辑状态' },
  GripProfile: { category: 'animation', summary: 'Where on an object each palm sits, and how its fingers are held there.', doc: 'animation/grip-pose', anchor: 'gripprofile', anchorZh: 'gripprofile' },
  GripSurface: { category: 'animation', summary: 'A cylinder, capsule, sphere or box on a held object that its holder\'s fingers close onto and stop at.', doc: 'animation/grip-pose', anchor: 'closing-onto-the-object', anchorZh: '贴合物体' },
  GripHolder: { category: 'animation', summary: 'Holds an object in its GripProfile\'s grip: the arms bent to its anchors, the fingers posed, in one order that cannot loop.', doc: 'animation/grip-pose', anchor: 'gripholder', anchorZh: 'gripholder' },
  GripPose: { category: 'animation', summary: 'Holds a rig\'s hands in a named pose, a pistol grip, a handle, a cup, that fits any rig with fingers.', doc: 'animation/grip-pose', anchor: 'the-grippose-component', anchorZh: 'grippose-组件' },
  SpringBone: { category: 'animation', summary: 'Makes every bone below this root a spring: the chain trails the animated pose by inertia, falls with gravity and is pulled back toward it (hair, tails, cords).', doc: 'animation/spring-bones', anchor: 'springbone-component', anchorZh: 'springbone-组件' },
  SpringBoneCollider: { category: 'animation', summary: 'A sphere or capsule that the spring-bone chains naming it are kept out of.', doc: 'animation/spring-bones', anchor: 'springbonecollider', anchorZh: 'springbonecollider' },
  SpriteAnimator: { category: 'animation', summary: 'Plays a flipbook clip by swapping the sprite frame, with speed, looping and frame events.', doc: 'animation/sprite-animation', anchor: 'spriteanimator-component', anchorZh: 'spriteanimator-组件' },
  ScreenFade: { category: 'animation', summary: 'Fades the screen to a colour over everything, keyed by a timeline or set by a script.', doc: 'animation/timeline/tracks', anchor: 'fade-and-time-dilation', anchorZh: '淡入淡出与时间缩放' },
  TimeDilation: { category: 'animation', summary: 'Slows or speeds the game, multiplying its own time scale: a timeline’s slow-motion beat.', doc: 'animation/timeline/tracks', anchor: 'fade-and-time-dilation', anchorZh: '淡入淡出与时间缩放' },
  TimelinePlayer: { category: 'animation', summary: 'Plays a timeline asset — keyframed tracks across many entities — with wrap modes and playback control.', doc: 'animation/timeline/playback', anchor: 'timelineplayer-component', anchorZh: 'timelineplayer-组件' },
  SpineAnimation: { category: 'animation', summary: 'A Spine skeleton: its skeleton and atlas assets, current animation, skin and mix settings.', doc: 'animation/spine', anchor: 'the-spineanimation-component', anchorZh: 'spineanimation-组件' },
  DragonBonesAnimation: { category: 'animation', summary: 'A DragonBones armature: its skeleton and atlas assets, armature choice and playback state.', doc: 'animation/dragonbones', anchor: 'the-dragonbonesanimation-component', anchorZh: 'dragonbonesanimation-组件' },

  // ── World ──────────────────────────────────────────────────────────────────
  Tilemap: { category: 'world', summary: 'A Tiled map asset projected into the scene; the engine derives one layer entity per map layer.', doc: 'world/tilemaps/tiled', anchor: 'the-tilemap-component', anchorZh: 'tilemap-组件' },
  TilemapLayer: { category: 'world', summary: 'One layer of tiles — its tileset, cell size, orientation, sorting and collision.', doc: 'world/tilemaps/overview', anchor: 'the-tilemaplayer-component', anchorZh: 'tilemaplayer-组件' },
  ParticleModelUnits: { category: 'world', summary: 'Imported particle sizes, speeds and gravity in model units; the particle plugin applies the largest absolute world-scale axis to the emitter.', doc: 'world/particles/overview', anchor: 'imported-particle-units', anchorZh: '导入粒子的单位' },
  ParticleEmitter: { category: 'world', summary: 'A particle system: emission, lifetime, shape, forces, noise, colour and size over life, sub-emitters and trails.', doc: 'world/particles/overview', anchor: 'particleemitter-fields', anchorZh: 'particleemitter-字段' },
  ParticleCollider: { category: 'world', summary: 'A sphere, box or capsule particles bounce off with no physics, for an emitter in Sdf collision mode, on the GPU or the CPU.', doc: 'world/particles/collision', anchor: 'sdf-collision', anchorZh: 'sdf-碰撞' },
  EffectLifetime: { category: 'world', summary: 'Removes a one-shot effect, the entity and everything under it, after it has run for a number of seconds in a running game.', doc: 'world/particles/overview', anchor: 'one-shot-effects', anchorZh: '一次性特效' },
  ParticleForceField: { category: 'world', summary: 'A field that pushes particles around — point, directional, vortex or drag.', doc: 'world/particles/motion', anchor: 'force-fields', anchorZh: '力场' },
  Marker: { category: 'world', summary: 'A named point or region of gameplay interest — spawn point, waypoint, trigger zone — queryable like any component.', doc: 'gameplay/markers', anchor: 'the-marker-component', anchorZh: 'marker-组件' },

  // ── Gameplay ───────────────────────────────────────────────────────────────
  NavAgent: { category: 'gameplay', summary: 'Steers an entity along a path found on the navigation grid.', doc: 'gameplay/ai/navigation/agents', anchor: 'navagent', anchorZh: 'navagent' },
  NavVolume: { category: 'gameplay', summary: 'The box a navigation mesh is baked over, out of the scene\u2019s own collision geometry.', doc: 'gameplay/ai/navigation/navmesh', anchor: 'navvolume', anchorZh: 'navvolume' },
  NavObstacle: { category: 'gameplay', summary: 'A box that blocks without being geometry \u2014 a door, a gate, a placed building.', doc: 'gameplay/ai/navigation/navmesh', anchor: 'navobstacle', anchorZh: 'navobstacle' },
  NavLink: { category: 'gameplay', summary: 'A way between two places the ground does not join \u2014 a drop, a ladder, a plank.', doc: 'gameplay/ai/navigation/navmesh', anchor: 'navlink', anchorZh: 'navlink' },
  NavArea: { category: 'gameplay', summary: 'A box of ground that costs more or less to cross \u2014 mud, water, a road.', doc: 'gameplay/ai/navigation/navmesh', anchor: 'navarea', anchorZh: 'navarea' },
  Perceiver: { category: 'gameplay', summary: 'Senses nearby perception targets within a sight cone and range.', doc: 'gameplay/ai/perception', anchor: 'components', anchorZh: '组件' },
  Perception: { category: 'gameplay', summary: "What a perceiver currently sees — written each frame for the entity's own logic to read.", doc: 'gameplay/ai/perception', anchor: 'components', anchorZh: '组件' },
  PerceptionTarget: { category: 'gameplay', summary: 'Tag: perceivers can see this entity.', doc: 'gameplay/ai/perception', anchor: 'components', anchorZh: '组件' },
  StateMachineAgent: { category: 'gameplay', summary: 'Runs a gameplay state machine asset, calling registry actions as states enter, update and exit.', doc: 'gameplay/ai/state-machines' },
  BehaviorTreeAgent: { category: 'gameplay', summary: 'Ticks a behavior tree asset against a blackboard, calling registry actions at its leaves.', doc: 'gameplay/ai/behavior-trees' },
  ScriptGraphAgent: { category: 'gameplay', summary: 'Runs a script graph asset on this entity — events, an exec wire, and data wires between registered names.', doc: 'gameplay/script-graphs' },
  EventBinding: { category: 'gameplay', summary: 'Wires an event on this entity to named actions — gameplay authored in the inspector, with no script.', doc: 'scripting/events', anchor: 'the-eventbinding-component', anchorZh: 'eventbinding-组件' },
  AudioSource: { category: 'gameplay', summary: 'Declarative playback attached to an entity, attenuated by distance when spatial.', doc: 'assets/audio/sources', anchor: 'audiosource', anchorZh: 'audiosource' },
  AudioListener: { category: 'gameplay', summary: 'The ear spatial audio is mixed relative to — usually the camera or the player.', doc: 'assets/audio/sources', anchor: 'audiolistener', anchorZh: 'audiolistener' },
  SoundEventSource: { category: 'gameplay', summary: 'An entity-owned sound event with reproducible variation and shared voice limits.', doc: 'assets/audio/sound-events', anchor: 'soundeventsource', anchorZh: 'soundeventsource' },
  Replicated: { category: 'gameplay', summary: 'Marks an entity the server replicates to every client.', doc: 'scripting/networking/replication', anchor: 'setup', anchorZh: '基本设置' },
  NetGhost: { category: 'gameplay', summary: 'Tag: this entity is a client-side proxy of one the server owns.', doc: 'scripting/networking/replication', anchor: 'setup', anchorZh: '基本设置' },
  Persistent: { category: 'gameplay', summary: 'Marks an entity a server keeps across restarts, under its `key` in the store (`esengine/persist`).', doc: 'scripting/networking/persistence', anchor: 'players-and-the-world', anchorZh: '玩家与世界' },
};
