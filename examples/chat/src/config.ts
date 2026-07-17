import type { Color } from 'esengine';

// The message log is a virtualized createListView; its viewport size must be
// known up front (scroll math), and the MessagesSlot box in the scene matches.
export const CHAT_W = 720;
export const CHAT_H = 424;

// Rows auto-size to their wrapped text (createListView's measured layout). Bubbles
// are pinned left (them) or right (you) at a fixed max width, and grow taller as
// the message wraps.
export const ROW_SPACING = 8;
export const BUBBLE_W = 460;
// Right-side bubbles leave a gutter so they clear the scroll edge.
export const RIGHT_GUTTER = 24;

// Bubble text metrics.
export const LABEL_PAD = 12;    // horizontal text inset inside a bubble
export const BUBBLE_VPAD = 10;  // vertical padding above + below the text
const FONT_SIZE = 14;
const LINE_H = FONT_SIZE * 1.3;      // matches Text.lineHeight (1.3 ratio)
const AVG_CHAR_W = FONT_SIZE * 0.6;  // deliberately wide → never under-count lines

/**
 * Estimated pixel height of a message bubble sized to its wrapped text. There is
 * no public text-measure API yet, so this word-wraps at an estimated
 * chars-per-line and errs TALL (a short estimate would overflow — the exact bug
 * this fixes). Fed to createListView as `itemHeight(index)`.
 */
export function bubbleHeight(msg: Message): number {
    const textW = BUBBLE_W - 2 * LABEL_PAD;
    const cpl = Math.max(1, Math.floor(textW / AVG_CHAR_W));
    return Math.max(1, wrapLines(msg.text, cpl)) * LINE_H + 2 * BUBBLE_VPAD;
}

/** Rough word-wrap line count at `cpl` chars per line (a word wider than a line
 *  splits across lines). */
function wrapLines(text: string, cpl: number): number {
    let lines = 1;
    let col = 0;
    for (const word of text.split(/\s+/)) {
        if (col === 0) col = word.length;
        else if (col + 1 + word.length <= cpl) col += 1 + word.length;
        else { lines++; col = word.length; }
        while (col > cpl) { lines++; col -= cpl; }
    }
    return lines;
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
