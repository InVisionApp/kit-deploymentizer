"use strict";

const expect = require("chai").expect;
const exec = require("child_process").exec;

describe("Deploymentizer", function() {
  this.timeout(10000);
  describe("shell script", () => {
    it("should run successfully", done => {
      process.env.SECRET_USERNAME = "myusername";
      process.env.SECRET_PASSWORD = "mypassword";
      process.env.GITHUB_TOKEN = "s@mpler@ndomt0ken";
      process.env.DEBUG = "true";

      var cmd = '/src/deploymentizer --conf="/test/fixture/kit.yaml"';

      exec(cmd, function(error, stdout, stderr) {
        console.log(`stdout: ${stdout}`);
        console.log(`stderr: ${stderr}`);
        if (error !== null) {
          console.log(`exec error: ${error}`);
          done(error);
        } else {
          done();
        }
      });
    });
  });
});
