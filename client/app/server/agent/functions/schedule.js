// 定时任务的增删改查。调度本身在 server/scheduler.js,由业务层经 config.scheduler 交进来。
export default async function schedule(args, config) {
    const scheduler = config.scheduler;
    if (!scheduler) throw new Error('这个应用没有调度器');
    const show = (value) => ({ text: JSON.stringify(value, null, 2) });
    switch (args.action) {
        case 'list': return show(scheduler.list());
        case 'add': return show(scheduler.add(args));
        case 'update': {
            const { action: _a, id, ...patch } = args;
            return show(scheduler.update(String(id), patch));
        }
        case 'remove': scheduler.remove(String(args.id)); return { text: '已删除' };
        case 'run': scheduler.runNow(String(args.id)); return { text: '这一轮结束后马上跑' };
        default: throw new Error('action 只能是 list / add / update / remove / run');
    }
}
