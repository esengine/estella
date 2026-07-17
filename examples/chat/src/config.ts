import type { Color } from 'esengine';
import { measureText } from 'esengine';

// The message log is a virtualized createListView; its viewport size must be
// known up front (scroll math), and the MessagesSlot box in the scene matches.
export const CHAT_W = 720;
export const CHAT_H = 424;

// Rows auto-size to their wrapped text (createListView's measured layout). Bubbles
// are pinned left (them) or right (you) and sized to their content — up to a max
// width, growing taller as the message wraps.
export const ROW_SPACING = 8;
// Max bubble width; a bubble shrinks to fit shorter messages (see bubbleMetrics).
export const BUBBLE_W = 460;
// Bubbles hug their side, leaving a gutter: left for them, right (clearing the
// scrollbar edge) for you.
export const LEFT_GUTTER = 12;
export const RIGHT_GUTTER = 24;

// Bubble text metrics.
export const LABEL_PAD = 12;    // horizontal text inset inside a bubble
export const BUBBLE_VPAD = 10;  // vertical padding above + below the text
export const FONT_SIZE = 14;

/**
 * A message bubble sized to its wrapped text — the single source of truth for
 * both the row height (createListView's `itemHeight`) and the bubble's own width
 * (set per-bind so short messages get a snug bubble, long ones grow to the max).
 *
 * Uses the engine's `measureText` (the same Canvas2D metrics the renderer wraps
 * by), so the measured wrap matches the rendered one exactly — no overflow. Text
 * is wrapped to `BUBBLE_W - 2*LABEL_PAD`; `width` is the widest wrapped line (ceil
 * for sub-pixel slack, clamped to the max), so the bubble hugs its content. Height
 * is `lineCount * lineHeight` (fontSize × the Text default 1.2 ratio).
 */
export function bubbleMetrics(msg: Message): { width: number; height: number } {
    const maxText = BUBBLE_W - 2 * LABEL_PAD;
    const m = measureText(msg.text, { fontSize: FONT_SIZE, maxWidth: maxText });
    const textW = Math.min(maxText, Math.ceil(m.width));
    return { width: textW + 2 * LABEL_PAD, height: m.height + 2 * BUBBLE_VPAD };
}

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
