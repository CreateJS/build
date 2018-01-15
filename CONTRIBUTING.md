# Contributing

Since this package acts as a build component for other packages, any changes made will affect how all of those packages compile. The libraries in the suite must all follow the same structure, and any structural changes made in one must be reflected in the others.

### Local Development

Run the following commands to link a local build package to one (or many) of your local CreateJS repositories.

```bash
# clone is repo
git clone https://github.com:createjs/build.git
# install dependencies
# this also symlinks the package to the global node_modules with `npm link`
npm install
# cd to the library that you wish to work from and point to the symlink
npm link @createjs/build
```

NPM scripts run from the library will execute with your local build package.
