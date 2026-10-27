import { useCallback, useEffect, useId, useRef, useState } from "react";

import { DocumentPanel } from "./document-panel";
import { MemoryManager } from "./memory-manager";
import { ProactiveSettings } from "./proactive-settings";

import "./consumer-panel.css";

export type ConsumerPanelProps = { characterId: string; conversationId: string | null };
type Setting = "memory" | "document" | "proactive";
const SETTINGS: { id: Setting; label: string }[] = [
  { id: "memory", label: "記憶" },
  { id: "document", label: "資料" },
  { id: "proactive", label: "自発通知" },
];

const ConsumerContent = ({
  setting,
  characterId,
  conversationId,
}: ConsumerPanelProps & { setting: Setting }) => {
  if (setting === "proactive")
    return <ProactiveSettings key={characterId} characterId={characterId} />;
  if (setting === "document")
    return (
      <DocumentPanel
        key={`${characterId}:${conversationId ?? "new"}`}
        characterId={characterId}
        conversationId={conversationId}
      />
    );
  return conversationId ? (
    <MemoryManager key={conversationId} conversationId={conversationId} />
  ) : (
    <p className="v2-consumer-note" role="status">
      最初の会話後に記憶を管理できます。最初の返信が保存されるまでお待ちください。
    </p>
  );
};

const ConsumerDialog = ({
  characterId,
  conversationId,
  onClose,
}: ConsumerPanelProps & { onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [setting, setSetting] = useState<Setting>("memory");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  return (
    <dialog ref={dialog} className="v2-consumer-dialog" aria-labelledby={title} onClose={onClose}>
      <header className="v2-consumer-header">
        <h2 id={title}>会話の設定</h2>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="会話の設定を閉じる"
        >
          閉じる
        </button>
      </header>
      <nav className="v2-consumer-nav" aria-label="設定の項目">
        {SETTINGS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={setting === item.id}
            onClick={() => setSetting(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="v2-consumer-body">
        <ConsumerContent
          setting={setting}
          characterId={characterId}
          conversationId={conversationId}
        />
      </div>
    </dialog>
  );
};

export const ConsumerPanel = (props: ConsumerPanelProps) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={trigger}
        className="v2-consumer-trigger"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        会話の設定
      </button>
      {open && <ConsumerDialog {...props} onClose={close} />}
    </>
  );
};
