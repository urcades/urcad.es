import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt();

export async function GET(context) {
    const blog = await getCollection('writing');

    return rss({
        title: 'É. Urcades',
        description: 'Ongoing Writing',
        site: context.site,
        items: blog.map((post) => ({
            title: post.data.title,
            pubDate: post.data.pubDate,
            description: post.data.description,
            customData: post.data.customData,
            link: `/writing/${post.slug}/`,
            content: sanitizeHtml(parser.render(post.body), {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
                transformTags: {
                    'Image': (tagName, attribs) => {
                        if (attribs.alt) {
                            return {
                                tagName: 'p',
                                text: `Image: ${attribs.alt}`
                            };
                        }
                        return { tagName: '', text: '' };
                    }
                },
                exclusiveFilter: (frame) => {
                    // Remove specific strings by filtering their content
                    const importRegex = /import\s[^;]*;/g;
                    return importRegex.test(frame.text);
                }
              }).replace(/import\s[^;]*;/g, ''), // Also replace instances of import statements in the content
            ...post.data,
        })),
    });
}
