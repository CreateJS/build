module.exports = {
	rootDir: "../",
	testMatch: [
		"<rootDir>/tests/spec/**/*.js"
  ],
	setupTestFrameworkScriptFile: "@createjs/build/tests/setup",
	collectCoverage: true,
	collectCoverageFrom: [
		"src/**/!(main).js"
  ],
	coveragePathIgnorePatterns: [
		"/node_modules/",
		"/tests/"
	],
	coverageDirectory: "./tests/coverage/",
	coverageReporters: [
		"html",
		"text"
  ],
	notify: true,
	verbose: true,
	testEnvironmentOptions: {
		resources: "usable"
	}
};
