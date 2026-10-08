// 极简 Markdown:段落、标题、列表、代码块、行内代码、粗体、链接。先转义再加标签,模型输出里的 HTML 不会生效。
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function inline(text: string) {
    return escape(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}

export function markdown(src: string) {
    const out: string[] = [];
    for (const block of src.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g)) {
        if (block.startsWith('```')) {
            const code = block.replace(/^```[^\n]*\n/, '').replace(/```$/, '');
            out.push(`<pre><code>${escape(code)}</code></pre>`);
            continue;
        }
        for (const para of block.split(/\n{2,}/)) {
            const lines = para.split('\n').filter((line) => line.trim());
            if (!lines.length) continue;
            if (lines.every((line) => /^\s*[-*] /.test(line))) {
                out.push(`<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`);
            } else if (lines.every((line) => /^\s*\d+\. /.test(line))) {
                out.push(`<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\. /, ''))}</li>`).join('')}</ol>`);
            } else if (/^#{1,3} /.test(lines[0]) && lines.length === 1) {
                out.push(`<h3>${inline(lines[0].replace(/^#+ /, ''))}</h3>`);
            } else {
                out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
            }
        }
    }
    return out.join('');
}
