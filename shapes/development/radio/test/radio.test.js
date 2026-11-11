import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRadioStore, parseFeed, STATIONS } from "../server/radio.js";
const station = STATIONS[1];
const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://example.com/article</link><description><![CDATA[<p>来自宇宙的消息。</p><script>bad()</script>]]></description><pubDate>Wed, 11 Nov 2026 01:00:00 GMT</pubDate></item><item><title>unsafe</title><link>javascript:alert(1)</link></item><item><title>duplicate</title><link>https://example.com/article</link></item></channel></rss>`;
function setup(t, fetcher) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "radio-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  return { data, radio: createRadioStore(data, fetcher) };
}
test("RSS 解码并去重，拒绝脚本链接，正文移除 HTML 与脚本", () => {
  const items = parseFeed(xml, station);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "A & B");
  assert.equal(items[0].description, "来自宇宙的消息。");
  assert.equal(items[0].published, "2026-11-11T01:00:00.000Z");
  assert.throws(() => parseFeed("<html/>", station), { status: 502 });
});
test("频道读取缓存避免重复联网；断网时明确标注缓存与失败原因", async (t) => {
  let calls = 0;
  let online = true;
  const { radio } = setup(t, async () => {
    calls++;
    if (!online) throw new Error("offline");
    return new Response(xml);
  });
  const first = await radio.episodes("space");
  assert.equal(first.stale, false);
  await radio.episodes("space");
  assert.equal(calls, 1);
  online = false;
  const cached = await radio.episodes("space", true);
  assert.equal(cached.stale, true);
  assert.match(cached.error, /offline/);
  assert.deepEqual(cached.items, first.items);
});
test("没有缓存时不编造节目；未知频道与过大的来源明确报错", async (t) => {
  const { radio } = setup(t, async () => new Response("fail", { status: 503 }));
  await assert.rejects(radio.episodes("space"), { status: 502 });
  await assert.rejects(radio.episodes("unknown"), { status: 404 });
  const large = setup(
    t,
    async () =>
      new Response(xml, {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
  ).radio;
  await assert.rejects(large.episodes("space"), { status: 502 });
});
test("稍后收听写入本机，重开保持，取消收藏与非法链接校验有效", (t) => {
  const { data, radio } = setup(t);
  const episode = parseFeed(xml, station)[0];
  assert.equal(radio.toggle({ episode }).items.length, 1);
  assert.equal(createRadioStore(data).library().items[0].id, episode.id);
  assert.equal(radio.toggle({ episode }).items.length, 0);
  assert.throws(
    () => radio.toggle({ episode: { ...episode, url: "javascript:alert(1)" } }),
    { status: 400 },
  );
});
