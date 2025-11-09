import { defineConfig } from "astro/config";

export default defineConfig({
  markdown: {
    syntaxHighlight: false,
  },
  site: "https://www.urcad.es",
  prefetch: {
    prefetchAll: true,
  },
});
