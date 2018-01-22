// gulp
import gulp from "gulp";
import beautify from "gulp-beautify";
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
// other
import uglifyComposer from "gulp-uglify/composer";
import uglifyES from "uglify-es";
import merge from "merge-stream";
import del from "del";
import browserSync from "browser-sync";
import fs from "fs";
import path from "path";

//////////////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////////////

// the build repo lives at /node_modules/@createjs/build/ inside the lib repos
const base = `${path.resolve(process.cwd(), "../../../")}/`;
// get the relative package and the universal config
const pkg = require(`${base}package.json`);
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
	dist: `${base}dist/`,
	docs: `${base}docs/`,
	// bundle entry
	main: `${base}src/main.js`,
	plugins: `${base}src/plugins/`,
	// browser-sync base
	serve: base,
	// extra folders
	examples: `${base}examples/**/*`,
	extras: `${base}extras/**/*`,
	tutorials: `${base}tutorials/**/*`,
	// glob for js watch
	sourceFiles: `${base}src/**/*.js`,
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
config.uglify.min.output.comments = (node, comment) => comment.line === 1;
// preserve the injected license header, strip documentation blocks
config.uglify.nonMin.output.comments = (node, comment) => comment.line === 1 || !(/@(uglify|license|copyright)/i.test(comment.value));

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
		plugins: [multiEntry()],
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

	const filesToBundle = [];
	const versionExports = {};

	if (utils.env.isCombined) {
		// force-binding must go before node-resolve since it prevents duplicates
		options.plugins.push(forceBinding(config.rollup.forceBinding));
		// combined bundle imports all dependencies
		options.external = () => false;
		libs.forEach(lib => {
			const dir = `../${utils.prettyName(lib).toLowerCase()}/`;
			filesToBundle.push(`${dir}src/**/*.js`);
			versionExports[lib] = require(`${dir}package.json`).version;
		});
	} else {
		// cross-library dependencies must remain externalized for individual bundles
		const externalDependencyRegex = new RegExp(
			`^(${Object.keys(options.globals = config.rollup.globals).map(g => g.replace("/", "\/")).join("|")})$`
		);
		options.external = id => externalDependencyRegex.test(id);
		filesToBundle.push("src/**/*.js");
		versionExports[lib] = version;
	}

	options.input = {
		include: filesToBundle,
		exclude: [ "*/src/main.js" ]
	};
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
			.pipe(uglify(config.uglify.nonMin))
			.pipe(beautify(config.beautify))
			.pipe(sourcemaps.write(paths.sourcemaps));
	}
	return b
		// strip Rollup's external dependency $# suffix from class names
		.pipe(replace(/(\w+)\$[0-9]/g, "$1"))
		.pipe(gulp.dest(`${paths.dist + version}/`));
}

gulp.task("bundle:module", () => bundle("module"));
gulp.task("bundle:common", () => bundle("common"));
gulp.task("bundle:global", () => bundle("global"));

function compilePlugin (format, entry) {
	const input = paths.plugins + entry;
	const options = {
		input,
		format: formatMap[format],
		name: "createjs",
		plugins: [ babel(config.babel) ],
		banner: gutil.template(
			utils.readFile(paths.BANNER),
			{ name: utils.generateBuildFilename(path.basename(entry, ".js"), format), file: "" }
		)
	};
	return rollup(options)
		.pipe(source(filename))
		.pipe(buffer())
		.pipe(gulp.dest(`${paths.dist}plugins/`));
}

// we don't compile an "es" version because that's just the source file...
gulp.task("plugins", cb => {
	try {
		// readdirSync() will throw if the dir isn't found
		let plugins = fs.readdirSync(paths.plugins);
		const files = utils.env.files;
		if (files) { plugins = plugins.filter(dir => files.indexOf(path.basename(dir, ".js") > -1)); }
		return merge(...formats.reduce((s, format) => {
			// exclude module format from plugin compiles
			if (format === "module") { return s; }
			return s.concat(compilePlugin.bind(null, format));
		}, []));
	} catch (err) {
		utils.logWarn(`No plugins found for ${utils.prettyName(lib)}.`);
		cb();
	}
});

gulp.task("build", gulp.parallel.apply(gulp,
	(utils.env.isCombined ? [] : ["plugins"]).concat(
		formats.map(format => `bundle:${format}`)
	)
));

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
			baseDir: paths.serve,
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

// only rebundle the global module during dev since that's what the examples use
gulp.task("watch", () => {
	utils.watch(paths.sourceFiles, gulp.series("bundle:global", "reload"));
	utils.watch(`${paths.plugins}*.js`, gulp.series("plugins", "reload"));
	utils.watch([paths.examples, paths.extras, paths.tutorials], gulp.series("reload"));
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

//////////////////////////////////////////////////////////////
// LINK
//////////////////////////////////////////////////////////////
/*
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
*/
