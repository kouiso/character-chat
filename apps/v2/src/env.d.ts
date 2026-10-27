declare namespace Cloudflare {
  interface Env {
    BASIC_AUTH_USER?: string;
    BASIC_AUTH_PASS?: string;
    OPENROUTER_API_KEY?: string;
    V2_MODEL?: string;
    V2_MODEL_PROVIDER?: string;
    V2_OPENROUTER_BASE_URL?: string;
    V2_MODEL_ATTEMPT_TIMEOUT_MS?: string;
    APP_ENV?: string;
    V2_FAKE_MODEL?: string;
    V2_TEST_FAULT?: string;
  }
}
