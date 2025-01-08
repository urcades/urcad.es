import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
const parser = new MarkdownIt();

export async function GET(context) {
  const blog = await getCollection("writing");
  return rss({
    title: "É. Urcades",
    description: "Ongoing Writing",
    site: context.site,
    items: blog.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      customData: post.data.customData,
      content: sanitizeHtml(parser.render(post.body), {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
      }),
      // Compute RSS link from post `slug`
      // This example assumes all posts are rendered as `/writing/[slug]` routes
      link: `/writing/${post.id}/`,
    })),
  });
}
