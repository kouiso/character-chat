import { and, eq, gt } from "drizzle-orm";
import { SignJWT } from "jose";

import { qualityReportDedupTable } from "../../../src/schema";

import type { drizzle } from "drizzle-orm/d1";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const EMAIL_REGEX = /\b[\w%+.-]+@[\d.a-z-]+\.[a-z]{2,}\b/gi;
const PHONE_REGEX = /\b\+?\d[\d\s().-]{7,}\d\b/g;
const URL_PATH_REGEX = /(https?:\/\/[\w.-]+)\/[\w!$%&'()*+,./:;=@~-]*\b/gi;

const truncate = (value: string, limit = 500): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

export const redactPII = (input: string): string =>
  input
    .replace(EMAIL_REGEX, "[REDACTED]")
    .replace(PHONE_REGEX, "[REDACTED]")
    .replace(URL_PATH_REGEX, "$1/[REDACTED]");

export const collectRecentTurns = (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> =>
  messages
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        m.role === "user" || m.role === "assistant",
    )
    .slice(-6);

export const guessFailureAxis = (responseText: string): string => {
  if (responseText.length < 120) return "too_short";
  if (/すみません|できません|控えます|i can't|i cannot/i.test(responseText))
    return "refusal_or_hedge";
  return "generic_quality_drop";
};

export const shouldReportQualityIssue = async (
  database: ReturnType<typeof drizzle>,
  conversationId: string,
  now: number,
): Promise<boolean> => {
  const threshold = now - DEDUP_WINDOW_MS;
  const existing = await database
    .select({ conversationId: qualityReportDedupTable.conversationId })
    .from(qualityReportDedupTable)
    .where(
      and(
        eq(qualityReportDedupTable.conversationId, conversationId),
        gt(qualityReportDedupTable.lastReportedAt, threshold),
      ),
    )
    .limit(1);

  if (existing.length > 0) return false;

  await database
    .insert(qualityReportDedupTable)
    .values({ conversationId, lastReportedAt: now })
    .onConflictDoUpdate({
      target: qualityReportDedupTable.conversationId,
      set: { lastReportedAt: now },
    });

  return true;
};

type ReportInput = {
  characterName?: string;
  assistantCount: number;
  phase: string;
  model: string;
  usedModel: string;
  responseText: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  conversationId: string;
  characterId?: string;
  timestamp: number;
};

export const buildQualityIssuePayload = (input: ReportInput): { title: string; body: string } => {
  const name = input.characterName?.trim() || "unknown";
  const title = `quality-warn: ${name} turn ${input.assistantCount} phase=${input.phase}`;
  const recent = collectRecentTurns(input.messages)
    .map((turn, idx) => `- ${idx + 1}. **${turn.role}**: ${truncate(redactPII(turn.content))}`)
    .join("\n");

  const body = [
    "## context",
    recent || "- (no recent turns)",
    "",
    "## detection",
    `- phase: ${input.phase}`,
    `- model: ${input.model}`,
    `- usedModel: ${input.usedModel}`,
    `- failed_axis_guess: ${guessFailureAxis(input.responseText)}`,
    "",
    "## meta",
    `- conversation_id: ${input.conversationId}`,
    `- character_id: ${input.characterId ?? "unknown"}`,
    `- timestamp: ${new Date(input.timestamp).toISOString()}`,
    "",
    "ref: #133",
  ].join("\n");

  return { title, body };
};

let cachedInstallationToken: { token: string; expiresAtMs: number } | null = null;

const GITHUB_API_BASE = "https://api.github.com";
const INSTALLATION_TOKEN_CACHE_MS = 50 * 60 * 1000;

const pemToUint8Array = (pem: string): Uint8Array => {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const raw = atob(base64);
  const bytes = Array.from(raw, (char) => char.charCodeAt(0));
  return new Uint8Array(bytes);
};

const toCryptoKey = async (privateKeyPem: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "pkcs8",
    pemToUint8Array(privateKeyPem) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

const createGitHubAppJwt = async (appId: string, privateKeyPem: string, nowMs = Date.now()) => {
  const key = await toCryptoKey(privateKeyPem);
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 9 * 60;
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(appId)
    .sign(key);
};

export const getGitHubAppInstallationToken = async (
  appId: string,
  privateKeyPem: string,
  installationId: string,
): Promise<string> => {
  if (cachedInstallationToken && cachedInstallationToken.expiresAtMs > Date.now()) {
    return cachedInstallationToken.token;
  }

  const appJwt = await createGitHubAppJwt(appId, privateKeyPem);
  const response = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "adult-ai-app-quality-reporter",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub App token fetch failed: ${response.status} ${text}`);
  }
  const body: { token: string } = await response.json();
  cachedInstallationToken = {
    token: body.token,
    expiresAtMs: Date.now() + INSTALLATION_TOKEN_CACHE_MS,
  };
  return body.token;
};

const resolveGitHubToken = async (auth: {
  ghPat?: string;
  appId?: string;
  appPrivateKey?: string;
  appInstallationId?: string;
}): Promise<string> => {
  if (auth.appId && auth.appPrivateKey && auth.appInstallationId) {
    return getGitHubAppInstallationToken(auth.appId, auth.appPrivateKey, auth.appInstallationId);
  }

  if (auth.ghPat) return auth.ghPat;
  throw new Error("GitHub auth missing: set GH_APP_ID/GH_APP_PRIVATE_KEY/GH_APP_INSTALLATION_ID");
};

export const createQualityIssue = async (
  auth: {
    ghPat?: string;
    appId?: string;
    appPrivateKey?: string;
    appInstallationId?: string;
  },
  payload: { title: string; body: string },
): Promise<void> => {
  const token = await resolveGitHubToken(auth);
  const response = await fetch("https://api.github.com/repos/kouiso/adult-ai-app/issues", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "adult-ai-app-quality-reporter",
    },
    body: JSON.stringify({
      title: payload.title,
      body: payload.body,
      labels: ["quality-degraded", "auto-reported"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub issue creation failed: ${response.status} ${text}`);
  }
};

export const __testOnly = {
  createGitHubAppJwt,
  resetInstallationTokenCache: () => {
    cachedInstallationToken = null;
  },
};
