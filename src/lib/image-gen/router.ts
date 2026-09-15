import { NovitaImageGenProvider } from "./novita-provider";
import {
  ImageGenProviderError,
  type ImageGenInitResponse,
  type ImageGenProvider,
  type ImageGenProviderConfig,
  type ImageGenRequest,
  type ImageGenTaskResult,
} from "./provider";
import { isRunwareTaskId, RunwareImageGenProvider } from "./runware-provider";

export type ImageGenRouterEnv = ImageGenProviderConfig & {
  imageProvider?: string;
};

export class ImageGenRouter {
  private readonly novita: ImageGenProvider;
  private readonly runware: ImageGenProvider;
  private readonly hasNovitaKey: boolean;
  private readonly hasRunwareKey: boolean;

  constructor(
    env: ImageGenRouterEnv,
    providers?: { novita?: ImageGenProvider; runware?: ImageGenProvider },
  ) {
    this.novita = providers?.novita ?? new NovitaImageGenProvider(env);
    this.runware = providers?.runware ?? new RunwareImageGenProvider(env);
    this.hasNovitaKey = Boolean(env.novitaApiKey);
    this.hasRunwareKey = Boolean(env.runwareApiKey);
  }

  get configuredMode(): string {
    if (this.hasNovitaKey && this.hasRunwareKey) return "novita+runware";
    if (this.hasRunwareKey) return "runware";
    return "novita";
  }

  async generate(req: ImageGenRequest): Promise<ImageGenInitResponse> {
    // LoRA 指定 = runware 固定。Novita 共有APIは自作 Illustrious LoRA を
    // whitelist + base_model の2枚ゲートで構造的に弾く(2026-07-16 実測)ため迂回不可。
    if (req.loras?.length) {
      // LoRA は runware 専用経路。キー未設定の環境で誤ってここに来たら、
      // provider 深部の requireApiKey まで潜らせず即座に原因の分かる 503 を返す。
      if (!this.hasRunwareKey) {
        throw new ImageGenProviderError("lora generation requires runware key", {
          status: 503,
          retryable: false,
          fallbackEligible: false,
          provider: "runware",
        });
      }
      return this.runware.generate(req);
    }

    try {
      return await this.novita.generate(req);
    } catch (error) {
      if (error instanceof ImageGenProviderError && error.fallbackEligible && this.hasRunwareKey) {
        // フォールバック側は素の生成のみ引き受ける(loras はこの分岐に来ない)
        return this.runware.generate(req);
      }
      throw error;
    }
  }

  async getTaskResult(taskId: string): Promise<ImageGenTaskResult> {
    if (isRunwareTaskId(taskId)) return this.runware.getTaskResult(taskId);
    return this.novita.getTaskResult(taskId);
  }

  healthCheck(): Promise<Array<{ provider: string; ok: boolean; latencyMs: number }>> {
    // runware キー未設定の環境で runware を health 一覧へ混ぜると、全 prod 環境が
    // 恒久的に runware:false を返し /api/image/providers のクライアント可視挙動が変わる。
    // 設定済みのときだけ問い合わせる。
    const checks = [
      this.novita.healthCheck().then((result) => ({ provider: "novita", ...result })),
    ];
    if (this.hasRunwareKey) {
      checks.push(
        this.runware.healthCheck().then((result) => ({ provider: "runware", ...result })),
      );
    }
    return Promise.all(checks);
  }
}

export const createImageGenRouter = (
  env: ImageGenRouterEnv,
  providers?: { novita?: ImageGenProvider; runware?: ImageGenProvider },
): ImageGenRouter => new ImageGenRouter(env, providers);
