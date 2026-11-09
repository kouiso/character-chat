// RIT-208: 公開キャラの作者へ通貨を贈る入力欄。送信中の二重送信は busy と
// idempotencyKey の固定で防ぐ（成功したら新しいキーに持ち替える）。
import { useRef, useState } from "react";

import { sendTip } from "../lib/reactions";

export const TipPanel = ({ characterId }: { characterId: string }) => {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const idemRef = useRef(crypto.randomUUID());

  const submit = () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0 || busy) return;
    setBusy(true);
    setError(null);
    void sendTip(characterId, value, idemRef.current)
      .then(({ senderBalance }) => {
        setDone(value);
        setAmount("");
        idemRef.current = crypto.randomUUID();
        void senderBalance;
      })
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="v2-tip"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="number"
        min={1}
        step={1}
        value={amount}
        placeholder="贈与額"
        onChange={(event) => setAmount(event.target.value)}
      />
      <button type="submit" disabled={busy || !amount.trim()}>
        {busy ? "贈与中…" : "作者へ贈与"}
      </button>
      {done !== null && <span>{done} を贈りました</span>}
      {error && <span role="alert">{error}</span>}
    </form>
  );
};
