const gulp = require("gulp");
const minimist = require("minimist");
const colors = require("ansi-colors");
const fancyLog = require("fancy-log");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const _readFile = promisify(fs.readFile);
const _readDir = promisify(fs.readdir);

module.exports = {
	log(...text) {
		let color = text[0];
		if (colors[color]) { text.shift(); }
		else { color = "magenta"; }
		fancyLog(colors[color](...text));
	},

	logOk(...text) { this.log("green", ...text); },
	logWarn(...text) { fancyLog.warn(...text); },
	logError(...text) { fancyLog.error(...text); },

	// gulp.watch, but swallows any errors to prevent the process from exiting
	watch(files, tasks) {
		const watcher = gulp.watch(files, {cwd: this.base}, tasks);
		watcher.on("error", err => this.logWarn("Swallowed error:", err));
		return watcher;
	},

	// return the string contents of a file, or undefined if there was an error reading the file
	async readFile(path) {
		try {
			return await _readFile(path, { encoding: 'utf-8' });
		} catch (err) {
			return this.logWarn(`File '${path}' was not found. Returning 'undefined'`);
		}
	},

	async readDir(path) {
		try {
			return await _readDir(path, { encoding: 'utf-8' });
		} catch (err) {
			return this.logWarn(`Directory '${path}' was not found. Returning 'undefined'`);
		}
	},

	// return a string representation of the library versions being bundled for exporting
	parseVersionExport(format, versions) {
		let str = "var cjs = window.createjs = window.createjs || {}";
		Object.keys(versions).forEach(v => str += `\ncjs.${this.prettyName(v)}.version = "${versions[v]}";`);
		return str;
	},

	// global modules have a format of lib[-NEXT][.min].js
	// commonjs modules have a format of lib[.type].js
	generateBuildFilename(lib, type, min = false) {
		let isNext = false;
		if (type === "iife") {
			type = "";
			isNext = !this.env.isProduction;
		}
		return `${this.prettyName(lib).toLowerCase() + (isNext ? "-NEXT" : "") + (type.length > 0 ? `.${type}` : "") + (min ? ".min" : "")}.js`;
	},

	// makes "lib" or "libjs" look like "LibJS"
	prettyName(lib) {
		if (lib === "cdn") { return "CreateJS"; }
		if (lib === "core") { return "Core"; }
		return `${lib[0].toUpperCase() + lib.substring(1, /js$/i.test(lib) ? lib.length - 2 : undefined)}JS`;
	},

	// quick reference for environment variables
	env: {
		options: minimist(process.argv.slice(2)),
		get isProduction () { return !!this.options.production; },
		get isCombined () { return !!this.options.combined; }
	},

	_base: null,
	_pkg: null,
	_getBasePathAndPackage() {
		// the build repo lives at /node_modules/@createjs/build/ inside the lib repos
		let base, pkg;
		try {
			base = path.resolve(process.cwd(), "../../../");
			pkg = require(`${base}/package.json`);
		} catch (e) {
			base = process.platform === "win32" ? process.env.PWD : path.resolve(process.env.PWD, "../../../");
			pkg = require(`${base}/package.json`);
		}
		this._base = base;
		this._pkg = pkg;
		return { base, pkg };
	},
	get base() {
		if (this._base) { return this._base; }
		return this._getBasePathAndPackage().base;
	},
	get pkg() {
		if (this._pkg) { return this._pkg; }
		return this._getBasePathAndPackage().pkg;
	}
};
