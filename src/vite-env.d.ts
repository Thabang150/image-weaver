/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_BASE_URL?: string;
  readonly VITE_PRODUCT_IMAGE_ALLOWED_HOSTS?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}
