import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import satteriHighlight from "./plugins/satteri-highlight.mjs";

export default defineConfig({
  image: {
    domains: ["media.urcad.es", "d2w9rnfcy7mm78.cloudfront.net"],
  },
  markdown: {
    syntaxHighlight: false,
    processor: satteri({
      hastPlugins: [satteriHighlight()],
    }),
  },
  site: "https://www.urcad.es",
  prefetch: {
    prefetchAll: false,
  },
  integrations: [sitemap()],
});
