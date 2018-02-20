// gulp
import gulp from "gulp";
import sourcemaps from "gulp-sourcemaps";
import replace from "gulp-replace";
import gutil from "gulp-util";
// rollup
import rollup from "rollup-stream";
import babel from "rollup-plugin-babel";
import multiEntry from "rollup-plugin-multi-entry";
import nodeResolve from "rollup-plugin-node-resolve";
import forceBinding from "rollup-plugin-force-binding";
// vinyl
import source from "vinyl-source-stream";
import buffer from "vinyl-buffer";
// utils
import * as utils from "./tasks/utils";
// built-ins
import fs from "fs";
import path from "path";
// other
import uglifyComposer from "gulp-uglify/composer";
import uglifyES from "uglify-es";
import merge from "merge-stream";
import del from "del";
import browserSync from "browser-sync";

//////////////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////////////

// the build repo lives at /node_modules/@createjs/build/ inside the lib repos
const base = path.resolve(process.env.PWD || process.cwd(), "../../../");
// get the relative package and the universal config
const pkg = require(`${base}/package.json`);
const config = require("./config.json");
const version = utils.env.isProduction ? pkg.version : "NEXT";
// the order of the libs here is also the order that they will be bundled in combined
const libs = ["core", "tween", "easel", "sound", "preload"];
// the lib that is using this process, read as @createjs/(lib)
const lib = pkg.name.split("/")[1];
// quickrefs
const paths = {
	// assets
	LICENSE: "./assets/LICENSE",
	BANNER: "./assets/BANNER",
	// generated folders
	dist: `${base}/dist`,
	// bundle entry
	main: `${base}/src/main.js`,
	plugins: `${base}/src/plugins`,
	assets: `${base}/assets/js`,
	// static html folders
	examples: `${base}/examples/**/*`,
	extras: `${base}/extras/**/*`,
	tutorials: `${base}/tutorials/**/*`,
	spikes: `${base}/spikes/**/*`,
	// glob for js watch
	sourceFiles: `${base}/src/**/*.js`,
	// sourcemap location, relative to js file not repo
	sourcemaps: "./maps"
};

//////////////////////////////////////////////////////////////
// BUNDLING
//////////////////////////////////////////////////////////////

// stores bundle caches for rebundling with rollup
const buildCaches = {};
// configure gulp-uglify to use uglify-es for ES2015+ support
const uglify = uglifyComposer(uglifyES, console);
// default the build formats
const formats = (utils.env.flags.format || "module,common,global").split(",");
const formatMap = {
	global: "iife",
	module: "es",
	common: "cjs"
};

// overwrite the comments strings in the config with functions
// preserve the injected license header, strip everything else
config.uglify.min.output.comments = config.uglify.nonMin.output.comments = (node, comment) => comment.line === 1;

function bundle (format) {
	// only minify in prod and for global bundles
	const minify = utils.env.isProduction && format === "global";
	const filename = utils.generateBuildFilename(lib, format, minify);
	const options = {
		format: formatMap[format],
		name: "createjs",
		exports: "named",
		extend: true,
		// plugins are added below as-needed
		plugins: [],
		// rollup is faster if we pass in the previous bundle on a re-bundle
		cache: buildCaches[filename],
		// min files are prepended with LICENSE, non-min with BANNER
		banner: gutil.template(
			utils.readFile(paths[minify ? "LICENSE" : "BANNER"]),
			{ name: utils.prettyName(lib), file: "" }
		),
		// only dev builds get sourcemaps
		sourcemap: !minify,
		// point to latest rollup so we're not depending on rollup-stream's updates
		rollup: require("rollup")
	};

	const versionExports = {};

	if (utils.env.isCombined) {
		// force-binding must go before node-resolve since it prevents duplicates
		options.plugins.push(
			multiEntry(),
			forceBinding(config.rollup.forceBinding)
		);
		// combined bundle imports all dependencies
		options.external = () => false;
		options.input = libs.map(lib => {
			const dir = `../${utils.prettyName(lib).toLowerCase()}/`;
			versionExports[lib] = require(`${dir}package.json`).version;
			return `${dir}/src/main.js`;
		});
	} else {
		// cross-library dependencies must remain externalized for individual bundles
		const externalDependencyRegex = new RegExp(
			`^(${Object.keys(options.globals = config.rollup.globals).map(g => g.replace("/", "\/")).join("|")})$`
		);
		options.external = id => externalDependencyRegex.test(id);
		options.input = `${base}/src/main.js`;
		versionExports[lib] = version;
	}

	options.outro = utils.parseVersionExport(format, versionExports);
	options.plugins.push(nodeResolve());
	// babel runs last
	if (format !== "module") {
		options.plugins.push(babel(config.babel));
	}

	let b = rollup(options)
		// cache bundle for re-bundles triggered by watch
		.on("bundle", bundle => buildCaches[filename] = bundle)
		.pipe(source(filename))
		.pipe(buffer());
	if (minify) {
		b = b.pipe(uglify(config.uglify.min));
	} else {
		b = b
			.pipe(sourcemaps.init({ loadMaps: true }))
			// TODO: Don't hardcode these paths
			.pipe(sourcemaps.mapSources(filepath =>
				/\/(Event|EventDispatcher|Ticker)\.js$/.test(filepath)
					? `${base}/node_modules/@createjs/core/src/${filepath.split("/src/")[1]}`
					: filepath.substring(3)
			))
			.pipe(uglify(config.uglify.nonMin))
			.pipe(sourcemaps.write(paths.sourcemaps));
	}
	return b
		// strip Rollup's external dependency $# suffix from class names
		.pipe(replace(/(\w+)\$[0-9]/g, "$1"))
		.pipe(gulp.dest(paths.dist));
}

gulp.task("bundle:module", () => bundle("module"));
gulp.task("bundle:common", () => bundle("common"));
gulp.task("bundle:global", () => bundle("global"));
gulp.task("build", gulp.parallel.apply(gulp, formats.map(format => `bundle:${format}`)));

// don't compile a module version because that's just the source file...
gulp.task("plugins", cb => {
	try {
		// readdirSync() will throw if the dir isn't found
		let plugins = fs.readdirSync(paths.plugins);
		const files = utils.env.flags.files;
		if (files) { plugins = plugins.filter(dir => files.indexOf(path.basename(dir, ".js") > -1)); }
		// compile the desired plugin(s) in the desired format(s), then flatten and merge the output stream
		return merge.apply(null, formats.filter(f => f !== "module").map(format => {
			return plugins.map(filename => {
				const options = {
					input: `${paths.plugins}/${filename}`,
					format: formatMap[format],
					name: "createjs",
					exports: "named",
					extend: true,
					plugins: [babel(config.babel)],
					banner: gutil.template(
						utils.readFile(paths.BANNER),
						{ name: utils.generateBuildFilename(path.basename(filename, ".js"), format), file: "" }
					)
				};
				return rollup(options)
					.pipe(source(filename))
					.pipe(buffer())
					.pipe(gulp.dest(`${paths.dist}/plugins`));
			});
		}).reduce((a, b) => a.concat(b)));
	} catch (err) {
		utils.logWarn(`No plugins found for ${utils.prettyName(lib)}.`);
		cb();
	}
});

// we don't compile a module version because that's just the source file...
gulp.task("assets", cb => {
	try {
		// readdirSync() will throw if the dir isn't found
		let assets = fs.readdirSync(paths.assets);
		const files = utils.env.flags.files;
		if (files) { assets = assets.filter(dir => files.indexOf(path.basename(dir, ".js") > -1)); }
		return merge.apply(null, assets.map(filename => {
			const options = {
				input: `${paths.assets}/src/${filename}`,
				format: formatMap.global,
				name: "createjs",
				plugins: [babel(config.babel)],
				banner: gutil.template(
					utils.readFile(paths.BANNER),
					{ name: utils.generateBuildFilename(path.basename(filename, ".js"), format), file: "" }
				)
			};
			return rollup(options)
				.pipe(source(filename))
				.pipe(buffer())
				.pipe(gulp.dest(paths.assets));
		}));
	} catch (err) {
		utils.logWarn(`No assets found for ${utils.prettyName(lib)}.`);
		cb();
	}
});

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
			directory: true,
			routes: {
				"/shared": "./assets",
				"/libs": "../",
			}
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

// only rebundle the global module during dev since that's what the examples use
gulp.task("watch", () => {
	utils.watch(paths.sourceFiles, gulp.series("build", "reload"));
	utils.watch(`${paths.plugins}/*.js`, gulp.series("plugins", "reload"));
	utils.watch(`${paths.assets}/src/*.js`, gulp.series("assets", "reload"));
	utils.watch([paths.examples, paths.extras, paths.tutorials, paths.spikes], gulp.series("reload"));
});

gulp.task("dev", gulp.series(
	"build",
	gulp.parallel(
		"serve",
		"watch"
	)
));

//////////////////////////////////////////////////////////////
// LINT
//////////////////////////////////////////////////////////////

gulp.task("lint", function () {
	// fail after error to break the travis build.
	return gulp.src(paths.sourceFiles)
		.pipe(eslint())
		.pipe(eslint.format("codeframe"));
});
