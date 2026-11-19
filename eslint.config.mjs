// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
	...config,
	{
		// specify files to exclude from linting here
		ignores: [
			'.dev-server/',
			'.vscode/',
			'**/*.test.js',
			'test/**/*.js',
			'*.config.mjs',
			'build',
			'dist',
			'admin/words.js',
			'admin/admin.d.ts',
			'admin/blockly.js',
			'**/adapter-config.d.ts',
			'widgets/**/*.js',
			'admin/webcomponents/*.js',
		],
	},
	{
		// web components run in the browser
		files: ['src-webcomponents/**/*.js'],
		languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
		// JSDoc casts (`/** @type {X} */ (value)`) type the browser code for tsconfig.webcomponents.json;
		// the typed mode of this rule would remove them on --fix
		rules: { 'jsdoc/check-tag-names': ['warn', { typed: false }] },
	},
	{
		// you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
		// as this improves maintainability. jsdoc warnings will not block build process.
		rules: {
			 'jsdoc/require-jsdoc': 'warn',
			// 'jsdoc/require-param': 'off',
			// 'jsdoc/require-param-description': 'off',
			// 'jsdoc/require-returns-description': 'off',
			// 'jsdoc/require-returns-check': 'off',
		},
	},
];