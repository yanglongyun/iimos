// 模型配置:$IIMOS_DATA/config.json。
// 位置是 launcher 契约里写死的 —— 救援 agent 从这里读凭据,别挪。
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONTEXT_WINDOW } from '../agent/compact.js';

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
    // 上下文窗口(token):用量到它的 70% 就压缩。太小的数是填错了,不收
    if (patch?.contextWindow !== undefined && patch.contextWindow !== '') {
        const window = Math.round(Number(patch.contextWindow));
        if (!Number.isFinite(window) || window < 4000) throw Object.assign(new Error('上下文窗口至少 4000 token'), { status: 400 });
        next.contextWindow = window;
    }
    const file = path.join(data, 'config.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    return next;
}

/** key 只露头尾各 4 位,中间打点;太短的 key 一位都不露(露 8 位就等于露了大半)。 */
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
