export interface CompiledExpression {
    evaluate(source: Record<string, unknown>): unknown;
}

const CACHE_MAX_SIZE = 512;
const cache = new Map<string, CompiledExpression>();

import { getNestedProperty } from './propertyPath';

export function compileExpression(expr: string): CompiledExpression {
    let compiled = cache.get(expr);
    if (compiled) return compiled;
    compiled = compile(expr);
    if (cache.size >= CACHE_MAX_SIZE) {
        const firstKey = cache.keys().next().value!;
        cache.delete(firstKey);
    }
    cache.set(expr, compiled);
    return compiled;
}

function compile(expr: string): CompiledExpression {
    const segments = parseSegments(expr);

    if (segments.length === 1 && segments[0].type === 'expr') {
        const inner = segments[0].value.trim();
        if (isSimpleKey(inner)) {
            return { evaluate: (source) => getNestedProperty(source, inner) };
        }
        return compileMath(inner);
    }

    const evaluators: ((source: Record<string, unknown>) => string)[] = [];
    for (const seg of segments) {
        if (seg.type === 'text') {
            const text = seg.value;
            evaluators.push(() => text);
        } else {
            const inner = seg.value.trim();
            if (isSimpleKey(inner)) {
                evaluators.push((source) => String(getNestedProperty(source, inner) ?? ''));
            } else {
                const mathExpr = compileMath(inner);
                evaluators.push((source) => String(mathExpr.evaluate(source) ?? ''));
            }
        }
    }

    return {
        evaluate(source) {
            let result = '';
            for (const ev of evaluators) result += ev(source);
            return result;
        },
    };
}

interface Segment {
    type: 'text' | 'expr';
    value: string;
}

function parseSegments(expr: string): Segment[] {
    const segments: Segment[] = [];
    let i = 0;
    let textStart = 0;

    while (i < expr.length) {
        if (expr[i] === '{') {
            if (i > textStart) {
                segments.push({ type: 'text', value: expr.slice(textStart, i) });
            }
            const closeIdx = expr.indexOf('}', i + 1);
            if (closeIdx === -1) {
                segments.push({ type: 'text', value: expr.slice(i) });
                return segments;
            }
            segments.push({ type: 'expr', value: expr.slice(i + 1, closeIdx) });
            i = closeIdx + 1;
            textStart = i;
        } else {
            i++;
        }
    }

    if (textStart < expr.length) {
        segments.push({ type: 'text', value: expr.slice(textStart) });
    }

    return segments;
}

function isSimpleKey(s: string): boolean {
    return /^[a-zA-Z_]\w*(\.\w+)*$/.test(s);
}

// ── Math Expression Parser (recursive descent, no eval) ──

interface MathNode {
    eval(source: Record<string, unknown>): number;
}

class NumberNode implements MathNode {
    constructor(private value_: number) {}
    eval(): number { return this.value_; }
}

class VarNode implements MathNode {
    constructor(private key_: string) {}
    eval(source: Record<string, unknown>): number {
        const v = getNestedProperty(source, this.key_);
        return typeof v === 'number' ? v : Number(v) || 0;
    }
}

class BinaryNode implements MathNode {
    constructor(private left_: MathNode, private op_: string, private right_: MathNode) {}
    eval(source: Record<string, unknown>): number {
        const l = this.left_.eval(source);
        const r = this.right_.eval(source);
        switch (this.op_) {
            case '+': return l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/': return r !== 0 ? l / r : 0;
            default: return 0;
        }
    }
}

class MathParser {
    private pos_ = 0;
    private tokens_: string[] = [];

    constructor(input: string) {
        this.tokens_ = tokenize(input);
    }

    parse(): MathNode {
        const node = this.parseExpression_();
        return node;
    }

    private parseExpression_(): MathNode {
        let left = this.parseTerm_();
        while (this.pos_ < this.tokens_.length && (this.peek_() === '+' || this.peek_() === '-')) {
            const op = this.advance_();
            const right = this.parseTerm_();
            left = new BinaryNode(left, op, right);
        }
        return left;
    }

    private parseTerm_(): MathNode {
        let left = this.parseFactor_();
        while (this.pos_ < this.tokens_.length && (this.peek_() === '*' || this.peek_() === '/')) {
            const op = this.advance_();
            const right = this.parseFactor_();
            left = new BinaryNode(left, op, right);
        }
        return left;
    }

    private parseFactor_(): MathNode {
        const token = this.advance_();
        if (token === '(') {
            const node = this.parseExpression_();
            if (this.peek_() === ')') this.advance_();
            return node;
        }
        const num = Number(token);
        if (!isNaN(num)) return new NumberNode(num);
        return new VarNode(token);
    }

    private peek_(): string { return this.tokens_[this.pos_] ?? ''; }
    private advance_(): string { return this.tokens_[this.pos_++] ?? ''; }
}

function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (ch === ' ' || ch === '\t') { i++; continue; }
        if ('+-*/()'.includes(ch)) {
            tokens.push(ch);
            i++;
        } else {
            let start = i;
            while (i < input.length && !'+-*/() \t'.includes(input[i])) i++;
            tokens.push(input.slice(start, i));
        }
    }
    return tokens;
}

function compileMath(inner: string): CompiledExpression {
    const parser = new MathParser(inner);
    const ast = parser.parse();
    return { evaluate: (source) => ast.eval(source) };
}
