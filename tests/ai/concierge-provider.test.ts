import {
  ConciergeProviderConfigurationError,
  DEFAULT_AI_PROVIDER,
  DEFAULT_GATEWAY_CONCIERGE_MODEL,
  DEFAULT_GOOGLE_CONCIERGE_MODEL,
  getConciergeProviderConfigurationError,
  resolveConciergeModel,
  resolveConciergeProviderConfiguration,
} from "@/app/_ai/providers/concierge-model";

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("concierge provider resolver", () => {
  it("defaults to direct Google and the stable Gemini Flash model", () => {
    expect(DEFAULT_AI_PROVIDER).toBe("google");
    expect(
      resolveConciergeProviderConfiguration(
        env({ GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key" })
      )
    ).toEqual({
      provider: "google",
      modelId: DEFAULT_GOOGLE_CONCIERGE_MODEL,
    });
    expect(DEFAULT_GOOGLE_CONCIERGE_MODEL).toBe("gemini-3.6-flash");
  });

  it("creates a direct Google LanguageModel without making a request", () => {
    const customFetch = vi.fn() as unknown as typeof fetch;
    const createGoogleProvider = vi.fn((options: { fetch?: typeof fetch }) => {
      expect(options.fetch).toBe(customFetch);
      return (modelId: string) => ({
        specificationVersion: "v4",
        provider: "google.test",
        modelId,
        supportedUrls: {},
        doGenerate: vi.fn(),
        doStream: vi.fn(),
      });
    });
    const model = resolveConciergeModel(
      env({
        AI_PROVIDER: "google",
        GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key",
        AI_CONCIERGE_MODEL: "gemini-3.5-flash-lite",
      }),
      {
        fetch: customFetch,
        createGoogleProvider: createGoogleProvider as never,
      }
    );
    expect(model).toMatchObject({
      provider: "google.test",
      modelId: "gemini-3.5-flash-lite",
      specificationVersion: "v4",
    });
    expect(createGoogleProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-google-key", fetch: customFetch })
    );
  });

  it("keeps Gateway as an explicit provider with a qualified model", () => {
    expect(
      resolveConciergeProviderConfiguration(
        env({ AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "test-gateway-key" })
      )
    ).toEqual({
      provider: "gateway",
      modelId: DEFAULT_GATEWAY_CONCIERGE_MODEL,
    });

    const model = resolveConciergeModel(
      env({
        AI_PROVIDER: "gateway",
        VERCEL_OIDC_TOKEN: "test-oidc",
        AI_CONCIERGE_MODEL: "google/gemini-3.6-flash",
      })
    );
    expect(model).toMatchObject({
      provider: "gateway",
      modelId: "google/gemini-3.6-flash",
      specificationVersion: "v4",
    });
  });

  it("rejects unknown providers and provider-specific illegal model IDs", () => {
    expect(() =>
      resolveConciergeProviderConfiguration(
        env({ AI_PROVIDER: "groq", GROQ_API_KEY: "test" })
      )
    ).toThrowError(ConciergeProviderConfigurationError);
    expect(() =>
      resolveConciergeProviderConfiguration(
        env({
          AI_PROVIDER: "google",
          GOOGLE_GENERATIVE_AI_API_KEY: "test",
          AI_CONCIERGE_MODEL: "openai/gpt-5.6-terra",
        })
      )
    ).toThrow(/direct Google Gemini model ID/);
    expect(() =>
      resolveConciergeProviderConfiguration(
        env({
          AI_PROVIDER: "gateway",
          AI_GATEWAY_API_KEY: "test",
          AI_CONCIERGE_MODEL: "gemini-3.6-flash",
        })
      )
    ).toThrow(/provider\/model/);
  });

  it("requires credentials for only the selected provider", () => {
    expect(
      getConciergeProviderConfigurationError(
        env({ AI_PROVIDER: "google", AI_GATEWAY_API_KEY: "irrelevant" })
      )?.code
    ).toBe("missing-google-key");
    expect(
      getConciergeProviderConfigurationError(
        env({
          AI_PROVIDER: "gateway",
          GOOGLE_GENERATIVE_AI_API_KEY: "irrelevant",
        })
      )?.code
    ).toBe("missing-gateway-credential");
    expect(
      getConciergeProviderConfigurationError(
        env({
          AI_PROVIDER: "gateway",
          VERCEL_OIDC_TOKEN: "test-oidc",
        })
      )
    ).toBeNull();
  });
});
