import { extname } from 'path';

export function log (color, ...text) {
	gutil.log(gutil.colors[color](...text));
}

export function watch (sourceFiles, gulpTasks) {
	gulp.watch(sourceFiles, gulpTasks)
		.on("error", () => {});
}

// return the string contents of a file, or undefined if there was an error reading the file
export function getFile (path) {
	try {
		return extname(path) === ".json"
			? require(path)
			: fs.readFileSync(path, { encoding: "utf-8" });
	} catch (error) {
		log("yellow", `File '${path}' was not found. Returning 'undefined'.`);
		return undefined;
	}
}

// return JSON read from a file
export function readJSON (path) {
	let file = getFile(path);
	return file
		?	(typeof file === 'string'
			? JSON.parse(file)
			: file)
		: {};
}

// returns a string of format lib[-NEXT](.type)(.min).js
// global modules have no type
export function generateBuildFilename (lib, type, min) {
	return `${nameToLib(lib) + (env.isDev ? "-NEXT" : "") + (type.length > 0 ? `.${type}` : "") + (min ? ".min" : "")}.js`;
}

// makes "easel" or "easeljs" look like "EaselJS"
export function nameToCamelCase (lib) {
	return `${lib[0].toUpperCase() + lib.substring(1, /js$/i.test(lib) ? lib.length - 2 : undefined)}JS`;
}

// makes "EaselJS" or "easeljs" look like "easel"
export function nameToLib (lib) {
	return lib.toLowerCase().replace(/js$/, "");
}

export const env = {
	DEV: 'development',
	PROD: 'production',
	get isDev () { return process.env.NODE_ENV === this.DEV; },
	get isProd () { return process.env.NODE_ENV === this.PROD; },
	get isCombined () { return process.env.hasOwnProperty("COMBINED"); }
};
