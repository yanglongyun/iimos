// 工具定义。导图只有主题,所以工具也都围绕主题:加、改、挪、删、读。再加出厂的 shell。
// 加工具:这里加定义,functions/ 加实现,runner.js 加分发。
const tools = [
    {
        type: 'function',
        name: 'add_topics',
        description: '在一个主题下面批量加子主题。一次最多 20 个;先想清楚层级,通常一层 3–6 个。'
            + 'title 要短(不超过 20 字),note 用一两句话补充这个分支要讲什么。',
        parameters: {
            type: 'object',
            properties: {
                parent_id: { type: 'string', description: '父主题的 id' },
                topics: {
                    type: 'array',
                    description: '要加的子主题,按显示顺序',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: '主题名,短而具体' },
                            note: { type: 'string', description: '可选:这个主题的补充说明' },
                        },
                        required: ['title'],
                    },
                },
            },
            required: ['parent_id', 'topics'],
        },
    },
    {
        type: 'function',
        name: 'update_topic',
        description: '改一个已有主题的标题或备注。没有要求改的字段不要传。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '主题 id' },
                title: { type: 'string', description: '新的标题' },
                note: { type: 'string', description: '新的备注;传空字符串可清空' },
            },
            required: ['id'],
        },
    },
    {
        type: 'function',
        name: 'move_topic',
        description: '把一个主题(连同它的整棵子树)挪到另一个主题下面。不能挪中心主题,也不能挪进自己的子树。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '要移动的主题 id' },
                parent_id: { type: 'string', description: '新的父主题 id' },
                position: { type: 'integer', description: '在兄弟主题中的位置,0 开始;不填就放到末尾' },
            },
            required: ['id', 'parent_id'],
        },
    },
    {
        type: 'function',
        name: 'delete_topic',
        description: '删掉一个主题和它的整棵子树。不可恢复。只有用户明确要求删时才用。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '要删除的主题 id' },
            },
            required: ['id'],
        },
    },
    {
        type: 'function',
        name: 'read_map',
        description: '读当前导图的完整结构,返回每个主题的 id、层级、标题和备注。动手改之前先读。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '导图 id;不填就是当前这张' },
            },
        },
    },
    {
        type: 'function',
        name: 'shell',
        description: '在 workspace(形态自己的目录)里执行终端命令,返回合并输出与退出码。'
            + '需要查资料(curl)、算东西、检查源码时用。导图内容请用导图工具改。',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '终端命令' },
                workdir: { type: 'string', description: '可选工作目录,相对 workspace' },
            },
            required: ['command'],
        },
    },
];

export default tools;
