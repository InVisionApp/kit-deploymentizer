"use strict";

var expect = require("chai").expect;
const Promise = require("bluebird");
const sinon = require("sinon");
const ClusterDefinition = require("../../../src/lib/cluster-definition");
const EventEmitter = require("events").EventEmitter;

describe("ENV API Client Configuration plugin", () => {
  let emitter, ApiConfig;
  before(() => {
    process.env.ENVAPI_ACCESS_TOKEN = "sometoken";
    emitter = new EventEmitter();
    ApiConfig = require("../../../src/plugin/env-api-client");
  });

  after(() => {
    delete process.env.ENVAPI_ACCESS_TOKEN;
  });

  describe("Load Client", () => {
    it("should fail with validation error", done => {
      try {
        const apiConfig = new ApiConfig();
        done(new Error("Should have failed"));
      } catch (err) {
        done();
      }
    });

    it("should fail with validation error", done => {
      try {
        const options = { api: "http://somehost/v1", Token: "SOME-TOKEN" };
        const apiConfig = new ApiConfig(options);
        done(new Error("Should have failed"));
      } catch (err) {
        done();
      }
    });

    it("should load plugin successfully", done => {
      const options = {
        apiUrl: "http://somehost/v1",
        apiToken: "SOME-TOKEN",
        timeout: 20000
      };
      const apiConfig = new ApiConfig(options);
      expect(apiConfig).to.exist;
      expect(apiConfig.apiToken).to.equal("SOME-TOKEN");
      expect(apiConfig.apiUrl).to.equal("http://somehost/v1");
      expect(apiConfig.timeout).to.equal(20000);
      done();
    });
    it("should load plugin successfully and default timeout", done => {
      const options = { apiUrl: "http://somehost/v1", apiToken: "SOME-TOKEN" };
      const apiConfig = new ApiConfig(options);
      expect(apiConfig).to.exist;
      expect(apiConfig.timeout).to.equal(15000);
      done();
    });
  });

  describe("Client calls", () => {
    it("should fail with error", done => {
      Promise.coroutine(function*() {
        const options = { apiUrl: "http://somehost/v1", Token: "SOME-TOKEN" };
        const apiConfig = new ApiConfig(options);
        apiConfig.emit = (name, obj) => {
          expect(name).to.be.equal("metric");
          expect(typeof obj).to.be.equal("object");
        };
        const service = {
          name: "mongo-init",
          annotations: {
            "kit-deploymentizer/env-api-service": "mongo-init",
            "kit-deploymentizer/env-api-branch": "develop"
          }
        };
        const envs = yield apiConfig.fetch(service, "cluster-name");
        done(new Error("Should have failed"));
      })().catch(err => {
        expect(err.message).to.exist;
        expect(err.message).to.have.string("Invalid argument for 'cluster'");
        done();
      });
    });

    it("should only call request to env-api once, and convert values", done => {
      Promise.coroutine(function*() {
        const responseOne = new Promise((resolve, reject) => {
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
        var rp = sinon.stub();
        rp.onFirstCall().returns(responseOne);
        // .onSecondCall().returns(2);

        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "example-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com"
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const options = {
          apiUrl: "http://somehost/v1",
          apiToken: "SOME-TOKEN",
          k8sBranch: true
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        const service = {
          name: "mongo-init",
          annotations: {
            "kit-deploymentizer/env-api-service": "mongo-init",
            "kit-deploymentizer/env-api-branch": "develop"
          }
        };
        const envs = yield apiConfig.fetch(service, clusterDef);
        // console.log("Resolved ENVS: %j", envs);
        expect(rp.callCount).to.equal(1);
        let calledWith = rp.getCall(0);
        // assert that the second call was to testing branch
        expect(calledWith.args[0].qs.branch).to.equal("develop");
        expect(calledWith.args[0].qs.env).to.equal("example-cluster");
        expect(envs.branch).to.equal("develop");
        expect(envs.env.length).to.equal(5);
        expect(envs.env[0].name).to.equal("GET_HOSTS_FROM");
        expect(envs.env[0].value).to.equal("dns");
        expect(envs.env[1].name).to.equal("MAX_RETRIES");
        expect(envs.env[1].value).to.equal("0");
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should call request to env-api twice, and get correct values", done => {
      Promise.coroutine(function*() {
        // ResponseOne is returned that says use testing branch,
        // Request is invoked again passing in branch testing
        // those values are used, but initial requests branch is kept.
        const responseOne = new Promise((resolve, reject) => {
          resolve({
            env: {
              GET_HOSTS_FROM: "dns",
              MAX_RETRIES: "0",
              WAIT_TIME: "60000"
            },
            k8s: {
              branch: "testing"
            }
          });
        });
        const responseTwo = new Promise((resolve, reject) => {
          resolve({
            env: {
              GET_HOSTS_FROM: "dns",
              MAX_RETRIES: "5",
              WAIT_TIME: "10000"
            },
            k8s: {
              branch: "develop"
            }
          });
        });
        var rp = sinon.stub();
        rp
          .onFirstCall()
          .returns(responseOne)
          .onSecondCall()
          .returns(responseTwo);
        const options = {
          apiUrl: "http://somehost/v1",
          apiToken: "SOME-TOKEN",
          k8sBranch: true
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "example-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com"
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const service = {
          name: "mongo-init",
          annotations: {
            "kit-deploymentizer/env-api-service": "mongo-init",
            "kit-deploymentizer/env-api-branch": "develop"
          }
        };
        const envs = yield apiConfig.fetch(service, clusterDef);
        // console.log("Resolved ENVS: %j", envs);
        expect(rp.callCount).to.equal(2);
        let calledWith = rp.getCall(1);
        // assert that the second call was to testing branch
        expect(calledWith.args[0].qs.branch).to.equal("testing");
        expect(envs.branch).to.equal("testing");
        expect(envs.env.length).to.equal(3);
        expect(envs.env[1].name).to.equal("MAX_RETRIES");
        expect(envs.env[1].value).to.equal("5");
        expect(envs.env[2].name).to.equal("WAIT_TIME");
        expect(envs.env[2].value).to.equal("10000");
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should call request to env-api once, k8sBranch disabled", done => {
      Promise.coroutine(function*() {
        // ResponseOne is returned that says use testing branch,
        // Request is invoked again passing in branch testing
        // those values are used, but initial requests branch is kept.
        const responseOne = new Promise((resolve, reject) => {
          resolve({
            env: {
              GET_HOSTS_FROM: "dns",
              MAX_RETRIES: "0",
              WAIT_TIME: "60000"
            },
            k8s: {
              branch: "testing"
            }
          });
        });
        var rp = sinon.stub();
        rp
          .onFirstCall()
          .returns(responseOne)
          .onSecondCall()
          .returns({});
        const options = {
          apiUrl: "http://somehost/v1",
          apiToken: "SOME-TOKEN"
        };
        const apiConfig = new ApiConfig(options);
        apiConfig.request = rp;

        const cluster = {
          kind: "ClusterNamespace",
          metadata: {
            name: "example-cluster",
            type: "staging",
            environment: "staging",
            domain: "somewbesite.com"
          }
        };
        const config = {
          kind: "ResourceConfig",
          env: [{ name: "a", value: 1 }, { name: "b", value: 2 }]
        };
        const clusterDef = new ClusterDefinition(cluster, config);

        const service = {
          name: "mongo-init",
          annotations: {
            "kit-deploymentizer/env-api-service": "mongo-init",
            "kit-deploymentizer/env-api-branch": "develop"
          }
        };
        const envs = yield apiConfig.fetch(service, clusterDef);
        // console.log("Resolved ENVS: %j", envs);
        expect(rp.callCount).to.equal(1);
        expect(envs.branch).to.equal("testing");
        expect(envs.env.length).to.equal(3);
        expect(envs.env[1].name).to.equal("MAX_RETRIES");
        expect(envs.env[1].value).to.equal("0");
        expect(envs.env[2].name).to.equal("WAIT_TIME");
        expect(envs.env[2].value).to.equal("60000");
        done();
      })().catch(err => {
        done(err);
      });
    });
  });
});
