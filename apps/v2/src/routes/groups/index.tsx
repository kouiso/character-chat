// パーティモード: グループ一覧＋作成（RIT-216・板 Groups）。2人以上のキャラ選択が要る。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from "@tanstack/react-router";

import {
  BackIcon,
  BottomBar,
  CheckIcon,
  EmptyState,
  ErrorCard,
  Face,
  PlusIcon,
  SubHeader,
} from "../../component/make-screen";
import { dayLabel } from "../../lib/day-label";
import { createGroup } from "../../lib/groups";
import { listCharacters } from "../../server/characters";
import { listUserGroups } from "../../server/groups";

import "../../component/clip-screen.css";

import type { CharacterListItem } from "../../server/characters";

const routeApi = getRouteApi("/groups/");

const MAX_MEMBERS = 8;

const shortName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

// 板の 5 列 × 2 段まで見せ、残りは「もっと見る」でひらく。選んだ子は畳んでも見えるようにする
const PICKER_FOLDED = 10;

const MemberPicker = ({
  characters,
  selected,
  full,
  onToggle,
}: {
  characters: CharacterListItem[];
  selected: string[];
  full: boolean;
  onToggle: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const shown = open
    ? characters
    : characters.filter((c, i) => i < PICKER_FOLDED || selected.includes(c.id));
  return (
    <>
      <div role="group" aria-label="参加する子" className="v2-clip-picker">
        {shown.map((character) => {
          const checked = selected.includes(character.id);
          return (
            <button
              key={character.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={character.name}
              className="v2-clip-pick"
              disabled={!checked && full}
              onClick={() => onToggle(character.id)}
            >
              <span className="v2-clip-pick-face">
                <Face id={character.id} name={character.name} avatar={character.avatar} />
                {checked && (
                  <span className="v2-clip-pick-check" aria-hidden="true">
                    <CheckIcon size={14} />
                  </span>
                )}
              </span>
              <span className="v2-clip-pick-name">{shortName(character.name)}</span>
            </button>
          );
        })}
      </div>
      {characters.length > PICKER_FOLDED && (
        <button
          type="button"
          className="v2-make-quiet-link v2-clip-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "たたむ" : "もっと見る"}
        </button>
      )}
    </>
  );
};

// 選んだ人数に応じた案内（板 Groups「参加する子」）
const MemberHints = ({
  selected,
  byId,
  full,
}: {
  selected: string[];
  byId: Map<string, CharacterListItem>;
  full: boolean;
}) => {
  if (selected.length === 0) {
    return <p className="v2-clip-hint">いっしょに話す子を選んでください。</p>;
  }
  return (
    <>
      {selected.length === 1 && <p className="v2-clip-hint">もう 1 人選んでください。</p>}
      {full && (
        <p className="v2-clip-hint">これ以上は選べません。誰かを外すと、ほかの子を選べます。</p>
      )}
      <p className="v2-clip-hint">
        あなたと {selected.length} 人・{selected.map((id) => byId.get(id)?.name ?? "").join("・")}
      </p>
    </>
  );
};

const NewGroup = ({
  characters,
  onBack,
}: {
  characters: CharacterListItem[];
  onBack: () => void;
}) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = selected.length >= 2 && Boolean(title.trim());
  const full = selected.length >= MAX_MEMBERS;
  const byId = new Map(characters.map((character) => [character.id, character]));

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < MAX_MEMBERS
          ? [...prev, id]
          : prev,
    );

  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { id } = await createGroup({
        title: title.trim(),
        characterIds: selected,
      });
      void navigate({ to: "/groups/$id", params: { id } });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="v2-make">
      <header className="v2-make-head">
        <button type="button" aria-label="戻る" className="v2-make-icon-button" onClick={onBack}>
          <BackIcon />
        </button>
        <h1>グループをつくる</h1>
      </header>
      <form
        className="v2-clip-body form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="v2-clip-field">
          <div className="v2-clip-label-row">
            <h2 className="v2-clip-label">参加する子</h2>
            {selected.length > 0 && (
              <span className="v2-clip-label-note">{selected.length} 人</span>
            )}
          </div>
          <MemberPicker characters={characters} selected={selected} full={full} onToggle={toggle} />
          <MemberHints selected={selected} byId={byId} full={full} />
        </div>
        <div className="v2-clip-field">
          <label htmlFor="group-title" className="v2-clip-label">
            グループの題
          </label>
          <input
            id="group-title"
            className="v2-make-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
          />
        </div>
        {failed && (
          <ErrorCard
            message="グループをつくれませんでした。"
            note="入れた内容は残っています。"
            onRetry={() => void create()}
          />
        )}
        <div className="v2-clip-submit">
          {!ready && (
            <p className="v2-clip-hint center">2 人以上を選んで題を入れると、つくれます。</p>
          )}
          <button type="submit" className="v2-make-primary" disabled={!ready || busy}>
            <span>{busy ? "つくっています" : "グループをつくる"}</span>
          </button>
        </div>
      </form>
    </main>
  );
};

const GroupsPage = () => {
  const { characters, groups } = routeApi.useLoaderData();
  const [making, setMaking] = useState(false);
  const byId = new Map(characters.map((character) => [character.id, character]));

  if (making) return <NewGroup characters={characters} onBack={() => setMaking(false)} />;

  if (groups.length === 0) {
    return (
      <main className="v2-make">
        <SubHeader title="グループ" back="/create" />
        <div className="v2-make-body">
          <EmptyState
            title="まだ、グループはありません"
            text={
              <>
                2 人以上の子を呼んで、
                <br />
                いっしょに話せます。
              </>
            }
          >
            <div className="v2-make-gap-8" aria-hidden="true" />
            <button
              type="button"
              className="v2-make-primary v2-make-wide"
              onClick={() => setMaking(true)}
            >
              <PlusIcon />
              <span>グループをつくる</span>
            </button>
          </EmptyState>
        </div>
      </main>
    );
  }

  return (
    <main className="v2-make has-bottom-bar">
      <SubHeader title="グループ" back="/create" />
      <div className="v2-make-body">
        <ul className="v2-make-list">
          {groups.map((group) => {
            const members = group.memberIds
              .map((id) => byId.get(id))
              .filter((member): member is CharacterListItem => Boolean(member));
            const lead = members[0];
            return (
              <li key={group.id} className="v2-make-row">
                <Link
                  to="/groups/$id"
                  params={{ id: group.id }}
                  aria-label={`グループ ${group.title} を開く`}
                  className="v2-make-row-link"
                >
                  <Face
                    id={lead?.id ?? group.id}
                    name={lead?.name ?? group.title}
                    avatar={lead?.avatar}
                  />
                  <span className="v2-make-row-text">
                    <span className="v2-make-row-name">{group.title}</span>
                    <span className="v2-make-row-note">
                      {members.length > 0
                        ? `あなたと ${members.length} 人・${members.map((m) => shortName(m.name)).join("・")}`
                        : "みんな削除されました"}
                    </span>
                  </span>
                  <span className="v2-make-row-date">{dayLabel(group.createdAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <BottomBar>
        <button type="button" className="v2-make-primary" onClick={() => setMaking(true)}>
          <PlusIcon />
          <span>グループをつくる</span>
        </button>
      </BottomBar>
    </main>
  );
};

const GroupsError = () => {
  const router = useRouter();
  return (
    <main className="v2-make">
      <SubHeader title="グループ" back="/create" />
      <div className="v2-make-body">
        <ErrorCard
          message="グループを読み込めませんでした。"
          onRetry={() => void router.invalidate()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/groups/")({
  loader: async ({ abortController }) => {
    const signal = abortController.signal;
    const [characters, groups] = await Promise.all([listCharacters({ signal }), listUserGroups()]);
    return { characters, groups };
  },
  errorComponent: GroupsError,
  component: GroupsPage,
});
