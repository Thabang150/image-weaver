export const API_PREFIX = "/api/v1";

export type CsrfTokenProvider = () => Promise<string>;

export class PreviewMutationBlockedError extends Error {
  constructor() {
    super(
      "This action is unavailable in the storefront preview. Preview mutations require a separate staging backend; no production data has been changed.",
    );
    this.name = "PreviewMutationBlockedError";
  }
}

export function isPreviewPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = pathname.includes("://") || pathname.startsWith("//")
      ? new URL(pathname, "https://preview.invalid").pathname
      : pathname.split(/[?#]/, 1)[0] ?? pathname;
  } catch {
    return false;
  }
  const normalized = path.replace(/\/+$/, "");
  return normalized === "/preview";
}

function isCustomerCartMutation(method: string, endpoint: string): boolean {
  const path = endpoint.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") ?? "";
  if (method === "POST") return path === "cart/items";
  if (method === "DELETE") {
    return path === "cart" || /^cart\/items\/[a-f\d]{24}$/i.test(path);
  }
  return method === "PATCH" && /^cart\/items\/[a-f\d]{24}$/i.test(path);
}

function isCustomerAddressMutation(method: string, endpoint: string): boolean {
  const path = endpoint.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") ?? "";
  if (method === "POST") return path === "users/me/addresses";
  if (method === "DELETE") return /^users\/me\/addresses\/[a-f\d]{24}$/i.test(path);
  return method === "PATCH" &&
    /^users\/me\/addresses\/[a-f\d]{24}(?:\/default)?$/i.test(path);
}

const customerAuthMutationPaths = new Set([
  "auth/login",
  "auth/register",
  "auth/logout",
  "auth/request-verification",
  "auth/verify-email",
  "auth/forgot-password",
  "auth/reset-password",
  "auth/login/verify-email-otp",
  "auth/login/resend-email-otp",
]);

function isCustomerAuthMutation(method: string, endpoint: string): boolean {
  if (method !== "POST") return false;
  const path = endpoint.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") ?? "";
  return customerAuthMutationPaths.has(path);
}

function isAdminInventoryAdjustment(method: string, endpoint: string): boolean {
  if (method !== "POST") return false;
  const path = endpoint.split(/[?#]/, 1)[0]?.replace(/^\/+/, "") ?? "";
  return /^admin\/products\/[^/]+\/inventory-adjustments$/.test(path);
}

function isPreviewMutationAllowed(method: string, endpoint: string): boolean {
  if (typeof window === "undefined") return false;
  // These narrowly scoped operations still rely on backend session, role, and CSRF checks.
  return !isPreviewPath(window.location.pathname) ||
    isCustomerAuthMutation(method, endpoint) ||
    isCustomerCartMutation(method, endpoint) ||
    isCustomerAddressMutation(method, endpoint) ||
    isAdminInventoryAdjustment(method, endpoint);
}

function inventoryDiagnosticRoute(method: string, endpoint: string): string | null {
  if (!isAdminInventoryAdjustment(method, endpoint)) return null;
  return "/admin/products/:productId/inventory-adjustments";
}

function inventoryErrorCategory(status: number | null, body?: unknown): string {
  const error =
    typeof body === "object" && body !== null && !Array.isArray(body) &&
      typeof (body as Record<string, unknown>)["error"] === "string"
      ? (body as Record<string, string>)["error"]
      : undefined;
  if (
    error === "preview_mutation_blocked" ||
    error === "csrf_acquisition_failed" ||
    error === "network_request_failed" ||
    error === "client_validation" ||
    error === "client_stock_validation"
  ) return error;
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    error === "Invalid or missing CSRF token."
  ) return "csrf";
  if (status === null) return "network_or_client";
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "route_or_product_not_found";
  if (status === 400 || status === 409 || status === 422) return "validation_or_conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "backend_error";
  return status >= 200 && status < 300 ? "none" : "http_error";
}

function logInventoryRequest(
  method: string,
  route: string,
  startedAt: number,
  status: number | null,
  body?: unknown,
  correlationId: string | null = null,
): void {
  console.info("[admin-inventory-request]", {
    method,
    route,
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    correlationId:
      correlationId && /^[A-Za-z0-9._:-]{1,128}$/.test(correlationId) ? correlationId : null,
    errorCategory: inventoryErrorCategory(status, body),
  });
}

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
  origin?: "preview" | "outside-preview";
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

function normalizeRequestMethod(method: string | undefined): string {
  if (typeof method !== "string" || !/^[A-Za-z]+$/.test(method.trim())) {
    throw new PreviewMutationBlockedError();
  }
  const normalized = method.trim().toUpperCase();
  if (!["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(normalized)) {
    throw new PreviewMutationBlockedError();
  }
  return normalized;
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

  async function requestWithStatus<T = unknown>(
    endpoint: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<{ body: T | undefined; status: number }> {
    const method = normalizeRequestMethod(requestOptions.method ?? "GET");
    const diagnosticRoute = inventoryDiagnosticRoute(method, endpoint);
    const diagnosticStartedAt = diagnosticRoute ? performance.now() : 0;
    if (isUnsafeMethod(method)) {
      if (requestOptions.origin === "preview" ||
        (requestOptions.origin !== "outside-preview" && typeof window === "undefined")) {
        if (diagnosticRoute) {
          logInventoryRequest(method, diagnosticRoute, diagnosticStartedAt, null, {
            error: "preview_mutation_blocked",
          });
        }
        throw new PreviewMutationBlockedError();
      }
      if (requestOptions.origin !== "outside-preview" &&
        !isPreviewMutationAllowed(method, endpoint)) {
        if (diagnosticRoute) {
          logInventoryRequest(method, diagnosticRoute, diagnosticStartedAt, null, {
            error: "preview_mutation_blocked",
          });
        }
        throw new PreviewMutationBlockedError();
      }
    }
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
      const isAdminRegistration = endpoint === "/auth/admin/register";
      if (isAdminRegistration) {
        console.info("[admin-registration] CSRF acquisition started.");
      }
      try {
        requestCsrfToken = await acquireCsrfToken();
        if (isAdminRegistration) {
          console.info("[admin-registration] CSRF acquisition succeeded.");
        }
      } catch (error) {
        if (diagnosticRoute) {
          logInventoryRequest(method, diagnosticRoute, diagnosticStartedAt, null, {
            error: "csrf_acquisition_failed",
          });
        }
        if (isAdminRegistration) {
          console.info(
            "[admin-registration] CSRF acquisition failed.",
            error instanceof Error ? error.name : typeof error,
            error instanceof Error ? error.message : "",
          );
        }
        throw error;
      }
      headers.set("X-CSRF-Token", requestCsrfToken);
    }

    const init: RequestInit = {
      method,
      headers: new Headers(headers),
      credentials: "include",
    };
    if (body !== undefined) init.body = body;
    if (requestOptions.signal) init.signal = requestOptions.signal;

    if (endpoint === "/auth/admin/register") {
      console.info("[admin-registration] Registration POST about to be sent.");
    }
    let response: Response;
    try {
      response = await fetcher(buildApiUrl(apiBaseUrl, endpoint), init);
    } catch (error) {
      if (diagnosticRoute) {
        logInventoryRequest(method, diagnosticRoute, diagnosticStartedAt, null, {
          error: "network_request_failed",
        });
      }
      if (endpoint === "/auth/admin/register") {
        console.info(
          "[admin-registration] Registration fetch threw.",
          error instanceof Error ? error.name : typeof error,
          error instanceof Error ? error.message : "",
        );
      }
      throw error;
    }
    if (endpoint === "/auth/admin/register") {
      console.info("[admin-registration] Registration response received.", response.status);
    }
    let responseBody = await readResponseBody(response);

    if (!response.ok) {
      let apiError = new ApiHttpError(
        response.status,
        responseBody,
        getErrorMessage(responseBody, response),
      );

      if (apiError.isCsrfFailure && isUnsafeMethod(method)) {
        if (csrfToken === requestCsrfToken || !csrfToken) {
          try {
            const refreshedToken = await acquireCsrfToken(true);
            const retryHeaders = new Headers(init.headers);
            retryHeaders.set("X-CSRF-Token", refreshedToken);
            response = await fetcher(buildApiUrl(apiBaseUrl, endpoint), {
              ...init,
              headers: retryHeaders,
            });
            responseBody = await readResponseBody(response);
            if (!response.ok) {
              apiError = new ApiHttpError(
                response.status,
                responseBody,
                getErrorMessage(responseBody, response),
              );
            }
          } catch (error) {
            apiError.csrfRefreshError = error;
          }
        }
      }

      if (!response.ok) {
        if (diagnosticRoute) {
          const correlationId =
            response.headers.get("x-correlation-id") ?? response.headers.get("x-request-id");
          logInventoryRequest(
            method,
            diagnosticRoute,
            diagnosticStartedAt,
            response.status,
            responseBody,
            correlationId,
          );
        }
        throw apiError;
      }
    }
    if (diagnosticRoute) {
      const correlationId =
        response.headers.get("x-correlation-id") ?? response.headers.get("x-request-id");
      logInventoryRequest(
        method,
        diagnosticRoute,
        diagnosticStartedAt,
        response.status,
        undefined,
        correlationId,
      );
    }

    if (requestOptions.regeneratesSession) {
      await refreshCsrfTokenAfterSessionTransition();
    }

    return { body: responseBody as T | undefined, status: response.status };
  }

  async function request<T = unknown>(
    endpoint: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T | undefined> {
    const result = await requestWithStatus<T>(endpoint, requestOptions);
    return result.body;
  }

  return {
    request,
    requestWithStatus,
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

  async function resilientFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await globalThis.fetch(input, init);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && init?.signal?.aborted) throw error;
        if (attempt === 0) await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
      }
    }
    throw lastError;
  }

  return createApiClient({
    baseUrl,
    fetcher: resilientFetch,
  });
}
