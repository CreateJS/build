import gulp from "gulp";
import uglify from "gulp-uglify";
import beautify from "gulp-beautify";
import sourcemaps from "gulp-sourcemaps";
import sass from "gulp-sass";
import replace from "gulp-replace";
import gutil from "gulp-util";

import rollup from "rollup-stream";
import babel from "rollup-plugin-babel";
import multiEntry from "rollup-plugin-multi-entry";
import nodeResolve from "rollup-plugin-node-resolve";

import source from "vinyl-source-stream";
import buffer from "vinyl-buffer";

import merge from "merge-stream";
import defaults from "lodash.defaults";
import del from "del";
import browserSync from "browser-sync";
import karma from "karma";
import yargs from "yargs";
import shell from "gulp-shell";
import fs from "fs";

/*
  TODO: Remaining tasks.
  - Docs
    - Compression to zip
  - CDN
    - Compile HTML Template
    - SASS (sourceMap: false, outputStyle: compressed)
    - copy all necessary dist files over to the CDN
    - compression of build to zip
  - Copy
    - When a lib is built, copy its global module into the _assets/libs of the other lib as a next.
    - also copy it to the demos folders on the site
    - copy lib/examples to site/demos/lib
 */

/********************************************************************

  CONSTANTS & UTILITIES

********************************************************************/

function log (color, ...text) {
  gutil.log(gutil.colors[color](...text));
}

// return the string contents of a file, or undefined if there was an error reading the file
function getFile (path) {
  try {
    return fs.readFileSync(path, { encoding: "utf-8" });
  } catch (error) {
    log('yellow', `File '${path}' was not found. Returning 'undefined'.`);
    return undefined;
  }
}

// return JSON read from a file
function readJSON (path) {
  let file = getFile(path);
  return file ? JSON.parse(file) : {};
}

// cwd will always be the createjs dir
const cwd = process.cwd();
// figure out of we're calling from a lib or directly
const relative = /node_modules/.test(cwd) ? "../../" : "./";
// get the relative package and the universal config (overwritten by the local config)
const pkg = JSON.parse(getFile(`${relative}package.json`));
const config = defaults(readJSON("./config.local.json"), readJSON("./config.json"));
const libs = ["easel","tween","sound","preload"];
// quickrefs
const activeLib = pkg.name;
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
  sourcemaps: ".",
  testConfig: `${cwd}/${relative}tests/karma.conf.js`,
  docs_sass: "./docsTheme/assets/scss/main.scss",
  docs_css: "./docsTheme/assets/css/"
};
const browser = browserSync.create();
// stores bundle caches for rebundling with rollup
const buildCaches = {};

// overwrite the preserveComments strings in the config with functions
config.uglifyMin.preserveComments = function (node, comment) {
  // preserve the injected license header
  if (comment.line === 1) { return true; }
  // strip everything else
  return false;
};
config.uglifyNonMin.preserveComments = function (node, comment) {
  // preserve the injected license header
  if (comment.line === 1) { return true; }
  // strip individual file license headers or any comment containing an @uglify tag.
  return !(/(@uglify|@license|copyright)/i.test(comment.value));
};

// replace .js with .map for sourcemaps
function mapFile (filename) {
  return filename.replace(".js", "");
}

// returns a string of format activeLib(-NEXT)(.type)(.min).js
// global modules have no type
function getBuildFile (type, minify) {
  return `${activeLib}${isNext() ? "-NEXT" : ""}${type.length ? `.${type}` : ""}${minify ? ".min" : ""}.js`;
}

// quickref for NEXT builds. Has to be function since a property will be stored prior to a run.
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
  options.banner = gutil.template(getFile(paths[minify ? "LICENSE" : "BANNER"]), { name: pkg.name, file: "" });
  // "createjs" imports by the libs must be internalized
  options.external = function external (id) { return false; };
  if (isCombined) {
    // multi-entry rollup plugin will handle the src/main paths for all libs
    options.entry = libs.map(lib => {
      let path = `${config[`${lib}_path`]}/${paths.entry.replace(relative, "")}`;
      try { fs.accessSync(path); }
      catch (error) { log('yellow', `Local ${lib[0].toUpperCase() + lib.slice(1)}JS not found, it will not be in the bundle. Please verify your config.local.json path.`); }
      return path;
    });
  } else {
    options.entry = paths.entry;
  }

  // uglify and beautify do not currently support ES6 (at least in a stable manner)
  const isES6 = type === "es6";

  let b = rollup(options)
    .on("bundle", bundle => buildCaches[filename] = bundle) // cache bundle for re-bundles triggered by watch
    .pipe(source(filename))
    .pipe(buffer())
    .pipe(replace(/<%=\sversion\s%>/g, pkg.version)); // inject the build version into the bundle
  if (minify) {
    if (!isES6) {
      b = b.pipe(uglify(config.uglifyMin));
    }
  } else {
    if (!isES6) {
      b = b
      .pipe(uglify(config.uglifyNonMin))
      .pipe(beautify(config.beautify));
    }
    // only non-min builds get sourcemaps
    b = b
    .pipe(sourcemaps.init({ loadMaps: true }))
    // remove the args from sourcemaps.write() to make it an inlined map.
    .pipe(sourcemaps.write(paths.sourcemaps, { mapFile }));
  }
  return b.pipe(gulp.dest(paths.dist));
}

// multi-entry reads main.js from each lib for a combined bundle.
// node-resolve grabs the shared createjs files and compiles/bundles them with the rest of the lib
gulp.task("bundle:es6", function () {
  let options = {
    format: "es",
    plugins: [ multiEntry(), nodeResolve() ]
  };
  return bundle(options, "es6", false);
});

gulp.task("bundle:cjs", function () {
  let options = {
    format: "cjs",
    plugins: [ babel(), multiEntry(), nodeResolve() ]
  };
  return merge(
    bundle(options, "cjs", false),
    bundle(options, "cjs", true)
  );
});

gulp.task("bundle:global", function () {
  let options = {
    format: "iife",
    moduleName: "createjs",
    plugins: [ babel(), multiEntry(), nodeResolve() ]
  };
  return merge(
    bundle(options, "", false),
    bundle(options, "", true)
  );
});


/********************************************************************

  DOCS

********************************************************************/

// force is required to bypass the security warnings about modifying dirs outside the cwd
gulp.task("clean:docs", function () {
  return del([ `${paths.docs}**` ], { force: true });
});

gulp.task("sass:docs", function () {
  return gulp.src(paths.docs_sass)
    .pipe(sass({ outputStyle: "compressed" }).on("error", sass.logError))
    .pipe(gulp.dest(paths.docs_css));
});

// there's no good and/or recent gulp wrapper for yuidoc available, so we'll execute a shell task
// each lib has a yuidoc.json in its root
gulp.task("yuidoc", shell.task(`cd ${relative} && yuidoc ./node_modules/createjs/src ./src`));

gulp.task("docs", gulp.series("clean:docs", "sass:docs", "yuidoc"));

/********************************************************************

  BUILD

********************************************************************/

// only clean the NEXT builds. Main builds are stored until manually deleted.
gulp.task("clean:dist", function (done) {
  if (isNext()) {
    return del([ `${paths.dist}*NEXT*.{js,map}` ], { force: true });
  }
  done();
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

// serve the lib root for easy examples/extras access
gulp.task("serve", function () {
  browser.init({ server: { baseDir: paths.serve } });
});

gulp.task("reload", function (done) {
  browser.reload();
  done();
});

// only rebundle the global module during dev since that's what the examples use
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
  let travis = browser === "Chrome_Travis";
  let reporters = [ "mocha" ];
  if (!headless && !travis) { reporters.push("kjhtml"); }
  // wrap done() to fix occasional bug that occurs when trying to close the server.
  let end = function () { done(); };
  let server = new karma.Server({
    configFile: paths.testConfig,
    browsers: [ browser ],
    singleRun: travis,
    reporters
  }, end);
  server.start();
});

// only rebundle global since that's what the tests load
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

/********************************************************************

  DEV LINK

********************************************************************/

// link the Combined repository to all of the repos or just the one passed
// this must be run from gulp and not npm, as args passed to npm run are not visible to the subsequent gulp task.
gulp.task("link", shell.task(
  (function () {
    let linked = true;
    try { fs.accessSync(process.execPath.replace("node.exe", "node_modules/createjs")); }
    catch (err) { linked = false; }
    return (linked ? [] : [ "npm link ." ]).concat(
      yargs.argv.hasOwnProperty('all')
        ? libs.map(lib => `cd ${config[`${lib}_path`]} && npm link createjs`)
        : [ `cd ${config[`${(yargs.argv.lib || "").replace("js", "").toLowerCase()}_path`]} && npm link createjs` ]
    );
  })()
));
