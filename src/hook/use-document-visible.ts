import { useEffect, useState } from "react";

/**
 * 画面が前面に出とるか。自動再送を前面でだけ走らせるために使う。
 *
 * 背面のまま送り直しても同じ理由で止められるだけで、上流の枠と課金を捨てることになる。
 */
export const useDocumentVisible = (): boolean => {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
};
