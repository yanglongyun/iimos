// 输入区:左边「+」加图片,中间圆角输入框,框里右侧是蓝色发送钮;回复中换成停止钮。
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

  // 切换对话时清空输入和待发图片,并把光标放进输入框。
  useEffect(() => {
    imageVersion.current++;
    readingImages.current = false;
    setReading(false);
    setImages([]);
    setText("");
    if (areaRef.current) {
      areaRef.current.style.height = "auto";
      areaRef.current.focus();
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
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
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
      {status && !status.model_ready && (
        <div className="composer-note warn">
          还没有配置模型,请先到设置里填写接口地址、API Key 和模型。
        </div>
      )}
      <div className="composer-row">
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
          className="round plus"
          title="添加图片（最多 5 张）"
          disabled={busy || reading || images.length === 5}
          onClick={() => imageInput.current?.click()}
        >
          <Icon name="plus" size={16} />
        </button>
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
                    <Icon name="close" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder="信息"
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
          {busy ? (
            <button
              className="round stop"
              title={stopping ? "正在停止…" : "停止"}
              disabled={stopping}
              onClick={(event) => {
                event.stopPropagation();
                void stopRun();
              }}
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              className={`round go${canSend ? " ready" : ""}`}
              title="发送"
              disabled={!canSend}
              onClick={(event) => {
                event.stopPropagation();
                submit();
              }}
            >
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
