import { defineConfig } from "astro/config";

export default defineConfig({
  image: {
    domains: ["media.urcad.es"],
  },
  markdown: {
    syntaxHighlight: false,
  },
  site: "https://www.urcad.es",
  prefetch: {
    prefetchAll: true,
  },
});
