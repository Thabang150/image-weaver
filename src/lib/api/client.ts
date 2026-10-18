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
  signal?: AbortSignal;
  regeneratesSession?: boolean;
}

export type ApiErrorKind = "unauthorized" | "forbidden" | "http";

export class ApiHttpError extends Error {
  readonly kind: ApiErrorKind;
  csrfRefreshError?: unknown;

  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.kind = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "http";
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
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("VITE_BACKEND_BASE_URL must be an absolute HTTP(S) URL.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "VITE_BACKEND_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith(API_PREFIX) ? path : `${path}${API_PREFIX}`;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

export function getBackendBaseUrl(configuredUrl = import.meta.env.VITE_BACKEND_BASE_URL) {
  if (!configuredUrl?.trim()) {
    throw new Error("Set VITE_BACKEND_BASE_URL before making backend requests.");
  }
  return normalizeApiBaseUrl(configuredUrl.trim());
}

export function buildApiUrl(baseUrl: string, endpoint: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(endpoint) || endpoint.startsWith("//")) {
    throw new Error("API endpoints must be relative paths.");
  }

  const base = new URL(normalizeApiBaseUrl(baseUrl));
  const relativeEndpoint = endpoint.replace(/^\/+/, "").replace(/^api\/v1(?:\/|$)/, "");
  const url = new URL(relativeEndpoint, base);

  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error("API endpoint must remain within the configured API prefix.");
  }

  return url.toString();
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

  function acquireCsrfToken(force = false): Promise<string> {
    if (!force && csrfToken) return Promise.resolve(csrfToken);
    if (csrfRequest) return csrfRequest;

    csrfToken = undefined;
    const pendingRequest = Promise.resolve()
      .then(csrfTokenProvider)
      .then((token) => {
        if (typeof token !== "string" || token.length === 0) {
          throw new CsrfTokenError("The CSRF token provider returned no token.");
        }
        csrfToken = token;
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

  async function request<T = unknown>(
    endpoint: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T | undefined> {
    const method = (requestOptions.method ?? "GET").toUpperCase();
    const headers = new Headers(requestOptions.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    let body: string | undefined;
    if (Object.prototype.hasOwnProperty.call(requestOptions, "json")) {
      body = JSON.stringify(requestOptions.json);
      if (body === undefined) {
        throw new TypeError("JSON request body must be serializable.");
      }
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    if (isUnsafeMethod(method)) {
      const token = await acquireCsrfToken();
      headers.set("X-CSRF-Token", token);
    }

    const init: RequestInit = {
      method,
      headers,
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
      const isCsrfRejection =
        response.status === 403 &&
        isRecord(responseBody) &&
        responseBody["error"] === "Invalid or missing CSRF token.";

      if (isCsrfRejection) {
        csrfToken = undefined;
        try {
          await acquireCsrfToken(true);
        } catch (error) {
          apiError.csrfRefreshError = error;
        }
      }

      throw apiError;
    }

    if (requestOptions.regeneratesSession) {
      await acquireCsrfToken(true);
    }

    return responseBody as T | undefined;
  }

  return {
    request,
    refreshCsrfToken: async () => {
      await acquireCsrfToken(true);
    },
  };
}

export function createConfiguredApiClient() {
  return createApiClient({
    baseUrl: getBackendBaseUrl(),
    fetcher: (input, init) => globalThis.fetch(input, init),
  });
}
