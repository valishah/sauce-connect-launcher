"use strict";

const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const rimraf = require("rimraf");
const childProcess = require("child_process");


const sauceConnectLauncher = require("../lib/sauce-connect-launcher")
const utils = require("../lib/utils");

let sauceCreds = {};
const verbose = process.env.VERBOSE_TESTS || false;
try{
  sauceCreds = process.env.SAUCE_ACCESS_KEY ? {} : require("../user.json");
  sauceCreds.verbose = verbose;
  sauceCreds.log = [];
  sauceCreds.logfile = __dirname + "/../sauce_connect.log";
  sauceCreds.logger = function (message) {
    if (verbose) {
      console.log("[info] ", message);
    }
    sauceCreds.log.push(message);
  };
  sauceCreds.connectRetries = 3;
  sauceCreds.downloadRetries = 2;

  process.env.SAUCE_API_HOST = "eu-central-1.saucelabs.com";
  process.env.SAUCE_ACCESS_KEY = sauceCreds.accessKey;
  process.env.SAUCE_USERNAME = sauceCreds.username;
}catch(err){
  require("colors");
  console.log("Please run make setup-sauce to set up real Sauce Labs Credentials".red);
}

describe("Sauce Connect Launcher", () => {
  
  beforeEach( (done) =>{
    jest.setTimeout(3600 * 10000);
    rimraf(path.normalize(__dirname + "/../sc/"), done);
  });
  afterEach( (done) => {
    jest.setTimeout(5000);
    sauceConnectLauncher.kill(done);
  });

  it("fails with an invalid executable", (done) => {
    var options = _.clone(sauceCreds);
    options.exe = "not-found";
    options.connectRetries = 0;
    
    sauceConnectLauncher(options, (err) => {
      expect(err).toBeTruthy();
      expect(err.message).toEqual(expect.stringContaining("ENOENT"));
      done();
    });
  });

  it("does not trigger a download when providing a custom executable", (done) => {
    var options = _.clone(sauceCreds);
    options.exe = "not-found";
    options.connectRetries = 0;

    sauceConnectLauncher(options, () => {
      expect(fs.existsSync(path.join(__dirname, "../sc/versions.json"))).toBeFalsy();
      done();
    });
  });

  it("should download Sauce Connect", (done) => {
    // We need to allow enough time for downloading Sauce Connect
    var log = [];
    var options = _.clone(sauceCreds);
    options.logger = (message) => {
      if (verbose) {
        console.log("[info] ", message);
      }
      log.push(message);
    };

    sauceConnectLauncher.download(options, (err) => {
      expect(err).toBeFalsy();

        // Expected command sequence
      var expectedSequence = [
        "Missing Sauce Connect local proxy, downloading dependency",
        "This will only happen once.",
        "Downloading ",
        "Archive checksum verified.",
        "Unzipping ",
        "Removing ",
        "Sauce Connect downloaded correctly",
      ];

      _.each(log, (message, i) => {
        expect(message).toMatch(new RegExp("^" + (expectedSequence[i] || "\\*missing\\*")));
      });
      done();
    });
  });

  it("handles errors when Sauce Connect download fails", (done) => {
    var log = [];
    var options = _.clone(sauceCreds);
    options.logger = (message) =>  {
      if (verbose) {
        console.log("[info] ", message);
      }
      log.push(message);
    };
    options.connectVersion = "9.9.9";
    options.downloadRetries = 1;

    sauceConnectLauncher.download(options, (err) => {
      expect(err).toBeTruthy();
      expect(err.message).toEqual(expect.stringContaining("Download failed with status code"));

        // Expected command sequence
      var expectedSequence = [
        "Missing Sauce Connect local proxy, downloading dependency",
        "This will only happen once.",
        "Invalid response status: 404",
        "Missing Sauce Connect local proxy, downloading dependency",
        "This will only happen once."
      ];

      _.each(log,  (message, i) => {
        expect(message).toMatch(new RegExp("^" + (expectedSequence[i] || "\\*missing\\*")));
      });

      done();
    });
  });

    
  it("should work with real credentials", (done) => {
    sauceConnectLauncher(sauceCreds, (err, sauceConnectProcess) => {
      expect(err).toBeFalsy();
      expect(sauceConnectProcess).toBeTruthy();
      sauceConnectLauncher.kill();
      expect(sauceCreds.log).toEqual(expect.arrayContaining(["Testing tunnel ready"]));
      sauceConnectProcess.on("exit", () =>{
        done();
      });
    });
  });

  it("should execute a provided close callback",  (done) => {
    sauceConnectLauncher(sauceCreds, (err, sauceConnectProcess) => {
      expect(err).toBeFalsy();
      expect(sauceConnectProcess).toBeTruthy();
      sauceConnectProcess.close(() => {
        done();
      });
    });
  });

  it("extracts the tunnelId from sc output",  (done) => {
    sauceConnectLauncher(sauceCreds,  (err, sauceConnectProcess) => {
      expect(err).toBeFalsy();
      expect(sauceConnectProcess).toBeTruthy();
      expect(sauceConnectProcess.tunnelId).toBeTruthy();
    
      utils.getTunnels( (err, res, body) => {
        expect(err).toBeFalsy();
        expect(res.statusCode).toEqual(200);
        expect(body).toEqual(expect.arrayContaining([sauceConnectProcess.tunnelId]));
        sauceConnectProcess.close(done);
      });
    });
  });

  it("closes the open tunnel",  (done) => {
     
    sauceConnectLauncher(sauceCreds,  (err, sauceConnectProcess) => {
      expect(err).toBeFalsy();
      expect(sauceConnectProcess).toBeTruthy();
      expect(sauceConnectProcess.tunnelId).toBeTruthy();

      utils.getTunnel(sauceConnectProcess.tunnelId,  (err, res, body) => {
        expect(err).toBeFalsy();
        expect(res.statusCode).toBe(200);
        expect(body.status).toBe("running");
            
        sauceConnectProcess.close( () => {
            // setTimeout(function () { // Wait for tunnel to be terminated
          utils.getTunnel(sauceConnectProcess.tunnelId,  (err, res, body) => {
            expect(err).toBeFalsy();
            expect(res.statusCode).toBe(200);
            expect(body.status).toBe("terminated");
            done();
          });
            // }, 5000);
        });
      });
    });
  });

  it.skip("allows to spawn sc detached",  (done) => {
    if (process.platform === "win32") { // detached mode not supported on windows yet
      return this.skip();
    }
        
    var pidfile = path.join(__dirname, "../sc_client.pid");
    var options = _.clone(sauceCreds);
    options.detached = true;
    options.pidfile = pidfile;
      // FIXME: Versions > 4.3.16 don't work in detached mode.
    options.connectVersion = "4.3.16";
    delete options.logger;
        
    var args = [ path.join(__dirname, "./fixture/spawn-sc.js"), JSON.stringify(options) ];
    var sc = childProcess.spawn("node", args, { stdio: "inherit" });
    sc.on("error",  (err) =>  {
      expect(err).toBeFalsy();
    });
        
    sc.on("exit",  (code)=> {
      expect(code).toBe(0);
        
      fs.readFile(pidfile,(err, content) => {
        expect(err).toBeFalsy();
        var pid = parseInt(content, 10);
        
        // Check, whether sc is still running
        expect( () => {
          process.kill(pid, 0);
        }).to.not.throwException();
        
        // Gracefully terminate it
        process.kill(pid, "SIGTERM");
        
          // Poll until the process is gone and verify that it has cleaned up
        var probeInterval = setInterval( ()=> {
          try {
            process.kill(pid, 0);
          } catch (err) {
            clearTimeout(probeInterval);
        
            expect(err).toBeTruthy();
            expect(err.code).toEqual("ESRCH");
        
            fs.readFile(pidfile,  (err) => {
              expect(err).toBeTruthy();
              expect(err.code).toEqual("ENOENT");
              done();
            });
          }
        }, 1000);
      });
    });
  });


  describe("handles misconfigured proxies and other request failures", () => {
    let options, http_proxy_original;

    beforeEach(() => {
      options = _.clone(sauceCreds);
      options.downloadRetries = 0;

      http_proxy_original = process.env.http_proxy;
      process.env.http_proxy = "http://127.0.0.1:12345/";
    });
    afterEach(() => {
      process.env.http_proxy = http_proxy_original;
    });

    it("when fetching versions.json", (done) => {
      sauceConnectLauncher.download(options, (err) => {
        expect(err).toBeTruthy();
        expect(err.message).toEqual(expect.stringContaining("ECONNREFUSED"));
        done();
      });
    });

    it("with fixed version when fetching archive", (done) => {
      options.connectVersion = "9.9.9";
      sauceConnectLauncher.download(options, (err) => {
        expect(err).toBeTruthy();
        expect(err.message).toEqual(expect.stringContaining("ECONNREFUSED"));
        done();
      });
    });
  });

  
  
});



