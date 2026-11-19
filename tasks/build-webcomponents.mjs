// Bundles the web components of src-webcomponents/ into admin/webcomponents/,
// next to their manifests. The base class of @iobroker/web-components is
// bundled in, so the module needs nothing from the host.
// test/testWebComponent.js builds with the same options to check the bundle is current.
import { build } from 'esbuild';

await build({
	entryPoints: ['src-webcomponents/device-card.js'],
	outdir: 'admin/webcomponents',
	bundle: true,
	format: 'esm',
	target: 'es2022',
	minify: true,
	legalComments: 'none',
	logLevel: 'info',
});
