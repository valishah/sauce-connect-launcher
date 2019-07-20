"use strict";

var sauceConnectLauncher = require("../../index");
var options = JSON.parse(process.argv[2]);
options.logger = console.log;

sauceConnectLauncher(options, function (err)  {
  if (err) {
    console.log(err);
    throw err;
  }
  process.exit(0);
});
