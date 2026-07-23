import type { Entity, TextInputHandle } from 'esengine';

export const state = {
    /** The editable markup source. */
    input: null as TextInputHandle | null,
    /** The rich Text whose content mirrors the input, re-rendered on every edit. */
    preview: null as Entity | null,
    built: false,
};
