import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { SettingsItemType, SettingsSectionDescriptor, SettingsItemDescriptor } from '../settings/SettingsRegistry';
import { getSettingsValue, setSettingsValue } from '../settings/SettingsRegistry';
import { SETTINGS_SECTION, SETTINGS_ITEM } from '../container/tokens';

export const aiSettingsPlugin: EditorPlugin = {
    name: 'ai-settings',
    register(ctx: EditorPluginContext) {
        const registerSection = (d: SettingsSectionDescriptor) => ctx.registrar.provide(SETTINGS_SECTION, d.id, d);
        const registerItem = (d: SettingsItemDescriptor) => ctx.registrar.provide(SETTINGS_ITEM, d.id, d);

        registerSection({ id: 'ai', title: 'AI', icon: 'zap', order: 8 });

        registerItem({
            id: 'ai.claudeBaseUrl',
            section: 'ai',
            label: 'API Base URL',
            description: 'Custom API endpoint (leave empty for official Anthropic API)',
            type: 'string',
            defaultValue: '',
            order: 0,
        });

        registerItem({
            id: 'ai.claudeApiKey',
            section: 'ai',
            label: 'Claude API Key',
            description: 'Anthropic API key or relay service key',
            type: 'custom' as SettingsItemType,
            defaultValue: '',
            order: 1,
            render: (container: HTMLElement) => renderPasswordInput(container, 'ai.claudeApiKey'),
        });

        registerItem({
            id: 'ai.claudeModel',
            section: 'ai',
            label: 'Claude Model',
            description: 'Model name (editable for relay services with custom model names)',
            type: 'string',
            defaultValue: 'claude-sonnet-4-20250514',
            order: 2,
        });

        registerItem({
            id: 'ai.imageModel',
            section: 'ai',
            label: 'Image Model',
            description: 'Image generation model name',
            type: 'string',
            defaultValue: 'gpt-5.4-nano',
            order: 3,
        });

        registerItem({
            id: 'ai.imageProvider',
            section: 'ai',
            label: 'Image Provider',
            type: 'select',
            defaultValue: 'openai',
            order: 4,
            options: [
                { label: 'Stability AI', value: 'stability' },
                { label: 'OpenAI', value: 'openai' },
            ],
        });

        registerItem({
            id: 'ai.imageApiKey',
            section: 'ai',
            label: 'Image API Key',
            description: 'API key for the selected image generation provider',
            type: 'custom' as SettingsItemType,
            defaultValue: '',
            order: 5,
            render: (container: HTMLElement) => renderPasswordInput(container, 'ai.imageApiKey'),
        });
    },
};

function renderPasswordInput(container: HTMLElement, settingId: string): () => void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const input = document.createElement('input');
    input.type = 'password';
    input.value = (getSettingsValue(settingId) as string) ?? '';
    input.placeholder = 'Enter API key...';
    input.style.cssText = 'flex:1;padding:4px 8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;font-size:12px;font-family:inherit;';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Show';
    toggleBtn.style.cssText = 'padding:4px 8px;background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:11px;';
    toggleBtn.addEventListener('click', () => {
        if (input.type === 'password') {
            input.type = 'text';
            toggleBtn.textContent = 'Hide';
        } else {
            input.type = 'password';
            toggleBtn.textContent = 'Show';
        }
    });

    input.addEventListener('change', () => {
        setSettingsValue(settingId, input.value);
    });

    wrapper.appendChild(input);
    wrapper.appendChild(toggleBtn);
    container.appendChild(wrapper);

    return () => {
        wrapper.remove();
    };
}
