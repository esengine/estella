import type { Color } from 'esengine';

// The message log is a virtualized createListView; its viewport size must be
// known up front (scroll math), and the MessagesSlot box in the scene matches.
export const CHAT_W = 720;
export const CHAT_H = 424;

// Fixed-height rows (the list recycles a handful of entities): a bubble plus an
// 8px gap. Bubbles are pinned left (them) or right (you) at a fixed max width.
export const ROW_H = 60;
export const ROW_SPACING = 8;
export const BUBBLE_W = 460;
// Right-side bubbles leave a gutter so they clear the scroll edge.
export const RIGHT_GUTTER = 24;

export const COMPOSER_H = 40;
export const SEND_W = 84;
export const INPUT_W = CHAT_W - SEND_W - 10; // + the row's 10px gap = CHAT_W

export type Sender = 'me' | 'bot';
export interface Message {
    id: number;
    from: Sender;
    text: string;
}

export const ME_BUBBLE: Color = { r: 0.20, g: 0.45, b: 0.85, a: 1 };
export const BOT_BUBBLE: Color = { r: 0.24, g: 0.24, b: 0.28, a: 1 };
export const BUBBLE_TEXT: Color = { r: 0.96, g: 0.96, b: 0.98, a: 1 };

// A canned, deterministic bot so reloads read identically (no randomness).
const REPLIES = [
    'createListView recycles ~10 entities for the whole log — scroll to see.',
    'Each bubble is one pooled row, re-bound as it enters the viewport.',
    'The box below is a TextInput widget; Enter or Send appends a message.',
    'New messages jump the list to the bottom via scrollToIndex.',
    'Type a few more — the list virtualizes as many as you like.',
];

export function botReply(userText: string, turn: number): string {
    if (/\b(hi|hey|hello)\b/i.test(userText)) return 'Hey! Ask me anything about this demo.';
    if (userText.endsWith('?')) return 'Good question — try scrolling the log while you type.';
    return REPLIES[turn % REPLIES.length];
}

// A short opening conversation so the log is not empty on load.
export const SEED: { from: Sender; text: string }[] = [
    { from: 'bot', text: 'Welcome to the chat demo.' },
    { from: 'bot', text: 'This log is a virtualized ListView; the field below is a TextInput.' },
    { from: 'me', text: 'Nice — how do I send a message?' },
    { from: 'bot', text: 'Type below and press Enter, or click Send.' },
];
