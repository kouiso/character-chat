// wrangler は読み込んだ時点で proxy の案内を、getPlatformProxy の中では .dev.vars を読んだ旨を、
// log の段で標準出力へ書く。標準出力を JSON の報告に使う呼び出し側（ベンチ・移行の CLI）を
// 汚さんよう、読み込みから起動が終わるまで log の段を黙らせる（警告とエラーは標準エラーに残る）。
// 最初の呼び出しより前に呼び出し側が WRANGLER_LOG を決めとる時はそれに従う（黙らせている間に
// 途中で決められた値は守らん。今その書き方をする呼び出し側は無い）。同時に起動中の数を数え、
// 先に終わった呼び出しが、まだ起動中の別の呼び出しの抑制を外さんよう、0 に戻った時だけ元に戻す。
// 黙らせている間は、同じプロセスのほかの wrangler の利用と、その間に起こした子のプロセスも黙る。
let quietRuns = 0;

export const withQuietWrangler = async <T>(run: () => Promise<T>): Promise<T> => {
  if (quietRuns === 0 && process.env.WRANGLER_LOG !== undefined) return run();
  quietRuns += 1;
  process.env.WRANGLER_LOG = "warn";
  try {
    return await run();
  } finally {
    quietRuns -= 1;
    if (quietRuns === 0) delete process.env.WRANGLER_LOG;
  }
};
