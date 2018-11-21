const gulp = require("gulp");
const rollup = require("rollup");
const babel = require("rollup-plugin-babel");
const multiEntry = require("rollup-plugin-multi-entry");
const nodeResolve = require("rollup-plugin-node-resolve");
const commonjs = require("rollup-plugin-commonjs");
const cleanup = require("rollup-plugin-cleanup");
const uglify = require("rollup-plugin-uglify").uglify;
const utils = require("./tasks/utils");
const template = require("lodash.template");
const path = require("path");
const del = require("del");
const browserSync = require("browser-sync");

//////////////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////////////

const base = utils.base;
const pkg = utils.pkg;
const version = utils.env.isProduction ? pkg.version : "NEXT";
// the order of the libs here is also the order that they will be bundled in combined
const libs = ["core", "tween", "easel", "sound", "preload"];
// the lib that is using this process, read as @createjs/(lib)
const lib = pkg.name.split("/")[1];
// quickrefs
const paths = {
	LICENSE: "./assets/LICENSE",
	BANNER: "./assets/BANNER",
	dist: path.join(base, "dist"),
	main: path.join(base, "src/main.js"),
	plugins: path.join(base, "src/plugins"),
	watch: {
		js: "src/**/*.js",
		plugins: "src/plugins/**/*.js",
		examples: "examples/**/*",
		extras: "extras/**/*",
		tutorials: "tutorials/**/*",
		spikes: "spikes/**/*"
	}
};

//////////////////////////////////////////////////////////////
// BUNDLING
//////////////////////////////////////////////////////////////

// stores bundle caches for rebundling with rollup
const buildCaches = {};
// instantiate rollup plugins only once
const plugins = {
	babel: babel({
		babelrc: false,
		configFile: "./babel.config.js"
	}),
	multiEntry: multiEntry(),
	nodeResolve: nodeResolve(),
	commonjs: commonjs(),
	uglify: uglify({
		output: {
			// preserves the @license banner
			comments: (node, comment) => comment.line === 1
		},
		compress: {
			global_defs: {
				// drop debug statements
				DEBUG: false
			}
		}
	}),
	cleanup: cleanup({
		comments: "srcmaps"
	})
};
// default the build formats
const formats = (utils.env.options.format || "cjs,iife").split(",");

// returns an async function for bundling
const bundle = (format) => async () => {
	const minify = utils.env.isProduction;
	const filename = utils.generateBuildFilename(lib, format, minify);
	const bundleOptions = {
		// plugins are added below as-needed
		plugins: [],
		// rollup is faster if we pass in the previous bundle on a re-bundle
		cache: buildCaches[filename],
	};
	const writeOptions = {
		format,
		file: path.join(paths.dist, filename),
		name: "createjs",
		exports: "named",
		extend: true,
		// min files are prepended with LICENSE, non-min with BANNER
		banner: template(await utils.readFile(paths[minify ? "LICENSE" : "BANNER"]))({ name: utils.prettyName(lib) }),
		// only dev builds get sourcemaps
		sourcemap: !minify
	};

	const versionExports = {};

	if (utils.env.isCombined) {
		bundleOptions.plugins.push(plugins.multiEntry);
		// combined bundle imports all dependencies
		bundleOptions.external = () => false;
		bundleOptions.input = libs.map(lib => {
			const dir = `../${utils.prettyName(lib).toLowerCase()}`;
			versionExports[lib] = require(path.join(dir, "package.json")).version;
			// TODO: if version is "NEXT", append the git commit hash `NEXT@hash`
			return path.join(dir, "src/main.js");
		});
	} else {
		writeOptions.globals = {};
		// don't globalize core lib
		libs.slice(1).forEach(lib => writeOptions.globals[`@createjs/${lib}js`] = "this.createjs");
		// cross-library dependencies must remain externalized for individual bundles
		bundleOptions.external = id => /@createjs\/(?!core)/.test(id);
		bundleOptions.input = paths.main;
		versionExports[lib] = version;
	}

	writeOptions.outro = utils.parseVersionExport(format, versionExports);
	bundleOptions.plugins.push(
		plugins.nodeResolve,
		plugins.commonjs,
		plugins.babel
	);

	// only minify iife bundles
	if (minify && format === "iife") {
		bundleOptions.plugins.push(plugins.uglify);
	} else {
		bundleOptions.plugins.push(plugins.cleanup);
	}

	return rollup.rollup(bundleOptions).then(b => {
		buildCaches[filename] = b.cache;
		return b.write(writeOptions);
	});
};

gulp.task("bundle:cjs", bundle("cjs"));
gulp.task("bundle:iife", bundle("iife"));
gulp.task("build", gulp.parallel.apply(gulp, formats.map(format => `bundle:${format}`)));

const bundlePlugins = (format) => async done => {
	// read plugin directory, bailing if it's not found
	let plugins = await utils.readDir(paths.plugins);
	if (!plugins) { done(); }
	// filter plugins if files flag is present
	const files = utils.env.options.files;
	if (files) { plugins = plugins.filter(dir => files.includes(path.basename(dir, ".js"))); }
	const banner = template(await utils.readFile(paths.BANNER))({ name: utils.prettyName(lib) });

	return Promise.all(
		plugins.map(plugin => {
			const bundleOptions = {
				input: path.join(paths.plugins, plugin),
				plugins: [
					plugins.babel,
					plugins.cleanup
				],
			};
			const writeOptions = {
				format,
				file: path.join(paths.dist, "plugins", plugin),
				name: "createjs",
				exports: "named",
				extend: true,
				sourcemap: true,
				banner
			};
			return rollup.rollup(bundleOptions).then(b => b.write(writeOptions));
		})
	);
};

gulp.task("plugins:cjs", bundlePlugins("cjs"));
gulp.task("plugins:iife", bundlePlugins("iife"));
gulp.task("plugins", gulp.parallel.apply(gulp, formats.map(format => `plugins:${format}`)));

//////////////////////////////////////////////////////////////
// DEV
//////////////////////////////////////////////////////////////

// browser-sync instance for dev
const browser = browserSync.create();

// serve the lib root for easy examples/extras access
gulp.task("serve", () => {
	browser.init({
		host: "localhost",
		port: 3000,
		server: {
			baseDir: base,
			directory: true
		},
		ghostMode: false,
		logLevel: "info",
		logPrefix: utils.prettyName(lib)
	});
});

gulp.task("reload", cb => {
	browser.reload();
	cb();
});

gulp.task("watch", () => {
	const w = paths.watch;
	utils.watch([w.js, `!${w.plugins}`], gulp.series("build", "reload"));
  utils.watch(w.plugins, gulp.series("plugins", "reload"));
	utils.watch([w.examples, w.extras, w.tutorials, w.spikes], gulp.series("reload"));
});

gulp.task("dev", gulp.series("build", gulp.parallel("serve", "watch")));

//////////////////////////////////////////////////////////////
// LINT
//////////////////////////////////////////////////////////////

gulp.task("lint", () => {
	// fail after error to break the travis build
	return gulp.src(paths.src)
		.pipe(eslint())
		.pipe(eslint.format("codeframe"));
});
