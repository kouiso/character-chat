// ブラウザ側で走る送信 click の本体。page.evaluate へ関数のまま渡すため、
// クロージャも import も参照せず、document だけを触る（参照すると直列化で壊れる）。
//
// 背景 (#993): disabled 判定と click を別ステップに分けると、その隙間で isLoading が
// true へ戻り、click は発火するのに handleSend が即 return する。だから同一タスクで行う。
// 一方 DOM の element.click() は Playwright の click({ force: true }) と同じく
// ヒットテストを飛ばすため、生成画像のフルスクリーンビューアがボタンを覆っていても
// 発火してまう。実利用ならオーバーレイに吸われる click を「送れた」と読む形になる。
// そこで同じタスクの中で当たり判定まで見て、覆われていたら click せず false を返す
// （呼び出し側の再送ループが dismissPhotoOverlay を挟んでから読み直す）。
//
// renderedMessageCount も click と同じタスクで読む(#997 の再指摘)。呼び出し側で
// click の前に別の page.evaluate として読み直すと、その隙間に挨拶や前ターンの
// 遅延描画が割り込んで数が増えることがあり、click が不発でもその無関係な増分だけで
// 「送れた」という echo 判定を満たしてしまう。click 直前の数を、click を打つのと
// 同じ同期タスクの中で読めば、その隙間自体が無くなる。
export type SendButtonClickResult = {
  clicked: boolean;
  /** click を試みた瞬間(同一タスク内)の描画数。呼び出し側が期待値を組む基準。 */
  renderedMessageCount: number;
};

// page.evaluate(fn, arg) は arg を1個の引数としてしか渡さない(#993 で確立した
// readComposerState と同じ制約)。2値をタプル1個にまとめて destructure する。
export const clickSendIfEnabledInPage = ([buttonSelector, groupSelector]: readonly [
  string,
  string,
]): SendButtonClickResult => {
  const renderedMessageCount = document.querySelectorAll(groupSelector).length;
  const button = document.querySelector(buttonSelector) as HTMLButtonElement | null;
  if (button === null || button.disabled) return { clicked: false, renderedMessageCount };
  const rect = button.getBoundingClientRect();
  // 潰れた矩形は表示されていない（display:none / 高さ 0 の折りたたみ）。中心も取れない。
  if (rect.width === 0 || rect.height === 0) return { clicked: false, renderedMessageCount };
  // 中心にいるのが自分自身か子孫でなければ、そこにあるのは覆っている別の要素。
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (hit === null || !button.contains(hit)) return { clicked: false, renderedMessageCount };
  button.click();
  return { clicked: true, renderedMessageCount };
};
