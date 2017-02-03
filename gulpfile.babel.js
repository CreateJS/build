import gulp from "gulp";
import uglify from "gulp-uglify";
import beautify from "gulp-beautify";
import sourcemaps from "gulp-sourcemaps";
import sass from "gulp-sass";
import cleanCSS from "gulp-clean-css";
import inlineCSS from "gulp-inline-source";
import replace from "gulp-replace";
import eslint from "gulp-eslint";
import gutil from "gulp-util";
import shell from "gulp-shell";
import zip from "gulp-zip";
import rename from "gulp-rename";

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
import fs from "fs";

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
const libs = [ "easel", "tween", "sound", "preload" ];
// quickrefs
const activeLib = pkg.name;
const version = pkg.version;
const isCombined = activeLib === "createjs";
const paths = {
  // universal
  dist: `${relative}dist/`,
  docs: `${relative}docs/`,
  cdn: `${relative}cdn/`,
  LICENSE: `./buildAssets/LICENSE`,
  BANNER: `./buildAssets/BANNER`,
  // libs only
  entry: `${relative}src/main.js`,
  plugins: `${relative}src/plugins/*.js`,
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

// return the lib path from the config
function getLibPath (lib) {
  return config[`${lib}_path`];
}

// returns a string of format activeLib-{version}(.type)(.min).js
// global modules have no type
function getBuildFile (type, minify) {
  return `${activeLib}-${isNext() ? "NEXT" : version}${type.length? `.${type}` : ""}${minify ? ".min" : ""}.js`;
}

// quickref for NEXT builds. Has to be function since a property will be stored prior to a run.
function isNext () {
  return yargs.argv.hasOwnProperty("NEXT");
}

// makes "easel" or "easeljs" look like "EaselJS"
function formatLib (lib) {
  return lib[0].toUpperCase() + lib.substring(1, /js$/.test(lib) ? lib.length - 2 : undefined) + "JS";
}

/********************************************************************

  BUNDLING

********************************************************************/

function bundle (options, type, minify) {
  const filename = getBuildFile(type, minify);
  // rollup is faster if we pass in the previous bundle on a re-bundle
  options.cache = buildCaches[filename];
  // min files are prepended with LICENSE, non-min with BANNER
  options.banner = gutil.template(getFile(paths[minify ? "LICENSE" : "BANNER"]), { name: formatLib(activeLib), file: "" });
  if (isCombined) {
    // combined bundles import all dependencies
    options.external = function () { return false; }
  } else {
    // cross-library dependencies must remain externalized for individual bundles
    let g = options.globals = {};
    g.tweenjs = g.easeljs = g.preloadjs = g.soundjs = 'createjs';

    const externalDependencyRegex = new RegExp(`^(${libs.join('|')})js$`);
    options.external = function external (id) {
      let match = id.match(externalDependencyRegex);
      if (match !== null) {
        log('green', `Externalizing cross-library dependency for ${formatLib(match[1])}`);
        return true;
      }
      return false;
    };
  }
  if (isCombined) {
    // multi-entry rollup plugin will handle the src/main paths for all libs
    options.entry = libs.map(lib => {
      let path = `${getLibPath(lib)}/${paths.entry.replace(relative, "")}`;
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
    .pipe(replace(/<%=\sversion\s%>/g, version)); // inject the build version into the bundle
  if (minify) {
    if (!isES6) {
      b = b.pipe(uglify(config.uglifyMin));
    }
  } else {
    if (!isES6) {
      b = b.pipe(uglify(config.uglifyNonMin))
        .pipe(beautify(config.beautify));
    }
    // only non-min builds get sourcemaps
    // remove the args from sourcemaps.write() to make it an inlined map.
    b = b.pipe(sourcemaps.init({ loadMaps: true }))
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
    plugins: [ babel(config.babel), multiEntry(), nodeResolve() ]
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
    plugins: [ babel(config.babel), multiEntry(), nodeResolve() ]
  };
  return merge(
    bundle(options, "", false),
    bundle(options, "", true)
  );
});

/********************************************************************

  PLUGINS

********************************************************************/

function plugin (options) {
  let isIIFE = options.format === "iife";
  let filename = `${options.entry.match(/(\w+)\.js$/)[1]}.${isIIFE ? "js" : "cjs.js"}`;
  options.banner = gutil.template(getFile(paths.LICENSE), { name: filename.substring(0, filename.length - (isIIFE ? 3 : 7)), file: "" });
  return rollup(options)
    .pipe(source(filename))
    .pipe(buffer())
    //.pipe(uglify(config.uglifyMin))
    .pipe(gulp.dest(`${paths.dist}plugins/`));
}

// only clean the NEXT builds. Main builds are stored until manually deleted.
gulp.task("plugins", function (done) {
  let stub = paths.plugins.substring(0, paths.plugins.length - 4);
  try { fs.accessSync(path); }
  catch (error) { log('yellow', `No plugins found for ${formatLib(activeLib)}.`); done(); return; }
  let plugins = fs.readdirSync(stub);
  let iife = plugins.map(entry => plugin({
    entry: stub + entry,
    format: "iife",
    moduleName: "createjs",
    plugins: [ babel(config.babel) ]
  }));

  let cjs = plugins.map(entry => plugin({
    entry: stub + entry,
    format: "cjs",
    plugins: [ babel(config.babel) ]
  }));

  return merge(...iife, ...cjs);
});

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

gulp.task("copy:build", function (done) {
  done();
  /*
    TODO: Copy builds around the libs.
      - When a lib is built, copy its global module into the _assets/libs of the other lib as a next.
      - also copy it to the demos folders on the site
      - copy lib/examples to site/demos/lib
   */
});

gulp.task("build", gulp.series(
  "clean:dist",
  gulp.parallel(
    "bundle:cjs",
    "bundle:global",
    "bundle:es6",
    "plugins"
  ),
  "copy:build"
));

/********************************************************************

  DOCS

********************************************************************/

// TODO: Library specific styles (currently hardcoded to Easel)
// TODO: Versioned doc builds.

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

// zip everything in the docs folder (except any existing archives) and write to the folder
gulp.task("zip:docs", function () {
  let path = paths.docs;
  return gulp.src(`${path}**/!(*.zip)`)
    .pipe(zip(`docs_${activeLib}-${isNext() ? "NEXT" : version}.zip`))
    .pipe(gulp.dest(path));
});

gulp.task("docs", gulp.series("clean:docs", "sass:docs", "yuidoc", "zip:docs"));

/********************************************************************

  CDN

********************************************************************/

// force is required to bypass the security warnings about modifying dirs outside the cwd
gulp.task("clean:cdn", function () {
  return del([ `${paths.cdn}build/*` ], { force: true });
});

gulp.task("sass:cdn", function () {
  let cdn = paths.cdn;
  return gulp.src(`${cdn}styles/styles.scss`)
    .pipe(sass({ outputStyle: "compressed" }).on("error", sass.logError))
    .pipe(cleanCSS({ keepSpecialComments: 0 }))
    .pipe(gulp.dest(`${cdn}build`));
});

gulp.task("render:cdn", function () {
  let cdn = paths.cdn;
  return gulp.src(`${cdn}index.template.html`)
    .pipe(inlineCSS())
    .pipe(rename("index.html"))
    .pipe(gulp.dest(`${cdn}build`));
});

// get the latest stable builds and copy them to cdn/build
gulp.task("copy:cdn", function () {
  let cdn = paths.cdn;

  let builds = gulp.src([ ...(libs.map(lib => `${getLibPath(lib)}/dist/*${version}*`)), `dist/*${version}*` ])
    .pipe(gulp.dest(`${cdn}build/builds/`));
  let favicons = gulp.src(`${cdn}favicons/*`, { base: cdn })
    .pipe(gulp.dest(`${cdn}build/`));

  return merge(builds, favicons);
});

gulp.task("zip:cdn", function () {
  let path = `${paths.cdn}build/`;
  return gulp.src(`${path}**/!(*.css|*.zip)`)
    .pipe(zip(`cdn_createjs-${version}.zip`))
    .pipe(gulp.dest(path));
});

gulp.task("cdn", gulp.series("clean:cdn", "sass:cdn", "render:cdn", "copy:cdn", "zip:cdn"));

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
  gulp.watch(paths.plugins, gulp.series("plugins", "reload"));
  gulp.watch([ paths.examples, paths.extras ], gulp.series("reload"));
});

gulp.task("dev", gulp.series(
  "clean:dist",
  gulp.parallel(
    "bundle:global",
    "plugins"
  ),
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
  gulp.watch(paths.plugins, gulp.series("plugins"));
});

gulp.task("test", gulp.series(
  "clean:dist",
  gulp.parallel(
    "bundle:global",
    "plugins"
  ),
  gulp.parallel(
    "karma",
    "watch:test"
  )
));

/********************************************************************

  LINT

********************************************************************/

gulp.task("lint", function () {
  // fail after error to break the travis build.
  return gulp.src(paths.sourceFiles)
    .pipe(eslint())
    .pipe(eslint.format("codeframe"));
});

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
        ? libs.map(lib => `cd ${getLibPath(lib)} && npm link createjs`)
        : [ `cd ${getLibPath((yargs.argv.lib || "").replace("js", "").toLowerCase())} && npm link createjs` ]
    );
  })()
));
