import { waitForDomReady } from "../browser-wait";

import type { E2eEnv } from "../env";
import type { ImageProbeResult, JudgeVerdict } from "../types";
import type { Page, Response } from "playwright";

type ProbeR2StagesOptions = {
  conversationId: string;
  env: E2eEnv;
  imgSelector: string;
  domReadySelector: string;
  screenshotBeforeReloadPath: string;
  screenshotAfterReloadPath: string;
};

const isImageContentType = (contentType: string): boolean => contentType.startsWith("image/");

const IMAGE_GENERATION_FAILURE_PATTERN =
  /画像生成に失敗しました|画像生成エラー|タイムアウト：画像生成が完了しませんでした|ネットワークエラー/gu;
const IMAGE_API_RESPONSE_PREVIEW_CHARS = 300;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const logImageApiResponse = async (response: Response): Promise<void> => {
  if (response.request().method() !== "POST") return;

  let pathname: string;
  try {
    pathname = new URL(response.url()).pathname;
  } catch {
    return;
  }
  if (pathname !== "/api/image") return;

  const status = response.status();
  let bodyPreview = "";
  if (status < 200 || status >= 300) {
    bodyPreview = await response
      .text()
      .then((body) => body.slice(0, IMAGE_API_RESPONSE_PREVIEW_CHARS))
      .catch((error: unknown) => `<failed to read response body: ${toErrorMessage(error)}>`);
  }

  console.log(
    `[probeR2Stages] /api/image POST status=${status}${
      bodyPreview ? ` body=${bodyPreview}` : ""
    }`,
  );
};

const readImageFailureMatches = async (page: Page): Promise<string[]> =>
  page.evaluate((patternSource) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- patternSource is IMAGE_GENERATION_FAILURE_PATTERN.source, a static literal
    const pattern = new RegExp(patternSource, "gu");
    return Array.from((document.body.innerText ?? "").matchAll(pattern), (match) => match[0]);
  }, IMAGE_GENERATION_FAILURE_PATTERN.source);

const toAbsoluteImageUrl = (src: string, env: E2eEnv): string =>
  src.startsWith("/") ? new URL(src, env.devOrigin).toString() : src;

const readLastImageState = async (
  page: Page,
  imgSelector: string,
): Promise<{ src: string; naturalWidth: number }> =>
  page
    .locator(imgSelector)
    .last()
    .evaluate((img) => {
      const srcValue = Reflect.get(img, "currentSrc") || Reflect.get(img, "src");
      const naturalWidthValue = Reflect.get(img, "naturalWidth");
      return {
        src: typeof srcValue === "string" ? srcValue : "",
        naturalWidth: typeof naturalWidthValue === "number" ? naturalWidthValue : 0,
      };
    });

const waitForImageUrl = async (
  page: Page,
  imgSelector: string,
  predicate: (src: string) => boolean,
): Promise<string | null> =>
  page
    .waitForFunction(
      ({ selector, serializedPredicate }) => {
        const documentValue = Reflect.get(globalThis, "document") as {
          querySelectorAll: (selector: string) => {
            length: number;
            item: (index: number) => unknown;
          };
        };
        const querySelectorAll = documentValue.querySelectorAll.bind(documentValue);
        const images = querySelectorAll(selector);
        if (images.length < 1) return null;

        const last = images.item(images.length - 1);
        if (typeof last !== "object" || last === null) return null;

        const currentSrc = Reflect.get(last, "currentSrc");
        const srcValue = currentSrc || Reflect.get(last, "src") || "";
        const src = typeof srcValue === "string" ? srcValue : "";
        if (!src) return null;

        const predicateFn = new Function(
          "src",
          `"use strict"; return (${serializedPredicate})(src);`,
        ) as (src: string) => boolean;
        return predicateFn(src) ? src : null;
      },
      {
        selector: imgSelector,
        serializedPredicate: predicate.toString(),
      },
      { timeout: 60_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);

const waitForR2Url = async (
  page: Page,
  imgSelector: string,
  readObservedR2Url: () => string | null,
  timeoutMs: number,
): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const observedR2Url = readObservedR2Url();
    if (observedR2Url) return observedR2Url;

    const imageState = await readLastImageState(page, imgSelector).catch(() => null);
    if (imageState?.src.includes("/api/image/r2/")) return imageState.src;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return readObservedR2Url();
};

const waitForCondition = async (
  condition: () => boolean,
  timeoutMs: number,
  pollMs = 200,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return condition();
};

const readReloadDisplayed = async (page: Page, imgSelector: string): Promise<boolean> =>
  page.locator(imgSelector).evaluateAll((images) =>
    images.every((img) => {
      const naturalWidthValue = Reflect.get(img, "naturalWidth");
      return typeof naturalWidthValue === "number" && naturalWidthValue > 0;
    }),
  );

const waitForImageVisibleOrGenerationFailure = async (
  page: Page,
  imgSelector: string,
  stage: string,
  timeoutMs: number,
): Promise<void> => {
  const baselineFailureCount = await readImageFailureMatches(page)
    .then((matches) => matches.length)
    .catch(() => 0);

  const result = await page
    .waitForFunction(
      ({ selector, failurePatternSource, initialFailureCount }) => {
        const images = Array.from(document.querySelectorAll(selector));
        const lastImage = images.at(-1);
        if (lastImage instanceof HTMLImageElement) {
          const style = window.getComputedStyle(lastImage);
          const rect = lastImage.getBoundingClientRect();
          if (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          ) {
            return { kind: "image" };
          }
        }

        // eslint-disable-next-line security/detect-non-literal-regexp -- failurePatternSource is a static RegExp.source passed via page.evaluate
        const pattern = new RegExp(failurePatternSource, "gu");
        const matches = Array.from(
          (document.body.innerText ?? "").matchAll(pattern),
          (match) => match[0],
        );
        if (matches.length > initialFailureCount) {
          return {
            kind: "failure",
            detail: matches.at(-1) ?? "画像生成に失敗しました",
          };
        }

        return null;
      },
      {
        selector: imgSelector,
        failurePatternSource: IMAGE_GENERATION_FAILURE_PATTERN.source,
        initialFailureCount: baselineFailureCount,
      },
      { timeout: timeoutMs },
    )
    .then(
      (handle) =>
        handle.jsonValue() as Promise<{ kind: "image" } | { kind: "failure"; detail: string }>,
    );

  if (result.kind === "failure") {
    throw new Error(`[probeR2Stages] image generation failed during ${stage}: ${result.detail}`);
  }
};

export async function probeR2Stages(
  page: Page,
  options: ProbeR2StagesOptions,
): Promise<ImageProbeResult> {
  const contentTypeByUrl = new Map<string, string>();
  let observedR2Url: string | null = null;
  let imagePatchCount = 0;

  const responseListener = (response: Response): void => {
    void logImageApiResponse(response).catch((error: unknown) => {
      console.error(`[probeR2Stages] /api/image response log failed: ${toErrorMessage(error)}`);
    });
    const url = response.url();
    const contentType = response.headers()["content-type"] ?? "unknown";
    if (!isImageContentType(contentType) && !url.includes("/api/image/r2/")) return;
    contentTypeByUrl.set(url, contentType);
    if (url.includes("/api/image/r2/")) {
      observedR2Url = url;
    }
  };
  const patchListener = (response: {
    url: () => string;
    request: () => { method: () => string };
    status: () => number;
  }): void => {
    if (response.request().method() !== "PATCH") return;
    try {
      const pathname = new URL(response.url()).pathname;
      if (!/\/api\/messages\/[^/]+\/image$/.test(pathname)) return;
      if (response.status() < 200 || response.status() >= 300) return;
      imagePatchCount += 1;
    } catch {
      // URL解析失敗は無視する
    }
  };

  page.on("response", responseListener);
  page.on("response", patchListener);

  try {
    await waitForImageVisibleOrGenerationFailure(
      page,
      options.imgSelector,
      "initial image",
      120_000,
    );

    const novitaUrl = await waitForImageUrl(
      page,
      options.imgSelector,
      (src) => src.startsWith("https://") || src.startsWith("blob:"),
    );

    const r2Url = await waitForR2Url(page, options.imgSelector, () => observedR2Url, 60_000);
    const patchBaseline = imagePatchCount;

    const beforeReloadLocator = page.locator(options.imgSelector).last();
    await beforeReloadLocator.screenshot({ path: options.screenshotBeforeReloadPath });
    await waitForCondition(() => imagePatchCount > patchBaseline, 45_000);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForDomReady(page, options.domReadySelector);
    // 会話選択は Zustand の currentConversationId が永続化されていないためリロード後に失われる。
    // サイドバーのボタンを直接クリックして対象 conversation に遷移させる。
    const conversationButton = page.locator(
      `button[data-conversation-id="${options.conversationId}"]`,
    );
    const buttonExists = await conversationButton
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (buttonExists) {
      await conversationButton
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    } else {
      // data-conversation-id がまだない場合はサイドバーの先頭 conversation を選択する。
      // setupFreshConversation 直後は対象 conversation が最新更新で先頭に来るはずなので
      // 暫定フォールバックとして機能する。
      await page
        .locator(".overflow-y-auto button[type='button']")
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }
    try {
      await page
        .locator(options.imgSelector)
        .last()
        .waitFor({ state: "visible", timeout: 120_000 });
    } catch (error) {
      const debugScreenshotPath = options.screenshotAfterReloadPath.replace(
        /\.png$/,
        "-debug-fullpage.png",
      );
      await page.screenshot({ path: debugScreenshotPath, fullPage: true }).catch(() => undefined);
      const imgCount = await page
        .locator("img")
        .count()
        .catch(() => -1);
      const groupCount = await page
        .locator(".group\\/message")
        .count()
        .catch(() => -1);
      const html = await page
        .locator("main")
        .first()
        .innerHTML()
        .catch(() => "")
        .then((value) => value.slice(0, 5000));
      console.error(
        `[probeR2Stages] post-reload image missing. imgCount=${imgCount} groupCount=${groupCount} debugScreenshot=${debugScreenshotPath}`,
      );
      console.error(`[probeR2Stages] main innerHTML (first 5000 chars):\n${html}`);
      throw new Error(
        `[probeR2Stages] post-reload image wait failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const reloadDisplayed = await readReloadDisplayed(page, options.imgSelector);
    const reloadState = await readLastImageState(page, options.imgSelector);
    await page.locator(options.imgSelector).last().screenshot({
      path: options.screenshotAfterReloadPath,
    });

    const contentType =
      (r2Url ? contentTypeByUrl.get(toAbsoluteImageUrl(r2Url, options.env)) : null) ?? "unknown";

    const novitaUrlReceived = novitaUrl !== null || r2Url !== null;

    return {
      novitaUrlReceived,
      r2KeyPersisted: r2Url !== null,
      reloadDisplayed,
      contentType,
      naturalWidth: reloadState.naturalWidth,
      novitaUrl,
      r2Url,
      screenshotBeforeReload: options.screenshotBeforeReloadPath,
      screenshotAfterReload: options.screenshotAfterReloadPath,
    };
  } finally {
    page.off("response", responseListener);
    page.off("response", patchListener);
  }
}

export async function runR2PersistenceJudge(
  page: Page,
  probeResult: ImageProbeResult,
): Promise<{ r2: JudgeVerdict; reload: JudgeVerdict }> {
  if (!probeResult.novitaUrlReceived) {
    return {
      r2: {
        pass: false,
        reason: "initial Novita image URL was not observed",
      },
      reload: {
        pass: false,
        reason: "reload stage skipped because Novita URL was not observed",
      },
    };
  }

  if (!probeResult.r2Url) {
    return {
      r2: {
        pass: false,
        reason: "R2 URL swap was not observed",
      },
      reload: {
        pass: false,
        reason: "reload stage skipped because R2 URL swap was not observed",
      },
    };
  }

  const headResponse = await page.context().request.head(probeResult.r2Url, {
    failOnStatusCode: false,
    timeout: 15_000,
  });
  const contentType = headResponse.headers()["content-type"] ?? probeResult.contentType;
  const r2Pass = headResponse.ok() && isImageContentType(contentType);

  return {
    r2: {
      pass: r2Pass,
      reason: r2Pass
        ? `R2 HEAD ${headResponse.status()} with ${contentType}`
        : `R2 HEAD ${headResponse.status()} with ${contentType}`,
    },
    reload: {
      pass: probeResult.reloadDisplayed,
      reason: probeResult.reloadDisplayed
        ? `image rendered after reload with naturalWidth ${probeResult.naturalWidth}`
        : `image failed to render after reload; naturalWidth ${probeResult.naturalWidth}`,
    },
  };
}
