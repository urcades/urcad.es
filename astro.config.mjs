import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import remarkHighlight from "./plugins/remark-highlight.mjs";

export default defineConfig({
  image: {
    domains: ["media.urcad.es"],
  },
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkHighlight],
  },
  site: "https://www.urcad.es",
  prefetch: {
    prefetchAll: true,
  },
  integrations: [sitemap()],
});
