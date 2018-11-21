const utils = require("../tasks/utils");
module.exports = {
	rootDir: utils.base,
	testMatch: [
		"<rootDir>/tests/spec/**/*.js"
  ],
	setupTestFrameworkScriptFile: "@createjs/build/tests/setup",
	collectCoverage: true,
	collectCoverageFrom: [
		"<rootDir>/src/**/!(main).js"
  ],
	coveragePathIgnorePatterns: [
		"/node_modules/",
		"/tests/"
	],
	coverageDirectory: "<rootDir>/tests/coverage/",
	coverageReporters: [
		"html",
		"text"
  ],
	notify: true,
	verbose: true
};
