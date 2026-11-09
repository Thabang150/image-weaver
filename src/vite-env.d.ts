/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_BASE_URL?: string;
  readonly VITE_APP_ENV?: "development" | "staging" | "production";
  readonly VITE_PRODUCT_IMAGE_ALLOWED_HOSTS?: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
}
