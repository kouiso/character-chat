import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// workerd の束縛を使い、リクエスト内で別の Miniflare を起動しない。
export const getPlatform = createServerOnlyFn(() => Promise.resolve({ env }));
