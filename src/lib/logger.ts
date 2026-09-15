// ログの集計・可視化が必要になったときに sink を差し込む。
// 呼び出し側の変更なしで Sentry / Logpush / 任意のストレージに繋げられる。

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  ns: string;
  msg: string;
  data?: unknown;
};

export type LogSink = (entry: LogEntry) => void;

const sinks: LogSink[] = [];

/** sink を登録する。戻り値を呼ぶと登録解除。 */
export const addLogSink = (sink: LogSink): (() => void) => {
  sinks.push(sink);
  return () => {
    const idx = sinks.indexOf(sink);
    if (idx !== -1) sinks.splice(idx, 1);
  };
};

const CONSOLE_MAP = {
  debug: null, // console.debug は ESLint 禁止のため sink のみ
  info: "info",
  warn: "warn",
  error: "error",
} as const satisfies Record<LogLevel, "info" | "warn" | "error" | null>;

const emit = (level: LogLevel, ns: string, msg: string, data?: unknown): void => {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    ns,
    msg,
    ...(data !== undefined ? { data } : {}),
  };

  const method = CONSOLE_MAP[level];
  // prod では console 出力を抑制し、内部情報の露出を防ぐ
  if (method !== null && import.meta.env.DEV) {
    if (data !== undefined) {
      console[method](`[${ns}] ${msg}`, data);
    } else {
      console[method](`[${ns}] ${msg}`);
    }
  }

  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // sink が throw しても呼び出し元に伝播させない
    }
  }
};

export type Logger = {
  /** デバッグ情報。コンソール出力なし、sink にのみ流れる。 */
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
};

/** namespace を持つ logger を生成する。 */
export const createLogger = (ns: string): Logger => ({
  debug: (msg, data) => emit("debug", ns, msg, data),
  info: (msg, data) => emit("info", ns, msg, data),
  warn: (msg, data) => emit("warn", ns, msg, data),
  error: (msg, data) => emit("error", ns, msg, data),
});
