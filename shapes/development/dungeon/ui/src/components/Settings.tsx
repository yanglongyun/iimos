import { useEffect, useState } from "react";
import type { Config } from "../types";
export function Settings({
  config,
  onSave,
  onClose,
}: {
  config: Config | null;
  onSave: (patch: Record<string, string>) => Promise<Config>;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    responsesUrl: "",
    apiKey: "",
    model: "",
    contextWindow: "128000",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (config)
      setValues({
        responsesUrl: config.responsesUrl,
        apiKey: "",
        model: config.model,
        contextWindow: String(config.contextWindow),
      });
  }, [config]);
  return (
    <div
      className="model-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="model-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="模型设置"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave(values);
            onClose();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <div>
            <small>MODEL CONNECTION</small>
            <h2>模型设置</h2>
          </div>
          <button type="button" aria-label="关闭模型设置" onClick={onClose}>
            ×
          </button>
        </header>
        <p>填入兼容 Responses 协议的服务。API Key 保存在本机。</p>
        <label>
          服务地址
          <input
            autoFocus
            type="url"
            required
            placeholder="https://…/v1/responses"
            value={values.responsesUrl}
            onChange={(event) =>
              setValues({ ...values, responsesUrl: event.target.value })
            }
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            required={!config?.hasKey}
            autoComplete="off"
            placeholder={
              config?.hasKey ? "已保存，留空保持当前值" : "输入 API Key"
            }
            value={values.apiKey}
            onChange={(event) =>
              setValues({ ...values, apiKey: event.target.value })
            }
          />
        </label>
        <div className="model-columns">
          <label>
            模型名称
            <input
              required
              value={values.model}
              onChange={(event) =>
                setValues({ ...values, model: event.target.value })
              }
            />
          </label>
          <label>
            上下文窗口
            <input
              type="number"
              required
              min="4000"
              value={values.contextWindow}
              onChange={(event) =>
                setValues({ ...values, contextWindow: event.target.value })
              }
            />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存设置"}
          </button>
        </footer>
      </form>
    </div>
  );
}
