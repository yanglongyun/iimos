// 这里只放工具定义,执行代码在 functions/ 目录,分发在 runner.js。
// 出厂只有四个:够 agent 读懂、改动整个应用。别的工具等用户要了,由 agent 自己加在这里。
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
];

export default tools;
