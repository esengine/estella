import type { PanelInstance } from '../PanelRegistry';
import { AIChatService, type ToolCallInfo } from './AIChatService';
import { getEditorInstance } from '../../context/EditorContext';
import { convertFileSrc } from '@tauri-apps/api/core';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

const STYLES = `
.ai-chat-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    user-select: text;
    -webkit-user-select: text;
    cursor: default;
}
.ai-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ai-chat-msg {
    padding: 8px 12px;
    border-radius: 6px;
    max-width: 85%;
    line-height: 1.5;
    word-wrap: break-word;
}
.ai-chat-msg--user {
    background: var(--accent-color, #4a9eff);
    color: #fff;
    align-self: flex-end;
    white-space: pre-wrap;
}
.ai-chat-msg--assistant {
    background: var(--bg-secondary);
    align-self: flex-start;
}
.ai-chat-msg--assistant p { margin: 0 0 8px 0; }
.ai-chat-msg--assistant p:last-child { margin-bottom: 0; }
.ai-chat-msg--assistant code {
    background: var(--bg-tertiary, #1e1e1e);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
}
.ai-chat-msg--assistant pre {
    background: var(--bg-tertiary, #1e1e1e);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 4px 0;
}
.ai-chat-msg--assistant pre code {
    background: none;
    padding: 0;
    font-size: 11px;
    line-height: 1.4;
}
.ai-chat-msg--assistant ul, .ai-chat-msg--assistant ol {
    margin: 4px 0;
    padding-left: 20px;
}
.ai-chat-msg--assistant h1, .ai-chat-msg--assistant h2, .ai-chat-msg--assistant h3 {
    margin: 8px 0 4px 0;
    font-size: 13px;
}
.ai-chat-msg--assistant blockquote {
    border-left: 3px solid var(--border-color);
    margin: 4px 0;
    padding: 2px 8px;
    opacity: 0.8;
}
.ai-chat-msg--assistant table {
    border-collapse: collapse;
    margin: 4px 0;
    font-size: 11px;
}
.ai-chat-msg--assistant th, .ai-chat-msg--assistant td {
    border: 1px solid var(--border-color);
    padding: 2px 6px;
}
.ai-chat-msg--tool {
    background: var(--bg-tertiary, #2a2a2a);
    align-self: flex-start;
    font-family: monospace;
    font-size: 11px;
    border-left: 3px solid var(--accent-color, #4a9eff);
    white-space: pre-wrap;
}
.ai-chat-tool-status {
    margin-right: 4px;
}
.ai-chat-input-row {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border-color);
}
.ai-chat-input {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg-input, var(--bg-secondary));
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    resize: none;
    min-height: 32px;
    max-height: 120px;
}
.ai-chat-input:focus {
    outline: none;
    border-color: var(--accent-color, #4a9eff);
}
.ai-chat-send-btn {
    padding: 6px 14px;
    background: var(--accent-color, #4a9eff);
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    align-self: flex-end;
}
.ai-chat-send-btn:hover {
    opacity: 0.9;
}
.ai-chat-send-btn:disabled {
    opacity: 0.5;
    cursor: default;
}
.ai-chat-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
}
.ai-chat-clear-btn {
    padding: 2px 8px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}
.ai-chat-clear-btn:hover {
    background: var(--bg-secondary);
}
.ai-chat-error {
    color: #f44;
    padding: 8px 12px;
    background: rgba(255,68,68,0.1);
    border-radius: 6px;
    align-self: flex-start;
}
.ai-chat-img-preview {
    max-width: 200px;
    max-height: 200px;
    border-radius: 4px;
    margin-top: 6px;
    cursor: pointer;
    image-rendering: pixelated;
    border: 1px solid var(--border-color);
}
.ai-chat-img-preview:hover {
    border-color: var(--accent-color, #4a9eff);
}
`;

const TOOL_LABELS: Record<string, string> = {
    generate_sprite: 'Generating image',
    create_entity: 'Creating entity',
    delete_entity: 'Deleting entity',
    set_property: 'Setting property',
    add_component: 'Adding component',
    remove_component: 'Removing component',
    create_script: 'Creating script',
    save_scene: 'Saving scene',
    instantiate_template: 'Creating from template',
    instantiate_prefab: 'Instantiating prefab',
    get_scene_tree: 'Reading scene',
    list_components: 'Listing components',
    list_assets: 'Listing assets',
    find_entities: 'Searching entities',
    get_component_schema: 'Reading component schema',
};

const TOOL_HINTS: Record<string, string> = {
    generate_sprite: 'Calling image generation API, this may take 5-15 seconds...',
    create_script: 'Writing script file...',
    save_scene: 'Saving scene to disk...',
    instantiate_prefab: 'Loading and instantiating prefab...',
};

export class AIChatPanel implements PanelInstance {
    private container_: HTMLElement;
    private service_: AIChatService | null = null;
    private messagesEl_: HTMLElement;
    private inputEl_: HTMLTextAreaElement;
    private sendBtn_: HTMLButtonElement;
    private sending_ = false;

    constructor(parentContainer: HTMLElement) {
        this.container_ = document.createElement('div');
        this.container_.className = 'ai-chat-root';

        const style = document.createElement('style');
        style.textContent = STYLES;
        this.container_.appendChild(style);

        const toolbar = document.createElement('div');
        toolbar.className = 'ai-chat-toolbar';
        const clearBtn = document.createElement('button');
        clearBtn.className = 'ai-chat-clear-btn';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {
            this.service_?.clearHistory();
            this.messagesEl_.innerHTML = '';
        });
        toolbar.appendChild(clearBtn);
        this.container_.appendChild(toolbar);

        this.messagesEl_ = document.createElement('div');
        this.messagesEl_.className = 'ai-chat-messages';
        this.container_.appendChild(this.messagesEl_);

        const inputRow = document.createElement('div');
        inputRow.className = 'ai-chat-input-row';

        this.inputEl_ = document.createElement('textarea');
        this.inputEl_.className = 'ai-chat-input';
        this.inputEl_.placeholder = 'Ask AI to create entities, generate sprites, write scripts...';
        this.inputEl_.rows = 1;
        this.inputEl_.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.send_();
            }
        });
        this.inputEl_.addEventListener('input', () => {
            this.inputEl_.style.height = 'auto';
            this.inputEl_.style.height = Math.min(this.inputEl_.scrollHeight, 120) + 'px';
        });

        this.sendBtn_ = document.createElement('button');
        this.sendBtn_.className = 'ai-chat-send-btn';
        this.sendBtn_.textContent = 'Send';
        this.sendBtn_.addEventListener('click', () => this.send_());

        inputRow.appendChild(this.inputEl_);
        inputRow.appendChild(this.sendBtn_);
        this.container_.appendChild(inputRow);

        parentContainer.appendChild(this.container_);

        this.initService_();
    }

    dispose(): void {
        this.service_?.abort();
        this.container_.remove();
    }

    private initService_(): void {
        const editor = getEditorInstance();
        const bridge = editor?.mcpBridge;
        if (bridge) {
            this.service_ = new AIChatService(bridge);
        }
    }

    private async send_(): Promise<void> {
        const text = this.inputEl_.value.trim();
        if (!text || this.sending_) return;

        if (!this.service_) {
            this.initService_();
            if (!this.service_) {
                this.appendError_('AI service not available. McpBridge not initialized.');
                return;
            }
        }

        this.sending_ = true;
        this.sendBtn_.disabled = true;
        this.sendBtn_.textContent = '...';
        this.inputEl_.value = '';
        this.inputEl_.style.height = 'auto';

        this.appendMessage_('user', text);

        let assistantEl: HTMLElement | null = null;
        let rawText = '';
        const toolEls = new Map<string, HTMLElement>();

        try {
            await this.service_.sendMessage(text, {
                onTextDelta: (delta) => {
                    if (!assistantEl) {
                        assistantEl = this.appendMessage_('assistant', '');
                    }
                    rawText += delta;
                    assistantEl.innerHTML = this.renderMarkdown_(rawText);
                    this.scrollToBottom_();
                },
                onTextReplace: (fullText) => {
                    rawText = fullText;
                    if (assistantEl) {
                        if (fullText) {
                            assistantEl.innerHTML = this.renderMarkdown_(fullText);
                        } else {
                            assistantEl.remove();
                            assistantEl = null;
                        }
                    }
                },
                onToolCall: (info: ToolCallInfo) => {
                    let el = toolEls.get(info.id);
                    if (!el) {
                        el = this.appendToolCall_(info);
                        toolEls.set(info.id, el);
                    } else {
                        this.updateToolCall_(el, info);
                    }
                    this.scrollToBottom_();
                },
                onComplete: () => {
                    if (assistantEl && rawText) {
                        assistantEl.innerHTML = this.renderMarkdown_(rawText);
                    }
                    assistantEl = null;
                    rawText = '';
                },
                onError: (error) => {
                    this.appendError_(error);
                },
            });
        } catch (e) {
            this.appendError_(e instanceof Error ? e.message : String(e));
        }

        this.sending_ = false;
        this.sendBtn_.disabled = false;
        this.sendBtn_.textContent = 'Send';
    }

    private appendMessage_(role: 'user' | 'assistant', text: string): HTMLElement {
        const el = document.createElement('div');
        el.className = `ai-chat-msg ai-chat-msg--${role}`;
        if (role === 'user') {
            el.textContent = text;
        } else {
            el.innerHTML = text ? this.renderMarkdown_(text) : '';
        }
        this.messagesEl_.appendChild(el);
        this.scrollToBottom_();
        return el;
    }

    private renderMarkdown_(text: string): string {
        try {
            return marked.parse(text, { async: false }) as string;
        } catch {
            return this.escapeHtml_(text);
        }
    }

    private appendToolCall_(info: ToolCallInfo): HTMLElement {
        const el = document.createElement('div');
        el.className = 'ai-chat-msg ai-chat-msg--tool';
        el.dataset.startTime = String(Date.now());
        this.renderToolContent_(el, info);
        this.messagesEl_.appendChild(el);
        return el;
    }

    private updateToolCall_(el: HTMLElement, info: ToolCallInfo): void {
        this.renderToolContent_(el, info);
    }

    private renderToolContent_(el: HTMLElement, info: ToolCallInfo): void {
        const statusIcon = info.status === 'running' ? '⏳' : info.status === 'done' ? '✓' : '✗';
        const label = TOOL_LABELS[info.name] ?? info.name;
        let html = `<span class="ai-chat-tool-status">${statusIcon}</span><strong>${label}</strong>`;

        if (info.status === 'running') {
            const hint = TOOL_HINTS[info.name];
            if (hint) html += `<br/><span style="opacity:0.6">${hint}</span>`;
        } else {
            const startTime = Number(el.dataset.startTime || 0);
            if (startTime) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                html += ` <span style="opacity:0.5">(${elapsed}s)</span>`;
            }

            if (info.result && info.name === 'generate_sprite' && info.status === 'done') {
                html += this.buildImagePreview_(info.result);
            } else if (info.result) {
                const resultText = info.result.length > 200 ? info.result.slice(0, 200) + '...' : info.result;
                html += `<br/>${this.escapeHtml_(resultText)}`;
            }
        }

        el.innerHTML = html;

        if (info.name === 'generate_sprite' && info.status === 'done') {
            const img = el.querySelector('.ai-chat-img-preview') as HTMLImageElement;
            img?.addEventListener('click', () => {
                const editor = getEditorInstance();
                const store = (editor as any)?.store_;
                if (store && img.dataset.assetPath) {
                    store.selectAsset?.(img.dataset.assetPath);
                }
            });
        }
    }

    private buildImagePreview_(resultJson: string): string {
        try {
            const result = JSON.parse(resultJson);
            if (result.path) {
                const editor = getEditorInstance();
                const projectPath = (editor as any)?.projectPath_ ?? '';
                const projectDir = projectPath.replace(/\/[^/]+$/, '');
                const absPath = `${projectDir}/${result.path}`;
                const src = convertFileSrc(absPath);
                return `<br/><img class="ai-chat-img-preview" src="${src}?v=${Date.now()}" data-asset-path="${this.escapeHtml_(result.path)}" title="${this.escapeHtml_(result.path)}"/>`;
            }
        } catch { /* ignore */ }
        return `<br/>${this.escapeHtml_(resultJson)}`;
    }

    private appendError_(msg: string): void {
        const el = document.createElement('div');
        el.className = 'ai-chat-error';
        el.textContent = msg;
        this.messagesEl_.appendChild(el);
        this.scrollToBottom_();
    }

    private scrollToBottom_(): void {
        this.messagesEl_.scrollTop = this.messagesEl_.scrollHeight;
    }

    private escapeHtml_(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
