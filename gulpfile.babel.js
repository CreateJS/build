// gulp
import gulp from "gulp";
import uglify from "gulp-uglify";
import beautify from "gulp-beautify";
import sourcemaps from "gulp-sourcemaps";
import sass from "gulp-sass";
import cleanCSS from "gulp-clean-css";
import replace from "gulp-replace";
import eslint from "gulp-eslint";
import gutil from "gulp-util";
import shell from "gulp-shell";
import zip from "gulp-zip";
import rename from "gulp-rename";
// rollup
import rollup from "rollup-stream";
import babel from "rollup-plugin-babel";
import multiEntry from "rollup-plugin-multi-entry";
import nodeResolve from "rollup-plugin-node-resolve";
import forceBinding from "rollup-plugin-force-binding";
import exportsExtend from "rollup-plugin-exports-extend";
// vinyl
import source from "vinyl-source-stream";
import buffer from "vinyl-buffer";
// utils
import * as utils from "./tasks/utils";
// other
import merge from "merge-stream";
import del from "del";
import browserSync from "browser-sync";
import fs from "fs";

//////////////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////////////

// the build repo lives at /node_modules/@createjs/build/ inside the lib repos
const base = "../../../";
// get the relative package and the universal config
const pkg = utils.readJSON(`${base}package.json`);
const config = utils.readJSON("./config.json");
// the order of the libs here is also the order that they will be bundled in combined
const libs = ["core", "tween", "easel", "sound", "preload"];
// the lib that is using this process (read as @createjs/(lib)js)
const lib = pkg.name.split('/')[1];
// quickrefs
const paths = {
	// assets
	LICENSE: "./assets/LICENSE",
	BANNER: "./assets/BANNER",
	// generated folders
	dist: `${base}dist/`,
	docs: `${base}docs/`,
	// bundle entry
	entry: `${base}src/main.js`,
	plugins: `${base}src/plugins/*.js`,
	// browser-sync base
	serve: base,
	// extra folders
	examples: `${base}examples/**/*`,
	extras: `${base}extras/**/*`,
	tutorials: `${base}tutorials/**/*`
	// glob for js watch
	sourceFiles: `${base}src/**/*.js`,
	// sourcemap location, relative to js file not repo
	sourcemaps: "./maps"
};
// browser-sync instance for dev
const browser = browserSync.create();
// stores bundle caches for rebundling with rollup
const buildCaches = {};
// overwrite the comments strings in the config with functions
// preserve the injected license header, strip everything else
config.uglify.min.output.comments = (node, comment) => comment.line === 1;
// preserve the injected license header, strip documentation blocks
config.uglify.nonMin.output.comments = (node, comment) => comment.line === 1 || !(/@(uglify|license|copyright)/i.test(comment.value));

//////////////////////////////////////////////////////////////
// BUNDLING
//////////////////////////////////////////////////////////////

function bundle (format) {
	const options = { format };
	if (format === "iife") { options.name = "createjs"; }
	const minify = utils.env.isProd;
	const filename = utils.generateBuildFilename(lib, format === "iife" ? "" : format, minify);
	// plugins are added below as-needed
	options.plugins = [];
	// rollup is faster if we pass in the previous bundle on a re-bundle
	options.cache = buildCaches[filename];
	// min files are prepended with LICENSE, non-min with BANNER
	options.banner = gutil.template(
		utils.getFile(paths[minify ? "LICENSE" : "BANNER"]),
		{ name: utils.nameToCamelCase(lib), file: "" }
	);
	// point to latest rollup so we're not depending on rollup-stream's updates
	options.rollup = require('rollup');

	if (utils.env.isCombined) {
		options.plugins.push(
			// multi-entry reads main.js from each lib for a combined bundle.
			multiEntry(),
			// force-binding must go before node-resolve since it prevents duplicates
			forceBinding(config.rollup.forceBinding),
			// node-resolve grabs the shared createjs files and compiles/bundles them with the rest of the lib
			nodeResolve()
		);
		// combined bundle imports all dependencies
		options.external = () => false;
		// combined builds occur in the @createjs/cdn repo, which has a dependency for all of the libs.
		options.input = libs.map(lib => `${base}/node_modules/@createjs/${lib}js/src/main.js`);
	} else {
		// point the top level export to an existing createjs
		options.plugins.push(nodeResolve(), exportsExtend(config.rollup.exportsExtend));
		// cross-library dependencies must remain externalized for individual bundles
		const externalDependencyRegex = new RegExp(`^(${Object.keys(options.globals = config.rollup.globals).map(g => g.replace('/', '\/')).join('|')})$`);
		options.external = id => {
			let match = id.match(externalDependencyRegex);
			if (match !== null) {
				utils.log("green", `Externalizing cross-library dependency for ${match[1]}`);
				return true;
			}
			return false;
		};

		options.input = paths.entry;
	}

	// babel runs last
	if (options.format !== "es6") {
		options.plugins.push(babel(config.babel));
	}

	// only development builds get sourcemaps
	options.sourcemap = utils.env.isDev;

	let b = rollup(options)
		.on("bundle", bundle => buildCaches[filename] = bundle) // cache bundle for re-bundles triggered by watch
		.pipe(source(filename))
		.pipe(buffer());
	if (options.sourcemap) {
		b = b.pipe(sourcemaps.init({ loadMaps: true }))
			.pipe(sourcemaps.mapSources((sourcePath, file) => {
				if (/\/(Event|EventDispatcher|Ticker)\.js$/.test(sourcePath)) {
					return `../node_modules/createjs/src/${sourcePath.split('/src/')[1]}`;
				} else {
					return sourcePath.substring(3);
				}
			}));
	}
	if (minify) {
		b = b.pipe(uglify(config.uglify.min));
	} else {
		// uglify strips comments, beautify re-indents and cleans up whitespace
		b = b.pipe(uglify(config.uglify.nonMin))
			.pipe(beautify(config.beautify));
		if (options.sourcemap) {
			b = b.pipe(sourcemaps.write(paths.sourcemaps));
		}
	}
	// inject the build version into the bundle
	return b.pipe(replace(/<%=\sversion\s%>/g, version))
		.pipe(gulp.dest(`${paths.dist + version}/`));
}

gulp.task("bundle:es6", function () {
	return bundle("es" );
});

gulp.task("bundle:cjs", function () {
	return bundle("cjs");
});

gulp.task("bundle:global", function () {
	return bundle({
		format: "iife",
		name: "createjs"
	}, "");
});

gulp.task("bundle:global:min", function () {
	return bundle({
		format: "iife",
		name: "createjs"
	}, "", true);
});

/********************************************************************

  PLUGINS

********************************************************************/

function transpilePlugin (options, isGlobal) {
	let filename = `${options.input.match(/(\w+)\.js$/)[1]}.${isGlobal ? "js" : "common.js"}`;
	options.banner = gutil.template(getFile(paths.BANNER), { name: filename.substring(0, filename.length - (isGlobal ? 3 : 10)), file: "" });
	return rollup(options)
		.pipe(source(filename))
		.pipe(buffer())
		.pipe(gulp.dest(`${paths.dist}plugins/`));
}

// only clean the NEXT builds. Main builds are stored until manually deleted.
gulp.task("plugins", function (done) {
	let stub = paths.plugins.substring(0, paths.plugins.length - 4);
	try {
		fs.accessSync(stub);
	} catch (error) {
		log("yellow", `No plugins found for ${nameToCamelCase(activeLib)}.`);
		done();
		return;
	}
	let plugins = fs.readdirSync(stub);
	let iife = plugins.map(entry => transpilePlugin({
		input: stub + entry,
		format: "iife",
		name: "createjs",
		plugins: [babel(config.babel)]
	}, true));

	let cjs = plugins.map(entry => transpilePlugin({
		input: stub + entry,
		format: "cjs",
		plugins: [babel(config.babel)]
	}, false));

	return merge(...iife, ...cjs);
});

/********************************************************************

  BUILD

********************************************************************/

// only clean the NEXT builds. Main builds are stored until manually deleted.
gulp.task("clean:dist", function (done) {
	if (isNext) {
		return del([`${paths.dist}*NEXT*`], { force: true });
	}
	done();
});

gulp.task("copy:build", function (done) {
	done();
	/*
	  TODO: Copy builds around the libs.
	    - When a lib is built, copy its global module into the _assets/libs of the other lib as a next.
	    - also copy it to the demos folders on the site
	    - copy lib/examples to site/demos/lib
	 */
});

gulp.task("build", gulp.series(
	setNodeEnv(PRODUCTION),
	"clean:dist",
	gulp.parallel(
		"bundle:cjs",
		"bundle:global",
		"bundle:global:min",
		"bundle:es6",
		"plugins"
	),
	"copy:build"
));

gulp.task("build:next", gulp.series(
	setNodeEnv(DEVELOPMENT),
	"clean:dist",
	"bundle:global",
	"copy:build"
));

/********************************************************************

  DEV

********************************************************************/

// serve the lib root for easy examples/extras access
gulp.task("serve", function () {
	browser.init({ server: { baseDir: paths.serve } });
});

gulp.task("reload", function (done) {
	browser.reload();
	done();
});

// only rebundle the global module during dev since that's what the examples use
gulp.task("watch:dev", function () {
	watch(paths.sourceFiles, gulp.series("bundle:global", "reload"));
	watch(paths.plugins, gulp.series("plugins", "reload"));
	watch([paths.examples, paths.extras], gulp.series("reload"));
});

gulp.task("dev", gulp.series(
	setNodeEnv(DEVELOPMENT),
	"clean:dist",
	gulp.parallel(
		"bundle:global",
		"plugins"
	),
	gulp.parallel(
		"serve",
		"watch:dev"
	)
));

/********************************************************************

  LINT

********************************************************************/

gulp.task("lint", function () {
	// fail after error to break the travis build.
	return gulp.src(paths.sourceFiles)
		.pipe(eslint())
		.pipe(eslint.format("codeframe"));
});

/********************************************************************

  DEV LINK

********************************************************************/

// link the Combined repository to all of the repos or just the one passed
// this must be run from gulp and not npm, as args passed to npm run are not visible to the subsequent gulp task.
gulp.task("link", shell.task(
	(function () {
		let linked = true;
		try { fs.accessSync(process.execPath.replace("node.exe", "node_modules/createjs")); } catch (err) { linked = false; }
		return (linked ? [] : ["npm link ."]).concat(
			yargs.argv.hasOwnProperty("all") ?
			libs.map(lib => `cd ${getLibPath(lib)} && npm link createjs`) :
			[`cd ${getLibPath((yargs.argv.lib || "").replace("js", "").toLowerCase())} && npm link createjs`]
		);
	})()
));
