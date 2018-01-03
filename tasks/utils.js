import gulp from "gulp";
import gutil from "gulp-util";
import fs from "fs";

// gulp-util.log with chalk colors
export function log (...text) {
	let color = text[0];
	if (gutil.colors[color]) { text.shift(); }
	else { color = "magenta"; }
	gutil.log(gutil.colors[color](...text));
}

export function logOk (...text) { log("green", ...text); }
export function logWarn (...text) { log("yellow", ...text); }
export function logError (...text) { log("red", ...text); }

// gulp.watch, but swallows any errors to prevent the process from exiting
export function watch (sourceFiles, gulpTasks) {
	gulp.watch(sourceFiles, gulpTasks).on("error", () => {});
}

// return the string contents of a file, or undefined if there was an error reading the file
export function readFile (path, cb = null) {
	const warn = logWarn.bind(null, `File '${path}' was not found. Returning 'undefined'.`);
	if (cb) {
		fs.readFile(path, { encoding: 'utf-8' }, (err, data) => cb(err ? warn() : data));
	} else {
		try {
			return fs.readFileSync(path, { encoding: 'utf-8' });
		} catch (err) {
			return warn();
		}
	}
}


// global modules have a format of lib[-NEXT][.min].js
// common and es modules have a format of lib[.type].js
export function generateBuildFilename (lib, type, min = false) {
	let isNext = false;
	if (type === "iife") {
		type = "";
		isNext = !env.isProduction;
	} else if (type === "cjs") {
		type = "common";
	}

	return `${prettyName(lib).toLowerCase() + (isNext ? "-NEXT" : "") + (type.length > 0 ? `.${type}` : "") + (min ? ".min" : "")}.js`;
}

// makes "lib" or "libjs" look like "LibJS"
export function prettyName (lib) {
	if (lib === "cdn") { return "CreateJS"; }
	if (lib === "core") { return "Core"; }
	return `${lib[0].toUpperCase() + lib.substring(1, /js$/i.test(lib) ? lib.length - 2 : undefined)}JS`;
}

// quick reference for environment variables
export const env = {
	flags: gutil.env,
	get isProduction () { return this.flags.production; },
	get isCombined () { return this.flags.combined; }
}
