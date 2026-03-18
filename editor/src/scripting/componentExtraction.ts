import { defineComponent, defineTag, getDefaultContext } from 'esengine';

export interface ComponentDefEntry {
    name: string;
    defaults: Record<string, unknown>;
    isTag: boolean;
}

export interface ScriptContent {
    path: string;
    content: string;
}

// =============================================================================
// Component Extraction (pure — no side effects)
// =============================================================================

const DEFINE_COMPONENT_RE = /defineComponent\s*(?:<[^>]*>\s*)?\(\s*['"]([^'"]+)['"]\s*,/g;
const DEFINE_TAG_RE = /defineTag\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractComponentDefs(source: string): ComponentDefEntry[] {
    const entries: ComponentDefEntry[] = [];

    DEFINE_COMPONENT_RE.lastIndex = 0;
    let match;
    while ((match = DEFINE_COMPONENT_RE.exec(source)) !== null) {
        const name = match[1];
        const rest = source.substring(match.index + match[0].length);
        const objStr = extractObjectLiteral(rest);
        if (!objStr) continue;
        try {
            const defaults = safeParseObjectLiteral(objStr);
            if (!defaults) continue;
            entries.push({ name, defaults, isTag: false });
        } catch { /* skip complex expressions */ }
    }

    DEFINE_TAG_RE.lastIndex = 0;
    while ((match = DEFINE_TAG_RE.exec(source)) !== null) {
        entries.push({ name: match[1], defaults: {}, isTag: true });
    }

    return entries;
}

// =============================================================================
// Registration (side-effecting — modifies SDK + editor registries)
// =============================================================================

export function registerComponentEntries(entries: ComponentDefEntry[]): void {
    const bridge = getDefaultContext().editorBridge;

    for (const { name, defaults, isTag } of entries) {
        if (isTag) {
            defineTag(name);
        } else {
            defineComponent(name, defaults);
        }
        bridge?.registerComponent(name, defaults, isTag);
    }
}

// =============================================================================
// Parsing Utilities
// =============================================================================

export function safeParseObjectLiteral(objStr: string): Record<string, unknown> | null {
    try {
        const json = objStr
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/'/g, '"')
            .replace(/(\w+)\s*:/g, '"$1":')
            .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export function extractObjectLiteral(source: string): string | null {
    const trimmed = source.trimStart();
    if (trimmed[0] !== '{') return null;

    let depth = 0;
    let inString = false;
    let quote = '';

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];

        if (inString) {
            if (ch === quote && trimmed[i - 1] !== '\\') inString = false;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            quote = ch;
            continue;
        }

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return trimmed.substring(0, i + 1);
        }
    }

    return null;
}
