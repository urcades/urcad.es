import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import sanitizeHtml from 'sanitize-html';
import { bundleMDX } from 'mdx-bundler';
import * as runtime from 'react/jsx-runtime';
import { renderToString } from 'react-dom/server';

// Mocking Astro components for MDX
const Image = (props) => `<img src="${props.src}" alt="${props.alt}" />`;

export async function GET(context) {
    const blog = await getCollection('writing');

    const processedBlog = await Promise.all(
        blog.map(async (post) => {
            const { code } = await bundleMDX({
                source: post.body,
                cwd: process.cwd(),
                files: {
                    './components/Image.js': `export default ${Image.toString()}`,
                },
                esbuildOptions: (options) => {
                    options.bundle = false;
                    return options;
                },
                mdxOptions: (options) => {
                    options.remarkPlugins = [];
                    options.rehypePlugins = [];
                    return options;
                },
            });

            const MDXComponent = new Function('React', 'jsx', `${code}; return MDXContent`)(runtime, runtime.jsx);

            const contentHtml = renderToString(<MDXComponent />);

            return {
                ...post,
                content: sanitizeHtml(contentHtml, {
                    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
                }),
            };
        })
    );

    return rss({
        title: 'É. Urcades',
        description: 'Ongoing Writing',
        site: context.site,
        items: processedBlog.map((post) => ({
            title: post.data.title,
            pubDate: post.data.pubDate,
            description: post.data.description,
            customData: post.data.customData,
            link: `/writing/${post.slug}/`,
            content: post.content,
            ...post.data,
        })),
    });
}