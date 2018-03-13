"use strict";

const os = require("os");
const Promise = require("bluebird");
const mockery = require("mockery");
const request = require("request-promise");
const errors = require("request-promise/errors");
const EventEmitter = require("events").EventEmitter;
const nock = require("nock");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
chai.should();

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
  const ElroySync = require("../../../src/lib/elroy-sync");

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

    it("should remove non-existent environments", () => {
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(cldefs => {
        ElroySync.RemoveDeploymentEnvironments(cldefs, eventHandler, {
          elroyUrl: "http://some-url.com",
          elroySecret: "xxxxx"
        }).should.be.fulfilled.then(res => {
          return Promise.resolve(res[0].count).should.eventually.equal(3);
        });
      });
    });

    it("should sync environments", () => {
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(cldefs => {
        ElroySync.SaveToElroy(
          cldefs[0],
          eventHandler,
          { elroyUrl: "http://some-url.com", elroySecret: "xxxxx" },
          0
        ).should.be.fulfilled.then(res => {
          return Promise.resolve(res[0].count).should.eventually.equal(3);
        });
      });
    });
  });

  describe("Get Cluster", () => {
    it("should retrieve cluster", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(200, { name: "test" });

      return ElroySync.retrieveCluster({ name: "test" }, eventHandler, {
        elroyUrl: "http://elroy_svc",
        elroySecret: "xxxxx"
      }).should.be.fulfilled.then(res => {
        return Promise.resolve(res.name).should.eventually.equal("test");
      });
    });

    it("should reject when not found cluster", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(404, "not found");

      return ElroySync.retrieveCluster({ name: "test" }, eventHandler, {
        elroyUrl: "http://elroy_svc",
        elroySecret: "xxxxx"
      }).should.be.rejectedWith(404);
    });
  });

  describe("Sync create/update Cluster", () => {
    it("should update cluster", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(200, { name: "test", metadata: { active: true } });

      nock("http://elroy_svc")
        .put("/api/v1/deployment-environment/test")
        .reply(204);

      return ElroySync.SaveToElroy(
        {
          cluster: { metadata: { name: "test", actve: true } },
          resources: () => {}
        },
        eventHandler,
        {
          elroyUrl: "http://elroy_svc",
          elroySecret: "xxxxx"
        },
        0
      ).should.be.fulfilled;
    });

    it("should create cluster", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(404, { name: "test", metadata: { active: true } });

      nock("http://elroy_svc")
        .post("/api/v1/deployment-environment")
        .reply(204);

      return ElroySync.SaveToElroy(
        {
          cluster: { metadata: { name: "test", actve: true } },
          resources: () => {}
        },
        eventHandler,
        {
          elroyUrl: "http://elroy_svc",
          elroySecret: "xxxxx"
        },
        0
      ).should.be.fulfilled;
    });

    it("should err cluster on creating tier ", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(404, "not found cluster");

      nock("http://elroy_svc")
        .post("/api/v1/deployment-environment")
        .reply(404, "not found tier");

      return ElroySync.SaveToElroy(
        {
          cluster: { metadata: { name: "test", actve: true } },
          resources: () => {}
        },
        eventHandler,
        {
          elroyUrl: "http://elroy_svc",
          elroySecret: "xxxxx"
        },
        0
      ).should.be.rejectedWith("not found tier");
    });

    it("should err cluster on updating tier ", () => {
      nock("http://elroy_svc")
        .get("/api/v1/deployment-environment/test")
        .reply(200, { name: "test", metadata: { active: true } });

      nock("http://elroy_svc")
        .put("/api/v1/deployment-environment/test")
        .reply(404, {
          message: "not found tier",
          response: { statusCode: 404 }
        });

      return ElroySync.SaveToElroy(
        {
          cluster: { metadata: { name: "test", actve: true } },
          resources: () => {}
        },
        eventHandler,
        {
          elroyUrl: "http://elroy_svc",
          elroySecret: "xxxxx"
        },
        0
      ).should.be.rejectedWith("not found tier");
    });

    it("should retry 4 times when error >= 502 ", () => {
      let retries = 0;
      let elroyMock = ElroySync;
      elroyMock.retrieveCluster = (cluster, events, options) => {
        return Promise.resolve({
          response: {
            statusCode: 200,
            request: { method: "GET" }
          }
        });
      };
      elroyMock.updateCluster = (cluster, events, options) => {
        retries++;
        return Promise.reject({
          response: {
            statusCode: 502,
            request: { method: "PUT" }
          }
        });
      };

      return ElroySync.SaveToElroy(
        {
          cluster: { metadata: { name: "test", actve: true } },
          resources: () => {}
        },
        eventHandler,
        {
          elroyUrl: "http://elroy_svc",
          elroySecret: "xxxxx"
        },
        0
      ).should.be.rejected.then(() => {
        return Promise.resolve(retries).should.eventually.equal(4);
      });
    });
  });
});
