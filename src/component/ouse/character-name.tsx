interface CharacterNameProps {
  name: string;
  reading?: string | null;
  className?: string;
}

/**
 * 読みが分かっとるキャラだけルビを振る（#1490）。読みが無い時に推測で振ると
 * 間違った読みが定着してまうので、その時は素の名前をそのまま出す。
 */
export const CharacterName = ({ name, reading, className }: CharacterNameProps) => {
  const trimmed = reading?.trim();
  if (!trimmed) return <span className={className}>{name}</span>;
  return (
    <ruby className={className}>
      {name}
      {/* ルビ非対応環境では rp の括弧が本文として読まれ、読みが失われん */}
      <rp>（</rp>
      <rt className="text-[0.55em] font-normal tracking-wide">{trimmed}</rt>
      <rp>）</rp>
    </ruby>
  );
};
