type ChatHeaderControlsProps = {
  showInner: boolean;
  onToggleInner: () => void;
};

export const ChatHeaderControls = ({ showInner, onToggleInner }: ChatHeaderControlsProps) => (
  <button type="button" aria-pressed={showInner} onClick={onToggleInner}>
    <span>心の声</span>
    <span>{showInner ? "オン" : "オフ"}</span>
  </button>
);
