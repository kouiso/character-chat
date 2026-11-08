import { createServerFn } from "@tanstack/react-start";

import { LOCAL_USER_ID } from "./identity";

export const readCharacterEditorIdentity = createServerFn({ method: "GET" }).handler(async () => ({
  ownerUserId: LOCAL_USER_ID,
}));
