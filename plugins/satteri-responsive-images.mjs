import { defineHastPlugin } from "satteri";

const DEFAULT_WIDTHS = [480, 720, 960, 1280];
const DEFAULT_SIZES = "(min-width: 768px) 55ch, 100vw";
const DEFAULT_REMOTE_DOMAINS = ["media.urcad.es", "d2w9rnfcy7mm78.cloudfront.net"];
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set([".gif", ".heic", ".heif", ".tif", ".tiff"]);

export default function satteriResponsiveImages({
  widths = DEFAULT_WIDTHS,
  sizes = DEFAULT_SIZES,
  remoteDomains = DEFAULT_REMOTE_DOMAINS,
} = {}) {
  const allowedRemoteDomains = new Set(remoteDomains);

  return defineHastPlugin({
    name: "responsive-markdown-images",
    element: {
      filter: ["img"],
      visit(node, ctx) {
        const props = node.properties ?? {};
        const src = typeof props.src === "string" ? props.src : "";

        if (!shouldAnnotateImage(src, props, allowedRemoteDomains)) {
          return;
        }

        ctx.setProperty(node, "widths", widths);
        ctx.setProperty(node, "sizes", sizes);
      },
    },
  });
}

export function shouldAnnotateImage(src, props, allowedRemoteDomains) {
  if (!src) return false;
  if (hasAuthorResponsiveProps(props)) return false;
  if (hasAuthorSizingProps(props)) return false;
  if (hasUnsupportedImageExtension(src)) return false;
  if (isDataUrl(src) || isSvg(src) || src.startsWith("/")) return false;

  if (!URL.canParse(src)) {
    return true;
  }

  const url = new URL(src);
  if (isStreamMediaUrl(url)) return false;
  return url.protocol === "https:" && allowedRemoteDomains.has(url.hostname);
}

function hasAuthorResponsiveProps(props) {
  return "sizes" in props || "srcset" in props || "srcSet" in props || "widths" in props;
}

function hasAuthorSizingProps(props) {
  return "width" in props || "height" in props;
}

function isDataUrl(src) {
  return src.startsWith("data:");
}

function isSvg(src) {
  const pathname = URL.canParse(src) ? new URL(src).pathname : src.split("?")[0];
  return pathname.toLowerCase().endsWith(".svg");
}

function hasUnsupportedImageExtension(src) {
  const pathname = URL.canParse(src) ? new URL(src).pathname : src.split("?")[0];
  const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
  return UNSUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

function isStreamMediaUrl(url) {
  return url.hostname === "media.urcad.es" && url.pathname.startsWith("/stream/");
}
