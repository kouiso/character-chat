export type FormatResult = { ok: boolean; reason?: string };

const ALLOWED_TAGS = new Set(["response", "action", "dialogue", "inner"]);
const TAG_PATTERN = /<\/?([A-Za-z]+)>/g;

export const formatCheck = (text: string): FormatResult => {
  if (/```/.test(text)) return { ok: false, reason: "コードフェンスを含む" };
  if (/\*\*/.test(text)) return { ok: false, reason: "Markdown 強調を含む" };
  if (/^(User|Assistant):/m.test(text)) return { ok: false, reason: "話者ラベルを含む" };

  const stack: string[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const isClosing = match[0].startsWith("</");
    const name = match[1];
    if (!ALLOWED_TAGS.has(name)) return { ok: false, reason: `未許可タグ: ${name}` };
    if (isClosing) {
      const top = stack.pop();
      if (top !== name) return { ok: false, reason: `タグの開閉が揃わん: ${name}` };
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0)
    return { ok: false, reason: `閉じられてへんタグが残っとる: ${stack.join(",")}` };
  return { ok: true };
};
