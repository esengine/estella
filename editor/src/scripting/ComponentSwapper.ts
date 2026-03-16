import { unregisterComponent } from 'esengine';
import { clearScriptComponents } from '../schemas/ComponentSchemas';
import {
    extractComponentDefs,
    registerComponentEntries,
    type ComponentDefEntry,
    type ScriptContent,
} from './componentExtraction';

export type { ScriptContent };

interface PreparedResult {
    entries: ComponentDefEntry[];
    sourceMap: Map<string, string>;
}

export class ComponentSwapper {
    private pending_: PreparedResult | null = null;

    prepare(scripts: ScriptContent[]): void {
        const entries: ComponentDefEntry[] = [];
        const sourceMap = new Map<string, string>();

        for (const { path, content } of scripts) {
            for (const entry of extractComponentDefs(content)) {
                entries.push(entry);
                sourceMap.set(entry.name, path);
            }
        }

        this.pending_ = { entries, sourceMap };
    }

    swap(): void {
        if (!this.pending_) return;

        const prevSourceMap = window.__esengine_componentSourceMap;
        if (prevSourceMap) {
            for (const name of prevSourceMap.keys()) {
                unregisterComponent(name);
            }
        }
        clearScriptComponents();

        registerComponentEntries(this.pending_.entries);

        window.__esengine_componentSourceMap = this.pending_.sourceMap;
        this.pending_ = null;
    }

    discard(): void {
        this.pending_ = null;
    }
}
