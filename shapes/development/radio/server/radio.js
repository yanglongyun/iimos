import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export const STATIONS = [
  {
    id: "technology",
    name: "科技前沿",
    english: "TECHNOLOGY",
    frequency: 88.6,
    source: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    description: "新技术、独立开发与互联网。",
  },
  {
    id: "space",
    name: "宇宙来信",
    english: "SPACE & SCIENCE",
    frequency: 92.3,
    source: "NASA",
    url: "https://www.nasa.gov/feed/",
    description: "来自太空探索一线的消息。",
  },
  {
    id: "life",
    name: "数字生活",
    english: "DIGITAL LIFE",
    frequency: 97.8,
    source: "少数派",
    url: "https://sspai.com/feed",
    description: "工具、工作方式与生活里的好想法。",
  },
  {
    id: "ideas",
    name: "思想漫游",
    english: "ARTS & IDEAS",
    frequency: 104.2,
    source: "Aeon",
    url: "https://aeon.co/feed.rss",
    description: "哲学、文化与理解世界的新视角。",
  },
];
const hash = (text) =>
  crypto.createHash("sha256").update(text).digest("hex").slice(0, 20);
const fail = (status, message) => Object.assign(new Error(message), { status });
export function plain(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff)),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name],
    )
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function field(xml, tag) {
  return (
    xml.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
    )?.[1] || ""
  );
}
export function parseFeed(xml, station) {
  if (typeof xml !== "string" || !/<rss\b|<feed\b/i.test(xml))
    throw fail(502, "来源没有返回有效的 RSS 内容。");
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
    (match) => match[1],
  );
  const items = [];
  const seen = new Set();
  for (const block of blocks) {
    const title = plain(field(block, "title")).slice(0, 300);
    const raw = plain(field(block, "link"));
    let url;
    try {
      url = new URL(raw, station.url);
      if (!["http:", "https:"].includes(url.protocol)) continue;
    } catch {
      continue;
    }
    if (!title || !raw || seen.has(url.href)) continue;
    seen.add(url.href);
    const published = Date.parse(plain(field(block, "pubDate")));
    let description = plain(field(block, "description")).slice(0, 700);
    if (station.id === "technology") description = "";
    items.push({
      id: hash(url.href),
      station: station.id,
      title,
      url: url.href,
      description,
      source: station.source,
      published: Number.isFinite(published)
        ? new Date(published).toISOString()
        : null,
    });
    if (items.length >= 16) break;
  }
  if (!items.length) throw fail(502, "这个频道暂时没有可读取的条目。");
  return items;
}
export function createRadioStore(data, fetcher = fetch) {
  const directory = path.join(data, "radio");
  const feeds = path.join(directory, "feeds");
  fs.mkdirSync(feeds, { recursive: true });
  const libraryFile = path.join(directory, "library.json");
  function write(file, value) {
    fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
    fs.renameSync(file + ".tmp", file);
    return value;
  }
  function cache(id) {
    const file = path.join(feeds, id + ".json");
    return fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : null;
  }
  const inFlight = new Map();
  async function episodes(id, refresh = false) {
    const station = STATIONS.find((value) => value.id === id);
    if (!station) throw fail(404, "没有这个频道。");
    const saved = cache(id);
    if (
      !refresh &&
      saved &&
      Date.now() - Date.parse(saved.fetchedAt) < 15 * 60 * 1000
    )
      return { ...saved, stale: false };
    if (inFlight.has(id)) return inFlight.get(id);
    const work = (async () => {
      try {
        const response = await fetcher(station.url, {
          signal: AbortSignal.timeout(12000),
          headers: {
            "user-agent": "iimos-radio/1.0",
            accept: "application/rss+xml, application/xml, text/xml",
          },
        });
        if (!response.ok) throw new Error(`来源返回 ${response.status}`);
        if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024)
          throw new Error("来源内容过大");
        const reader = response.body.getReader();
        let total = 0;
        const chunks = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > 2 * 1024 * 1024) throw new Error("来源内容过大");
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const items = parseFeed(
          Buffer.concat(chunks).toString("utf8"),
          station,
        );
        return {
          ...write(path.join(feeds, id + ".json"), {
            station: id,
            fetchedAt: new Date().toISOString(),
            items,
          }),
          stale: false,
        };
      } catch (cause) {
        if (saved)
          return { ...saved, stale: true, error: `更新失败：${cause.message}` };
        throw fail(502, `暂时无法读取${station.source}，请稍后重试。`);
      } finally {
        inFlight.delete(id);
      }
    })();
    inFlight.set(id, work);
    return work;
  }
  function library() {
    return fs.existsSync(libraryFile)
      ? JSON.parse(fs.readFileSync(libraryFile, "utf8"))
      : { items: [] };
  }
  function toggle({ episode }) {
    if (
      !episode ||
      typeof episode.title !== "string" ||
      typeof episode.url !== "string" ||
      !STATIONS.some((station) => station.id === episode.station)
    )
      throw fail(400, "条目信息无效。");
    let url;
    try {
      url = new URL(episode.url);
    } catch {
      throw fail(400, "条目地址无效。");
    }
    if (!["https:", "http:"].includes(url.protocol))
      throw fail(400, "条目地址无效。");
    const id = hash(url.href);
    const saved = library();
    const existing = saved.items.some((item) => item.id === id);
    if (existing) saved.items = saved.items.filter((item) => item.id !== id);
    else {
      if (saved.items.length >= 500) throw fail(400, "最多保存 500 个条目。");
      saved.items.unshift({
        id,
        station: episode.station,
        title: plain(episode.title).slice(0, 300),
        url: url.href,
        description: plain(String(episode.description || "")).slice(0, 700),
        source: STATIONS.find((station) => station.id === episode.station)
          .source,
        published: episode.published || null,
        savedAt: new Date().toISOString(),
      });
    }
    return write(libraryFile, saved);
  }
  return { episodes, library, toggle };
}
