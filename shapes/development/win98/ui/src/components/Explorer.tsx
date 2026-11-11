import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";
type Entry = {
  name: string;
  directory: boolean;
  link: boolean;
  size: number;
  modified: string;
};
type Listing = { location: string; entries: Entry[] };
type Place = { volume: "workspace" | "documents" | null; path: string };
const bytes = (size: number) =>
  size < 1024
    ? `${size} 字节`
    : `${Math.ceil(size / 1024).toLocaleString()} KB`;

export function Explorer({
  onNote,
  onAbout,
}: {
  onNote: () => void;
  onAbout: () => void;
}) {
  const [place, setPlace] = useState<Place>({ volume: null, path: "" });
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [icons, setIcons] = useState(false);
  const previewRequest = useRef(0);

  useEffect(() => {
    if (!place.volume) return;
    previewRequest.current += 1;
    let canceled = false;
    setLoading(true);
    setOpening(false);
    setError("");
    setListing(null);
    setSelected("");
    setPreview(null);
    api<Listing>(
      "GET",
      `/api/files?volume=${place.volume}&path=${encodeURIComponent(place.path)}`,
    )
      .then((result) => {
        if (!canceled) setListing(result);
      })
      .catch((cause) => {
        if (!canceled) setError(cause.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [place, revision]);

  const open = async (entry: Entry) => {
    const path = [place.path, entry.name].filter(Boolean).join("/");
    if (entry.directory) {
      setPlace({ volume: place.volume, path });
      return;
    }
    if (place.volume === "documents" && path === "note.txt") {
      onNote();
      return;
    }
    setError("");
    setOpening(true);
    const request = ++previewRequest.current;
    try {
      const file = await api<{ name: string; text: string }>(
        "GET",
        `/api/file?volume=${place.volume}&path=${encodeURIComponent(path)}`,
      );
      if (request === previewRequest.current) setPreview(file);
    } catch (cause) {
      if (request === previewRequest.current)
        setError((cause as Error).message);
    } finally {
      if (request === previewRequest.current) setOpening(false);
    }
  };
  const up = () => {
    previewRequest.current += 1;
    setOpening(false);
    setError("");
    if (preview) {
      setPreview(null);
      return;
    }
    if (!place.path) {
      setPlace({ volume: null, path: "" });
      return;
    }
    setPlace({
      volume: place.volume,
      path: place.path.split("/").slice(0, -1).join("/"),
    });
  };
  const label = place.volume === "workspace" ? "应用源码" : "我的文档";
  return (
    <div className="explorer-app app-column">
      <nav className="menubar">
        <button
          onClick={() => {
            setPlace({ volume: null, path: "" });
            setError("");
            setPreview(null);
          }}
        >
          我的电脑(<u>C</u>)
        </button>
        <button onClick={() => setIcons(!icons)}>
          查看：{icons ? "图标" : "详细信息"}
        </button>
        <button onClick={onAbout}>
          帮助(<u>H</u>)
        </button>
      </nav>
      <div className="explorer-toolbar">
        <button disabled={!place.volume} onClick={up}>
          <Icon name="up" size={22} />
          <span>向上</span>
        </button>
        <i />
        <button
          onClick={() => {
            setPreview(null);
            refresh((value) => value + 1);
          }}
        >
          <span className="refresh-symbol">↻</span>
          <span>刷新</span>
        </button>
        <i />
        <button onClick={onNote}>
          <Icon name="notepad" size={22} />
          <span>记事本</span>
        </button>
      </div>
      <div className="address-bar">
        <span>
          地址(<u>D</u>)
        </span>
        <div className="inset">
          <Icon name={place.volume ? "folder" : "computer"} size={16} />
          <span>
            {place.volume
              ? `${label}${place.path ? ` / ${place.path}` : ""}`
              : "我的电脑"}
          </span>
        </div>
      </div>
      <div className="explorer-content inset">
        {!place.volume ? (
          <div className="drive-view">
            <div className="explorer-heading">
              <Icon name="computer" size={40} />
              <div>
                <h2>我的电脑</h2>
                <p>选择要浏览的文件夹。</p>
              </div>
            </div>
            <div className="drives">
              <button
                onDoubleClick={() =>
                  setPlace({ volume: "workspace", path: "" })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    setPlace({ volume: "workspace", path: "" });
                }}
                onClick={() => setSelected("workspace")}
                className={selected === "workspace" ? "selected-file" : ""}
              >
                <Icon name="drive" />
                <span>
                  <b>应用源码</b>
                  <small>iimos 98</small>
                </span>
              </button>
              <button
                onDoubleClick={() =>
                  setPlace({ volume: "documents", path: "" })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    setPlace({ volume: "documents", path: "" });
                }}
                onClick={() => setSelected("documents")}
                className={selected === "documents" ? "selected-file" : ""}
              >
                <Icon name="folder" />
                <span>
                  <b>我的文档</b>
                  <small>本机文件</small>
                </span>
              </button>
            </div>
          </div>
        ) : preview ? (
          <div className="file-preview">
            <div>
              <Icon name="file" size={16} />
              <b>{preview.name}</b>
              <button onClick={() => setPreview(null)}>关闭预览</button>
            </div>
            <pre>{preview.text}</pre>
          </div>
        ) : (
          <>
            {!icons && (
              <div className="file-columns">
                <span>名称</span>
                <span>大小</span>
                <span>类型</span>
              </div>
            )}
            {loading && <p className="explorer-notice">正在读取文件…</p>}
            {!loading && !listing?.entries.length && !error && (
              <div className="empty-folder">
                <Icon name="folder" size={48} />
                <p>此文件夹为空</p>
                {place.volume === "documents" && (
                  <button className="classic-button" onClick={onNote}>
                    新建便笺
                  </button>
                )}
              </div>
            )}
            <div className={icons ? "file-icons" : "file-list"}>
              {listing?.entries.map((entry) => (
                <button
                  key={entry.name}
                  className={`file-entry ${selected === entry.name ? "selected-file" : ""}`}
                  onClick={() => setSelected(entry.name)}
                  onDoubleClick={() => {
                    void open(entry);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void open(entry);
                  }}
                  title={entry.name}
                >
                  <span>
                    <Icon
                      name={entry.directory ? "folder" : "file"}
                      size={icons ? 32 : 16}
                    />
                    <span>{entry.name}</span>
                  </span>
                  {!icons && (
                    <>
                      <span>{entry.directory ? "" : bytes(entry.size)}</span>
                      <span>
                        {entry.directory
                          ? "文件夹"
                          : entry.link
                            ? "链接"
                            : "文件"}
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {error && (
        <div className="explorer-error error-text" role="alert">
          {error}
        </div>
      )}
      <footer className="statusbar">
        <span>
          {opening
            ? "正在打开文件…"
            : place.volume
              ? `${listing?.entries.length || 0} 个对象`
              : "2 个对象"}
        </span>
        <span title={listing?.location}>
          {place.volume ? label : "我的电脑"}
        </span>
      </footer>
    </div>
  );
}
