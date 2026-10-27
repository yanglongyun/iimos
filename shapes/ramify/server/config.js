// 模型配置:$IIMOS_DATA/config.json。位置和 responsesUrl / apiKey / model 三项是 launcher 契约里写死的,所有形态共用;
// 别的形态写进去的字段原样保留,这里只读写自己认识的几项。
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONTEXT_WINDOW } from './agent/compact.js';

const FIELDS = ['responsesUrl', 'apiKey', 'model'];

export function readConfig(data) {
    try { return JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')); } catch { return {}; }
}

/** 合并保存。apiKey 留空表示不改(界面不回显已存的 key)。 */
export function writeConfig(data, patch) {
    const next = { ...readConfig(data) };
    for (const key of FIELDS) {
        if (typeof patch?.[key] !== 'string') continue;
        const value = patch[key].trim();
        if (key === 'apiKey' && !value) continue;
        next[key] = value;
    }
    if (patch?.contextWindow !== undefined && patch.contextWindow !== '') {
        const window = Math.round(Number(patch.contextWindow));
        if (!Number.isFinite(window) || window < 4000) throw Object.assign(new Error('上下文窗口至少 4000 token'), { status: 400 });
        next.contextWindow = window;
    }
    fs.mkdirSync(data, { recursive: true });
    const file = path.join(data, 'config.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    return next;
}

function keyHint(key) {
    if (!key) return '';
    return key.length >= 12 ? `${key.slice(0, 4)}••••••••${key.slice(-4)}` : '••••••••';
}

/** 给界面看的:key 不回传,只给一个打了码的样子。 */
export function publicConfig(config) {
    return {
        responsesUrl: config.responsesUrl || '',
        model: config.model || '',
        contextWindow: Number(config.contextWindow) || DEFAULT_CONTEXT_WINDOW,
        hasKey: Boolean(config.apiKey),
        keyHint: keyHint(config.apiKey),
        ready: Boolean(config.responsesUrl && config.apiKey && config.model),
    };
}

export const modelReady = (config) => Boolean(config.responsesUrl && config.apiKey && config.model);
