import { useEffect, useRef, type ReactNode } from "react";

import { TalkIcon } from "./talk-icon";

export const TalkSheet = ({
  title,
  onClose,
  children,
  open = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  open?: boolean;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open) dialog?.showModal();
    else dialog?.close();
    return () => dialog?.close();
  }, [open]);
  return (
    <dialog ref={ref} className="v2-talk-sheet" aria-label={title} onCancel={onClose}>
      <div className="v2-talk-sheet-content">
        <div className="v2-talk-handle" aria-hidden="true" />
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="閉じる" onClick={onClose}>
            <TalkIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
};
