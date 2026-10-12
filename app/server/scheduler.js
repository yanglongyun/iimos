// 定时任务:到点了,在唯一的那个对话里替用户「开口」,让 agent 跑一轮。
//
// 任务存在 $IIMOS_DATA/tasks.json,agent 用 schedule 工具增删改,界面在面板里列出来。
//   { id, title, prompt, rule, enabled, createdAt, lastRun, nextRun }
//   rule: { type: 'daily', time: 'HH:MM', days?: [0-6](0 是周日) }
//       | { type: 'interval', minutes }(至少 5 分钟)
//       | { type: 'once', at: ISO 时间 }
//
// 电脑睡着错过了点:醒来 12 小时内补跑一次,再久就跳过,算下一次。对话正忙就等它空下来。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TICK_MS = 20_000;
const CATCH_UP_MS = 12 * 60 * 60_000;

export function validRule(rule) {
    if (!rule || typeof rule !== 'object') throw new Error('rule 必须是对象');
    if (rule.type === 'daily') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule.time))) throw new Error('daily 的 time 要写成 HH:MM');
        if (rule.days !== undefined && (!Array.isArray(rule.days) || !rule.days.length || rule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
            throw new Error('days 是 0-6 的数组,0 是周日');
        }
        return { type: 'daily', time: rule.time, ...(rule.days ? { days: [...new Set(rule.days)].sort() } : {}) };
    }
    if (rule.type === 'interval') {
        const minutes = Number(rule.minutes);
        if (!Number.isFinite(minutes) || minutes < 5) throw new Error('interval 至少 5 分钟');
        return { type: 'interval', minutes };
    }
    if (rule.type === 'once') {
        const at = new Date(rule.at);
        if (Number.isNaN(at.getTime())) throw new Error('once 的 at 要是能解析的时间,比如 2026-10-13T08:00:00+08:00');
        return { type: 'once', at: at.toISOString() };
    }
    throw new Error('rule.type 只能是 daily / interval / once');
}

/** 从 from(不含)之后的下一次。once 过了就是 null。 */
export function nextRun(rule, from = new Date()) {
    const after = new Date(from.getTime() + 1000);
    if (rule.type === 'once') return new Date(rule.at) >= after ? rule.at : null;
    if (rule.type === 'interval') return new Date(from.getTime() + rule.minutes * 60_000).toISOString();
    const [h, m] = rule.time.split(':').map(Number);
    for (let i = 0; i < 8; i += 1) {
        const day = new Date(after);
        day.setDate(day.getDate() + i);
        day.setHours(h, m, 0, 0);
        if (day < after) continue;
        if (rule.days && !rule.days.includes(day.getDay())) continue;
        return day.toISOString();
    }
    return null;
}

export function describe(rule) {
    if (rule.type === 'interval') return rule.minutes % 60 === 0 ? `每 ${rule.minutes / 60} 小时` : `每 ${rule.minutes} 分钟`;
    if (rule.type === 'once') return `${new Date(rule.at).toLocaleString('zh-CN', { hour12: false })} 一次`;
    const names = '日一二三四五六';
    const days = !rule.days || rule.days.length === 7 ? '每天' : rule.days.join() === '1,2,3,4,5' ? '工作日' : `每周${rule.days.map((d) => names[d]).join('、')}`;
    return `${days} ${rule.time}`;
}

export function createScheduler({ data, fire, now = () => new Date(), emit = () => {} }) {
    const file = path.join(data, 'tasks.json');
    const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).tasks || []; } catch { return []; } };
    const save = (tasks) => {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ tasks }, null, 2));
        fs.renameSync(`${file}.tmp`, file);
        emit({ type: 'tasks', tasks: list(tasks) });
    };
    const list = (tasks = load()) => tasks.map((task) => ({ ...task, when: describe(task.rule) }));
    let timer = null;
    const queue = [];

    function tick() {
        const tasks = load();
        const t = now();
        let changed = false;
        for (const task of tasks) {
            if (!task.enabled || !task.nextRun || new Date(task.nextRun) > t) continue;
            const late = t - new Date(task.nextRun);
            if (late <= CATCH_UP_MS && !queue.includes(task.id)) queue.push(task.id);
            task.nextRun = nextRun(task.rule, t);
            if (!task.nextRun) task.enabled = false;
            changed = true;
        }
        if (changed) save(tasks);
        while (queue.length) {
            const task = load().find((x) => x.id === queue[0]);
            if (!task) { queue.shift(); continue; }
            if (!fire(task)) break;   // 对话正忙:下一次 tick 再试
            queue.shift();
            const all = load();
            const saved = all.find((x) => x.id === task.id);
            if (saved) { saved.lastRun = t.toISOString(); save(all); }
        }
    }

    return {
        list,
        start() { if (!timer) { timer = setInterval(tick, TICK_MS); timer.unref?.(); setTimeout(tick, 2000).unref?.(); } },
        stop() { clearInterval(timer); timer = null; },
        tick,
        add({ title, prompt, rule }) {
            if (typeof title !== 'string' || !title.trim()) throw new Error('缺少 title');
            if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('缺少 prompt(到点了你要做什么)');
            const clean = validRule(rule);
            const tasks = load();
            const task = { id: crypto.randomBytes(4).toString('hex'), title: title.trim(), prompt: prompt.trim(), rule: clean, enabled: true, createdAt: now().toISOString(), lastRun: null, nextRun: nextRun(clean, now()) };
            if (!task.nextRun) throw new Error('这个时间已经过了');
            tasks.push(task);
            save(tasks);
            return { ...task, when: describe(clean) };
        },
        update(id, patch) {
            const tasks = load();
            const task = tasks.find((x) => x.id === id);
            if (!task) throw new Error(`没有这个任务:${id}`);
            if (patch.title !== undefined) task.title = String(patch.title);
            if (patch.prompt !== undefined) task.prompt = String(patch.prompt);
            if (patch.rule !== undefined) task.rule = validRule(patch.rule);
            if (patch.enabled !== undefined) task.enabled = Boolean(patch.enabled);
            task.nextRun = task.enabled ? nextRun(task.rule, now()) : task.nextRun;
            save(tasks);
            return { ...task, when: describe(task.rule) };
        },
        remove(id) {
            const tasks = load();
            const next = tasks.filter((x) => x.id !== id);
            if (next.length === tasks.length) throw new Error(`没有这个任务:${id}`);
            save(next);
            return true;
        },
        /** 立刻跑一次(界面上的「现在跑」)。对话正忙就排队。 */
        runNow(id) {
            if (!load().some((x) => x.id === id)) throw new Error(`没有这个任务:${id}`);
            if (!queue.includes(id)) queue.push(id);
            tick();
            return true;
        },
    };
}
