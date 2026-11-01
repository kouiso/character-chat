import { env } from "cloudflare:workers";

export const getPlatform = async () => ({ env });
