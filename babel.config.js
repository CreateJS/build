module.exports = {
	env: {
		development: {
			presets: [
				[
					"@babel/env", {
						targets: {
							browsers: ["IE 9"]
						},
						modules: false,
						loose: true
					}
				]
			]
		},
		test: {
			presets: [
				[
					"@babel/env", {
						targets: {
							browsers: ["IE 9"]
						},
						loose: true
					}
				]
			]
		}
	}
}
