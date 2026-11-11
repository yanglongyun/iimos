import "./Settings.css";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { toast } from "../overlay/toast";
import { Icon } from "../icons/Icon";
import { useShell } from "./layout";
import { loadStatus, useThread } from "../thread/store";

interface ConfigView {
  responsesUrl: string;
  key_set: boolean;
  key_hint: string;
  model: string;
  context_window: number;
  system: string;
  compact_at: number;
  keep: number;
  compact_system: string;
  compact_prefix: string;
  workdir: string;
  run_timeout: number;
  timeout: number;
  max_output: number;
  paths: { data_dir: string; config: string };
}
interface Form {
  responsesUrl: string;
  apiKey: string;
  model: string;
  context_window: string;
  system: string;
  compact_at: string;
  keep: string;
  compact_system: string;
  compact_prefix: string;
  workdir: string;
  run_timeout: string;
  timeout: string;
  max_output: string;
}
type NumberField =
  | "context_window"
  | "compact_at"
  | "keep"
  | "run_timeout"
  | "timeout"
  | "max_output";
const toForm = (config: ConfigView): Form => ({
  responsesUrl: config.responsesUrl,
  apiKey: "",
  model: config.model,
  context_window: String(config.context_window),
  system: config.system,
  compact_at: String(config.compact_at),
  keep: String(config.keep),
  compact_system: config.compact_system,
  compact_prefix: config.compact_prefix,
  workdir: config.workdir,
  run_timeout: String(config.run_timeout),
  timeout: String(config.timeout),
  max_output: String(config.max_output),
});

export function Settings() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [value, setValue] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const status = useThread((state) => state.status);
  const shell = useShell();

  useEffect(() => {
    // 顺便刷新状态，插件连接情况显示最新的。
    void loadStatus();
    void api
      .get<ConfigView>("/api/config")
      .then((result) => {
        setConfig(result);
        setValue(toForm(result));
      })
      .catch((error) => toast(error instanceof Error ? error.message : "设置加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const field = (key: keyof Form, next: string) =>
    setValue((current) => (current ? { ...current, [key]: next } : null));
  const number = (key: NumberField) => {
    const input = value?.[key].trim();
    const result = Number(input);
    const minimum = key === "context_window" ? 0 : 1;
    if (!input || !Number.isSafeInteger(result) || result < minimum) {
      throw new Error(`${key} 必须填写大于等于 ${minimum} 的整数`);
    }
    return result;
  };

  const save = async () => {
    if (!value) {
      return;
    }
    if (!value.responsesUrl.trim() || !value.model.trim()) {
      toast("接口地址和模型不能为空");
      return;
    }
    if (!config?.key_set && !value.apiKey.trim()) {
      toast("请填写 API Key");
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        responsesUrl: value.responsesUrl,
        apiKey: value.apiKey.trim(),
        model: value.model,
        context_window: number("context_window"),
        system: value.system,
        compact_at: number("compact_at"),
        keep: number("keep"),
        compact_system: value.compact_system,
        compact_prefix: value.compact_prefix,
        workdir: value.workdir,
        run_timeout: number("run_timeout"),
        timeout: number("timeout"),
        max_output: number("max_output"),
      };
      await api.put("/api/config", patch);
      const saved = await api.get<ConfigView>("/api/config");
      setConfig(saved);
      setValue(toForm(saved));
      await loadStatus();
      toast("设置已保存", 2600);
    } catch (error) {
      toast(error instanceof Error ? error.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const numberField = (label: string, key: NumberField, note: string, min = 1) => (
    <label>
      <span>{label}</span>
      <div>
        <input
          className="field-input"
          type="number"
          min={min}
          step={1}
          value={value?.[key] ?? ""}
          onChange={(event) => field(key, event.target.value)}
        />
        <p className="sheet-note">{note}</p>
      </div>
    </label>
  );

  return (
    <section className="settings-page">
      <header className="topbar">
        <button
          className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
          title="展开侧栏"
          onClick={shell.toggleSidebar}
        >
          <Icon name="panel" size={17} />
        </button>
        <span className="topbar-title">设置</span>
      </header>
      <main className="settings-content">
        <div className="settings-panel">
          <div className="settings-heading">
            <h1>设置</h1>
            <p>模型连接与 Agent 行为保存在本机的 config.json 中,保存后立即生效。</p>
          </div>
          {loading ? (
            <div className="sheet-note">正在读取设置…</div>
          ) : !config || !value ? (
            <p className="sheet-error">设置读取失败，请重新打开设置。</p>
          ) : (
            <>
              <section className="settings-section">
                <div className="settings-section-title">模型</div>
                <div className="settings-form">
                  <label>
                    <span>接口地址</span>
                    <input
                      className="field-input mono"
                      value={value.responsesUrl}
                      placeholder="https://api.openai.com/v1/responses"
                      onChange={(event) => field("responsesUrl", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>API Key</span>
                    <div className="secret-field">
                      <input
                        className="field-input mono"
                        type={showKey ? "text" : "password"}
                        value={value.apiKey}
                        placeholder={
                          config.key_set
                            ? `已设置(${config.key_hint}),留空保持不变`
                            : "请输入 API Key"
                        }
                        onChange={(event) => field("apiKey", event.target.value)}
                      />
                      <button type="button" onClick={() => setShowKey((show) => !show)}>
                        {showKey ? "隐藏" : "显示"}
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>模型</span>
                    <input
                      className="field-input mono"
                      value={value.model}
                      placeholder="模型 ID"
                      onChange={(event) => field("model", event.target.value)}
                    />
                  </label>
                  {numberField(
                    "上下文窗口(token)",
                    "context_window",
                    "模型支持的最大上下文 token 数，0 表示未设置。压缩阈值必须小于已设置的窗口。",
                    0,
                  )}
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">指令</div>
                <div className="settings-form">
                  <label>
                    <span>主提示词</span>
                    <div>
                      <textarea
                        className="field-input settings-prompt"
                        rows={8}
                        value={value.system}
                        onChange={(event) => field("system", event.target.value)}
                      />
                      <p className="sheet-note">
                        支持变量 {"{{os}}"} {"{{arch}}"} {"{{host}}"} {"{{user}}"} {"{{workdir}}"}{" "}
                        {"{{time}}"}。
                      </p>
                    </div>
                  </label>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">压缩</div>
                <div className="settings-form">
                  {numberField(
                    "压缩阈值(token)",
                    "compact_at",
                    "对话达到此 token 数时总结早期上下文。",
                  )}
                  {numberField("压缩后保留条数", "keep", "压缩时保留最近的消息条数。")}
                  <label>
                    <span>压缩提示词</span>
                    <textarea
                      className="field-input settings-prompt"
                      rows={4}
                      value={value.compact_system}
                      onChange={(event) => field("compact_system", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>压缩摘要前缀</span>
                    <textarea
                      className="field-input settings-prompt"
                      rows={2}
                      value={value.compact_prefix}
                      onChange={(event) => field("compact_prefix", event.target.value)}
                    />
                  </label>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">执行</div>
                <div className="settings-form">
                  <label>
                    <span>工作目录</span>
                    <div>
                      <input
                        className="field-input mono"
                        value={value.workdir}
                        placeholder="留空使用用户目录"
                        onChange={(event) => field("workdir", event.target.value)}
                      />
                      <p className="sheet-note">Agent 执行命令和读写文件的默认目录,必须已存在。</p>
                    </div>
                  </label>
                  {numberField("回复超时(秒)", "run_timeout", "一次完整回复的最长时间。")}
                  {numberField("命令超时(秒)", "timeout", "shell 工具单次执行的最长时间。")}
                  {numberField(
                    "工具输出上限(字符)",
                    "max_output",
                    "单次工具结果保留的最多字符数,超出截断。",
                  )}
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">浏览器</div>
                <div className="settings-form">
                  <p className="sheet-note">
                    在 Chrome 或 Edge 里安装 agentic 插件后，Agent
                    就能打开网页、读取、点击和输入。它只操作自己打开的标签页（agentic
                    标签组），不碰你已经开着的页面。
                  </p>
                  <p className="sheet-note">
                    插件：
                    {status?.browser_connected
                      ? "已连接"
                      : "未连接（打开 agentic 后约 30 秒内自动连上）"}
                  </p>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">位置</div>
                <div className="settings-kv">
                  <div>
                    <span>版本</span>
                    <b>{status?.version || ""}</b>
                  </div>
                  <div>
                    <span>数据目录</span>
                    <b>{config.paths.data_dir}</b>
                  </div>
                  <div>
                    <span>配置文件</span>
                    <b>{config.paths.config}</b>
                  </div>
                </div>
              </section>
            </>
          )}
          <div className="settings-actions">
            <button
              className="btn btn-accent"
              disabled={loading || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
          </div>
        </div>
      </main>
    </section>
  );
}
