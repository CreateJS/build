# @createjs/build

This package serves as the master build process for transpiling and bundling the CreateJS source code for distribution. It is installed as a dependency to each library and as such is designed to run from within the `node_modules` directory.

Individual library builds are run from the respective library packages. Combined builds are meant for CDN distribution and are run from the [CDN package](https://github.com/createjs/cdn).

## Installation

From the library package, install:
###### `npm install @createjs/build`

## Usage

Tasks within this package are run via npm scripts in the library packages. Here is a summary of tasks that this package can run:

###### `npm run build -- [--production] [--combined] [--format=global,module,common]`

- transpile and bundle ES2015+ source to ES5 via Rollup & Babel
- use `production` flag for minified builds
- use `combined` flag from CDN package for combined builds
- use `format` flag to specify which bundle formats to export, defaults to all

###### `npm run plugins -- [--production] [--format=global,common] [--files=FileName]`

- transpile ES2015+ plugin source to ES5 via Rollup & Babel
- use `production` flag for minified output
- use `format` flag to specify which bundle formats to export, 'module' is disabled
- use `files` flag to only transpile specific files (sans file extension)

###### `npm run dev`

- transpile and bundle ES2015+ source to ES5 via Rollup & Babel
- non-minified, includes sourcemaps
- only bundles 'global' module as that is what is imported by examples
- starts a browser-sync instance for testing examples and tutorials
- watches source files for changes, re-compiling and reloading browser

###### `npm run lint`

- lint source code with ESLint
- uses the same config as the CI on GitHub, for local checks before committing

###### `npm run test`

- each library extends the master Jest config and setup file found in `tests/`
