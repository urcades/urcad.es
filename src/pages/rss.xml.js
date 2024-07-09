import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt();

export async function GET(context) {
    const blog = await getCollection('writing');

    // Function to preprocess markdown content
    function preprocessMarkdown(content) {
        // Replace custom Image tags with standard img tags
        const imgTagRegex = /<Image\s+src={([^}]+)}\s+alt="([^"]+)"\s*\/>/g;
        const processedContent = content.replace(imgTagRegex, (match, src, alt) => {
            return `Image: ${alt}`;
        });

        // Remove import statements
        const importRegex = /import\s[^;]*;/g;
        return processedContent.replace(importRegex, '');
    }

    return rss({
        title: 'É. Urcades',
        description: 'Ongoing Writing',
        site: context.site,
        items: blog.map((post) => {
            const processedBody = preprocessMarkdown(post.body);
            return {
                title: post.data.title,
                pubDate: post.data.pubDate,
                description: post.data.description,
                customData: post.data.customData,
                link: `/writing/${post.slug}/`,
                content: sanitizeHtml(parser.render(processedBody), {
                    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
                }),
                ...post.data,
            };
        }),
    });
}
