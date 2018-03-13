"use strict";

var expect = require("chai").expect;
const Promise = require("bluebird");
const sinon = require("sinon");
const ClusterDefinition = require("../../../src/lib/cluster-definition");
const ApiConfig = require("../../../src/plugin/env-api-client-v3");
const EventEmitter = require("events").EventEmitter;

describe("ENV API Client Configuration plugin", () => {
  let emitter, ApiConfig;

  before(() => {
    process.env.ENVAPI_ACCESS_TOKEN = "sometoken";
    emitter = new EventEmitter();
    ApiConfig = require("../../../src/plugin/env-api-client");
  });

  describe("Load Client", () => {
    it("should fail with validation error", done => {
      try {
        const options = { api: "http://somehost/v3" };
        const apiConfig = new ApiConfig(options);
        done(new Error("Should have failed"));
      } catch (err) {
        done();
      }
    });

    it("should load plugin successfully", done => {
      process.env.ENVAPI_ACCESS_TOKEN = "xxxxx-xxx-xxx";
      const options = { apiUrl: "http://somehost/api/v3", timeout: 20000 };
      const apiConfig = new ApiConfig(options);
      expect(apiConfig).to.exist;
      expect(apiConfig.apiToken).to.equal("xxxxx-xxx-xxx");
      expect(apiConfig.apiUrl).to.equal("http://somehost/api/v3");
      expect(apiConfig.timeout).to.equal(20000);
      delete process.env.ENVAPI_ACCESS_TOKEN;
      done();
    });
    it("should use ENV value for url", done => {
      process.env.ENVAPI_ACCESS_TOKEN = "xxxxx-xxx-xxx";
      process.env.ENVAPI_URL = "http://new-url.com/api/v3";
      const options = { apiUrl: "http://somehost/api/v3", timeout: 20000 };
      const apiConfig = new ApiConfig(options);
      expect(apiConfig).to.exist;
      expect(apiConfig.apiToken).to.equal("xxxxx-xxx-xxx");
      expect(apiConfig.apiUrl).to.equal("http://new-url.com/api/v3");
      expect(apiConfig.timeout).to.equal(20000);
      delete process.env.ENVAPI_ACCESS_TOKEN;
      delete process.env.ENVAPI_URL;
      done();
    });
  });

  describe("Invoke Client", () => {
    const resV3Valid = new Promise((resolve, reject) => {
      resolve({
        status: "success",
        message: "fetched env",
        values: {
          GET_HOSTS_FROM: "dns",
          MAX_RETRIES: "0",
          MEMBER_HOSTS:
            "mongoreplica-01-svc:27017,mongoreplica-02-svc:27017,mongoreplica-03-svc:27017",
          REPLICA_SET_NAME: "rs0",
          WAIT_TIME: "60000"
        }
      });
    });
    const resV3Invalid = new Promise((resolve, reject) => {
      reject({
        statusCode: 404,
        message:
          '404 - {"message":"Unable to fetch \'in-config.yaml\' from \'node-test-rosie\' repo, branch \'master\': GET https://api.github.com/repos/InvisionApp/node-test-rosie/contents/in-config.yaml?ref=master: 404 Not Found []","status":"error"}'
      });
    });
    const resV2Env = new Promise((resolve, reject) => {
      resolve({
        env: {
          GET_HOSTS_FROM: "dns",
          MAX_RETRIES: "0",
          MEMBER_HOSTS:
            "mongoreplica-01-svc:27017,mongoreplica-02-svc:27017,mongoreplica-03-svc:27017",
          REPLICA_SET_NAME: "rs0",
          WAIT_TIME: "60000"
        },
        k8s: {
          branch: "develop"
        }
      });
    });

    const testrosieService = {
      name: "testrosie",
      annotations: {
        "kit-deploymentizer/env-api-service": "node-test-rosie",
        "kit-deploymentizer/env-api-branch": "master"
      }
    };
    const testService = {
      name: "test-service",
      annotations: {
        "kit-deploymentizer/env-api-service": "test-service",
        "kit-deploymentizer/env-api-branch": "master"
      }
    };

    before(() => {
      process.env.ENVAPI_ACCESS_TOKEN = "xxxxx-xxx-xxx";
    });

    after(() => {
      delete process.env.ENVAPI_ACCESS_TOKEN;
    });

    it("should fail with error", done => {
      Promise.coroutine(function*() {
        const options = {
          apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
          supportFallback: true
        };
        const apiConfig = new ApiConfig(options);
        const envs = yield apiConfig.fetch(testrosieService, "cluster-name");
        done(new Error("Should have failed"));
      })().catch(err => {
        expect(err.message).to.exist;
        expect(err.message).to.have.string("Invalid argument for 'cluster'");
        done();
      });
    });

    it("should call request to v3 and succeed", done => {
      Promise.coroutine(function*() {
        var rp = sinon.stub();
        rp.onFirstCall().returns(resV3Valid);
        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "staging-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com",
            restricted: true
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const options = {
          apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
          supportFallback: true
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        let envs;
        envs = yield apiConfig.fetch(testService, clusterDef);
        expect(rp.callCount).to.equal(1);

        expect(envs.env.length).to.equal(5);
        expect(envs.env[0].name).to.equal("GET_HOSTS_FROM");
        expect(envs.env[0].value).to.equal("dns");
        expect(envs.env[1].name).to.equal("MAX_RETRIES");
        expect(envs.env[1].value).to.equal("0");

        done();
      })().catch(err => {
        console.log(JSON.stringify(err));
        done(err);
      });
    });

    it("should call request to v3 and fallback to v1", done => {
      Promise.coroutine(function*() {
        var rp = sinon.stub();
        rp.onFirstCall().returns(resV3Invalid);
        rp.onSecondCall().returns(resV2Env);
        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "staging-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com",
            restricted: true
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const options = {
          apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
          supportFallback: true
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        let envs;
        envs = yield apiConfig.fetch(testService, clusterDef);
        expect(rp.callCount).to.equal(2);

        expect(envs.env.length).to.equal(5);
        expect(envs.env[0].name).to.equal("GET_HOSTS_FROM");
        expect(envs.env[0].value).to.equal("dns");
        expect(envs.env[1].name).to.equal("MAX_RETRIES");
        expect(envs.env[1].value).to.equal("0");

        done();
      })().catch(err => {
        console.log(JSON.stringify(err));
        done(err);
      });
    });

    it("should call request to v3 and no fallback", done => {
      Promise.coroutine(function*() {
        var rp = sinon.stub();
        rp.onFirstCall().returns(resV3Invalid);
        rp.onSecondCall().returns(resV2Env);
        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "staging-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com",
            restricted: true
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const options = {
          apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
          supportFallback: false
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        let envs;
        envs = yield apiConfig.fetch(testService, clusterDef);
        expect(rp.callCount).to.equal(1);

        done(new Error("Should have thrown Error"));
      })().catch(err => {
        expect(err.message).to.exist;
        expect(err.message).to.have.string("Unable to fetch 'in-config.yaml'");
        done();
      });
    });
  });
});
