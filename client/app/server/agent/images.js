// 截图怎么给模型看。
//
// 工具结果只能是文字,所以截图存成文件(在 $IIMOS_DATA/shots/),对话里跟一条用户消息:
//   { type:'message', role:'user', hidden:true, content:[{ type:'input_text' }, { type:'input_image', file }] }
// 发请求前 forModel() 把它变成模型认的样子:只有最近 KEEP 张换成真图(data URL),更早的换成一句文字 ——
// 一张图上千 token,每轮都带全部历史截图会很快撑爆上下文。hidden 让界面不把它当成用户说的话。
// 模型不支持看图时(vision:false,或请求被拒),图全部换成文字,告诉它截图存在哪。
import fs from 'node:fs';

const KEEP = 1;

export function imageNote(tool, file) {
    return {
        type: 'message',
        role: 'user',
        hidden: true,
        content: [
            { type: 'input_text', text: `[${tool} 的截图]` },
            { type: 'input_image', file },
        ],
    };
}

export const hasImage = (item) => item.type === 'message' && Array.isArray(item.content) && item.content.some((part) => part.type === 'input_image');

export function forModel(messages, { vision = true } = {}) {
    let left = vision ? KEEP : 0;
    const out = new Array(messages.length);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const item = messages[i];
        if (!hasImage(item)) { out[i] = item; continue; }
        const content = item.content.map((part) => {
            if (part.type !== 'input_image' || !part.file) return part;
            if (left > 0) {
                try {
                    const data = fs.readFileSync(part.file).toString('base64');
                    left -= 1;
                    return { type: 'input_image', image_url: `data:image/png;base64,${data}`, detail: 'auto' };
                } catch { return { type: 'input_text', text: `(截图文件不见了:${part.file})` }; }
            }
            return { type: 'input_text', text: vision ? `(较早的截图,已省略;需要再看就重新截。文件:${part.file})` : `(这个模型看不了图;截图存在 ${part.file})` };
        });
        out[i] = { type: 'message', role: item.role, content };
    }
    return out;
}

export const isVisionError = (error) => /image|vision|multimodal|多模态|图片|图像/i.test(String(error?.message || ''));
