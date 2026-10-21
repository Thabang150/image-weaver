import { defineConfig } from "nitro";

export default defineConfig({
  routeRules: {
    "/api/v1/**": {
      proxy: "https://heathywayssa-backend.onrender.com/api/v1/**",
    },
  },
});
