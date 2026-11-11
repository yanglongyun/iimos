import { useEffect, useState } from "react";
import type { Config } from "../types";
import { Icon } from "./Icon";
export function Settings({
  config,
  onSave,
}: {
  config: Config | null;
  onSave: (patch: Record<string, string>) => Promise<Config>;
}) {
  const [values, setValues] = useState({
    responsesUrl: "",
    apiKey: "",
    model: "",
    contextWindow: "128000",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
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
    <form
      className="settings-app app-column"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await onSave(values);
          setFailure(false);
          setMessage("模型设置已保存。");
          setValues((previous) => ({ ...previous, apiKey: "" }));
        } catch (error) {
          setFailure(true);
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="property-tabs">
        <span>模型</span>
      </div>
      <div className="property-page">
        <div className="settings-heading">
          <Icon name="settings" />
          <p>
            配置模型连接。
            <br />
            API Key 保存在本机。
          </p>
        </div>
        <fieldset>
          <legend>连接设置</legend>
          <label>
            <span>
              服务地址(<u>U</u>)：
            </span>
            <input
              type="url"
              required
              value={values.responsesUrl}
              placeholder="https://…/v1/responses"
              autoComplete="off"
              onChange={(event) =>
                setValues({ ...values, responsesUrl: event.target.value })
              }
            />
          </label>
          <label>
            <span>
              API Key(<u>K</u>)：
            </span>
            <input
              type="password"
              required={!config?.hasKey}
              value={values.apiKey}
              placeholder={
                config?.hasKey ? "已保存，留空保持当前值" : "输入 API Key"
              }
              autoComplete="off"
              onChange={(event) =>
                setValues({ ...values, apiKey: event.target.value })
              }
            />
          </label>
          <label>
            <span>
              模型名称(<u>M</u>)：
            </span>
            <input
              required
              value={values.model}
              autoComplete="off"
              onChange={(event) =>
                setValues({ ...values, model: event.target.value })
              }
            />
          </label>
          <label>
            <span>上下文窗口：</span>
            <div className="number-field">
              <input
                type="number"
                min="4000"
                step="1"
                required
                value={values.contextWindow}
                onChange={(event) =>
                  setValues({ ...values, contextWindow: event.target.value })
                }
              />
              <span>token</span>
            </div>
          </label>
        </fieldset>
        <p className="property-note">
          服务需支持 Responses 协议。对话达到上下文窗口的 70%
          时，会自动压缩早期消息。
        </p>
        <p
          className={`settings-message ${failure ? "error-text" : ""}`}
          role="status"
        >
          {message}
        </p>
      </div>
      <footer className="dialog-actions">
        <span>{config?.ready ? "已配置模型" : "尚未配置模型"}</span>
        <button
          className="classic-button primary"
          disabled={busy}
          type="submit"
        >
          {busy ? "保存中…" : "保存设置"}
        </button>
      </footer>
    </form>
  );
}
