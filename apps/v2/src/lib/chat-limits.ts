// 画面と API が同じ上限で判定する。ずれると、画面で受けた文を API が 400 で弾き、保留のまま戻せんくなる。
export const MAX_MESSAGE_LENGTH = 4000;
