var path = require("path");

// get base and pkg
var base, pkg;
try {
	base = path.resolve(process.cwd(), "../../../");
	pkg = require(`${base}/package.json`);
} catch (e) {
	base = process.platform === "win32" ? process.env.PWD : path.resolve(process.env.PWD, "../../../");
	pkg = require(`${base}/package.json`);
}

// create expect adapter
var expectPlugin = {
	"framework:expect": ["factory", function (files) {
		files.unshift({
			included: true, served: true, watched: false,
			pattern: path.join(path.dirname(require.resolve("expect")), "build-es5", "index.js")
		})
	}]
}
expectPlugin["framework:expect"][1].$inject = ["config.files"];

module.exports = function (config) {
	config.set({
		basePath: base,
		frameworks: ["expect"],
		plugins: [expectPlugin],
		files: [pkg.browser]
	});
};
