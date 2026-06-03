#!/usr/bin/env node

import assert from "node:assert/strict";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import astroConfig from "../astro.config.mjs";
import satteriResponsiveImages, { shouldAnnotateImage } from "../plugins/satteri-responsive-images.mjs";

const allowedRemoteDomains = new Set(["media.urcad.es", "d2w9rnfcy7mm78.cloudfront.net"]);

function shouldAnnotate(src, props = {}) {
  return shouldAnnotateImage(src, props, allowedRemoteDomains);
}

assert.equal(
  shouldAnnotate("https://media.urcad.es/assets/260603/photo.jpeg"),
  true,
  "stable media asset JPEGs should be annotated"
);

assert.equal(
  shouldAnnotate("https://media.urcad.es/stream/260603/D9396164-DE20-455B-959F-ADE35EC4B85A.jpeg"),
  false,
  "stream JPEGs should not be annotated"
);

assert.equal(
  shouldAnnotate("https://media.urcad.es/stream/260603/photo.HEIC"),
  false,
  "stream HEIC images should not be annotated"
);

assert.equal(
  shouldAnnotate("https://media.urcad.es/stream/260603/photo.heif"),
  false,
  "stream HEIF images should not be annotated"
);

assert.equal(
  shouldAnnotate("https://media.urcad.es/assets/260603/animation.gif"),
  false,
  "unsupported stable asset extensions should not be annotated"
);

for (const props of [{ width: 1200 }, { height: 800 }, { srcset: "photo-2x.jpeg 2x" }, { sizes: "100vw" }]) {
  assert.equal(
    shouldAnnotate("https://media.urcad.es/assets/260603/photo.jpeg", props),
    false,
    `${Object.keys(props)[0]} should prevent annotation`
  );
}

const markdownProcessor = await createSatteriMarkdownProcessor({
  image: astroConfig.image,
  hastPlugins: [satteriResponsiveImages()],
});
const rendered = await markdownProcessor.render(
  [
    "![](https://media.urcad.es/assets/260603/photo.jpeg)",
    "![](https://media.urcad.es/stream/260603/D9396164-DE20-455B-959F-ADE35EC4B85A.jpeg)",
  ].join("\n\n"),
  {}
);

assert.deepEqual(rendered.metadata.remoteImagePaths, ["https://media.urcad.es/assets/260603/photo.jpeg"]);
assert.match(rendered.code, /__ASTRO_IMAGE_=/, "stable assets should enter Astro's image pipeline");
assert.match(
  rendered.code,
  /src="https:\/\/media\.urcad\.es\/stream\/260603\/D9396164-DE20-455B-959F-ADE35EC4B85A\.jpeg"/,
  "stream images should render as ordinary img URLs"
);

console.log("satteri-responsive-images tests passed");
