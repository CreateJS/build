beforeEach(function () {
	jasmine.addMatchers({
		toBeInRange: function() {
			return {
				compare: function(actual, expected, range) {
					var result = { pass: false };
					range = range || 0;

					if (actual <= (expected + range) && actual >= (expected - range)) {
						result.pass = true;
					}

					return result;
				}
			};
		}
  });
});
