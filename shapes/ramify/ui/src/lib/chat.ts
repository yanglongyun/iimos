// 把存库的条目整理成对话里的行:用户气泡、agent 回复、工具调用(调用和它的结果合成一行)。
import type { Item, Compaction } from '../types';
import type { Note } from '../store';

type Base = { key: string; createdAt: string | null };
export type UserRow = Base & { kind: 'user'; content: string; node?: { id?: string; title?: string; count?: number } };
export type AssistantRow = Base & { kind: 'assistant'; content: string; streaming: boolean };
export type ToolRow = Base & { kind: 'tool'; callId: string; name: string; arguments: string; result: string | null; failed: boolean };
export type NoteRow = Base & { kind: 'note'; note: Note['kind']; content: string };
export type CompactRow = Base & { kind: 'compaction'; summary: string };
export type ChatRow = UserRow | AssistantRow | ToolRow | NoteRow | CompactRow;

const text = (item: Item) => ('content' in item && Array.isArray(item.content) ? item.content.map((part) => part.text || '').join('') : '');

export function buildRows(messages: Item[], compactions: Compaction[], notes: Note[], partial: string): ChatRow[] {
    const rows: ChatRow[] = [];
    const tools = new Map<string, ToolRow>();
    const compactAfter = new Map<number, Compaction>();
    for (const c of compactions) compactAfter.set(c.message_id, c);
    const notesAfter = new Map<number, Note[]>();
    for (const n of notes) notesAfter.set(n.afterId, [...(notesAfter.get(n.afterId) || []), n]);
    const flush = (afterId: number) => {
        for (const n of notesAfter.get(afterId) || []) rows.push({ kind: 'note', key: n.key, note: n.kind, content: n.text, createdAt: null });
    };
    flush(0);
    for (const item of messages) {
        if (item.type === 'message' && item.role === 'user') {
            rows.push({ kind: 'user', key: `m${item.id}`, content: item.display ?? text(item), node: item.node, createdAt: item.created_at });
        } else if (item.type === 'message') {
            const content = text(item).trim();
            if (content) rows.push({ kind: 'assistant', key: `m${item.id}`, content, streaming: false, createdAt: item.created_at });
        } else if (item.type === 'function_call') {
            const row: ToolRow = { kind: 'tool', key: `t${item.call_id}`, callId: item.call_id, name: item.name, arguments: item.arguments, result: null, failed: false, createdAt: item.created_at };
            tools.set(item.call_id, row);
            rows.push(row);
        } else if (item.type === 'function_call_output') {
            const row = tools.get(item.call_id);
            let failed = false, result = item.output;
            try { const parsed = JSON.parse(item.output); failed = parsed.success === false; result = parsed.text ?? item.output; } catch { /* 原样 */ }
            if (row) { row.result = result; row.failed = failed; }
        }
        const c = compactAfter.get(item.id);
        if (c) rows.push({ kind: 'compaction', key: `c${c.id}`, summary: c.summary, createdAt: c.created_at });
        flush(item.id);
    }
    if (partial) rows.push({ kind: 'assistant', key: 'partial', content: partial, streaming: true, createdAt: null });
    return rows;
}
