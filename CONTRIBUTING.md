# Contributing

Since this package acts as a build component for other packages, any changes made will affect how all of those packages compile. The libraries in the suite must follow the same structure, and any structural changes made in one must be reflected in the others.

### Pull Requests

Our continuous integration processes will lint and test all pull requests. To save time, please lint and test your changes locally, prior to committing. Instructions for how to do this can be found in the README.

Please reference any issues that your PR addresses.

### Local Development

Run the following commands to link a local build package to one (or many) of your local CreateJS repositories.

```
# clone repo
git clone https://github.com:createjs/build.git
cd path/to/build
# install dependencies and create an npm symlink
npm install
npm link .
# cd to the library that you wish to work from and point to the symlink
cd path/to/easeljs
npm link @createjs/build
```

NPM scripts run from the library will execute with your local build package.
