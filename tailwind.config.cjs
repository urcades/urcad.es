/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		fontFamily: {
			'serif': ['Times New Roman', 'Times', 'ui-serif', 'Georgia',],
		},
		extend: {
			typography: (theme) => ({
			  DEFAULT: {
				css: {
					'--tw-prose-body': theme('colors.black'),
					'--tw-prose-counters': theme('colors.black'),
					'--tw-prose-bullets': theme('colors.black'),
					'--tw-prose-invert-body': theme('colors.white'), 
					'--tw-prose-invert-counters': theme('colors.white'), 
					'--tw-prose-invert-bullets': theme('colors.white'),
					'--tw-prose-invert-headings': theme('colors.white'),
					'--tw-prose-quote-borders': theme('colors.black'),
					'--tw-prose-invert-quote-borders': theme('colors.white'),
					'--tw-prose-quotes': theme('colors.black'),
					'--tw-prose-invert-quotes': theme('colors.white'),
					blockquote: {
						borderLeftWidth: '1px',
					},
				},
			  },
			}),
		  },
	},
	plugins: [
		require('@tailwindcss/typography'),
	],
}