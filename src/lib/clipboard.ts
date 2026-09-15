// navigator.clipboard は落ちる時に黙って落ちる。実機(Android Chrome, 2026-08-17 局長報告)で
// コピーが効かず、しかも `.then` だけ繋いどったので成功表示も出んかった——押しても何も
// 起きん、という状態になる。失敗を握り潰さず、古い経路へ落として、結果を呼び出し側へ返す。
const copyViaHiddenTextarea = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // 画面外に置く。display:none や visibility:hidden やと選択でけへん。
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

export const copyText = async (text: string): Promise<boolean> => {
  if (!text) return false;
  // secure context でないと navigator.clipboard 自体が undefined になる。
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 権限拒否・非アクティブタブ等。下の経路へ落とす。
    }
  }
  return copyViaHiddenTextarea(text);
};
