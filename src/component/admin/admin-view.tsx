import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/component/ui/alert-dialog";
import { apiFetch } from "@/lib/api";

type AdminTab = "scores" | "images" | "test" | "dedup";
type Verdict = "nuketa" | "microm" | "dame";

type ScoreEntry = {
  type?: string;
  char?: string;
  judgment?: string;
  score?: number;
  image_ref?: string;
  run_id?: string;
  ts?: string;
  [key: string]: unknown;
};

type ReviewImage = {
  key: string;
  size: number;
};

type RatingRecord = {
  r2Key: string;
  verdict: Verdict;
  note: string;
  updatedAt: number;
};

type DedupCandidate = {
  reviewKey: string;
  subKey: string;
  size: number;
};

const VERDICT_LABELS: Record<Verdict, string> = {
  nuketa: "抜けた ✅",
  microm: "微妙 🤔",
  dame: "だめ ❌",
};

const VERDICT_COLORS: Record<Verdict, string> = {
  nuketa: "bg-green-700 hover:bg-green-600",
  microm: "bg-yellow-700 hover:bg-yellow-600",
  dame: "bg-red-800 hover:bg-red-700",
};

function normalizeImageRef(ref: string): string {
  return ref.replace(/^r2:adult-ai-images\//, "");
}

function matchScoreForKey(key: string, entries: ScoreEntry[]): ScoreEntry | undefined {
  return entries.find((e) => {
    if (!e.image_ref) return false;
    const normalized = normalizeImageRef(e.image_ref);
    if (normalized === key) return true;
    if (e.type === "eval" && key.startsWith(normalized)) return true;
    return false;
  });
}

function useKeyboardNav(active: boolean, onLeft: () => void, onRight: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") onLeft();
      if (e.key === "ArrowRight") onRight();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onLeft, onRight]);
}

type ScoresTabProps = {
  scores: ScoreEntry[];
  scoresFilter: string;
  setScoresFilter: (v: string) => void;
};

const ScoresTab = ({ scores, scoresFilter, setScoresFilter }: ScoresTabProps) => {
  const filtered = useMemo(() => {
    if (!scoresFilter) return scores;
    const query = scoresFilter.toLowerCase();
    return scores.filter(
      (e) =>
        String(e.char ?? "")
          .toLowerCase()
          .includes(query) ||
        String(e.judgment ?? "")
          .toLowerCase()
          .includes(query) ||
        String(e.score ?? "")
          .toLowerCase()
          .includes(query) ||
        String(e.type ?? "")
          .toLowerCase()
          .includes(query),
    );
  }, [scores, scoresFilter]);
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{scores.length} 件</span>
        <input
          type="search"
          placeholder="絞り込み (char / judgment / score...)"
          value={scoresFilter}
          onChange={(e) => setScoresFilter(e.target.value)}
          className="w-80 rounded border border-border bg-muted px-3 py-1 text-sm focus:outline-none"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="pb-1 pr-4">type</th>
              <th className="pb-1 pr-4">char</th>
              <th className="pb-1 pr-4">judgment</th>
              <th className="pb-1 pr-4">score</th>
              <th className="pb-1 pr-4">ts</th>
              <th className="pb-1">image_ref</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                <td className="py-0.5 pr-4 text-xs">{String(e.type ?? "")}</td>
                <td className="py-0.5 pr-4">{String(e.char ?? "")}</td>
                <td className="py-0.5 pr-4">{String(e.judgment ?? "")}</td>
                <td className="py-0.5 pr-4 font-mono">{String(e.score ?? "")}</td>
                <td className="py-0.5 pr-4 text-xs text-muted-foreground">{String(e.ts ?? "")}</td>
                <td className="max-w-xs truncate py-0.5 text-xs text-muted-foreground">
                  {String(e.image_ref ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type ImagesTabProps = {
  reviewImages: ReviewImage[];
  ratings: RatingRecord[];
  imagesCursor: string | null;
  imagesLoading: boolean;
  onLoadMore: (cursor: string) => void;
  onSelectImage: (idx: number) => void;
};

const ImagesTab = ({
  reviewImages,
  ratings,
  imagesCursor,
  imagesLoading,
  onLoadMore,
  onSelectImage,
}: ImagesTabProps) => (
  <div>
    <div className="mb-3 text-sm text-muted-foreground">{reviewImages.length} 件</div>
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {reviewImages.map((img, idx) => {
        const rating = ratings.find((r) => r.r2Key === img.key);
        return (
          <button
            key={img.key}
            type="button"
            className="relative overflow-hidden rounded border border-border text-left"
            onClick={() => onSelectImage(idx)}
          >
            <img
              src={`/api/admin/review/${encodeURIComponent(img.key)}`}
              alt={img.key}
              loading="lazy"
              className="h-28 w-full object-cover"
            />
            {rating && (
              <span
                className={`absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center text-xs font-bold text-white ${
                  rating.verdict === "nuketa"
                    ? "bg-green-700/80"
                    : rating.verdict === "microm"
                      ? "bg-yellow-700/80"
                      : "bg-red-800/80"
                }`}
              >
                {VERDICT_LABELS[rating.verdict]}
              </span>
            )}
          </button>
        );
      })}
    </div>
    {imagesCursor && (
      <button
        type="button"
        onClick={() => onLoadMore(imagesCursor)}
        disabled={imagesLoading}
        className="mt-4 rounded bg-muted px-4 py-2 text-sm disabled:opacity-50"
      >
        {imagesLoading ? "読み込み中..." : "もっと読む"}
      </button>
    )}
  </div>
);

const ScoreInfoPanel = ({ entry }: { entry: ScoreEntry }) => (
  <div className="rounded bg-muted p-3 text-sm">
    <p className="mb-1 font-medium">スコア台帳</p>
    <p>char: {String(entry.char ?? "")}</p>
    <p>score: {String(entry.score ?? "")}</p>
    <p>judgment: {String(entry.judgment ?? "")}</p>
  </div>
);

const RatingPanel = ({ rating }: { rating: RatingRecord }) => (
  <div className="rounded bg-muted p-3 text-sm">
    <p className="font-medium">過去判定: {VERDICT_LABELS[rating.verdict]}</p>
    {rating.note && <p className="text-muted-foreground">{rating.note}</p>}
  </div>
);

type TestTabProps = {
  reviewImages: ReviewImage[];
  testIndex: number;
  testNote: string;
  testSaving: boolean;
  ratings: RatingRecord[];
  scores: ScoreEntry[];
  onPrev: () => void;
  onNext: () => void;
  onNoteChange: (v: string) => void;
  onSaveVerdict: (v: Verdict) => void;
};

const TestTab = ({
  reviewImages,
  testIndex,
  testNote,
  testSaving,
  ratings,
  scores,
  onPrev,
  onNext,
  onNoteChange,
  onSaveVerdict,
}: TestTabProps) => {
  const currentImage = reviewImages[testIndex];
  const currentRating = currentImage
    ? ratings.find((r) => r.r2Key === currentImage.key)
    : undefined;
  const currentScore = currentImage ? matchScoreForKey(currentImage.key, scores) : undefined;

  if (reviewImages.length === 0) {
    return (
      <p className="text-muted-foreground">画像なし（審査画像タブで先に読み込んでください）</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onPrev}
          disabled={testIndex === 0}
          className="rounded bg-muted px-3 py-1 text-sm disabled:opacity-30"
        >
          ←
        </button>
        <span className="text-sm text-muted-foreground">
          {testIndex + 1} / {reviewImages.length}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={testIndex === reviewImages.length - 1}
          className="rounded bg-muted px-3 py-1 text-sm disabled:opacity-30"
        >
          →
        </button>
      </div>

      {currentImage && (
        <div className="flex w-full max-w-5xl gap-4">
          <div className="flex-1">
            <img
              src={`/api/admin/review/${encodeURIComponent(currentImage.key)}`}
              alt={currentImage.key}
              className="max-h-[70vh] w-full rounded object-contain"
            />
            <p className="mt-1 text-center text-xs text-muted-foreground">{currentImage.key}</p>
          </div>
          <div className="flex w-64 flex-col gap-3">
            {currentScore && <ScoreInfoPanel entry={currentScore} />}
            {currentRating && <RatingPanel rating={currentRating} />}
            <input
              type="text"
              placeholder="メモ (任意)"
              value={testNote}
              onChange={(e) => onNoteChange(e.target.value)}
              className="rounded border border-border bg-muted px-3 py-1.5 text-sm focus:outline-none"
            />
            <div className="flex flex-col gap-2">
              {(["nuketa", "microm", "dame"] as Verdict[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onSaveVerdict(v)}
                  disabled={testSaving}
                  className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${VERDICT_COLORS[v]}`}
                >
                  {VERDICT_LABELS[v]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type DedupTabProps = {
  dedupCandidates: DedupCandidate[];
  dedupNote: string | null;
  dedupSelected: Set<string>;
  dedupLoading: boolean;
  dedupDeleting: boolean;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (v: boolean) => void;
  deleteResult: { deletedCount: number; freedBytes: number } | null;
  onToggle: (key: string, checked: boolean) => void;
  onSelectAll: () => void;
  onDelete: () => void;
};

const DedupTab = ({
  dedupCandidates,
  dedupNote,
  dedupSelected,
  dedupLoading,
  dedupDeleting,
  showDeleteConfirm,
  setShowDeleteConfirm,
  deleteResult,
  onToggle,
  onSelectAll,
  onDelete,
}: DedupTabProps) => {
  if (dedupLoading) return <p className="text-muted-foreground">候補を検索中...</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{dedupCandidates.length} 件の重複候補</span>
        {dedupNote && <span className="text-xs text-muted-foreground">{dedupNote}</span>}
        {dedupSelected.size > 0 && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded bg-red-800 px-3 py-1 text-sm text-white hover:bg-red-700"
          >
            選択 {dedupSelected.size} 件を削除
          </button>
        )}
        {dedupCandidates.length > 0 && (
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded bg-muted px-3 py-1 text-sm"
          >
            {dedupSelected.size === dedupCandidates.length ? "全選択解除" : "全選択"}
          </button>
        )}
      </div>

      {deleteResult && (
        <div className="mb-3 rounded bg-green-900/30 p-3 text-sm">
          削除完了: {deleteResult.deletedCount} 件 /{" "}
          {(deleteResult.freedBytes / 1024 / 1024).toFixed(2)} MB 解放
        </div>
      )}

      <div className="space-y-3">
        {dedupCandidates.map((c) => (
          <div
            key={c.reviewKey}
            className="flex items-center gap-3 rounded border border-border p-2"
          >
            <input
              type="checkbox"
              checked={dedupSelected.has(c.reviewKey)}
              onChange={(e) => onToggle(c.reviewKey, e.target.checked)}
              className="h-4 w-4"
            />
            <div className="flex flex-col items-center gap-1">
              <img
                src={`/api/admin/review/${encodeURIComponent(c.reviewKey)}`}
                alt={c.reviewKey}
                className="h-20 w-20 rounded object-cover"
              />
              <span className="text-xs text-muted-foreground">review/</span>
            </div>
            <div className="flex-1 text-xs text-muted-foreground">
              <p className="truncate">{c.reviewKey}</p>
              <p className="truncate">→ {c.subKey}</p>
              <p>{(c.size / 1024).toFixed(0)} KB</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <img
                src={`/api/avatar/${encodeURIComponent(c.subKey)}`}
                alt={c.subKey}
                className="h-20 w-20 rounded object-cover"
              />
              <span className="text-xs text-muted-foreground">sub/</span>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>review/ 画像を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              選択した {dedupSelected.size} 件の review/ キーを削除します。sub/
              の本番画像は削除されません。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={dedupDeleting}
              className="bg-red-700 hover:bg-red-600"
            >
              {dedupDeleting ? "削除中..." : "削除する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export const AdminView = () => {
  const [tab, setTab] = useState<AdminTab>("scores");
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [scoresFilter, setScoresFilter] = useState("");
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [imagesCursor, setImagesCursor] = useState<string | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [testIndex, setTestIndex] = useState(0);
  const [testNote, setTestNote] = useState("");
  const [testSaving, setTestSaving] = useState(false);
  const [dedupCandidates, setDedupCandidates] = useState<DedupCandidate[]>([]);
  const [dedupNote, setDedupNote] = useState<string | null>(null);
  const [dedupSelected, setDedupSelected] = useState<Set<string>>(new Set());
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupDeleting, setDedupDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{
    deletedCount: number;
    freedBytes: number;
  } | null>(null);
  const imagesInitialized = useRef(false);

  useEffect(() => {
    fetch("/admin-data/score-index.jsonl")
      .then((r) => r.text())
      .then((text) => {
        const parsed = text
          .trim()
          .split("\n")
          .filter(Boolean)
          .flatMap((l) => {
            try {
              return [JSON.parse(l) as ScoreEntry];
            } catch {
              return [];
            }
          });
        setScores(parsed);
      })
      .catch(() => {
        toast.error("スコア一覧の読み込みに失敗しました");
      });
  }, []);

  const loadImages = useCallback(async (cursor?: string) => {
    setImagesLoading(true);
    try {
      const url = cursor
        ? `/api/admin/review-images?cursor=${encodeURIComponent(cursor)}`
        : "/api/admin/review-images";
      const res = await apiFetch(url);
      if (!res.ok) {
        toast.error("画像一覧の読み込みに失敗しました");
        return;
      }
      const data: { items: ReviewImage[]; cursor: string | null } = await res.json();
      setReviewImages((prev) => (cursor ? [...prev, ...data.items] : data.items));
      setImagesCursor(data.cursor);
    } finally {
      setImagesLoading(false);
    }
  }, []);

  const loadRatings = useCallback(async () => {
    const res = await apiFetch("/api/admin/ratings");
    if (!res.ok) {
      toast.error("判定一覧の読み込みに失敗しました");
      return;
    }
    const data: RatingRecord[] = await res.json();
    setRatings(data);
  }, []);

  const loadDedupCandidates = useCallback(async () => {
    setDedupLoading(true);
    try {
      const res = await apiFetch("/api/admin/dedup-candidates");
      if (!res.ok) {
        toast.error("重複候補の読み込みに失敗しました");
        return;
      }
      const data: { candidates: DedupCandidate[]; note?: string } = await res.json();
      setDedupCandidates(data.candidates);
      setDedupNote(data.note ?? null);
    } finally {
      setDedupLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "images" || tab === "test") {
      if (!imagesInitialized.current) {
        imagesInitialized.current = true;
        void loadImages();
      }
      void loadRatings();
    }
    if (tab === "dedup") void loadDedupCandidates();
  }, [tab, loadImages, loadRatings, loadDedupCandidates]);

  const onPrev = useCallback(() => setTestIndex((i) => Math.max(0, i - 1)), []);
  const onNext = useCallback(
    () => setTestIndex((i) => Math.min(reviewImages.length - 1, i + 1)),
    [reviewImages.length],
  );

  useKeyboardNav(tab === "test", onPrev, onNext);

  const saveVerdict = async (verdict: Verdict) => {
    const key = reviewImages[testIndex]?.key;
    if (!key) return;
    setTestSaving(true);
    try {
      const res = await apiFetch("/api/admin/rating", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ r2Key: key, verdict, note: testNote }),
      });
      if (!res.ok) {
        // 保存失敗時は index を進めず note も残す。進めてしまうと判定が
        // 無言で失われ、ユーザーは保存できたと誤認する。
        toast.error("判定の保存に失敗しました");
        return;
      }
      await loadRatings();
      setTestNote("");
      setTestIndex((i) => Math.min(reviewImages.length - 1, i + 1));
    } finally {
      setTestSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    setDedupDeleting(true);
    try {
      const res = await apiFetch("/api/admin/dedup-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewKeys: [...dedupSelected] }),
      });
      if (res.ok) {
        const data: { deletedCount: number; freedBytes: number } = await res.json();
        setDeleteResult(data);
        setDedupCandidates((prev) => prev.filter((c) => !dedupSelected.has(c.reviewKey)));
        setDedupSelected(new Set());
      } else {
        toast.error("重複画像の削除に失敗しました");
      }
    } finally {
      setDedupDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleToggle = (key: string, checked: boolean) => {
    setDedupSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleSelectAll = () => {
    setDedupSelected(
      dedupSelected.size === dedupCandidates.length
        ? new Set()
        : new Set(dedupCandidates.map((c) => c.reviewKey)),
    );
  };

  const TABS: { id: AdminTab; label: string }[] = [
    { id: "scores", label: "スコア台帳" },
    { id: "images", label: "審査画像" },
    { id: "test", label: "抜けテスト" },
    { id: "dedup", label: "重複削除" },
  ];

  return (
    <div className="min-h-screen bg-background p-4 text-foreground">
      <h1 className="mb-4 text-xl font-bold">Admin</h1>
      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "scores" && (
        <ScoresTab scores={scores} scoresFilter={scoresFilter} setScoresFilter={setScoresFilter} />
      )}
      {tab === "images" && (
        <ImagesTab
          reviewImages={reviewImages}
          ratings={ratings}
          imagesCursor={imagesCursor}
          imagesLoading={imagesLoading}
          onLoadMore={(cursor) => void loadImages(cursor)}
          onSelectImage={(idx) => {
            setTestIndex(idx);
            setTab("test");
          }}
        />
      )}
      {tab === "test" && (
        <TestTab
          reviewImages={reviewImages}
          testIndex={testIndex}
          testNote={testNote}
          testSaving={testSaving}
          ratings={ratings}
          scores={scores}
          onPrev={onPrev}
          onNext={onNext}
          onNoteChange={setTestNote}
          onSaveVerdict={(v) => void saveVerdict(v)}
        />
      )}
      {tab === "dedup" && (
        <DedupTab
          dedupCandidates={dedupCandidates}
          dedupNote={dedupNote}
          dedupSelected={dedupSelected}
          dedupLoading={dedupLoading}
          dedupDeleting={dedupDeleting}
          showDeleteConfirm={showDeleteConfirm}
          setShowDeleteConfirm={setShowDeleteConfirm}
          deleteResult={deleteResult}
          onToggle={handleToggle}
          onSelectAll={handleSelectAll}
          onDelete={() => void handleDeleteSelected()}
        />
      )}
    </div>
  );
};
