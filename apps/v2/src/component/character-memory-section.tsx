import { useId, useState } from "react";

import "./character-memory-section.css";

// 版（character_version.content_json）に入る記憶の方針そのもの。
// 節の枠（RIT-52/RIT-126 側）ができた時にそのまま移せるよう、value/onChange だけを受け取る。
export type CharacterMemoryPolicy = {
  memoryInstruction: string;
  memoryKinds: ("fact" | "preference")[];
};

const KINDS = [
  { kind: "fact", label: "事実" },
  { kind: "preference", label: "好み" },
] as const;

// 畳んだ時の 1 行。「事実と好みを覚える」は板の文言。残り 3 つは板に無く、
// 票の「未決」の既定の案（事実を覚える／好みを覚える／何も覚えない）を使う。
export const memoryKindsSummary = (kinds: readonly ("fact" | "preference")[]): string => {
  const fact = kinds.includes("fact");
  const preference = kinds.includes("preference");
  if (fact && preference) return "事実と好みを覚える";
  if (fact) return "事実を覚える";
  if (preference) return "好みを覚える";
  return "何も覚えない";
};

export const CharacterMemorySection = ({
  value,
  onChange,
}: {
  value: CharacterMemoryPolicy;
  onChange: (next: CharacterMemoryPolicy) => void;
}) => {
  const [open, setOpen] = useState(false);
  const instructionId = useId();
  const toggleKind = (kind: "fact" | "preference") => {
    onChange({
      ...value,
      memoryKinds: value.memoryKinds.includes(kind)
        ? value.memoryKinds.filter((item) => item !== kind)
        : [...value.memoryKinds, kind],
    });
  };

  return (
    <section className="v2-memory-section" aria-label="記憶">
      <button
        type="button"
        className="v2-memory-section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="v2-memory-section-heading">
          <span className="v2-memory-section-title">記憶</span>
          {!open && (
            <span className="v2-memory-section-summary">
              {memoryKindsSummary(value.memoryKinds)}
            </span>
          )}
        </span>
        <span className="v2-memory-section-chevron" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 9l7 7 7-7" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="v2-memory-section-body">
          <div className="v2-memory-field">
            <label htmlFor={instructionId}>何を覚えるか</label>
            <textarea
              id={instructionId}
              rows={3}
              maxLength={2000}
              value={value.memoryInstruction}
              onChange={(event) => onChange({ ...value, memoryInstruction: event.target.value })}
            />
          </div>
          <div role="group" aria-label="覚える種類" className="v2-memory-kinds">
            <div className="v2-memory-kinds-heading">覚える種類</div>
            <div className="v2-memory-kinds-buttons">
              {KINDS.map(({ kind, label }) => (
                <button
                  type="button"
                  key={kind}
                  className="v2-memory-kind"
                  aria-pressed={value.memoryKinds.includes(kind)}
                  aria-label={`覚える種類: ${label}`}
                  onClick={() => toggleKind(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="v2-memory-note">両方切ると、何も覚えません。</p>
          </div>
          <p className="v2-memory-note">
            覚えた事は、会話ごとに見られます。
            <br />
            トークの「≡」→「記憶」にあります。
          </p>
        </div>
      )}
    </section>
  );
};
