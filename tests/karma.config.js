const path = require("path");
const utils = require("../tasks/utils");

// create expect adapter
const expectPlugin = {
	"framework:expect": ["factory", files => {
		files.unshift({
			included: true, served: true, watched: false,
			pattern: path.join(path.dirname(require.resolve("expect")), "build-es5", "index.js")
		})
	}]
}
expectPlugin["framework:expect"][1].$inject = ["config.files"];

module.exports = config => {
	config.set({
		basePath: utils.base,
		frameworks: ["expect"],
		plugins: [expectPlugin],
		files: [utils.pkg.browser]
	});
};
