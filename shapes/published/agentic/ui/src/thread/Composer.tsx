import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../icons/Icon";
import { send, stopRun, useThread } from "./store";
import { toast } from "../overlay/toast";

export function Composer() {
  const navigate = useNavigate();
  const showCreatedSession = (id: string) => {
    if (window.location.pathname === "/") {
      navigate(`/sessions/${id}`, { replace: true });
    }
  };
  const [text, setText] = useState("");
  const [images, setImages] = useState<Array<{ name: string; url: string }>>([]);
  const [reading, setReading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageVersion = useRef(0);
  const readingImages = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { busy, stopping, currentId, status, online, ready } = useThread();

  // 切换对话时清空输入和待发图片。
  useEffect(() => {
    imageVersion.current++;
    readingImages.current = false;
    setReading(false);
    setImages([]);
    setText("");
    if (areaRef.current) {
      areaRef.current.style.height = "auto";
    }
  }, [currentId]);
  useEffect(
    () => () => {
      imageVersion.current++;
    },
    [],
  );

  const canSend =
    online && ready && !busy && !reading && (text.trim().length > 0 || images.length > 0);

  const addImages = async (files: File[]) => {
    if (busy || readingImages.current || files.length === 0) {
      return;
    }
    if (images.length + files.length > 5) {
      toast("每条消息最多发送 5 张图片");
      return;
    }
    for (const file of files) {
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
        toast("仅支持 PNG、JPEG、GIF、WebP 图片");
        return;
      }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) {
        toast("图片不能为空，且每张不能超过 10 MiB");
        return;
      }
    }
    const version = imageVersion.current;
    readingImages.current = true;
    setReading(true);
    try {
      const selected: Array<{ name: string; url: string }> = [];
      for (const file of files) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
          reader.readAsDataURL(file);
        });
        selected.push({ name: file.name, url });
      }
      if (imageVersion.current === version) {
        setImages((current) => [...current, ...selected]);
      }
    } catch (error) {
      if (imageVersion.current === version) {
        toast(error instanceof Error ? error.message : "图片读取失败");
      }
    } finally {
      if (imageVersion.current === version) {
        readingImages.current = false;
        setReading(false);
      }
    }
  };

  const autosize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  };

  const submit = () => {
    if (!canSend) {
      return;
    }
    if (
      !send(
        text,
        null,
        showCreatedSession,
        images.map((image) => image.url),
      )
    ) {
      return;
    }
    setText("");
    setImages([]);
    if (areaRef.current) {
      areaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer" onClick={() => areaRef.current?.focus()}>
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((image, index) => (
              <div className="composer-image" key={index}>
                <img src={image.url} alt={image.name} />
                <button
                  type="button"
                  aria-label={`移除图片 ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setImages((current) => current.filter((_, position) => position !== index));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={2}
          value={text}
          placeholder="交给 Agent 一件事…"
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length > 0) {
              event.preventDefault();
              void addImages(files);
            }
          }}
          onChange={(event) => {
            setText(event.target.value);
            autosize(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            submit();
          }}
        />
        <div className="composer-bar">
          <div className="composer-left">
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void addImages(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="image-picker"
              title="添加图片（最多 5 张）"
              disabled={busy || reading || images.length === 5}
              onClick={(event) => {
                event.stopPropagation();
                imageInput.current?.click();
              }}
            >
              <Icon name="image" size={18} />
            </button>
            {images.length > 0 && <span className="model-tag">{images.length}/5</span>}
            {reading && <span className="model-tag">读取图片…</span>}
            {status && !status.model_ready && <span className="model-tag warn">模型尚未配置</span>}
          </div>
          <div className="composer-right">
            {status?.model && (
              <span className="model-tag clip" title={`模型:${status.model}`}>
                {status.model}
              </span>
            )}
            {busy ? (
              <button
                className="round stop"
                title={stopping ? "正在停止…" : "停止"}
                disabled={stopping}
                onClick={(event) => {
                  event.stopPropagation();
                  stopRun();
                }}
              >
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button
                className="round go"
                title="发送"
                disabled={!canSend}
                onClick={(event) => {
                  event.stopPropagation();
                  submit();
                }}
              >
                <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="foot-note">
        {status?.workdir ? `Agent 在 ${status.workdir} 执行命令、读写文件` : ""}
      </div>
    </div>
  );
}
