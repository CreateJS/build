import gulp from "gulp";
import rollup from "rollup-stream";
import babel from "rollup-plugin-babel";
import multiEntry from "rollup-plugin-multi-entry";
import nodeResolve from "rollup-plugin-node-resolve";
import source from "vinyl-source-stream";
import del from "del";
import uglify from "gulp-uglify";
import beautify from "gulp-beautify";
import sourcemaps from "gulp-sourcemaps";
import buffer from "vinyl-buffer";
import browserSync from "browser-sync";
import sass from "gulp-sass";
import karma from "karma";
import yargs from "yargs";
import shell from "gulp-shell";
import fs from "fs";

/*
  TODO: Remaining tasks.
  - Docs
    - YUIDOC
    - SASS
    - Compression to zip
 */

/********************************************************************

  CONSTANTS & UTILITIES

********************************************************************/

// return the string contents of a file
function getFile (path) {
  return fs.readFileSync(path, { encoding: 'utf-8' });
}

const cwd = process.cwd();
const relative = /node_modules/.test(cwd) ? "../../" : "./";
const pkg = JSON.parse(getFile(`${relative}package.json`));
const config = JSON.parse(getFile("./config.json"));
const activeLib = pkg.name.toLowerCase();
const isCombined = activeLib === "createjs";
const paths = {
  // universal
  dist: `${relative}dist/`,
  docs: `${relative}docs/`,
  LICENSE: `./buildAssets/LICENSE`,
  BANNER: `./buildAssets/BANNER`,
  // libs only
  entry: `${relative}src/main.js`,
  serve: relative,
  examples: `${relative}examples/**/*`,
  extras: `${relative}extras/**/*`,
  sourceFiles: `${relative}src/**/*.js`,
  sourcemaps: "",
  testConfig: `${relative}tests/karma.conf.js`,
  docsSASS: "./docsTheme/assets/scss/main.scss",
  docsCSS: "./docsTheme/assets/css/"
};
const browser = browserSync.create();
const buildCaches = {};

config.uglifyMin.preserveComments = function (node, comment) {
  // preserve the injected license header
  if (comment.line === 1) { return true; }
  // strip everything else
  return false;
};
config.uglifyNonMin.preserveComments = function (node, comment) {
  // preserve the injected license header
  if (comment.line === 1) { return true; }
  // strip any file header comments, including licenses.
  return !(/(@namespace|@module|copyright)/gi.test(comment.value));
};

function template (str, replace) {
  for (let key in replace) {
    str = str.replace(new RegExp(`<%= ${key} %>`, "g"), replace[key]);
  }
  return str;
}

function mapFile (filename) {
  return filename.replace(".js", "");
}

function getBuildFile (type, minify) {
  return `${activeLib}${isNext() ? "-NEXT" : ""}${type.length ? `.${type}` : ""}${minify ? ".min" : ""}.js`;
}

function isNext () {
  return yargs.argv.hasOwnProperty("NEXT");
}

/********************************************************************

  BUNDLING

********************************************************************/

function bundle (options, type, minify) {
  const filename = getBuildFile(type, minify);
  // rollup is faster if we pass in the previous bundle on a re-bundle
  options.cache = buildCaches[filename];
  // min files are prepended with LICENSE, non-min with BANNER
  options.banner = template(getFile(paths[minify ? "LICENSE" : "BANNER"]), { name: pkg.name });
  // "createjs" imports by the libs must be internalized
  options.external = function external (id) { return false; };
  if (isCombined) {
    // multi-entry rollup plugin will handle the src/main paths for all libs
    options.entry = ["easel","tween","sound","preload"].map(lib => `${config[`${lib}_path`]}/${paths.entry.replace(relative, "")}`);
  } else {
    options.entry = paths.entry;
  }

  // uglify and beautify do not currently support ES6
  let b = rollup(options)
    .on("bundle", bundle => buildCaches[filename] = bundle) // cache bundle for re-bundles triggered by watch
    .pipe(source(filename))
    .pipe(buffer())
  if (minify) {
    if (type !== "es6") {
      b = b.pipe(uglify(config.uglifyMin));
    }
  } else {
    if (type !== "es6") {
      b = b
      .pipe(uglify(config.uglifyNonMin))
      .pipe(beautify(config.beautify));
    }
    b = b
    .pipe(sourcemaps.init({ loadMaps: true }))
    .pipe(sourcemaps.write(paths.sourcemaps, { mapFile }));
  }
  return b.pipe(gulp.dest(paths.dist));
}

gulp.task("bundle:es6", function (done) {
  let options = {
    format: "es",
    plugins: [ multiEntry(), nodeResolve() ]
  };
  bundle(options, "es6", false);
  done();
});

gulp.task("bundle:cjs", function (done) {
  let options = {
    format: "cjs",
    plugins: [ babel(), multiEntry(), nodeResolve() ]
  };
  bundle(options, "cjs", false);
  bundle(options, "cjs", true);
  done();
});

gulp.task("bundle:global", function (done) {
  let options = {
    format: "iife",
    moduleName: "createjs",
    plugins: [ babel(), multiEntry(), nodeResolve() ]
  };
  bundle(options, "", false);
  bundle(options, "", true);
  done();
});


/********************************************************************

  DOCS

********************************************************************/

gulp.task("clean:docs", function () {
  return del([ `${paths.docs}**` ], { force: true });
});

gulp.task("sass:docs", function () {
  return gulp.src(paths.docsSASS)
    .pipe(sass({ outputStyle: "compressed" }).on("error", sass.logError))
    .pipe(gulp.dest(paths.docsCSS));
});

gulp.task("yuidoc", shell.task(`cd ${relative} && yuidoc ./node_modules/createjs/src ./src`));

gulp.task("docs", gulp.series("clean:docs", "sass:docs", "yuidoc"));

/********************************************************************

  BUILD

********************************************************************/

gulp.task("clean:dist", function () {
  return del([ `${paths.dist}*(${isNext() ? "" : "!"}NEXT)*.(js|map)` ], { force: true });
});

gulp.task("build", gulp.series(
  "clean:dist",
  gulp.parallel(
    "bundle:cjs",
    "bundle:global",
    "bundle:es6"
  )
));

/********************************************************************

  DEV

********************************************************************/

gulp.task("serve", function () {
  browser.init({ server: { baseDir: paths.serve } });
});

gulp.task("reload", function (done) {
  browser.reload();
  done();
});

gulp.task("watch:dev", function () {
  gulp.watch(paths.sourceFiles, gulp.series("bundle:global", "reload"));
  gulp.watch([ paths.examples, paths.extras ], gulp.series("reload"));
});

gulp.task("dev", gulp.series(
  "clean:dist",
  "bundle:global",
  gulp.parallel(
    "serve",
    "watch:dev"
  )
));

/********************************************************************

  TESTS

********************************************************************/

gulp.task("karma", function (done) {
  let browser = yargs.argv.browser;
  let headless = browser === "PhantomJS";
  // wrap done to fix occasional bug that occurs when trying to close the server.
  let end = function () { done(); };
  let server = new karma.Server({
    configFile: paths.testConfig,
    browsers: [ browser ],
    reporters: [ headless ? "mocha" : "kjhtml" ]
  }, end);
  server.start();
});

gulp.task("watch:test", function () {
  gulp.watch(paths.sourceFiles, gulp.series("bundle:global"));
});

gulp.task("test", gulp.series(
  "clean:dist",
  "bundle:global",
  gulp.parallel(
    "karma",
    "watch:test"
  )
));
