/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {
			typography: (theme) => ({
			  DEFAULT: {
				css: {
					'--tw-prose-body': theme('colors.black'),
					'--tw-prose-invert-body': theme('colors.white'), 
					'--tw-prose-invert-headings': theme('colors.white'),
				},
			  },
			}),
		  },
	},
	plugins: [
		require('@tailwindcss/typography'),
	],
}
