import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useConversation } from "./store";
import { markdown } from "./markdown";
import { Settings } from "./components/Settings";
type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: string;
  exits: string[];
  visited: boolean;
  reachable: boolean;
  description?: string;
  enemy?: boolean;
};
type Entry = {
  turn: number;
  title: string;
  text: string;
  kind: string;
  roll?: { die: number; value: number; label: string };
};
type Game = {
  id: string;
  turn: number;
  status: string;
  position: string;
  visited: string[];
  searched: string[];
  rested: boolean;
  key: boolean;
  relic: boolean;
  hero: {
    name: string;
    role: string;
    hp: number;
    maxHp: number;
    attack: number;
    armor: number;
    gold: number;
    potions: number;
  };
  room: Room;
  rooms: Room[];
  enemy: { name: string; hp: number; defense: number } | null;
  journal: Entry[];
};

function Crest() {
  return (
    <svg viewBox="0 0 72 86" fill="none" aria-hidden="true">
      <path
        d="M9 7 36 1l27 6v44L36 82 9 51Z"
        fill="#171c1b"
        stroke="currentColor"
      />
      <path d="m22 21 14-7 14 7v28L36 65 22 49Z" stroke="currentColor" />
      <path d="M36 20v39M22 33h28M27 44l9 8 9-8" stroke="currentColor" />
      <path d="m32 7 4-5 4 5M13 53l23 23 23-23" stroke="currentColor" />
    </svg>
  );
}
export function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [reset, setReset] = useState(false);
  const [tab, setTab] = useState<"journal" | "chat">("journal");
  const [draft, setDraft] = useState("");
  const { state, send, stop, saveConfig, note } = useConversation();
  const log = useRef<HTMLDivElement>(null);
  const refresh = () =>
    api<Game>("GET", "/api/game")
      .then(setGame)
      .catch((cause) => setError(cause.message));
  useEffect(() => {
    void refresh();
  }, [state.items.length]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [game?.turn, state.items.length, state.partial, tab]);
  const act = async (action: string, target?: string) => {
    if (!game || busy) return;
    setBusy(true);
    setError("");
    try {
      setGame(
        await api("POST", "/api/game", {
          id: game.id,
          turn: game.turn,
          action,
          target,
        }),
      );
      setTab("journal");
      setReset(false);
    } catch (cause) {
      setError((cause as Error).message);
      if ((cause as { status?: number }).status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };
  const ask = async () => {
    const text = draft.trim();
    if (!text || state.running) return;
    if (!state.config?.ready) {
      setSettings(true);
      return;
    }
    setDraft("");
    setTab("chat");
    try {
      await send(text);
    } catch (cause) {
      note("error", (cause as Error).message);
      setDraft(text);
    }
  };
  if (!game)
    return (
      <main className="loading-screen">
        <Crest />
        <h1>暮光之下</h1>
        <p>{error || "正在展开冒险记录…"}</p>
        {error && <button onClick={() => void refresh()}>重试</button>}
      </main>
    );
  const last = game.journal.at(-1)!;
  const roll = [...game.journal].reverse().find((entry) => entry.roll)?.roll;
  const blocked = busy || state.running || game.status !== "playing";
  return (
    <div className="dungeon-app">
      <header className="campaign-header">
        <div className="brand-mark">
          <Crest />
          <div>
            <span>THE TWILIGHT VAULT</span>
            <b>暮光之下</b>
          </div>
        </div>
        <div className="campaign-meta">
          <span>
            <i />
            单人冒险
          </span>
          <span>第 {String(game.turn).padStart(2, "0")} 回合</span>
          <button onClick={() => setSettings(true)}>模型设置</button>
        </div>
      </header>
      <div className="campaign-layout">
        <aside className="quest-panel">
          <div className="small-label">CAMPAIGN I</div>
          <h2>长夜将尽</h2>
          <p className="quest-description">
            废城下的火光尚未熄灭。
            <br />
            带回圣物，让黎明重来。
          </p>
          <div className="quest-rule" />
          <h3>当前目标</h3>
          <ol className="objectives">
            <li className={game.key ? "complete" : "current"}>
              <span>{game.key ? "✓" : "01"}</span>
              <div>
                寻找月牙钥匙<small>无声书库</small>
              </div>
            </li>
            <li className={game.relic ? "complete" : game.key ? "current" : ""}>
              <span>{game.relic ? "✓" : "02"}</span>
              <div>
                取回暮光圣物<small>暮光祭坛</small>
              </div>
            </li>
            <li
              className={
                game.status === "victory"
                  ? "complete"
                  : game.relic
                    ? "current"
                    : ""
              }
            >
              <span>{game.status === "victory" ? "✓" : "03"}</span>
              <div>
                返回旧城门<small>离开地下城</small>
              </div>
            </li>
          </ol>
          <div className="quest-bottom">
            <span className="book-symbol">✧</span>
            <p>
              每一次掷骰，
              <br />
              都留在你的冒险记录里。
            </p>
            <button onClick={() => setReset(true)}>开始新的冒险</button>
          </div>
        </aside>
        <main className="adventure">
          <div className="room-kicker">
            <span>暮光城 / 地下一层</span>
            <span>
              已探索 {game.visited.length} / {game.rooms.length}
            </span>
          </div>
          <section className="room-scene">
            <div className="scene-arch" aria-hidden="true">
              <svg viewBox="0 0 300 150">
                <path d="M68 150V75a82 82 0 0 1 164 0v75M88 150V75a62 62 0 0 1 124 0v75M150 0v24M93 23l15 18m99-18-15 18M69 77h20m122 0h20" />
                <path d="M110 150v-45m80 45v-45M120 150l30-21 30 21" />
                <path
                  className="flame"
                  d="M146 105c-10-15 9-17 4-33 20 20 4 24 4 33Z"
                />
              </svg>
            </div>
            <div className="small-label">
              {game.enemy
                ? "ENCOUNTER"
                : game.status === "victory"
                  ? "ADVENTURE COMPLETE"
                  : "CURRENT LOCATION"}
            </div>
            <h1>
              {game.status === "victory"
                ? "黎明归来"
                : game.status === "defeated"
                  ? "最后一盏灯"
                  : game.room.name}
            </h1>
            <p>{game.room.description}</p>
            {game.enemy && (
              <div className="enemy-banner">
                <span>⚔</span>
                <div>
                  <b>{game.enemy.name}</b>
                  <small>防御 {game.enemy.defense}</small>
                </div>
                <span>生命 {game.enemy.hp}</span>
              </div>
            )}
          </section>
          <div className="log-tabs">
            <button
              className={tab === "journal" ? "on" : ""}
              onClick={() => setTab("journal")}
            >
              冒险日志
            </button>
            <button
              className={tab === "chat" ? "on" : ""}
              onClick={() => setTab("chat")}
            >
              与地下城主交谈{state.running && <i />}
            </button>
            <span>记录保存在本机</span>
          </div>
          <div
            className="adventure-log"
            ref={log}
            role="log"
            aria-live="polite"
          >
            {tab === "journal" ? (
              game.journal.map((entry) => (
                <article className="journal-entry" key={entry.turn}>
                  <span className="turn-label">
                    {String(entry.turn).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>
                      {entry.title}
                      {entry.roll && (
                        <span className="roll-tag">
                          D{entry.roll.die} · {entry.roll.value}
                        </span>
                      )}
                    </h3>
                    <p>{entry.text}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="dm-chat">
                {!state.items.length && (
                  <p className="dm-intro">
                    你可以询问地下城主的建议，或用自己的话描述行动。配置模型后，主持人会读取真实地图、掷骰和角色状态。
                  </p>
                )}
                {state.items.map((item, index) =>
                  item.type === "message" ? (
                    <article key={index} className={item.role}>
                      <b>{item.role === "user" ? "旅人" : "地下城主"}</b>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: markdown(
                            item.content
                              .map((part) => part.text || "")
                              .join(""),
                          ),
                        }}
                      />
                    </article>
                  ) : item.type === "local" ? (
                    <p key={index} className="error">
                      {item.text}
                    </p>
                  ) : null,
                )}
                {state.running && (
                  <article>
                    <b>地下城主</b>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: markdown(state.partial || "正在观察局势…"),
                      }}
                    />
                  </article>
                )}
              </div>
            )}
          </div>
          {error && (
            <p className="action-error" role="alert">
              {error}
            </p>
          )}
          <section className="action-panel">
            <div className="action-heading">
              <span>你要如何行动？</span>
              <small>{game.enemy ? "战斗中" : "选择动作或前往相邻房间"}</small>
            </div>
            {game.status === "playing" ? (
              <>
                <div className="action-buttons">
                  {game.enemy ? (
                    <>
                      <button
                        className="primary"
                        disabled={blocked}
                        onClick={() => void act("attack")}
                      >
                        ⚔ 攻击
                      </button>
                      <button
                        disabled={blocked}
                        onClick={() => void act("guard")}
                      >
                        ◇ 防御
                      </button>
                      <button
                        disabled={blocked}
                        onClick={() => void act("flee")}
                      >
                        撤退
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="primary"
                        disabled={
                          blocked || game.searched.includes(game.position)
                        }
                        onClick={() => void act("search")}
                      >
                        搜寻房间
                      </button>
                      {game.room.kind === "camp" && (
                        <button
                          disabled={blocked || game.rested}
                          onClick={() => void act("rest")}
                        >
                          在营地休息
                        </button>
                      )}
                      {(game.room.kind === "altar" ||
                        (game.room.kind === "gate" && game.relic)) && (
                        <button
                          disabled={
                            blocked ||
                            (game.room.kind === "altar" && game.relic)
                          }
                          onClick={() => void act("interact")}
                        >
                          {game.room.kind === "altar"
                            ? "取回圣物"
                            : "离开地下城"}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    disabled={
                      blocked ||
                      !game.hero.potions ||
                      game.hero.hp === game.hero.maxHp
                    }
                    onClick={() => void act("potion")}
                  >
                    恢复药水 <small>×{game.hero.potions}</small>
                  </button>
                </div>
                {!game.enemy && (
                  <div className="exits">
                    {game.rooms
                      .filter((room) => room.reachable)
                      .map((room) => (
                        <button
                          disabled={blocked}
                          key={room.id}
                          onClick={() => void act("move", room.id)}
                        >
                          前往{room.name} <span>↗</span>
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="game-end">
                <b>
                  {game.status === "victory"
                    ? "你已带回暮光圣物。"
                    : "你的冒险记录已保留。"}
                </b>
                <button onClick={() => setReset(true)}>再来一次</button>
              </div>
            )}
            <form
              className="free-action"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <input
                aria-label="向地下城主描述行动"
                placeholder="或用自己的话描述行动…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              {state.running ? (
                <button type="button" onClick={stop}>
                  停止
                </button>
              ) : (
                <button type="submit">↵</button>
              )}
            </form>
          </section>
        </main>
        <aside className="character-panel">
          <div className="character-card">
            <div className="hero-avatar">
              <Crest />
            </div>
            <span className="small-label">THE TRAVELLER</span>
            <h2>{game.hero.name}</h2>
            <p>人类 · {game.hero.role}</p>
            <div className="hp-label">
              <span>生命</span>
              <b>
                {game.hero.hp} <small>/ {game.hero.maxHp}</small>
              </b>
            </div>
            <div className="hp-track">
              <span
                style={{ width: `${(game.hero.hp / game.hero.maxHp) * 100}%` }}
              />
            </div>
            <div className="attributes">
              <div>
                <b>+{game.hero.attack}</b>
                <span>攻击</span>
              </div>
              <div>
                <b>{game.hero.armor}</b>
                <span>防御</span>
              </div>
              <div>
                <b>{game.hero.gold}</b>
                <span>金币</span>
              </div>
            </div>
          </div>
          <section className="map-section">
            <div className="panel-heading">
              <h3>地下城地图</h3>
              <span>第 1 层</span>
            </div>
            <svg
              className="dungeon-map"
              viewBox="0 0 280 210"
              aria-label="地下城房间地图"
            >
              {game.rooms.flatMap((room) =>
                room.exits
                  .filter((id) => room.id < id)
                  .map((id) => {
                    const target = game.rooms.find((value) => value.id === id)!;
                    return (
                      <line
                        key={room.id + id}
                        x1={32 + room.x * 70}
                        y1={32 + room.y * 70}
                        x2={32 + target.x * 70}
                        y2={32 + target.y * 70}
                      />
                    );
                  }),
              )}
              {game.rooms.map((room) => (
                <g
                  key={room.id}
                  className={`map-room ${room.visited ? "visited" : ""} ${room.id === game.position ? "here" : ""} ${room.reachable && !game.enemy ? "reachable" : ""}`}
                >
                  <rect
                    x={19 + room.x * 70}
                    y={19 + room.y * 70}
                    width="26"
                    height="26"
                  />
                  {room.id === game.position && (
                    <circle cx={32 + room.x * 70} cy={32 + room.y * 70} r="4" />
                  )}
                  <text x={32 + room.x * 70} y={60 + room.y * 70}>
                    {room.visited || room.reachable ? room.name : "未探索"}
                  </text>
                </g>
              ))}
            </svg>
            <div className="map-legend">
              <span>◆ 当前位置</span>
              <span>□ 已探索</span>
            </div>
          </section>
          <section className="inventory">
            <div className="panel-heading">
              <h3>行囊</h3>
              <span>{2 + Number(game.key) + Number(game.relic)} 件物品</span>
            </div>
            <div>
              <span>⚔</span>
              {game.hero.attack > 3 ? "精制短剑" : "短剑"}{" "}
              <small>攻击 +{game.hero.attack}</small>
            </div>
            <div>
              <span>♜</span>恢复药水 <small>×{game.hero.potions}</small>
            </div>
            {game.key && (
              <div>
                <span>⚿</span>月牙钥匙 <small>任务物品</small>
              </div>
            )}
            {game.relic && (
              <div className="relic-item">
                <span>✧</span>暮光圣物 <small>任务物品</small>
              </div>
            )}
          </section>
          <div className={`dice-panel ${busy ? "rolling" : ""}`}>
            <svg viewBox="0 0 80 80">
              <path d="m40 3 33 20v35L40 77 7 58V23Z" />
              <path d="m7 23 33-6 33 6-15 33H22L7 23m15 33 18 21 18-21M40 3v14L22 56m18-39 18 39" />
            </svg>
            <b>{roll?.value || "—"}</b>
            <div>
              <span>{roll?.label || "二十面骰"}</span>
              <small>{roll ? "最近一次检定" : "等待第一次检定"}</small>
            </div>
          </div>
        </aside>
      </div>
      <footer className="campaign-footer">
        <span>暮光之下 · 本地冒险</span>
        <span>真实掷骰 · 自动存档</span>
        <span>
          {game.status === "playing"
            ? "冒险进行中"
            : game.status === "victory"
              ? "冒险完成"
              : "冒险结束"}
        </span>
      </footer>
      {settings && (
        <Settings
          config={state.config}
          onSave={saveConfig}
          onClose={() => setSettings(false)}
        />
      )}
      {reset && (
        <div className="model-overlay">
          <section
            className="model-dialog"
            role="dialog"
            aria-label="开始新的冒险"
          >
            <h2>再踏入一次长夜？</h2>
            <p>当前冒险会归档保存。新的冒险将从旧城门开始。</p>
            <footer>
              <button onClick={() => setReset(false)}>继续当前冒险</button>
              <button onClick={() => void act("new")}>开始新的冒险</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
