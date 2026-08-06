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
  Transform: { category: 'core', summary: 'Position, rotation and scale — plus the read-only world-space values the engine composes down the parent chain.', doc: 'core-concepts/transforms', anchor: 'the-transform-component', anchorZh: 'transform-组件' },
  Parent: { category: 'core', summary: 'The entity this one hangs under. The engine keeps it and `Children` in step; set it through the hierarchy API.', doc: 'core-concepts/transforms', anchor: 'parenting--hierarchy', anchorZh: '父子层级' },
  Children: { category: 'core', summary: "The entity's children, maintained by the engine alongside `Parent`. Its order is the order children draw in.", doc: 'core-concepts/transforms', anchor: 'parenting--hierarchy', anchorZh: '父子层级' },
  Name: { category: 'core', summary: "The entity's display name — what the World Outliner shows and what name lookups resolve against.", doc: 'core-concepts/components', anchor: 'the-ones-the-engine-reads-about-your-entities', anchorZh: '引擎用来描述实体的那几个' },
  Velocity: { category: 'core', summary: 'Constant linear and angular motion applied every frame, with no physics body involved.', doc: 'scripting/overview', anchor: 'constant-motion-the-velocity-component', anchorZh: '匀速运动velocity-组件' },
  SceneOwner: { category: 'core', summary: 'Which additively-loaded scene owns the entity, and whether it survives that scene being unloaded.', doc: 'world/scenes', anchor: 'persistent-entities', anchorZh: '持久化实体' },
  Disabled: { category: 'core', summary: 'Tag added by `setEntityActive(false)`: an entity counts as active exactly while it is absent.', doc: 'core-concepts/components', anchor: 'the-ones-the-engine-reads-about-your-entities', anchorZh: '引擎用来描述实体的那几个' },
  RuntimeOnly: { category: 'core', summary: 'Tag for a world-only derived entity (the layers a `Tilemap` projects, runtime tile colliders). Scene saves skip it, because persisting one would duplicate it against the next derivation.', doc: 'core-concepts/components', anchor: 'the-ones-the-engine-reads-about-your-entities', anchorZh: '引擎用来描述实体的那几个' },

  // ── Graphics ───────────────────────────────────────────────────────────────
  Sprite: { category: 'graphics', summary: 'Draws a texture in the world — tint, size, pivot, sorting layer, flipping, tiling and parallax.', doc: 'graphics/sprites', anchor: 'sprite-fields', anchorZh: 'sprite-字段' },
  BitmapText: { category: 'graphics', summary: 'Text drawn in world space from a bitmap font, sorted alongside sprites (UI text is `Text`).', doc: 'graphics/sprites', anchor: 'bitmap-text-in-the-world', anchorZh: '世界空间位图文字' },
  ShapeRenderer: { category: 'graphics', summary: 'A filled or stroked primitive — rectangle, circle, capsule — with no texture asset.', doc: 'graphics/sprites', anchor: 'shapes-without-a-texture', anchorZh: '不带纹理的图元' },
  TrailRenderer: { category: 'graphics', summary: 'A ribbon trailing the entity as it moves, tapering and fading over its lifetime.', doc: 'graphics/sprites', anchor: 'motion-trails', anchorZh: '拖尾' },
  CacheAsBitmap: { category: 'graphics', summary: 'Renders an expensive subtree once into a texture and reuses it until marked dirty.', doc: 'graphics/sprites', anchor: 'cache-as-bitmap', anchorZh: '位图缓存cache-as-bitmap' },
  Camera: { category: 'graphics', summary: 'A view onto the world — projection, zoom, viewport rect, clear flags and render priority.', doc: 'graphics/camera', anchor: 'the-camera-component', anchorZh: 'camera-组件' },
  FollowTarget: { category: 'graphics', summary: 'Makes a camera chase an entity, with an offset, a dead zone and eased catch-up.', doc: 'graphics/camera', anchor: 'follow-a-target', anchorZh: '跟随目标' },
  Canvas: { category: 'graphics', summary: 'The design resolution and scale mode a scene is authored against — one per scene root.', doc: 'core-concepts/screen', anchor: 'the-canvas-component', anchorZh: 'canvas-组件' },
  Light2D: { category: 'graphics', summary: 'A 2D light — point, directional, spot or ambient — that lit renderers and Lit2D materials receive.', doc: 'graphics/lighting', anchor: 'light-types', anchorZh: '光源类型' },
  ShadowCaster2D: { category: 'graphics', summary: 'Marks a renderer as an occluder, so 2D lights cast shadows from its silhouette.', doc: 'graphics/lighting', anchor: 'casting-shadows', anchorZh: '投射阴影' },
  PostProcessVolume: { category: 'graphics', summary: 'A stack of full-screen effects (bloom, vignette, colour grading) applied after the scene is drawn.', doc: 'graphics/post-processing', anchor: 'using-a-postprocessvolume', anchorZh: '使用-postprocessvolume' },
  Mesh2D: { category: 'graphics', summary: 'Arbitrary 2D geometry — your own vertices, indices and material — drawn like any other renderer.', doc: 'graphics/drawing', anchor: 'custom-meshes-mesh2d', anchorZh: '自定义网格mesh2d' },
  Video: { category: 'graphics', summary: 'Plays a video stream onto a surface in the world or the UI.', doc: 'graphics/video', anchor: 'the-video-component', anchorZh: 'video-组件' },

  // ── UI ─────────────────────────────────────────────────────────────────────
  UINode: { category: 'ui', summary: 'The UI box: size, position, margins and padding in design pixels. Every UI entity has one.', doc: 'ui/layout', anchor: 'uinode--the-box', anchorZh: 'uinode盒子' },
  UIVisual: { category: 'ui', summary: 'What a UI node actually paints — a colour, a texture, or a nine-sliced sprite.', doc: 'ui/overview', anchor: 'uivisual-and-uimask', anchorZh: 'uivisual-与-uimask' },
  UIMask: { category: 'ui', summary: "Clips descendants to this node's rect, with an optional alpha cutoff.", doc: 'ui/lists', anchor: 'clipping--uimask', anchorZh: '裁剪--uimask' },
  UIScroll: { category: 'ui', summary: 'Scrollable content inside a clipped viewport, with momentum and scrollbars.', doc: 'ui/overview', anchor: 'scrolling', anchorZh: '滚动' },
  FlexContainer: { category: 'ui', summary: 'Lays children out along an axis — direction, justification, alignment, wrapping and gaps.', doc: 'ui/layout', anchor: 'flexcontainer--laying-out-children', anchorZh: 'flexcontainer排布子项' },
  Interactable: { category: 'ui', summary: 'Makes a UI node hit-testable, so pointer events can land on it.', doc: 'ui/interaction', anchor: 'hit-testing-interactable--uiinteraction', anchorZh: '命中测试interactable--uiinteraction' },
  UIInteraction: { category: 'ui', summary: "Live pointer state for an interactable node — hovered, pressed, and the frame's transitions.", doc: 'ui/interaction', anchor: 'hit-testing-interactable--uiinteraction', anchorZh: '命中测试interactable--uiinteraction' },
  Text: { category: 'ui', summary: 'UI text — font, size, alignment, colour, outline, shadow, rich-text markup and a localization key.', doc: 'ui/text', anchor: 'text-properties', anchorZh: 'text-属性' },
  TextInput: { category: 'ui', summary: 'An editable text field with a caret, selection and IME support.', doc: 'ui/widgets', anchor: 'text-input', anchorZh: '文本输入' },
  Draggable: { category: 'ui', summary: 'Lets the pointer drag a UI node, optionally constrained to an axis.', doc: 'ui/interaction', anchor: 'drag--drop', anchorZh: '拖放' },
  DragState: { category: 'ui', summary: 'Transient per-frame geometry of a drag in progress; the drag system rebuilds it, scene saves omit it.', doc: 'ui/interaction', anchor: 'drag--drop', anchorZh: '拖放' },
  Focusable: { category: 'ui', summary: 'Puts a widget in the keyboard focus order.', doc: 'ui/interaction', anchor: 'focus--keyboard', anchorZh: '焦点与键盘' },
  SafeArea: { category: 'ui', summary: 'Insets an absolute UI node clear of notches and rounded corners.', doc: 'core-concepts/screen', anchor: 'safe-areas-notches--rounded-corners', anchorZh: '安全区刘海与圆角' },
  ThemeStyle: { category: 'ui', summary: "Records which theme role an entity's colours came from, so a live theme swap can repaint it.", doc: 'ui/theming', anchor: 'how-widgets-consume-tokens', anchorZh: '控件如何消费令牌' },
  UIController: { category: 'ui', summary: 'Shared named page state a whole subtree switches on — no bespoke per-widget state.', doc: 'ui/controllers', anchor: 'controllers', anchorZh: '控制器' },
  UIGear: { category: 'ui', summary: 'Per-page field values a controller drives declaratively, authored from the Details panel.', doc: 'ui/controllers', anchor: 'gears', anchorZh: '属性绑定' },
  UIDialog: { category: 'ui', summary: 'A modal dialog surface — backdrop, result, and open/close state.', doc: 'ui/widgets', anchor: 'dialog', anchorZh: 'dialog-对话框' },
  UIDropdown: { category: 'ui', summary: 'A dropdown selector: its options and the selected index.', doc: 'ui/widgets', anchor: 'dropdown', anchorZh: 'dropdown-下拉框' },
  UISlider: { category: 'ui', summary: 'A draggable value along a range, with an optional step.', doc: 'ui/widgets', anchor: 'slider', anchorZh: 'slider-滑块' },
  UIToggle: { category: 'ui', summary: 'A two-state widget — checkbox or switch — and its group membership.', doc: 'ui/widgets', anchor: 'toggle', anchorZh: 'toggle-开关' },

  // ── Physics ────────────────────────────────────────────────────────────────
  RigidBody: { category: 'physics', summary: 'Puts the entity under the solver: static, kinematic or dynamic, with damping, gravity scale and sleep.', doc: 'gameplay/physics', anchor: 'rigidbody', anchorZh: 'rigidbody' },
  BoxCollider: { category: 'physics', summary: 'A rectangular collision shape. Sizes are in **metres**, not pixels.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  CircleCollider: { category: 'physics', summary: 'A circular collision shape. Radius is in **metres**.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  CapsuleCollider: { category: 'physics', summary: 'A capsule collision shape — the usual choice for a character body.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  SegmentCollider: { category: 'physics', summary: 'A single line segment — a one-sided wall or edge.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  PolygonCollider: { category: 'physics', summary: 'A convex polygon collision shape from your own points.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  ChainCollider: { category: 'physics', summary: 'A polyline of edges — open or looped — for static terrain.', doc: 'gameplay/physics', anchor: 'colliders', anchorZh: '碰撞体' },
  CharacterController: { category: 'physics', summary: 'Kinematic character movement that slides along walls, climbs slopes and reports ground contact.', doc: 'gameplay/physics', anchor: 'character-controller', anchorZh: '角色控制器' },
  OneWayPlatform: { category: 'physics', summary: 'Makes a collider solid from one side only, so a body passes up through it and lands on top.', doc: 'gameplay/physics', anchor: 'one-way-platforms', anchorZh: '单向平台' },
  DistanceJoint: { category: 'physics', summary: 'Holds two bodies a fixed (or spring-limited) distance apart.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },
  RevoluteJoint: { category: 'physics', summary: 'Pins two bodies at a point and lets them rotate — a hinge, with optional limits and a motor.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },
  PrismaticJoint: { category: 'physics', summary: 'Constrains two bodies to slide along one axis — a piston or lift.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },
  WeldJoint: { category: 'physics', summary: 'Locks two bodies rigidly together, with optional spring give.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },
  MotorJoint: { category: 'physics', summary: 'Drives one body toward a target offset and angle — moving platforms and conveyors.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },
  WheelJoint: { category: 'physics', summary: 'A suspension axis plus a spinning axle — the wheel half of a vehicle.', doc: 'gameplay/physics', anchor: 'joints', anchorZh: '关节' },

  // ── Animation ──────────────────────────────────────────────────────────────
  Animator: { category: 'animation', summary: 'Runs an animator controller — states, transitions and blend trees — over the entity.', doc: 'animation/overview', anchor: 'animator-state-machine', anchorZh: '动画状态机' },
  SpriteAnimator: { category: 'animation', summary: 'Plays a flipbook clip by swapping the sprite frame, with speed, looping and frame events.', doc: 'animation/overview', anchor: 'sprite-animation', anchorZh: '精灵动画' },
  TimelinePlayer: { category: 'animation', summary: 'Plays a timeline asset — keyframed tracks across many entities — with wrap modes and playback control.', doc: 'animation/timeline', anchor: 'attach-a-timeline', anchorZh: '附加时间轴' },
  SpineAnimation: { category: 'animation', summary: 'A Spine skeleton: its skeleton and atlas assets, current animation, skin and mix settings.', doc: 'animation/spine', anchor: 'the-spineanimation-component', anchorZh: 'spineanimation-组件' },
  DragonBonesAnimation: { category: 'animation', summary: 'A DragonBones armature: its skeleton and atlas assets, armature choice and playback state.', doc: 'animation/dragonbones', anchor: 'the-dragonbonesanimation-component', anchorZh: 'dragonbonesanimation-组件' },

  // ── World ──────────────────────────────────────────────────────────────────
  Tilemap: { category: 'world', summary: 'A Tiled map asset projected into the scene; the engine derives one layer entity per map layer.', doc: 'world/tilemaps', anchor: 'load-a-tiled-map', anchorZh: '加载-tiled-地图' },
  TilemapLayer: { category: 'world', summary: 'One layer of tiles — its tileset, cell size, orientation, sorting and collision.', doc: 'world/tilemaps', anchor: 'the-tilemaplayer-component', anchorZh: 'tilemaplayer-组件' },
  ParticleEmitter: { category: 'world', summary: 'A particle system: emission, lifetime, shape, forces, noise, colour and size over life, sub-emitters and trails.', doc: 'world/particles', anchor: 'particleemitter-reference', anchorZh: 'particleemitter-字段参考' },
  ParticleForceField: { category: 'world', summary: 'A field that pushes particles around — point, directional, vortex or drag.', doc: 'world/particles', anchor: 'force-fields', anchorZh: '力场' },
  Marker: { category: 'world', summary: 'A named point or region of gameplay interest — spawn point, waypoint, trigger zone — queryable like any component.', doc: 'gameplay/markers', anchor: 'marker-component-reference', anchorZh: 'marker-组件参考' },

  // ── Gameplay ───────────────────────────────────────────────────────────────
  NavAgent: { category: 'gameplay', summary: 'Steers an entity along a path found on the navigation grid.', doc: 'gameplay/ai/navigation' },
  Perceiver: { category: 'gameplay', summary: 'Senses nearby perception targets within a sight cone and range.', doc: 'gameplay/ai/perception' },
  Perception: { category: 'gameplay', summary: "What a perceiver currently sees — written each frame for the entity's own logic to read.", doc: 'gameplay/ai/perception' },
  PerceptionTarget: { category: 'gameplay', summary: 'Tag: perceivers can see this entity.', doc: 'gameplay/ai/perception' },
  StateMachineAgent: { category: 'gameplay', summary: 'Runs a gameplay state machine asset, calling registry actions as states enter, update and exit.', doc: 'gameplay/ai/state-machines' },
  BehaviorTreeAgent: { category: 'gameplay', summary: 'Ticks a behavior tree asset against a blackboard, calling registry actions at its leaves.', doc: 'gameplay/ai/behavior-trees' },
  EventBinding: { category: 'gameplay', summary: 'Wires an event on this entity to named actions — gameplay authored in the inspector, with no script.', doc: 'scripting/events', anchor: 'the-data', anchorZh: '数据本身' },
  AudioSource: { category: 'gameplay', summary: 'Declarative playback attached to an entity, attenuated by distance when spatial.', doc: 'assets/audio', anchor: 'declarative-playback--audiosource', anchorZh: '声明式播放--audiosource' },
  AudioListener: { category: 'gameplay', summary: 'The ear spatial audio is mixed relative to — usually the camera or the player.', doc: 'assets/audio', anchor: 'spatial-audio', anchorZh: '空间音频' },
  Replicated: { category: 'gameplay', summary: 'Marks an entity the server replicates to every client.', doc: 'scripting/networking', anchor: 'state-replication--multiplayer-entities', anchorZh: '状态复制多人实体同步' },
  NetGhost: { category: 'gameplay', summary: 'Tag: this entity is a client-side proxy of one the server owns.', doc: 'scripting/networking', anchor: 'state-replication--multiplayer-entities', anchorZh: '状态复制多人实体同步' },
};
