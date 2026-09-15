export type EmptyResult = { ok: boolean };

export const emptyCheck = (text: string): EmptyResult => {
  const stripped = text.replace(/<\/?[A-Za-z]+>/g, "").trim();
  return { ok: stripped.length > 0 };
};
