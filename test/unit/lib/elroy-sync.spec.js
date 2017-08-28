"use strict";

const os = require("os");
const expect = require("chai").expect;
const Promise = require("bluebird");
const mockery = require("mockery");
const request = require("request-promise");
const errors = require("request-promise/errors");
const EventEmitter = require("events").EventEmitter;

const YamlHandler = require("../../../src/util/yaml-handler");
const EventHandler = require("../../../src/util/event-handler");
const eventHandler = new EventHandler();
/* used to debug events */
eventHandler.on("debug", function(msg) {
  console.log(`Received DEBUG message: ${msg}`);
});
eventHandler.on("info", function(msg) {
  console.log(`Received INFO message: ${msg}`);
});
eventHandler.on("warn", function(msg) {
  console.log(`Received WARN message: ${msg}`);
});
eventHandler.on("fatal", function(msg) {
  console.log(`Received FATAL message: ${msg}`);
});
/* */

describe("ElroySync", () => {
  describe("match clusters", () => {
    before(function(done) {
      mockery.enable({
        warnOnReplace: false,
        warnOnUnregistered: false,
        useCleanCache: true
      });

      mockery.registerMock("request-promise", function() {
        return Promise.resolve({
          count: 3,
          items: [
            { name: "test-fixture", active: true },
            { name: "other-test-fixture", active: true },
            { name: "deactivate-me", active: true }
          ]
        });
      });
      console.log("Registering mock");
      done();
    });

    after(function(done) {
      mockery.disable();
      mockery.deregisterAll();
      done();
    });

    it("should remove non-existent environments", done => {
      return Promise.coroutine(function*() {
        const ElroySync = require("../../../src/lib/elroy-sync");
        const clusterDefs = yield YamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        console.log("cluster def counts: " + clusterDefs.length);
        let updated = yield ElroySync.RemoveDeploymentEnvironments(
          clusterDefs,
          eventHandler,
          { elroyUrl: "http://some-url.com", elroySecret: "xxxxx" }
        );

        expect(updated.length).to.equal(1);
        done();
      })().catch(err => {
        done(err);
      });
    });
  });

  describe("Retry Sync", () => {
    let retryCount = 0;
    eventHandler.on("warn", msg => {
      if (msg.includes("retrying")) {
        retryCount++;
      }
    });
    before(function(done) {
      mockery.enable({
        warnOnReplace: false,
        warnOnUnregistered: false,
        useCleanCache: true
      });
      mockery.registerMock("request-promise", function() {
        return Promise.reject(
          new errors.StatusCodeError(504, {}, {}, { statusCode: 504 })
        );
      });
      console.log("Registering mock");
      done();
    });

    after(function(done) {
      mockery.disable();
      mockery.deregisterAll();
      done();
    });

    it("should retry 3 times", done => {
      return Promise.coroutine(function*() {
        const ElroySync = require("../../../src/lib/elroy-sync");
        const clusterDefs = yield YamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        let updated = yield ElroySync.SaveToElroy(
          clusterDefs[0],
          eventHandler,
          { elroyUrl: "http://some-url.com", elroySecret: "xxxxx" },
          retryCount
        );
        done("Should not have reached here");
      })().catch(err => {
        setTimeout(function() {
          expect(retryCount).to.equal(3);
          done();
        }, 3000);
      });
    });
  });
});
