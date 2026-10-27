export const API_PREFIX = "/api/v1";

export type CsrfTokenProvider = () => Promise<string>;

export interface ApiClientOptions {
  baseUrl: string;
  csrfTokenProvider?: CsrfTokenProvider;
  fetcher?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: string;
  headers?: HeadersInit;
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal;
  regeneratesSession?: boolean;
}

export type ApiErrorKind = "unauthorized" | "forbidden" | "http";

export class ApiHttpError extends Error {
  readonly kind: ApiErrorKind;
  readonly isCsrfFailure: boolean;
  csrfRefreshError?: unknown;

  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.kind = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "http";
    this.isCsrfFailure =
      status === 403 && isRecord(body) && body["error"] === "Invalid or missing CSRF token.";
  }
}

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export class CsrfTokenError extends Error {
  constructor(
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "CsrfTokenError";
  }
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  const isRelative = baseUrl.startsWith("/") && !baseUrl.startsWith("//");
  let url: URL;

  try {
    url = isRelative ? new URL(baseUrl, "https://api.invalid") : new URL(baseUrl);
  } catch {
    throw new Error("VITE_BACKEND_BASE_URL must be an HTTP(S) URL or a relative API path.");
  }

  if (
    (!isRelative && url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "VITE_BACKEND_BASE_URL must be an HTTP(S) URL or relative path without credentials, query, or fragment.",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith(API_PREFIX) ? path : `${path}${API_PREFIX}`;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return isRelative ? `${url.pathname}${url.search}` : url.toString();
}

export function getBackendBaseUrl(
  configuredUrl = import.meta.env.VITE_BACKEND_BASE_URL,
  isDevelopment = import.meta.env.DEV,
) {
  if (!isDevelopment) return normalizeApiBaseUrl(API_PREFIX);
  if (!configuredUrl?.trim()) return normalizeApiBaseUrl(API_PREFIX);
  return normalizeApiBaseUrl(configuredUrl.trim());
}

export function buildApiUrl(baseUrl: string, endpoint: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(endpoint) || endpoint.startsWith("//")) {
    throw new Error("API endpoints must be relative paths.");
  }

  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  const isRelative = normalizedBase.startsWith("/");
  const base = new URL(normalizedBase, "https://api.invalid");
  const relativeEndpoint = endpoint.replace(/^\/+/, "").replace(/^api\/v1(?:\/|$)/, "");
  const url = new URL(relativeEndpoint, base);

  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error("API endpoint must remain within the configured API prefix.");
  }

  return isRelative ? `${url.pathname}${url.search}` : url.toString();
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  return contentType === "application/json" || Boolean(contentType?.endsWith("+json"));
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  if (!isJsonResponse(response)) return text;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return text;
    throw new ApiResponseError(response.status, "Backend returned malformed JSON.");
  }
}

function getErrorMessage(body: unknown, response: Response): string {
  if (typeof body === "string" && body.trim()) return body;

  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (typeof record["message"] === "string" && record["message"].trim()) {
      return record["message"];
    }
    if (typeof record["error"] === "string" && record["error"].trim()) {
      return record["error"];
    }
  }

  return response.statusText || `Backend request failed with status ${response.status}.`;
}

export function createApiClient(options: ApiClientOptions) {
  const apiBaseUrl = normalizeApiBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  let csrfToken: string | undefined;
  let csrfRequest: Promise<string> | undefined;

  async function fetchCsrfToken(): Promise<string> {
    const response = await fetcher(buildApiUrl(apiBaseUrl, "/auth/csrf-token"), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new ApiHttpError(response.status, body, getErrorMessage(body, response));
    }

    if (!isRecord(body) || typeof body["csrfToken"] !== "string") {
      throw new ApiResponseError(
        response.status,
        "Backend returned an invalid CSRF token response.",
      );
    }
    return body["csrfToken"];
  }

  const csrfTokenProvider = options.csrfTokenProvider ?? fetchCsrfToken;

  function startCsrfTokenRequest(): Promise<string> {
    const requestGeneration = csrfGeneration;
    const pendingRequest = Promise.resolve()
      .then(csrfTokenProvider)
      .then((token) => {
        if (typeof token !== "string" || token.length === 0) {
          throw new CsrfTokenError("The CSRF token provider returned no token.");
        }
        if (requestGeneration === csrfGeneration) csrfToken = token;
        return token;
      })
      .catch((error: unknown) => {
        csrfToken = undefined;
        if (
          error instanceof CsrfTokenError ||
          error instanceof ApiResponseError ||
          error instanceof ApiHttpError
        ) {
          throw error;
        }
        throw new CsrfTokenError("Unable to acquire a CSRF token.", error);
      })
      .finally(() => {
        if (csrfRequest === pendingRequest) csrfRequest = undefined;
      });
    csrfRequest = pendingRequest;
    return pendingRequest;
  }

  let csrfGeneration = 0;
  let csrfRefreshRequest: Promise<string> | undefined;

  function acquireCsrfToken(force = false): Promise<string> {
    if (!force && csrfToken) return Promise.resolve(csrfToken);
    if (!force && csrfRequest) return csrfRequest;
    if (force && csrfRefreshRequest) return csrfRefreshRequest;

    if (!force) return startCsrfTokenRequest();

    csrfGeneration += 1;
    csrfToken = undefined;
    const pendingRefresh = (async () => {
      if (csrfRequest) {
        try {
          await csrfRequest;
        } catch {
          // A fresh request below is still required after a session transition.
        }
      }
      return startCsrfTokenRequest();
    })().finally(() => {
      if (csrfRefreshRequest === pendingRefresh) csrfRefreshRequest = undefined;
    });
    csrfRefreshRequest = pendingRefresh;
    return pendingRefresh;
  }

  async function refreshCsrfTokenAfterSessionTransition(): Promise<void> {
    if (csrfRefreshRequest) {
      try {
        await csrfRefreshRequest;
      } catch {
        // The session transition requires a fresh token even if an older refresh failed.
      }
    }
    await acquireCsrfToken(true);
  }

  async function request<T = unknown>(
    endpoint: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T | undefined> {
    const method = (requestOptions.method ?? "GET").toUpperCase();
    const headers = new Headers(requestOptions.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    let body: BodyInit | undefined;
    if (requestOptions.body !== undefined) {
      if (Object.prototype.hasOwnProperty.call(requestOptions, "json")) {
        throw new TypeError("Provide either a raw request body or a JSON body, not both.");
      }
      body = requestOptions.body;
    }
    if (Object.prototype.hasOwnProperty.call(requestOptions, "json")) {
      const jsonBody = JSON.stringify(requestOptions.json);
      if (jsonBody === undefined) {
        throw new TypeError("JSON request body must be serializable.");
      }
      body = jsonBody;
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    let requestCsrfToken: string | undefined;
    if (isUnsafeMethod(method)) {
      requestCsrfToken = await acquireCsrfToken();
      headers.set("X-CSRF-Token", requestCsrfToken);
    }

    const init: RequestInit = {
      method,
      headers: new Headers(headers),
      credentials: "include",
    };
    if (body !== undefined) init.body = body;
    if (requestOptions.signal) init.signal = requestOptions.signal;

    const response = await fetcher(buildApiUrl(apiBaseUrl, endpoint), init);
    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      const apiError = new ApiHttpError(
        response.status,
        responseBody,
        getErrorMessage(responseBody, response),
      );

      if (apiError.isCsrfFailure && isUnsafeMethod(method)) {
        if (csrfToken === requestCsrfToken || !csrfToken) {
          try {
            await acquireCsrfToken(true);
          } catch (error) {
            apiError.csrfRefreshError = error;
          }
        }
      }

      throw apiError;
    }

    if (requestOptions.regeneratesSession) {
      await refreshCsrfTokenAfterSessionTransition();
    }

    return responseBody as T | undefined;
  }

  return {
    request,
    refreshCsrfToken: async () => {
      await refreshCsrfTokenAfterSessionTransition();
    },
  };
}

export function createConfiguredApiClient() {
  const configuredBaseUrl = getBackendBaseUrl();
  const baseUrl =
    import.meta.env.DEV && typeof window !== "undefined"
      ? new URL(normalizeApiBaseUrl(API_PREFIX), window.location.origin).toString()
      : configuredBaseUrl;

  return createApiClient({
    baseUrl,
    fetcher: (input, init) => globalThis.fetch(input, init),
  });
}
