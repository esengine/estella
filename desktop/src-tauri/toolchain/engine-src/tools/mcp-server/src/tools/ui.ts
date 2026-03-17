import { z } from 'zod';
import type { BridgeClient } from '../bridge.js';

const colorSchema = z.object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1).optional(),
}).describe('Color {r,g,b,a} each 0-1');

const parentSchema = z.union([z.number(), z.string()]).optional()
    .describe('Parent entity ID or name (auto-parented under Canvas for UI)');

function ok(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

interface TemplateResult {
    ok: boolean;
    entityId: number;
}

const FALLBACK_TEMPLATES: Record<string, { components: Array<{ type: string; data?: Record<string, unknown> }> }> = {
    Text: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Text' }] },
    Image: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }] },
    Panel: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'Mask' }] },
    Button: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'Interactable' }] },
    TextInput: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'TextInput' }] },
    Toggle: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'Toggle' }] },
    Slider: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Slider' }] },
    ProgressBar: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'ProgressBar' }] },
    ScrollView: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'ScrollView' }] },
    Dropdown: { components: [{ type: 'Transform' }, { type: 'UIRect' }, { type: 'Image' }, { type: 'Dropdown' }] },
};

let templateApiSupported: boolean | null = null;

async function instantiate(
    bridge: BridgeClient,
    template: string,
    parent: number | string | undefined,
    overrides?: Record<string, Record<string, unknown>>,
): Promise<TemplateResult> {
    if (templateApiSupported !== false) {
        try {
            const result = await bridge.post('/ui/create', { template, parent, overrides }) as TemplateResult;
            templateApiSupported = true;
            return result;
        } catch (e) {
            if (templateApiSupported === true) throw e;
            templateApiSupported = false;
        }
    }

    const fallback = FALLBACK_TEMPLATES[template];
    if (!fallback) throw new Error(`Unknown UI template: ${template}`);

    const components = fallback.components.map(c => {
        const data = overrides?.[c.type];
        return data ? { type: c.type, data } : { type: c.type };
    });

    const result = await bridge.post('/scene/create-entity', {
        name: template,
        parent,
        components,
    }) as TemplateResult;
    return result;
}

export function registerUITools(
    server: { tool: Function },
    bridge: BridgeClient,
): void {

    server.tool(
        'create_text',
        'Create a UI text label (auto-parented under Canvas)',
        {
            parent: parentSchema,
            text: z.string().optional().describe('Text content'),
            fontSize: z.number().optional().describe('Font size (default: 24)'),
            color: colorSchema.optional().describe('Text color'),
            align: z.enum(['left', 'center', 'right']).optional(),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            const textOverrides: Record<string, unknown> = {};
            if (args.text != null) textOverrides.content = args.text;
            if (args.fontSize != null) textOverrides.fontSize = args.fontSize;
            if (args.color) textOverrides.color = args.color;
            if (args.align) {
                const map: Record<string, number> = { left: 0, center: 1, right: 2 };
                textOverrides.align = map[args.align as string] ?? 0;
            }
            if (Object.keys(textOverrides).length) overrides.Text = textOverrides;

            const rectOverrides: Record<string, unknown> = {};
            if (args.width != null || args.height != null) {
                rectOverrides.size = { x: (args.width as number) ?? 100, y: (args.height as number) ?? 100 };
            }
            if (Object.keys(rectOverrides).length) overrides.UIRect = rectOverrides;

            const result = await instantiate(bridge, 'Text', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_image',
        'Create a UI image element (auto-parented under Canvas)',
        {
            parent: parentSchema,
            color: colorSchema.optional().describe('Tint color'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.color) overrides.Image = { color: args.color };
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 100, y: (args.height as number) ?? 100 } };
            }
            const result = await instantiate(bridge, 'Image', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_panel',
        'Create a UI panel with background and mask (auto-parented under Canvas)',
        {
            parent: parentSchema,
            color: colorSchema.optional().describe('Background color'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.color) overrides.Image = { color: args.color };
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 100, y: (args.height as number) ?? 100 } };
            }
            const result = await instantiate(bridge, 'Panel', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_button',
        'Create a UI button with background and interactable (auto-parented under Canvas)',
        {
            parent: parentSchema,
            color: colorSchema.optional().describe('Background color'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.color) overrides.Image = { color: args.color };
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 160, y: (args.height as number) ?? 40 } };
            }
            const result = await instantiate(bridge, 'Button', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_input_field',
        'Create a UI text input field (auto-parented under Canvas)',
        {
            parent: parentSchema,
            placeholder: z.string().optional().describe('Placeholder text'),
            value: z.string().optional().describe('Initial value'),
            fontSize: z.number().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            const inputOverrides: Record<string, unknown> = {};
            if (args.placeholder != null) inputOverrides.placeholder = args.placeholder;
            if (args.value != null) inputOverrides.value = args.value;
            if (args.fontSize != null) inputOverrides.fontSize = args.fontSize;
            if (Object.keys(inputOverrides).length) overrides.TextInput = inputOverrides;
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 200, y: (args.height as number) ?? 36 } };
            }
            const result = await instantiate(bridge, 'TextInput', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_toggle',
        'Create a UI toggle/checkbox with checkmark child (auto-parented under Canvas)',
        {
            parent: parentSchema,
            isOn: z.boolean().optional().describe('Initial state (default: true)'),
            size: z.number().optional().describe('Toggle box size (default: 24)'),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.isOn != null) overrides.Toggle = { isOn: args.isOn };
            if (args.size != null) {
                const s = args.size as number;
                overrides.UIRect = { size: { x: s, y: s } };
            }
            const result = await instantiate(bridge, 'Toggle', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_slider',
        'Create a UI slider with fill bar and handle child entities (auto-parented under Canvas)',
        {
            parent: parentSchema,
            value: z.number().optional().describe('Initial value (default: 0.5)'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.value != null) overrides.Slider = { value: args.value };
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 200, y: (args.height as number) ?? 20 } };
            }
            const result = await instantiate(bridge, 'Slider', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_progress_bar',
        'Create a UI progress bar with fill child entity (auto-parented under Canvas)',
        {
            parent: parentSchema,
            value: z.number().optional().describe('Progress 0-1 (default: 0.5)'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            if (args.value != null) overrides.ProgressBar = { value: args.value };
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 200, y: (args.height as number) ?? 20 } };
            }
            const result = await instantiate(bridge, 'ProgressBar', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_scroll_view',
        'Create a scrollable UI container with viewport and content child (auto-parented under Canvas)',
        {
            parent: parentSchema,
            width: z.number().optional(),
            height: z.number().optional(),
            horizontal: z.boolean().optional().describe('Enable horizontal scroll'),
            vertical: z.boolean().optional().describe('Enable vertical scroll (default: true)'),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            const svOverrides: Record<string, unknown> = {};
            if (args.horizontal != null) svOverrides.horizontalEnabled = args.horizontal;
            if (args.vertical != null) svOverrides.verticalEnabled = args.vertical;
            if (Object.keys(svOverrides).length) overrides.ScrollView = svOverrides;
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 300, y: (args.height as number) ?? 200 } };
            }
            const result = await instantiate(bridge, 'ScrollView', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );

    server.tool(
        'create_dropdown',
        'Create a UI dropdown/select with label and list children (auto-parented under Canvas)',
        {
            parent: parentSchema,
            options: z.array(z.string()).optional().describe('Option labels'),
            selectedIndex: z.number().optional().describe('Initially selected index'),
            width: z.number().optional(),
            height: z.number().optional(),
        },
        async (args: Record<string, unknown>) => {
            const overrides: Record<string, Record<string, unknown>> = {};
            const ddOverrides: Record<string, unknown> = {};
            if (args.options) ddOverrides.options = args.options;
            if (args.selectedIndex != null) ddOverrides.selectedIndex = args.selectedIndex;
            if (Object.keys(ddOverrides).length) overrides.Dropdown = ddOverrides;
            if (args.width != null || args.height != null) {
                overrides.UIRect = { size: { x: (args.width as number) ?? 160, y: (args.height as number) ?? 32 } };
            }
            const result = await instantiate(bridge, 'Dropdown', args.parent as any, overrides);
            return ok(JSON.stringify(result));
        },
    );
}
