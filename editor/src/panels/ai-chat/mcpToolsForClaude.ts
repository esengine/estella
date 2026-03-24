interface ToolParam {
    type: string;
    description: string;
    enum?: string[];
}

interface ToolDef {
    snake: string;
    description: string;
    properties: Record<string, ToolParam>;
    required?: string[];
}

const SNAKE_TO_CAMEL: Record<string, string> = {};
const CAMEL_TO_SNAKE: Record<string, string> = {};

function registerMapping(snake: string, camel: string): void {
    SNAKE_TO_CAMEL[snake] = camel;
    CAMEL_TO_SNAKE[camel] = snake;
}

function snakeToCamel(s: string): string {
    return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const TOOL_DEFS: ToolDef[] = [
    { snake: 'get_scene_tree', description: 'Get the scene hierarchy tree', properties: { depth: { type: 'integer', description: 'Max depth to traverse' } } },
    { snake: 'get_entity_data', description: 'Get all component data for an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name (alternative to ID)' } } },
    { snake: 'find_entities', description: 'Search entities by name or component type', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    { snake: 'get_selection', description: 'Get currently selected entities and asset', properties: {} },
    { snake: 'create_entity', description: 'Create a new entity', properties: { name: { type: 'string', description: 'Entity name' }, parent: { type: 'string', description: 'Parent entity name or ID' }, components: { type: 'array', description: 'Components to add: [{type, data}]' } } },
    { snake: 'delete_entity', description: 'Delete an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' } } },
    { snake: 'rename_entity', description: 'Rename an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Current entity name' }, new_name: { type: 'string', description: 'New name' } }, required: ['new_name'] },
    { snake: 'reparent_entity', description: 'Move entity under a new parent', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' }, new_parent: { type: 'string', description: 'New parent name or ID or null' } } },
    { snake: 'add_component', description: 'Add a component to an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' }, component: { type: 'string', description: 'Component type name' }, data: { type: 'object', description: 'Initial component data' } }, required: ['component'] },
    { snake: 'remove_component', description: 'Remove a component from an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' }, component: { type: 'string', description: 'Component type' } }, required: ['component'] },
    { snake: 'set_property', description: 'Set a component property value', properties: { entity: { type: 'string', description: 'Entity name or ID' }, component: { type: 'string', description: 'Component type' }, field: { type: 'string', description: 'Property field name' }, value: { type: 'string', description: 'New value (any JSON type)' } }, required: ['entity', 'component', 'field', 'value'] },
    { snake: 'select_entity', description: 'Select an entity in the editor', properties: { entity: { type: 'string', description: 'Entity name or ID' } }, required: ['entity'] },
    { snake: 'duplicate_entity', description: 'Duplicate an entity', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' } } },
    { snake: 'toggle_entity_visibility', description: 'Toggle entity visibility', properties: { id: { type: 'integer', description: 'Entity ID' }, name: { type: 'string', description: 'Entity name' } } },
    { snake: 'list_components', description: 'List all available component types', properties: {} },
    { snake: 'get_component_schema', description: 'Get schema and defaults for a component type', properties: { name: { type: 'string', description: 'Component type name' } }, required: ['name'] },
    { snake: 'list_assets', description: 'List project assets, optionally filtered by type', properties: { type: { type: 'string', description: 'Asset type filter' } } },
    { snake: 'get_asset_info', description: 'Get asset details by UUID or path', properties: { uuid: { type: 'string', description: 'Asset UUID' }, path: { type: 'string', description: 'Asset relative path' } } },
    { snake: 'create_asset', description: 'Create a new asset file. For anim-clip, pass content as JSON string with frames referencing texture UUIDs.', properties: { type: { type: 'string', description: 'Asset type: material, scene, shader, anim-clip, timeline, bitmap-font' }, name: { type: 'string', description: 'File name' }, dir: { type: 'string', description: 'Directory relative to project root' }, content: { type: 'string', description: 'Custom file content (JSON string). Overrides default template.' } }, required: ['type', 'name'] },
    { snake: 'delete_asset', description: 'Delete an asset', properties: { uuid: { type: 'string', description: 'Asset UUID' }, path: { type: 'string', description: 'Asset path' } } },
    { snake: 'create_script', description: 'Create a new TypeScript script file', properties: { name: { type: 'string', description: 'Script name' }, content: { type: 'string', description: 'Script content' }, dir: { type: 'string', description: 'Directory relative to project root' } }, required: ['name'] },
    { snake: 'instantiate_template', description: 'Create entity from a built-in template (e.g. button, slider, panel)', properties: { template: { type: 'string', description: 'Template name' }, parent: { type: 'string', description: 'Parent entity' }, overrides: { type: 'object', description: 'Property overrides: {ComponentType: {field: value}}' } }, required: ['template'] },
    { snake: 'instantiate_prefab', description: 'Instantiate a prefab from path', properties: { path: { type: 'string', description: 'Prefab asset path' }, parent: { type: 'string', description: 'Parent entity' } }, required: ['path'] },
    { snake: 'save_scene', description: 'Save the current scene', properties: {} },
    { snake: 'new_scene', description: 'Create a new empty scene', properties: { force: { type: 'boolean', description: 'Skip save confirmation' } } },
    { snake: 'open_scene', description: 'Open a scene file', properties: { path: { type: 'string', description: 'Scene file path' } }, required: ['path'] },
    { snake: 'toggle_play_mode', description: 'Toggle between Edit and Play mode', properties: {} },
    { snake: 'undo', description: 'Undo last action', properties: {} },
    { snake: 'redo', description: 'Redo last undone action', properties: {} },
    { snake: 'get_scene_metadata', description: 'Get scene name, entity count, design resolution', properties: {} },
    { snake: 'generate_sprite', description: 'Generate a single sprite image using AI. For animations, call this multiple times with different pose descriptions to get individual frames. Returns {ok, path, uuid}.', properties: { prompt: { type: 'string', description: 'Image generation prompt — describe ONE pose/frame' }, filename: { type: 'string', description: 'Output filename (default: auto-generated)' }, width: { type: 'integer', description: 'Image width in pixels' }, height: { type: 'integer', description: 'Image height in pixels' } }, required: ['prompt'] },
];

for (const def of TOOL_DEFS) {
    const camel = snakeToCamel(def.snake);
    registerMapping(def.snake, camel);
}

export function getToolsClaude(): unknown[] {
    return TOOL_DEFS.map(def => ({
        name: def.snake,
        description: def.description,
        input_schema: {
            type: 'object',
            properties: def.properties,
            ...(def.required ? { required: def.required } : {}),
        },
    }));
}

export function getToolsOpenAI(): unknown[] {
    return TOOL_DEFS.map(def => ({
        type: 'function',
        function: {
            name: def.snake,
            description: def.description,
            parameters: {
                type: 'object',
                properties: def.properties,
                ...(def.required ? { required: def.required } : {}),
            },
        },
    }));
}

export function getToolsSystemPrompt(): string {
    const toolDescriptions = TOOL_DEFS.map(def => {
        const params = Object.entries(def.properties).map(([k, v]) => {
            const req = def.required?.includes(k) ? ' (required)' : '';
            return `    - ${k}: ${v.type} — ${v.description}${req}`;
        }).join('\n');
        return `- **${def.snake}**: ${def.description}${params ? '\n' + params : ''}`;
    }).join('\n');

    return `You are an Estella game engine editor assistant. You EXECUTE actions using tool calls. NEVER just describe what you would do.

## How to call tools

Output this EXACT format (triple backticks + "tool_call" label are MANDATORY):

\`\`\`tool_call
{"name": "tool_name", "arguments": {"param1": "value1"}}
\`\`\`

- You MUST output tool_call blocks for ANY action. Text alone does NOTHING.
- Output ALL tool calls in your FIRST response. Do not say "I will" then wait.
- Multiple tool_call blocks in one message is OK.
- After I return tool results, continue with more tool_call blocks if needed.

## Engine Reference

### Entity Templates (use with instantiate_template)
General: Sprite, Camera, AudioSource
UI: Canvas, Button, Panel, Image, Toggle, ProgressBar, ScrollView, Slider, Dropdown, Text, TextInput
Physics: BoxCollider, CircleCollider, CapsuleCollider

### Key Components & Properties
- **Transform**: position {x,y,z}, rotation {x,y,z,w}, scale {x,y,z}
- **Sprite**: texture (uuid), color {r,g,b,a}, size {x,y}, layer, flipX, flipY
- **Canvas**: designResolution {x,y}, scaleMode (0=FixedWidth,1=FixedHeight,4=Match)
- **UIRect**: anchorMin/Max {x,y}, offsetMin/Max {x,y}, size {x,y}, pivot {x,y}
- **Text**: content (string), fontSize, color {r,g,b,a}, align (0=Left,1=Center,2=Right), bold, wordWrap
- **Image**: texture, color, imageType (0=Simple,1=Sliced)
- **Button**: state, transition
- **Slider**: value, minValue, maxValue, fillEntity, handleEntity
- **RigidBody**: bodyType, gravityScale, fixedRotation
- **LayoutGroup**: direction, spacing, padding, childAlignment
- **GridLayout**: crossAxisCount, itemSize {x,y}, spacing {x,y}
- **FlexContainer**: direction, wrap, justifyContent, alignItems, gap
- **Interactable**: enabled, raycastTarget

### Scripting (use create_script tool)
\`\`\`typescript
import { defineComponent, defineSystem, Query, Mut, Commands, Res, ResMut, defineResource, defineEvent, EventWriter, EventReader, Schedule } from 'esengine';
import { Transform, Sprite, Input } from 'esengine';

// Custom component
export const MyComp = defineComponent('MyComp', { speed: 5, score: 0 });

// Resource (global state)
const GameState = defineResource({ score: 0, gameOver: false }, 'GameState');

// System — runs every frame
export const moveSystem = defineSystem(
  [Query(Mut(Transform), MyComp), Res(Input)],
  (query, input) => {
    for (const [entity, transform, comp] of query) {
      if (input.isKeyDown('ArrowRight')) transform.position.x += comp.speed;
      if (input.isKeyDown('ArrowLeft')) transform.position.x -= comp.speed;
    }
  }
);

// Input: input.isKeyDown/Pressed/Released(key), input.getMousePosition(), input.isMouseButtonDown(0)
// Commands: cmds.spawn('Name'), cmds.despawn(entity), cmds.insert(entity, Component, data)
// Schedules: Schedule.Startup (once), Schedule.Update (every frame), Schedule.FixedUpdate (physics)
\`\`\`

### Color: {r,g,b,a} range 0-1. White={r:1,g:1,b:1,a:1}, Red={r:1,g:0,b:0,a:1}

### UI Hierarchy Pattern
Canvas (root) → Panel (container with UIRect) → children (Text, Button, Image...)
All UI entities MUST be under a Canvas. Use UIRect for positioning.

### Making a Game — Typical Steps
1. create_entity for Canvas (or use instantiate_template "Canvas")
2. Create UI entities under Canvas using instantiate_template or create_entity+components
3. create_script for game logic (define components, systems, input handling)
4. set_property to configure components
5. save_scene

## Available tools

${toolDescriptions}`;
}

export function toolNameToMethodName(snakeName: string): string {
    return SNAKE_TO_CAMEL[snakeName] ?? snakeToCamel(snakeName);
}

export function convertToolParams(snakeName: string, params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
        result[snakeToCamel(key)] = value;
    }
    return result;
}
