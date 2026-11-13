// 場面台帳の表示・手直しパネル（RIT-118）。
// 直した値は PATCH /api/chat/:id/ledger で最新台帳行を上書きし、次のターンの指示文へ入る。
import { useState, type ReactNode } from "react";

import { ledgerSchema, loadLedger, saveLedger, type LedgerData } from "../lib/ledger";

const PHASES = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

export const formatMap = (map: Record<string, string>): string =>
  Object.entries(map)
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");

// 「名前:状態」を行ごとに書く形。コロンの無い行は捨てる（中途半端な行で全部を失敗させんため）。
export const parseMapText = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"))
      .map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      })
      .filter(([key]) => key.length > 0),
  );

const splitList = (text: string): string[] =>
  text
    .split(/[、,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const describe = (ledger: LedgerData): [string, string][] => [
  ["段", ledger.phase],
  ["場所", ledger.location ?? "-"],
  ["時刻", ledger.time ?? "-"],
  ["居る人", ledger.present.join("、") || "-"],
  ["服", formatMap(ledger.clothing).replaceAll("\n", "、") || "-"],
  ["持ち物", formatMap(ledger.items).replaceAll("\n", "、") || "-"],
  ["体位", ledger.position ?? "-"],
  ["直前の行為", ledger.lastEvents.at(-1) ?? "-"],
];

type LedgerFields = { present: string; clothing: string; items: string; lastEvents: string };

type LedgerFormProps = {
  draft: LedgerData;
  fields: LedgerFields;
  saving: boolean;
  setDraft: (draft: LedgerData) => void;
  setField: (key: keyof LedgerFields) => (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

const LedgerForm = ({
  draft,
  fields,
  saving,
  setDraft,
  setField,
  onSave,
  onCancel,
}: LedgerFormProps) => (
  <div className="v2-ledger-form">
    <label>
      段
      <select
        value={draft.phase}
        onChange={(event) =>
          setDraft({
            ...draft,
            phase: event.target.value as LedgerData["phase"],
          })
        }
      >
        {PHASES.map((phase) => (
          <option key={phase} value={phase}>
            {phase}
          </option>
        ))}
      </select>
    </label>
    <label>
      場所
      <input
        value={draft.location ?? ""}
        onChange={(event) => setDraft({ ...draft, location: event.target.value || null })}
      />
    </label>
    <label>
      時刻
      <input
        value={draft.time ?? ""}
        onChange={(event) => setDraft({ ...draft, time: event.target.value || null })}
      />
    </label>
    <label>
      居る人（「、」区切り）
      <input value={fields.present} onChange={(event) => setField("present")(event.target.value)} />
    </label>
    <label>
      服（1行に「名前:状態」）
      <textarea
        value={fields.clothing}
        onChange={(event) => setField("clothing")(event.target.value)}
        rows={3}
      />
    </label>
    <label>
      持ち物（1行に「物:所在」）
      <textarea
        value={fields.items}
        onChange={(event) => setField("items")(event.target.value)}
        rows={3}
      />
    </label>
    <label>
      体位
      <input
        value={draft.position ?? ""}
        onChange={(event) => setDraft({ ...draft, position: event.target.value || null })}
      />
    </label>
    <label>
      出来事（1行1件、新しい順は末尾）
      <textarea
        value={fields.lastEvents}
        onChange={(event) => setField("lastEvents")(event.target.value)}
        rows={3}
      />
    </label>
    <div className="v2-ledger-actions">
      <button type="button" onClick={onSave} disabled={saving}>
        {saving ? "保存中…" : "保存する"}
      </button>
      <button type="button" onClick={onCancel} disabled={saving}>
        やめる
      </button>
    </div>
  </div>
);

type LedgerBodyProps = {
  ledger: LedgerData | null | undefined;
  hasError: boolean;
  editing: boolean;
  onStartEdit: () => void;
  form: ReactNode;
};

// 読込中・台帳なし・表示・手直しのどれか一つだけを出す。
const LedgerBody = ({ ledger, hasError, editing, onStartEdit, form }: LedgerBodyProps) => {
  if (ledger === undefined) return <p>読み込み中…</p>;
  if (ledger === null) {
    return hasError ? null : <p>まだ台帳がありません。最初の返信が届くと記録が始まります。</p>;
  }
  if (editing) return form;
  return (
    <>
      <dl className="v2-ledger-list">
        {describe(ledger).map(([label, value]) => (
          <div key={label} className="v2-ledger-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onStartEdit}>
        直す
      </button>
    </>
  );
};

type LedgerPanelProps = {
  characterId: string;
  getConversationId: () => string | null;
};

export const LedgerPanel = ({ characterId, getConversationId }: LedgerPanelProps) => {
  const [open, setOpen] = useState(false);
  const [ledger, setLedger] = useState<LedgerData | null | undefined>(undefined);
  const [draft, setDraft] = useState<LedgerData | null>(null);
  const [fields, setFields] = useState<LedgerFields>({
    present: "",
    clothing: "",
    items: "",
    lastEvents: "",
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openPanel = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setEditing(false);
    setError(null);
    setNotice(null);
    const conversationId = getConversationId();
    if (!conversationId) {
      setLedger(null);
      return;
    }
    try {
      const loaded = await loadLedger(characterId, conversationId, new AbortController().signal);
      setLedger(loaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "台帳を読み込めませんでした。");
    }
  };

  const startEdit = () => {
    if (!ledger) return;
    setDraft({ ...ledger });
    setFields({
      present: ledger.present.join("、"),
      clothing: formatMap(ledger.clothing),
      items: formatMap(ledger.items),
      lastEvents: ledger.lastEvents.join("\n"),
    });
    setEditing(true);
    setNotice(null);
  };

  const save = async () => {
    const conversationId = getConversationId();
    if (!conversationId || !draft) return;
    const next: LedgerData = {
      ...draft,
      present: splitList(fields.present),
      clothing: parseMapText(fields.clothing),
      items: parseMapText(fields.items),
      lastEvents: fields.lastEvents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
    const parsed = ledgerSchema.safeParse(next);
    if (!parsed.success) {
      setError("台帳の形が正しくありません。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const turn = await saveLedger(characterId, conversationId, parsed.data);
      if (turn === null) {
        setError("まだ保存された台帳がありません。");
        return;
      }
      setLedger(parsed.data);
      setEditing(false);
      setNotice(`保存しました（ターン${turn}）。次の返信からこの値が指示文に入ります。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "台帳を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: keyof typeof fields) => (value: string) =>
    setFields((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="v2-ledger">
      <button type="button" className="v2-ledger-toggle" onClick={() => void openPanel()}>
        台帳
      </button>
      {open && (
        <div className="v2-ledger-panel">
          {error && (
            <div className="v2-error" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="v2-ledger-notice">{notice}</div>}
          <LedgerBody
            ledger={ledger}
            hasError={error !== null}
            editing={editing}
            onStartEdit={startEdit}
            form={
              draft && (
                <LedgerForm
                  draft={draft}
                  fields={fields}
                  saving={saving}
                  setDraft={setDraft}
                  setField={setField}
                  onSave={() => void save()}
                  onCancel={() => setEditing(false)}
                />
              )
            }
          />
        </div>
      )}
    </div>
  );
};
