import { defineConfig } from "nitro";
import { loadEnv } from "vite";

const configuredBackendBaseUrl =
  process.env["VITE_BACKEND_BASE_URL"] ??
  loadEnv("production", process.cwd(), "VITE_")["VITE_BACKEND_BASE_URL"];

if (!configuredBackendBaseUrl?.trim()) {
  throw new Error("VITE_BACKEND_BASE_URL must be configured for the production API proxy.");
}

const backendUrl = new URL(configuredBackendBaseUrl.trim());
if (
  (backendUrl.protocol !== "http:" && backendUrl.protocol !== "https:") ||
  backendUrl.username ||
  backendUrl.password ||
  backendUrl.search ||
  backendUrl.hash
) {
  throw new Error("VITE_BACKEND_BASE_URL must be an HTTP(S) URL without credentials or query.");
}

const backendPath = backendUrl.pathname.replace(/\/+$/, "");
const backendApiPath = backendPath.endsWith("/api/v1")
  ? backendPath
  : `${backendPath}/api/v1`;

export default defineConfig({
  routeRules: {
    "/api/v1/**": {
      proxy: `${backendUrl.origin}${backendApiPath}/**`,
    },
  },
});
