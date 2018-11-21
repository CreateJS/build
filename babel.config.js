const browsers = ["IE 9"];
const loose = true;
module.exports = {
	// default preset for prod+dev
	presets: [
		[
			"@babel/env", {
				targets: {
					browsers: browsers
				},
				modules: false,
				loose: loose
			}
		]
	],
	env: {
		// unit testing preset
		test: {
			presets: [
				[
					"@babel/env", {
						targets: {
							browsers: browsers
						},
						loose: loose
					}
				]
			]
		}
	}
}
