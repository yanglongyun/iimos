// 这里只放工具定义,执行代码在 functions/ 目录,分发在 runner.js。
// 出厂:四个改自己的(shell read write edit)+ 通知(notify)+ 定时(schedule)。
// 别的工具等用户要了,由 agent 自己加在这里。
const tools = [
    {
        type: 'function',
        name: 'shell',
        description: '在 workspace(应用自己的目录)里执行终端命令,返回合并输出与退出码。node 和 iimos 两条命令可用。',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '终端命令' },
                workdir: { type: 'string', description: '可选工作目录,相对 workspace' },
            },
            required: ['command'],
        },
    },
    {
        type: 'function',
        name: 'read',
        description: '读取带行号的文本文件。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径,相对 workspace' },
                offset: { type: 'integer', description: '起始行,默认 1' },
                limit: { type: 'integer', description: '最多行数,默认 2000' },
            },
            required: ['path'],
        },
    },
    {
        type: 'function',
        name: 'write',
        description: '完整写入文件,自动创建父目录。改已有文件的一小处用 edit。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径,相对 workspace' },
                content: { type: 'string', description: '完整内容' },
            },
            required: ['path', 'content'],
        },
    },
    {
        type: 'function',
        name: 'edit',
        description: '精确替换文本,默认要求唯一匹配。',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径,相对 workspace' },
                old_string: { type: 'string', description: '原文' },
                new_string: { type: 'string', description: '新内容' },
                replace_all: { type: 'boolean', description: '替换全部' },
            },
            required: ['path', 'old_string', 'new_string'],
        },
    },
    {
        type: 'function',
        name: 'notify',
        description: '给用户发一条通知:电脑上弹系统通知。'
            + '用在用户不在跟前、又确实该知道的时候(定时任务出了结果、发现了要紧的事)。别滥用。',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                body: { type: 'string' },
            },
            required: ['title'],
        },
    },
    {
        type: 'function',
        name: 'schedule',
        description: '定时任务:到点了,系统会在这个对话里替用户开口,把 prompt 交给你跑一轮(用户可能不在跟前)。'
            + '用来做早报、盯盘、定期看邮箱、提醒、隔一阵主动找用户聊聊……时间按用户本地时间。'
            + '加之前跟用户说清楚什么时候、做什么;用户说不要了就删掉。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'run'] },
                id: { type: 'string', description: 'update/remove/run 的任务 id' },
                title: { type: 'string', description: '给用户看的名字,如「早报」' },
                prompt: { type: 'string', description: '到点了交给你的话:要做什么、结果怎么给用户。写清楚,到时候的你不记得现在的上下文' },
                rule: {
                    type: 'object',
                    description: '{type:"daily",time:"08:00",days?:[1,2,3,4,5]}(0 是周日)| {type:"interval",minutes:60}(至少 5)| {type:"once",at:"2026-10-13T08:00:00+08:00"}',
                    properties: {
                        type: { type: 'string', enum: ['daily', 'interval', 'once'] },
                        time: { type: 'string' },
                        days: { type: 'array', items: { type: 'integer' } },
                        minutes: { type: 'number' },
                        at: { type: 'string' },
                    },
                    required: ['type'],
                },
                enabled: { type: 'boolean', description: 'update 时暂停 / 恢复' },
            },
            required: ['action'],
        },
    },
];

export default tools;
