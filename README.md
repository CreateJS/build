# THIS BRANCH IS CURRENTLY UNDER HEAVY DEVELOPMENT

## We use Gulp (http://gulpjs.com/) to manage our build process.

### To use

#### Install dependencies

Node (>=4.2.2):

```
node -v
```

If your node is out of date, install the latest from:
http://nodejs.org/

After node is setup, install the other dependencies:

```
# Install Gulp-Cli
npm install gulp-cli -g

# Install all the dependencies for this project.
npm install

# Make sure you have the latest of all the CreateJS libraries.
```

#### Setup

You'll need to change the default settings to suit your work environment.
We have 2 config files:

* `config.json` - Is meant to be in git and pushed to all developers.
* `config.local.json` - Is added to `.gitignore` and only for your local setup (any settings in here will override those in `config.json`)

Please adjust these settings to match your environment. All paths can either be relative from this folder, or absolute paths.

* `site_path`
* `easel_path`
* `preload_path`
* `sound_path`
* `tween_path`

#### Developing in Tandem with a library
All of the CreateJS libs have this repository as a dependency. In order to edit this repository and have the changes reflect immediately in your
local lib repository, you must link the repositories.

```
# From this repository, run:
npm link .

# From the lib, run:
npm link createjs
```

This will create a symlink in the `node_modules` for the `createjs` dependency.

#### Building
To export a release build for this library run:

```
npm run build
```

This command will bundle all libs together.

To build the NEXT version run:

```
npm run build:next
```

Does the exact same process as above but uses NEXT as the version.
Non-minified NEXT builds have sourcemaps.

#### Main commands
* `npm run build` - Builds all the projects and creates combined / minified files
* `npm run build:next` - Same as build, but uses the NEXT version.
* `npm run cdn` - Builds a new CDN index page and copies all required script files to build.
* `npm run copy:builds` - Copies the NEXT build (global module) from each lib into the asset dirs of the others.
* `npm run copy:demos` - Copies each lib's examples over to the site's demos dir.
