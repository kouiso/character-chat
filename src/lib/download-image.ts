import { toast } from "sonner";

// タッチデバイス & 小型ビューポートかどうか（モバイル UA 判定の代替）
export const isMobileTouchDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
};

// Web Share API でファイル共有を試みる（成功/ユーザーキャンセル時 true、未対応や失敗時 false）
const trySharingImageFile = async (blob: Blob, filename: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || !("share" in navigator)) return false;
  const file = new File([blob], filename, { type: blob.type });
  const shareData: ShareData = { files: [file] };
  const nav = navigator;
  if (typeof nav.canShare !== "function" || !nav.canShare(shareData)) return false;
  try {
    await nav.share(shareData);
    toast.success("共有しました");
    return true;
  } catch (shareError) {
    const name = shareError instanceof Error ? shareError.name : "";
    if (name === "AbortError") return true; // ユーザーキャンセル: 後続フォールバックを抑止
    return false;
  }
};

// モバイル: Web Share → 失敗時は新規タブで開き長押し保存に誘導
const saveImageOnMobile = async (blob: Blob, filename: string): Promise<void> => {
  const shared = await trySharingImageFile(blob, filename);
  if (shared) return;
  const viewerUrl = URL.createObjectURL(blob);
  window.open(viewerUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(viewerUrl), 30000);
  toast.info("長押しで保存できます");
};

// デスクトップ: <a download> でダウンロードフォルダへ保存
const saveImageOnDesktop = (blob: Blob, filename: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  toast.success(`ダウンロードフォルダに保存しました: ${filename}`);
};

// 画像 Blob を端末に保存する。モバイルは共有シート優先、デスクトップは直接ダウンロード。
export const saveBlobAsImage = async (blob: Blob, filename: string): Promise<void> => {
  if (isMobileTouchDevice()) {
    await saveImageOnMobile(blob, filename);
    return;
  }
  saveImageOnDesktop(blob, filename);
};
