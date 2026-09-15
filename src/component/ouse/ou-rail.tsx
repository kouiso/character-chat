import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { Character } from "@/lib/api";

interface OuRailProps {
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string) => void;
  onAddCharacter?: () => void;
  onUtage?: () => void;
  onSettings?: () => void;
}

export const OuRail = ({
  characters,
  activeCharacterId,
  onSelectCharacter,
  onAddCharacter,
  onUtage,
  onSettings,
}: OuRailProps) => (
  <nav className="ou-rail">
    <div className="ou-rail-mark">逢</div>
    <div className="ou-rail-faves">
      {characters.map((char) => (
        <button
          key={char.id}
          type="button"
          className={`ou-rail-item${char.id === activeCharacterId ? " is-active" : ""}`}
          onClick={() => onSelectCharacter(char.id)}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}
        >
          <div className="ou-rail-ic" style={{ overflow: "hidden" }}>
            {char.avatar ? (
              <AuthenticatedImage
                src={char.avatar}
                alt={char.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                fallback={
                  <span
                    style={{
                      fontFamily: "'Shippori Mincho','Noto Serif JP',serif",
                      fontSize: 16,
                      color: "rgba(251,247,239,.7)",
                    }}
                  >
                    {char.name[0]}
                  </span>
                }
              />
            ) : (
              <span
                style={{
                  fontFamily: "'Shippori Mincho','Noto Serif JP',serif",
                  fontSize: 16,
                  color: "rgba(251,247,239,.7)",
                }}
              >
                {char.name[0]}
              </span>
            )}
          </div>
          <span className="ou-fly">{char.name}</span>
        </button>
      ))}
    </div>
    <div className="ou-rail-bottom">
      {onAddCharacter && (
        <button
          type="button"
          className="ou-rail-item"
          onClick={() => onAddCharacter()}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}
        >
          <div className="ou-rail-add" style={{ color: "rgba(251,247,239,.44)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="ou-fly">追加</span>
        </button>
      )}
      {onUtage && (
        <button
          type="button"
          className="ou-rail-item"
          onClick={onUtage}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}
        >
          <div className="ou-rail-add" style={{ color: "rgba(251,247,239,.44)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 5h10M4 5c0 3.5 1.5 6 4 6s4-2.5 4-6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <path
                d="M8 11v2.5M5.5 13.5h5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="ou-fly">宴</span>
        </button>
      )}
      {onSettings && (
        <button
          type="button"
          className="ou-rail-item"
          onClick={onSettings}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}
        >
          <div className="ou-rail-add" style={{ color: "rgba(251,247,239,.44)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M8 1.5v1.75M8 12.75V14.5M1.5 8h1.75M12.75 8H14.5M3.1 3.1l1.24 1.24M11.66 11.66l1.24 1.24M3.1 12.9l1.24-1.24M11.66 4.34l1.24-1.24"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="ou-fly">設定</span>
        </button>
      )}
    </div>
  </nav>
);
