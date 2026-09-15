import { Button } from "@/component/ui/button";

type AgeDeniedScreenProps = {
  onReconsider: () => void;
};

// 退出を選んだ後に真っ黒な無操作画面を残すと、URL 欄が無い PWA では
// アプリを消す以外に抜ける手が無くなる。言葉と戻る道を必ず置く。
export const AgeDeniedScreen = ({ onReconsider }: AgeDeniedScreenProps) => (
  <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-8 text-center">
    <p className="font-narrative text-4xl font-bold tracking-widest text-primary/80">18+</p>
    <h1 className="font-narrative text-xl tracking-wide">ご利用ありがとうございました</h1>
    <p className="max-w-sm text-sm leading-7 text-muted-foreground">
      本アプリは 18 歳以上の方のみご利用いただけます。
      <br />
      このまま閉じてください。押し間違えた場合は下から戻れます。
    </p>
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full max-w-xs"
      onClick={onReconsider}
    >
      年齢確認へ戻る
    </Button>
  </div>
);
