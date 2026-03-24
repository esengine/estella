import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getSettingsValue } from '../../settings/SettingsRegistry';
import { getToolsOpenAI, getToolsSystemPrompt, toolNameToMethodName, convertToolParams } from './mcpToolsForClaude';
import type { McpBridge } from '../../bridge/McpBridge';

export interface ToolCallInfo {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: 'running' | 'done' | 'error';
    result?: string;
}

interface Message {
    role: string;
    content: unknown;
    tool_calls?: unknown[];
    tool_call_id?: string;
}

export class AIChatService {
    private messages_: Message[] = [];
    private aborted_ = false;
    private unlistenChunk_: UnlistenFn | null = null;
    private unlistenDone_: UnlistenFn | null = null;

    constructor(private bridge_: McpBridge) {}

    clearHistory(): void {
        this.messages_ = [];
    }

    abort(): void {
        this.aborted_ = true;
        this.unlistenChunk_?.();
        this.unlistenChunk_ = null;
        this.unlistenDone_?.();
        this.unlistenDone_ = null;
    }

    async sendMessage(
        text: string,
        callbacks: {
            onTextDelta: (text: string) => void;
            onTextReplace: (fullText: string) => void;
            onToolCall: (info: ToolCallInfo) => void;
            onComplete: () => void;
            onError: (error: string) => void;
        },
    ): Promise<void> {
        this.aborted_ = false;
        this.messages_.push({ role: 'user', content: text });
        await this.runLoop_(callbacks, 0);
    }

    private async runLoop_(callbacks: {
        onTextDelta: (text: string) => void;
        onTextReplace: (fullText: string) => void;
        onToolCall: (info: ToolCallInfo) => void;
        onComplete: () => void;
        onError: (error: string) => void;
    }, step: number): Promise<void> {
        const MAX_STEPS = 15;
        if (step >= MAX_STEPS || this.aborted_) {
            callbacks.onComplete();
            return;
        }

        const apiKey = getSettingsValue<string>('ai.claudeApiKey');
        if (!apiKey) { callbacks.onError('API key not configured.'); return; }
        const baseUrl = getSettingsValue<string>('ai.claudeBaseUrl') ?? '';
        const model = getSettingsValue<string>('ai.claudeModel') ?? 'claude-sonnet-4-20250514';

        const tools = getToolsOpenAI();
        const systemPrompt = getToolsSystemPrompt();
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let fullText = '';
        const toolCalls: Array<{ id: string; name: string; argsJson: string }> = [];
        let currentToolIdx = -1;

        const donePromise = new Promise<void>((resolve) => {
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };

            listen<{ data: string }>(`ai-chat-chunk-${requestId}`, (event) => {
                if (this.aborted_) return;
                try {
                    const chunk = JSON.parse(event.payload.data);
                    const choices = chunk.choices;
                    if (!choices) return;
                    for (const choice of choices) {
                        const delta = choice.delta;
                        if (!delta) continue;

                        if (delta.content) {
                            fullText += delta.content;
                            callbacks.onTextDelta(delta.content);
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.id) {
                                    currentToolIdx = toolCalls.length;
                                    toolCalls.push({ id: tc.id, name: tc.function?.name ?? '', argsJson: '' });
                                    callbacks.onToolCall({ id: tc.id, name: tc.function?.name ?? '', input: {}, status: 'running' });
                                }
                                if (tc.function?.arguments && currentToolIdx >= 0) {
                                    toolCalls[currentToolIdx].argsJson += tc.function.arguments;
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }
            }).then(fn => { this.unlistenChunk_ = fn; });

            listen(`ai-chat-done-${requestId}`, () => {
                this.unlistenChunk_?.(); this.unlistenChunk_ = null;
                this.unlistenDone_?.(); this.unlistenDone_ = null;
                done();
            }).then(fn => { this.unlistenDone_ = fn; });

            setTimeout(done, 180000);
        });

        await new Promise(r => setTimeout(r, 50));

        try {
            await invoke('ai_chat_stream', {
                requestId, apiKey,
                baseUrl: baseUrl || null,
                model,
                messages: this.messages_,
                tools,
                systemPrompt,
                maxTokens: 4096,
            });
        } catch (e) {
            this.unlistenChunk_?.(); this.unlistenDone_?.();
            callbacks.onError(e instanceof Error ? e.message : String(e));
            return;
        }

        await donePromise;
        if (this.aborted_) return;

        // Fallback: parse tool_call blocks from text if relay doesn't support native tool_calls
        if (toolCalls.length === 0 && fullText.includes('```tool_call')) {
            const regex = /```tool_call\s*\n?([\s\S]*?)```/g;
            let match;
            while ((match = regex.exec(fullText)) !== null) {
                try {
                    const parsed = JSON.parse(match[1].trim());
                    const id = `tc_${toolCalls.length}`;
                    toolCalls.push({ id, name: parsed.name, argsJson: JSON.stringify(parsed.arguments ?? {}) });
                } catch { /* skip */ }
            }
            if (toolCalls.length > 0) {
                fullText = fullText.replace(regex, '').trim();
                callbacks.onTextReplace(fullText);
                for (const tc of toolCalls) {
                    let args: Record<string, unknown> = {};
                    try { args = JSON.parse(tc.argsJson); } catch { /* */ }
                    callbacks.onToolCall({ id: tc.id, name: tc.name, input: args, status: 'running' });
                }
            }
        }

        if (toolCalls.length === 0) {
            this.messages_.push({ role: 'assistant', content: fullText });
            callbacks.onComplete();
            return;
        }

        const assistantMsg: Message = {
            role: 'assistant',
            content: fullText || null,
            tool_calls: toolCalls.map(tc => {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.argsJson || '{}'); } catch { /* */ }
                return { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argsJson || '{}' } };
            }),
        };
        this.messages_.push(assistantMsg);

        for (const tc of toolCalls) {
            if (this.aborted_) return;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.argsJson || '{}'); } catch { /* */ }

            const methodName = toolNameToMethodName(tc.name);
            const params = convertToolParams(tc.name, args);

            try {
                const result = await this.bridge_.executeTool(methodName, params);
                const resultStr = JSON.stringify(result);
                this.messages_.push({ role: 'tool', content: resultStr, tool_call_id: tc.id });
                callbacks.onToolCall({ id: tc.id, name: tc.name, input: args, status: 'done', result: resultStr });
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                this.messages_.push({ role: 'tool', content: errMsg, tool_call_id: tc.id });
                callbacks.onToolCall({ id: tc.id, name: tc.name, input: args, status: 'error', result: errMsg });
            }
        }

        callbacks.onTextReplace('');
        await this.runLoop_(callbacks, step + 1);
    }
}
