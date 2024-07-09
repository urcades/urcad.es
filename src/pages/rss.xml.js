import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt();

// Function to preprocess markdown content
function preprocessMarkdown(content) {
    // Extract import statements and create a mapping
    const importRegex = /import\s+(\w+)\s+from\s+"([^"]+)";/g;
    const imports = {};
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        imports[match[1]] = match[2];
    }

    // Remove import statements
    content = content.replace(importRegex, '');

    // Replace custom Image tags with standard img tags
    const imgTagRegex = /<Image\s+([^>]+)\/>/g;
    content = content.replace(imgTagRegex, (match, attributes) => {
        const srcMatch = attributes.match(/src={(\w+)}/);
        const altMatch = attributes.match(/alt="([^"]*)"/);
        if (srcMatch && altMatch) {
            const src = imports[srcMatch[1]];
            const alt = altMatch[1];
            return `<p>Image: ${alt}</p>`;
        }
        return match; // Return the original match if src or alt is not found
    });

    return content;
}

export async function GET(context) {
    const blog = await getCollection('writing');

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
