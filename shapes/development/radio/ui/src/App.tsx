import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "./api";
import { useConversation } from "./store";
import { markdown } from "./markdown";
import { Settings } from "./components/Settings";
type Station = {
  id: string;
  name: string;
  english: string;
  frequency: number;
  source: string;
  url: string;
  description: string;
};
type Episode = {
  id: string;
  station: string;
  title: string;
  url: string;
  description: string;
  source: string;
  published: string | null;
  savedAt?: string;
};
type Feed = {
  station: string;
  fetchedAt: string;
  stale: boolean;
  error?: string;
  items: Episode[];
};
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      })
    : "—";
export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState("technology");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [library, setLibrary] = useState<Episode[]>([]);
  const [selected, setSelected] = useState(0);
  const [savedView, setSavedView] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [playback, setPlayback] = useState<"stopped" | "playing" | "paused">(
    "stopped",
  );
  const [volume, setVolume] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<"program" | "summary">("program");
  const [revision, setRevision] = useState(0);
  const forceRefresh = useRef(false);
  const [summarizing, setSummarizing] = useState(false);
  const speech = useRef(0);
  const station = stations.find((value) => value.id === stationId);
  const episodes = savedView ? library : feed?.items || [];
  const current = episodes[selected];
  const { state, send, stop, saveConfig, note } = useConversation();
  const audioAvailable = typeof speechSynthesis !== "undefined";
  const stopAudio = () => {
    speech.current += 1;
    if (audioAvailable) speechSynthesis.cancel();
    setPlayback("stopped");
  };
  useEffect(() => {
    api<{ stations: Station[] }>("GET", "/api/stations")
      .then((result) => setStations(result.stations))
      .catch((cause) => setError(cause.message));
    api<{ items: Episode[] }>("GET", "/api/library")
      .then((result) => setLibrary(result.items))
      .catch((cause) => setError(cause.message));
    return () => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    stopAudio();
    setLoading(true);
    setError("");
    setFeed(null);
    setSelected(0);
    setTab("program");
    api<Feed>(
      "GET",
      `/api/episodes?station=${stationId}${forceRefresh.current ? "&refresh=1" : ""}`,
    )
      .then((result) => {
        if (!canceled) setFeed(result);
      })
      .catch((cause) => {
        if (!canceled) setError(cause.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    forceRefresh.current = false;
    return () => {
      canceled = true;
    };
  }, [stationId, revision]);
  useEffect(() => {
    if (!state.running) setSummarizing(false);
  }, [state.running]);
  const speak = (episode: Episode) => {
    if (!audioAvailable) {
      setError("当前浏览器不支持语音朗读。你仍可以阅读条目。");
      return;
    }
    stopAudio();
    const request = ++speech.current;
    const text = `${episode.source}。${episode.title}。${episode.description || "此来源仅提供标题。你可以打开原文阅读完整内容。"}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u4e00-\u9fff]/.test(episode.title) ? "zh-CN" : "en-US";
    utterance.rate = speed;
    utterance.volume = volume;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((value) =>
      value.lang.toLowerCase().startsWith(utterance.lang.toLowerCase()),
    );
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      if (request === speech.current) setPlayback("playing");
    };
    utterance.onend = () => {
      if (request === speech.current) setPlayback("stopped");
    };
    utterance.onerror = (event) => {
      if (request !== speech.current) return;
      setPlayback("stopped");
      if (event.error !== "interrupted" && event.error !== "canceled")
        setError("语音朗读暂时不可用，请检查系统语音设置。");
    };
    speechSynthesis.speak(utterance);
  };
  const play = () => {
    if (!current) return;
    if (playback === "playing") {
      speechSynthesis.pause();
      setPlayback("paused");
    } else if (playback === "paused") {
      speechSynthesis.resume();
      setPlayback("playing");
    } else speak(current);
  };
  const choose = (index: number) => {
    const wasPlaying = playback === "playing";
    stopAudio();
    setSelected(index);
    setTab("program");
    if (wasPlaying && episodes[index]) speak(episodes[index]);
  };
  const save = async (episode: Episode) => {
    try {
      const result = await api<{ items: Episode[] }>("POST", "/api/library", {
        episode,
      });
      setLibrary(result.items);
      if (savedView) stopAudio();
      if (savedView)
        setSelected((value) =>
          Math.max(0, Math.min(value, result.items.length - 1)),
        );
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const summarize = async () => {
    if (!state.config?.ready) {
      setSettings(true);
      return;
    }
    if (!feed?.items.length) return;
    setTab("summary");
    setSummarizing(true);
    try {
      await send(
        `简报频道：${stationId}\n请把「${station?.name}」频道的以下真实 RSS 条目整理为一份适合朗读的中文简报。每条保留来源与原文链接；只根据所给材料，不增加未证实的事实。最后用一段话指出值得继续关注的主题。资料抓取时间：${feed.fetchedAt}\n\n${JSON.stringify(feed.items.slice(0, 8).map((item) => ({ title: item.title, source: item.source, url: item.url, excerpt: item.description })))}`,
      );
    } catch (cause) {
      note("error", (cause as Error).message);
      setSummarizing(false);
    }
  };
  const summaries: Record<string, string> = {};
  let requestStation = "";
  for (const item of state.items) {
    if (item.type !== "message") continue;
    const text = item.content.map((part) => part.text || "").join("");
    if (item.role === "user") {
      requestStation = text.match(/^简报频道：([a-z]+)\n/)?.[1] || "";
      if (requestStation) summaries[requestStation] = "";
    } else if (requestStation) {
      summaries[requestStation] = (summaries[requestStation] || "") + text;
    }
  }
  const summary =
    state.running && requestStation === stationId
      ? (summaries[stationId] || "") + state.partial
      : summaries[stationId] || "";
  const frequency = station?.frequency || 88.6;
  const frequencyPosition = ((frequency - 87.5) / 20.5) * 100;
  return (
    <div className="radio-app">
      <header className="radio-header">
        <div className="radio-brand">
          <span className="brand-orbit">◉</span>
          <div>
            <b>iimos radio</b>
            <span>主题频道 · 本地语音</span>
          </div>
        </div>
        <div className="radio-header-right">
          <span>
            <i />
            本机电台
          </span>
          <button onClick={() => setSettings(true)}>模型设置</button>
        </div>
      </header>
      <main className="radio-layout">
        <aside className="station-panel">
          <div className="eyebrow">YOUR FREQUENCIES</div>
          <h1>
            今天，
            <br />
            听点什么。
          </h1>
          <p>选择频道，收听来自公开来源的内容。</p>
          <div className="station-presets">
            {stations.map((value, index) => (
              <button
                key={value.id}
                className={!savedView && value.id === stationId ? "active" : ""}
                onClick={() => {
                  setSavedView(false);
                  setStationId(value.id);
                }}
              >
                <span className="preset-number">0{index + 1}</span>
                <div>
                  <b>{value.name}</b>
                  <small>{value.source}</small>
                </div>
                <span className="preset-frequency">
                  {value.frequency.toFixed(1)}
                </span>
                <i />
              </button>
            ))}
          </div>
          <button
            className={`saved-switch ${savedView ? "active" : ""}`}
            onClick={() => {
              stopAudio();
              setSavedView(!savedView);
              setSelected(0);
              setTab("program");
            }}
          >
            <span>◇</span>稍后收听 <b>{library.length}</b>
          </button>
          <div className="station-footnote">
            <span>RSS → 文字 → 声音</span>
            <p>
              内容来自公开订阅源。
              <br />
              语音由浏览器在本机播放。
            </p>
          </div>
        </aside>
        <section className="listening-room">
          <div className="section-title">
            <span>{savedView ? "YOUR COLLECTION" : "NOW TUNED TO"}</span>
            <span>
              {savedView ? "稍后收听" : station?.english || "正在连接"}
            </span>
          </div>
          <section
            className={`receiver ${playback === "playing" ? "is-playing" : ""}`}
            aria-label="电台播放器"
          >
            <span className="cabinet-screw top-left" />
            <span className="cabinet-screw top-right" />
            <span className="cabinet-screw bottom-left" />
            <span className="cabinet-screw bottom-right" />
            <div className="receiver-face">
              <div className="receiver-topline">
                <b>
                  IIMOS <span>R-01</span>
                </b>
                <div>
                  <i className={playback === "playing" ? "lit" : ""} />
                  <span>
                    {playback === "playing"
                      ? "ON AIR"
                      : playback === "paused"
                        ? "PAUSED"
                        : "STANDBY"}
                  </span>
                </div>
              </div>
              <div className="tuning-glass">
                <div className="scale-labels">
                  <span>FM</span>
                  {[88, 92, 96, 100, 104, 108].map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                  <span>MHz</span>
                </div>
                <div className="frequency-scale">
                  <span style={{ left: `${frequencyPosition}%` }} />
                </div>
                <div className="frequency-readout">
                  <span>{savedView ? "MEMORY" : station?.english}</span>
                  <b>
                    {frequency.toFixed(1)}
                    <small> MHz</small>
                  </b>
                </div>
                <div className="dial-shadow" />
                <input
                  className="tuning-input"
                  aria-label="调频"
                  title="拖动刻度切换频道"
                  type="range"
                  min="0"
                  max={Math.max(0, stations.length - 1)}
                  step="1"
                  value={Math.max(
                    0,
                    stations.findIndex((value) => value.id === stationId),
                  )}
                  disabled={!stations.length}
                  onChange={(event) => {
                    setSavedView(false);
                    setStationId(stations[Number(event.target.value)].id);
                  }}
                />
              </div>
              <div className="receiver-controls">
                <div className="speaker-grille" aria-hidden="true" />
                <div className="transport">
                  <button
                    aria-label="上一条"
                    title="上一条"
                    disabled={!current || selected === 0}
                    onClick={() => choose(selected - 1)}
                  >
                    ◀◀
                  </button>
                  <button
                    className="play-button"
                    aria-label={
                      playback === "playing"
                        ? "暂停朗读"
                        : playback === "paused"
                          ? "继续朗读"
                          : "开始朗读"
                    }
                    disabled={!current}
                    onClick={play}
                  >
                    {playback === "playing" ? "Ⅱ" : "▶"}
                  </button>
                  <button
                    aria-label="下一条"
                    title="下一条"
                    disabled={!current || selected >= episodes.length - 1}
                    onClick={() => choose(selected + 1)}
                  >
                    ▶▶
                  </button>
                </div>
                <div
                  className="volume-knob"
                  style={
                    {
                      "--rotation": `${volume * 260 - 130}deg`,
                    } as CSSProperties
                  }
                >
                  <div />
                  <label>
                    VOLUME
                    <input
                      aria-label="音量"
                      type="range"
                      min="0"
                      max="1"
                      step=".05"
                      value={volume}
                      onChange={(event) =>
                        setVolume(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="receiver-bottomline">
                <span>LOCAL VOICE RECEIVER</span>
                <span>STEREO · SERIES 01</span>
              </div>
            </div>
          </section>
          <div className="playback-line">
            <span>
              <i className={playback === "playing" ? "pulse" : ""} />
              {playback === "playing"
                ? "正在朗读"
                : playback === "paused"
                  ? "已暂停"
                  : current
                    ? "已就绪"
                    : "等待节目"}
            </span>
            <label>
              语速
              <select
                aria-label="朗读语速"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value="0.85">0.85×</option>
                <option value="1">1.0×</option>
                <option value="1.15">1.15×</option>
                <option value="1.3">1.3×</option>
              </select>
            </label>
            <span>
              {current ? `${selected + 1} / ${episodes.length}` : "—"}
            </span>
          </div>
          <div className="program-tabs">
            <button
              className={tab === "program" ? "on" : ""}
              onClick={() => setTab("program")}
            >
              播报内容
            </button>
            <button
              className={tab === "summary" ? "on" : ""}
              onClick={() => setTab("summary")}
            >
              频道简报
            </button>
            {!savedView && (
              <button
                className="make-summary"
                disabled={
                  loading || !feed?.items.length || state.running || summarizing
                }
                onClick={() => void summarize()}
              >
                ✦ {summarizing || state.running ? "正在整理…" : "生成中文简报"}
              </button>
            )}
          </div>
          {tab === "program" ? (
            <article className="program-content">
              {current ? (
                <>
                  <div className="program-source">
                    <span>{current.source}</span>
                    <span>{date(current.published)}</span>
                    <button
                      className={
                        library.some((value) => value.id === current.id)
                          ? "bookmarked"
                          : ""
                      }
                      onClick={() => void save(current)}
                    >
                      {library.some((value) => value.id === current.id)
                        ? "◆ 已收藏"
                        : "◇ 稍后收听"}
                    </button>
                  </div>
                  <h2>{current.title}</h2>
                  <p>
                    {current.description ||
                      "这个来源只提供标题。可以直接收听标题，或打开原文了解完整内容。"}
                  </p>
                  <a href={current.url} target="_blank" rel="noreferrer">
                    阅读原文 <span>↗</span>
                  </a>
                </>
              ) : (
                <div className="program-empty">
                  <span>◉</span>
                  <h2>
                    {loading && !savedView
                      ? "正在接收频道…"
                      : savedView
                        ? "还没有收藏的条目"
                        : "暂时没有节目"}
                  </h2>
                  <p>{error || "选择频道中的条目，加入稍后收听。"}</p>
                </div>
              )}
            </article>
          ) : (
            <article className="summary-content">
              <div className="summary-topline">
                <b>频道简报</b>
                <span>
                  {state.running ? "正在整理来源…" : "由你配置的模型生成"}
                </span>
                {state.running && <button onClick={stop}>停止</button>}
              </div>
              {summary ? (
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{ __html: markdown(summary) }}
                />
              ) : (
                <p>
                  根据当前频道的前八条 RSS
                  内容，生成一份中文简报。需要先在模型设置中配置连接。
                </p>
              )}
              {summary && !state.running && (
                <button
                  onClick={() =>
                    speak({
                      id: "summary",
                      station: stationId,
                      title: `${station?.name}，频道简报`,
                      description: summary
                        .replace(/[#*`]/g, "")
                        .replace(/https?:\/\/\S+/g, ""),
                      url: "",
                      source: "iimos 电台",
                      published: null,
                    })
                  }
                >
                  ▶ 朗读简报
                </button>
              )}
              {state.items
                .filter(
                  (item) => item.type === "local" && item.kind === "error",
                )
                .slice(-1)
                .map((item, index) => (
                  <p className="error" key={index}>
                    {item.type === "local" ? item.text : ""}
                  </p>
                ))}
            </article>
          )}
          {error && current && (
            <p className="radio-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="programme-panel">
          <div className="programme-heading">
            <div>
              <span className="eyebrow">PROGRAMME</span>
              <h2>{savedView ? "稍后收听" : station?.name || "节目单"}</h2>
            </div>
            {!savedView && (
              <button
                aria-label="刷新频道"
                title="刷新频道"
                disabled={loading}
                onClick={() => {
                  forceRefresh.current = true;
                  setRevision((value) => value + 1);
                }}
              >
                ↻
              </button>
            )}
          </div>
          <p className="programme-note">
            {savedView
              ? "保存下来的好内容，留待慢慢听。"
              : station?.description}
          </p>
          <div className="episode-list">
            {loading && !savedView ? (
              <p className="feed-status">正在读取公开 RSS…</p>
            ) : (
              episodes.map((episode, index) => (
                <button
                  key={episode.id}
                  className={index === selected ? "active" : ""}
                  onClick={() => choose(index)}
                >
                  <span className="episode-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{episode.title}</h3>
                    <small>
                      {episode.source}
                      <span>{date(episode.published)}</span>
                    </small>
                  </div>
                  {index === selected && (
                    <span className="episode-indicator">
                      {playback === "playing" ? "▮▮" : "▶"}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          {!savedView && (
            <div className="feed-footer">
              <span>
                {feed?.stale
                  ? "显示已缓存内容"
                  : feed
                    ? "频道已更新"
                    : "尚未连接"}
              </span>
              <small>
                {feed
                  ? new Date(feed.fetchedAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </small>
              {feed?.stale && <p>{feed.error}</p>}
              {error && !feed && (
                <button
                  onClick={() => {
                    forceRefresh.current = true;
                    setRevision((value) => value + 1);
                  }}
                >
                  重新接收
                </button>
              )}
            </div>
          )}
        </aside>
      </main>
      <footer className="radio-footer">
        <span>IIMOS RADIO — EST. 2026</span>
        <span>
          {audioAvailable
            ? "浏览器语音朗读 · 单篇播放"
            : "当前浏览器不支持语音朗读"}
        </span>
        <span>文字与语音，随时切换。</span>
      </footer>
      {settings && (
        <Settings
          config={state.config}
          onSave={saveConfig}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}
