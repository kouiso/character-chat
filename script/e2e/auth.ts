import type { Page, Route } from "playwright";

const LOCAL_AUTH_HEADER = "CF-Access-Authenticated-User-Email";

export const buildLocalAuthHeaders = (userEmail: string): Record<string, string> => ({
  [LOCAL_AUTH_HEADER]: userEmail,
});

export const installLocalApiAuth = async (
  page: Page,
  devOrigin: string,
  userEmail: string,
): Promise<void> => {
  const origin = new URL(devOrigin).origin;
  const authHeaders = buildLocalAuthHeaders(userEmail);

  await page.route(`${origin}/api/**`, async (route: Route) => {
    const request = route.request();
    await route.continue({
      headers: {
        ...request.headers(),
        ...authHeaders,
      },
    });
  });
};
