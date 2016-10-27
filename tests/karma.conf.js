module.exports = function (config) {
  // browsers and reporters set in gulpfile
  config.set({
    frameworks: [ "jasmine" ],
    basePath: "../",
    files: [
      // lib and sourcemaps
      // "dist/createjs-2015.11.26.combined.js",
      "dist/createjs-NEXT.js",
      { pattern: "src/**/*.js", included: false },
      { pattern: "dist/createjs-NEXT.map", included: false },
      // helpers
      "tests/helpers/helpers.js",
      // specs
      "tests/spec/*.js"
    ]
  });
};
