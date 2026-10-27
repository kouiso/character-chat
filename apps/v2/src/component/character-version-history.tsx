import type { CharacterEditorState } from "../lib/character-contract";

export const CharacterVersionHistory = ({
  state,
  busy,
  confirmVersion,
  onSelect,
  onRestore,
  onCancel,
}: {
  state: CharacterEditorState;
  busy: boolean;
  confirmVersion: number | null;
  onSelect: (id: number) => void;
  onRestore: (id: number) => Promise<void>;
  onCancel: () => void;
}) => (
  <section aria-label="キャラクターの版履歴">
    <h2>前の版</h2>
    <p>戻しても会話や記憶は変更しません。</p>
    {state.versions.length === 0 && <p>まだ版が保存されていません。</p>}
    <ol>
      {state.versions.map((version) => (
        <li key={version.id}>
          <details>
            <summary>
              版 {version.id} · {new Date(version.createdAt).toLocaleString("ja-JP")}
              {version.id === state.currentVersionId ? "（現在の版）" : ""}
            </summary>
            <dl>
              {[
                ["名前", version.sheet.name],
                ["紹介", version.sheet.introduction],
                ["タグ", version.sheet.tags.join("、")],
                ["最初のひとこと", version.sheet.greeting],
                ["指示", version.sheet.systemPrompt],
                ["例文", version.sheet.exampleDialogue],
                ["世界", version.sheet.world],
                ["見た目", version.sheet.appearance],
                ["年齢", String(version.sheet.age)],
                ["区分", version.sheet.adultCategory === "general" ? "一般" : "成人向け"],
                [
                  "話しかけ",
                  version.sheet.proactiveSettings.enabled
                    ? `${version.sheet.proactiveSettings.intervalMinutes}分間隔`
                    : "無効",
                ],
              ].map(([label, text]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{text || "未設定"}</dd>
                </div>
              ))}
            </dl>
          </details>
          <button
            type="button"
            disabled={busy || version.id === state.currentVersionId}
            onClick={() => onSelect(version.id)}
          >
            版 {version.id} に戻す
          </button>
        </li>
      ))}
    </ol>
    {confirmVersion !== null && (
      <div role="group" aria-label="版を戻す確認">
        <p>現在の入力を破棄し、版 {confirmVersion} に戻します。</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void onRestore(confirmVersion);
          }}
        >
          入力を破棄して戻す
        </button>
        <button type="button" disabled={busy} onClick={() => onCancel()}>
          やめる
        </button>
      </div>
    )}
  </section>
);
