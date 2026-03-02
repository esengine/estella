import { describe, it, expect } from 'vitest';
import { PLAYABLE_HTML_TEMPLATE } from '../builder/templates';

describe('Playable HTML Template — multi-scene support', () => {
    it('template contains __SCENES__ variable instead of __SCENE__', () => {
        expect(PLAYABLE_HTML_TEMPLATE).toContain('var __SCENES__={{SCENES_DATA}}');
        expect(PLAYABLE_HTML_TEMPLATE).not.toContain('var __SCENE__=');
    });

    it('template passes scenes and firstScene to initPlayableRuntime', () => {
        expect(PLAYABLE_HTML_TEMPLATE).toContain("scenes:__SCENES__,firstScene:'{{STARTUP_SCENE}}'");
        expect(PLAYABLE_HTML_TEMPLATE).not.toContain('sceneData:');
        expect(PLAYABLE_HTML_TEMPLATE).not.toContain('sceneName:');
    });

    it('template placeholders are replaced correctly for multi-scene', () => {
        const scenes = [
            { name: 'main', data: '{"entities":[]}' },
            { name: 'level1', data: '{"entities":[{"id":1}]}' },
        ];
        const startupScene = 'main';

        const scenesDataStr = `[${scenes.map(s => `{name:${JSON.stringify(s.name)},data:${s.data}}`).join(',')}]`;

        const html = PLAYABLE_HTML_TEMPLATE
            .replace('{{SCENES_DATA}}', scenesDataStr)
            .replace('{{STARTUP_SCENE}}', startupScene)
            .replace('{{WASM_SDK}}', '')
            .replace('{{SPINE_SCRIPT}}', '')
            .replace('{{PHYSICS_SCRIPT}}', '')
            .replace('{{GAME_CODE}}', '')
            .replace('{{ASSETS_MAP}}', '{}')
            .replace('{{PHYSICS_CONFIG}}', '{}')
            .replace('{{MANIFEST}}', 'null')
            .replace('{{RUNTIME_CONFIG}}', '')
            .replace('{{RUNTIME_APP_CONFIG}}', '')
            .replace('{{CTA_STYLE}}', '')
            .replace('{{CTA_HTML}}', '')
            .replace('{{CTA_SCRIPT}}', '')
            .replace('{{CTA_SHOW}}', '');

        expect(html).toContain(`var __SCENES__=[{name:"main",data:{"entities":[]}},{name:"level1",data:{"entities":[{"id":1}]}}]`);
        expect(html).toContain("firstScene:'main'");
        expect(html).not.toContain('{{');
    });
});
