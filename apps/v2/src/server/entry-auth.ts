import { BASIC_AUTH_REALM, isBasicAuthConfigured, verifyBasicAuth } from "@v2/cf/basic-auth";

import type { BasicAuthEnv } from "@v2/cf/basic-auth";

export const checkBasicAuth = (request: Request, env: BasicAuthEnv): Response | undefined => {
  if (!isBasicAuthConfigured(env)) {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!verifyBasicAuth(request.headers.get("Authorization"), env)) {
    return new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`,
        "Cache-Control": "no-store",
      },
    });
  }
};
