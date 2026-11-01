import { timingSafeEqual } from "node:crypto";

export type BasicAuthConfig = { BASIC_AUTH_USERNAME?: string; BASIC_AUTH_PASSWORD?: string };

const privateHeaders = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
  vary: "Authorization",
};

const decodeCredentials = (header: string | null): string | null => {
  const encoded = /^basic ([\d+/a-z]+={0,2})$/i.exec(header ?? "")?.[1];
  if (!encoded) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
};

const equalCredentials = async (received: string, expected: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [received, expected].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
};

export const requireBasicAuth = async (
  request: Request,
  config: BasicAuthConfig,
): Promise<Response | null> => {
  const { BASIC_AUTH_USERNAME: username, BASIC_AUTH_PASSWORD: password } = config;
  if (!username || !password || username.includes(":")) {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
  const received = decodeCredentials(request.headers.get("authorization"));
  if (received !== null && (await equalCredentials(received, `${username}:${password}`)))
    return null;
  return new Response(null, {
    status: 401,
    headers: {
      ...privateHeaders,
      "www-authenticate": 'Basic realm="Character Chat", charset="UTF-8"',
    },
  });
};

export const preventSharedCaching = (response: Response): Response => {
  const secured = new Response(response.body, response);
  secured.headers.set("cache-control", privateHeaders["cache-control"]);
  secured.headers.set("pragma", privateHeaders.pragma);
  const vary = secured.headers.get("vary");
  secured.headers.set("vary", vary ? `${vary}, Authorization` : "Authorization");
  return secured;
};
