// 主题跟随系统:解析成 light/dark 写到 <html data-theme>,样式层只认这两个值。
const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply() {
  document.documentElement.dataset.theme = media.matches ? "dark" : "light";
}

export function initTheme() {
  apply();
  media.addEventListener("change", apply);
}
