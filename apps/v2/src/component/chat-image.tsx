import { useEffect, useRef, useState } from "react";

export const ChatImage = ({ src }: { src: string }) => {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current;
    const onError = () => setFailed(true);
    element?.addEventListener("error", onError);
    return () => element?.removeEventListener("error", onError);
  }, [src, attempt, failed]);
  if (failed)
    return (
      <div role="status">
        画像を読み込めませんでした。
        <button
          type="button"
          onClick={() => {
            setAttempt((value) => value + 1);
            setFailed(false);
          }}
        >
          再読み込み
        </button>
      </div>
    );
  return (
    <img
      src={attempt ? `${src}?retry=${attempt}` : src}
      alt="会話に保存された画像"
      loading="lazy"
      ref={image}
    />
  );
};
