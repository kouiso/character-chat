// 待ち時間に上限を掛ける。相手を止められなくても、待つ側は必ず返す。
//
// 使いどころは「返らないと送信ロックが解けない」経路。react-query の mutation は
// networkMode: "online"（query-client.ts）なので、接続が落ちると失敗せずに
// 一時停止する。停止した mutation の mutateAsync は解決も棄却もしないため、
// await した側は永久に待つ。永続化とその入れ直しはロック解除の手前に居るので、
// そこで待ち続けると入力欄が disabled のまま戻らない（#993 で消したはずの形）。
//
// mutation 側の networkMode を "always" へ変えて解決しないのは、再接続時に
// 自動で再開する仕組みごと捨てることになるため。待つ側だけ時間を切る。
export const withDeadline = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  // 期限側が勝った後に task が棄却すると、誰も受けていない棄却として警告になる。
  // 受け手を1つ足しておく（結果は race 側が使うので捨てて良い）。
  void task.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // TimeoutError 名で投げる。中断は「保存されなかった」を意味しないため、
          // 呼び出し側が在否を読み直す経路（persist-turn.ts）へ乗せる必要がある。
          const error = new Error(`${label} timed out after ${timeoutMs}ms`);
          error.name = "TimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
