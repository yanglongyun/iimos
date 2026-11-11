// 接收一次工具调用,执行对应工具,返回 { text, failed? }。出错不抛,作为失败结果交回模型。
import shell from './functions/shell.js';
import { addNodes, readTree, writeNode } from './functions/nodes.js';

export default async function runTool(call, config, signal) {
    signal?.throwIfAborted();
    try {
        if (typeof call.arguments !== 'string') throw new Error('arguments 必须是 JSON 字符串');
        const args = JSON.parse(call.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
        switch (call.name) {
            case 'shell': return await shell(args, config, signal);
            case 'add_nodes': return addNodes(args, config);
            case 'write_node': return writeNode(args, config);
            case 'read_tree': return readTree(args, config);
            default: throw new Error(`没有这个工具:${call.name}`);
        }
    } catch (error) {
        signal?.throwIfAborted();
        return { text: error.message, failed: true };
    }
}
