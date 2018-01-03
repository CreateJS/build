// generic setup for all createjs tests
expect.extend({
	toBeInRange (actual, expected, range = 0) {
		return {
			message: () => `expected ${actual} to be in range [${expected - range}-${expected + range}]`,
			pass: actual <= (expected + range) && actual >= (expected - range)
		};
	}
});
