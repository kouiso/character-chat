// 画面まるごとの状態（板 HomeStates「ほかの画面」と「見つからないページ」）。
// 文と形は WORDING.md の 1 つに揃える。行き止まりにしない（もう一度か行き先が必ずある）。
import { Link, useRouter } from "@tanstack/react-router";

import { useChatOnline } from "../lib/chat-online";

import {
  AlertIcon,
  ArrowRightIcon,
  RetryFillButton,
  ScreenBackHeader,
  ScreenBand,
  ScreenBlock,
  SearchIcon,
  SkeletonRow,
  Skel,
  useSlowFlag,
} from "./screen-state";

import type { ErrorComponentProps } from "@tanstack/react-router";

const useRetryApp = () => {
  const router = useRouter();
  return () => {
    void router.invalidate({ forcePending: true });
  };
};

// 「ほかの画面」の読み込み中: 戻る＋題の骨組み＋本文と行の骨組み。
// 長引いた時は下の帯に「時間がかかっています」（板 HomeStates-6）。
const AppLoadingBody = () => (
  <>
    <ScreenBackHeader />
    <div className="v2-app-skel" role="status" aria-label="読み込んでいます">
      <div className="v2-skel-anim">
        <Skel width={200} height={12} hi />
        <div className="v2-app-skel-gap16" />
        <Skel width={350} height={12} />
        <div className="v2-app-skel-gap12" />
        <Skel width={288} height={12} />
        <div className="v2-app-skel-gap32" />
        <SkeletonRow nameWidth={96} lineWidth={200} />
        <SkeletonRow nameWidth={72} lineWidth={168} />
        <SkeletonRow nameWidth={112} lineWidth={184} />
      </div>
    </div>
  </>
);

export const AppLoadingState = () => {
  const online = useChatOnline();
  const slow = useSlowFlag();
  const retry = useRetryApp();
  if (!online) {
    return (
      <div className="v2-screen">
        <ScreenBackHeader />
        <ScreenBlock
          role="alert"
          iconTone="danger"
          icon={<AlertIcon />}
          title="オフラインです"
          note="つながったら、もう一度読み込めます。"
          inner
        >
          <RetryFillButton onRetry={retry} />
        </ScreenBlock>
      </div>
    );
  }
  return (
    <div className={slow ? "v2-screen v2-screen--band" : "v2-screen"}>
      <AppLoadingBody />
      {slow && <ScreenBand kind="status" text="時間がかかっています" onRetry={retry} />}
    </div>
  );
};

// 「ほかの画面」の読めない時・オフライン（板 HomeStates-7/8）。
// 題つきの形は句点なし、次の一手は「もう一度」1 つだけ。
export const AppErrorState = ({ reset }: ErrorComponentProps) => {
  const online = useChatOnline();
  const retry = useRetryApp();
  return (
    <div className="v2-screen">
      <ScreenBackHeader />
      <ScreenBlock
        role="alert"
        iconTone="danger"
        icon={<AlertIcon />}
        title={online ? "ページを読み込めませんでした" : "オフラインです"}
        note={online ? undefined : "つながったら、もう一度読み込めます。"}
        inner
      >
        <RetryFillButton
          onRetry={() => {
            retry();
            reset();
          }}
        />
      </ScreenBlock>
    </div>
  );
};

// 見つからないページ（板 HomeStates-9）。行き先は「ホームへ」1 つ（塗り＋右向きの矢印）。
export const AppNotFoundState = () => (
  <div className="v2-screen">
    <ScreenBlock
      role="status"
      iconTone="sub"
      icon={<SearchIcon />}
      title="このページが見つかりませんでした"
      note="ホームから、会いたい子を選べます。"
    >
      <Link to="/" className="v2-fill-btn">
        <span>ホームへ</span>
        <ArrowRightIcon />
      </Link>
    </ScreenBlock>
  </div>
);
