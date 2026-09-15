export const randomUUID = (): string => {
  const cryptoProvider = globalThis.crypto;
  if (typeof cryptoProvider !== "undefined" && typeof cryptoProvider.randomUUID === "function") {
    return cryptoProvider.randomUUID();
  }

  // LAN の http アクセスでは secure context ではないため Web Crypto の randomUUID がない。
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
};
