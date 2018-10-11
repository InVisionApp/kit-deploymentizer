"use strict";

const Promise = require("bluebird");
const sinon = require("sinon");
const ClusterDefinition = require("../../../src/lib/cluster-definition");
const ApiConfig = require("../../../src/plugin/env-api-client-v3");
const EventHandler = require("../../../src/util/event-handler");

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
chai.should();
const expect = chai.expect;

describe.only("ENV API Client Configuration plugin", () => {
  let ApiConfig;

  before(() => {
    ApiConfig = require("../../../src/plugin/env-api-client-v3");
  });

  describe("Load Client", () => {
    it("should fail with validation error", () => {
      try {
        const options = { api: "http://somehost/v3" };
        const apiConfig = new ApiConfig(options);
      } catch (err) {
        expect(err).to.exist;
        expect(err.message).to.be.equal(
          "The environment variable ENVAPI_ACCESS_TOKEN is required."
        );
      }
    });

    it("should load plugin successfully", () => {
      process.env.ENVAPI_ACCESS_TOKEN = "xxxxx-xxx-xxx";
      const options = { apiUrl: "http://somehost/api/v3", timeout: 20000 };
      const apiConfig = new ApiConfig(options);
      expect(apiConfig).to.exist;
      expect(apiConfig.apiToken).to.equal("xxxxx-xxx-xxx");
      expect(apiConfig.apiUrl).to.equal("http://somehost/api/v3");
      expect(apiConfig.timeout).to.equal(20000);
      delete process.env.ENVAPI_ACCESS_TOKEN;
    });

    it("should use ENV value for url", () => {
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
    });
  });

  describe("Api V3 Calls", () => {
    const resV3Valid = new Promise((resolve, reject) => {
      resolve({
        statusCode: 200,
        body: {
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
        }
      });
    });

    const resV3Invalid = new Promise((resolve, reject) => {
      reject({
        statusCode: 404,
        message: "Unable to fetch 'in-config.yaml' from 'node-test-rosie' repo"
      });
    });

    const testrosieService = {
      name: "testrosie",
      resourceName: "test-service",
      annotations: {
        "kit-deploymentizer/env-api-service": "node-test-rosie",
        "kit-deploymentizer/env-api-branch": "master"
      }
    };
    const testService = {
      name: "test-service",
      resourceName: "test-service",
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

    it("should fail with error", () => {
      const options = {
        apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
        supportFallback: true
      };
      const apiConfig = new ApiConfig(options);
      apiConfig
        .fetch(testrosieService, "cluster-name")
        .should.be.rejectedWith("Invalid argument for 'cluster'");
    });

    it("should send metrics via events", () => {
      const events = new EventHandler();
      let sentMetric = false;
      events.on("metric", function(msg) {
        sentMetric = true;
      });
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
        events: events
      };

      var rp = sinon.stub();
      rp.onFirstCall().returns(resV3Valid);

      const apiConfig = new ApiConfig(options);
      apiConfig.request = rp;

      return apiConfig
        .fetch(testService, clusterDef)
        .should.be.fulfilled.then(() => {
          expect(sentMetric).to.equal(true);
        });
    });

    it("should call request to v3 and succeed", () => {
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

      apiConfig
        .fetch(testService, clusterDef)
        .should.be.fulfilled.then(envs => {
          expect(rp.callCount).to.equal(1);
          expect(envs.env.length).to.equal(5);
          expect(envs.env[0].name).to.equal("GET_HOSTS_FROM");
          expect(envs.env[0].value).to.equal("dns");
          expect(envs.env[1].name).to.equal("MAX_RETRIES");
          expect(envs.env[1].value).to.equal("0");
        });
    });

    it("should fail when error request to v3", () => {
      var rp = sinon.stub();
      rp.onFirstCall().returns(resV3Invalid);
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
        apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api"
      };
      const apiConfig = new ApiConfig(options);
      apiConfig.request = rp;

      return apiConfig
        .fetch(testService, clusterDef)
        .should.be.rejected.then(err => {
          expect(rp.callCount).to.equal(1);
          expect(err.message).to.equal(
            "Unable to fetch 'in-config.yaml' from 'node-test-rosie' repo"
          );
        });
    });
  });

  describe.only("Api V4 Calls", () => {
    const envsResult = [
      {
        name: "SUBDOMAIN_REGEX",
        kind: "config",
        value: "\\\\.[\\\\w\\\\W]*",
        platform_owned: false
      },
      {
        name: "ROOKOUT_TOKEN",
        kind: "config",
        value: "aaaabbb",
        platform_owned: false
      },
      {
        name: "EMAIL_CUSTOMER_SUCCESS",
        kind: "config",
        value: "qateamfake@invisionapp.com",
        platform_owned: false
      },
      {
        name: "MONGO_DB",
        kind: "secret",
        value: "integration_invision",
        platform_owned: false
      },
      {
        name: "FREEHAND_API_URL",
        kind: "global",
        value: "https://freehand-api.v6.testing.invision.works",
        platform_owned: true
      }
    ];

    const resV4Valid = new Promise((resolve, reject) => {
      resolve({
        statusCode: 200,
        body: {
          status: "success",
          values: envsResult
        }
      });
    });

    const resV4Invalid = new Promise((resolve, reject) => {
      reject({
        statusCode: 404,
        message: "Unable to fetch 'in-config.yaml' from 'node-test-rosie' repo"
      });
    });

    const resV3Valid = new Promise((resolve, reject) => {
      resolve({
        statusCode: 200,
        body: {
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
        }
      });
    });

    const testService = {
      name: "test-service",
      resourceName: "test-service",
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

    it("should call request to v4 when feature flag enabled and succeed", () => {
      var rp = sinon.stub();
      rp.onFirstCall().returns(resV4Valid);

      const events = new EventHandler();
      let sentMetric = false;
      events.on("metric", function(msg) {
        sentMetric = true;
      });

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
        launchDarkly: {
          toggle: function() {
            return Promise.resolve(true);
          }
        },
        apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
        supportFallback: false,
        commitId: "shahahahaha",
        events: events
      };

      const apiConfig = new ApiConfig(options);
      apiConfig.request = rp;

      apiConfig
        .fetch(testService, clusterDef)
        .should.be.fulfilled.then(envs => {
          expect(rp.callCount).to.equal(1);
          expect(rp.firstCall.args[0].uri).to.include(
            "https://envapi.tools.shared-multi.k8s.invision.works/api/v4/resources/test-service"
          );
          expect(envs).to.deep.equal({
            env: envsResult
          });
          expect(sentMetric).to.equal(true);
        });
    });

    it("should use the resource annotation if it exists", () => {
      var rp = sinon.stub();
      rp.onFirstCall().returns(resV4Valid);

      const testService = {
        name: "test-service",
        resourceName: "test-service",
        annotations: {
          "kit-deploymentizer/env-api-service": "test-service",
          "kit-deploymentizer/env-api-resource": "other-service",
          "kit-deploymentizer/env-api-branch": "master"
        }
      };

      const events = new EventHandler();
      let sentMetric = false;
      events.on("metric", function(msg) {
        sentMetric = true;
      });

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
        launchDarkly: {
          toggle: function() {
            return Promise.resolve(true);
          }
        },
        apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
        supportFallback: false,
        commitId: "shahahahaha",
        events: events
      };

      const apiConfig = new ApiConfig(options);
      apiConfig.request = rp;

      apiConfig
        .fetch(testService, clusterDef)
        .should.be.fulfilled.then(envs => {
          expect(rp.callCount).to.equal(1);
          expect(rp.firstCall.args[0].uri).to.include(
            "https://envapi.tools.shared-multi.k8s.invision.works/api/v4/resources/other-service"
          );
          expect(envs).to.deep.equal({
            env: envsResult
          });
          expect(sentMetric).to.equal(true);
        });
    });

    it("should call request to v3 when feature flag disabled and succeed", () => {
      var rp = sinon.stub();
      rp.onFirstCall().returns(resV3Valid);

      const events = new EventHandler();
      let sentMetric = false;
      events.on("metric", function(msg) {
        sentMetric = true;
      });

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
        launchDarkly: {
          toggle: function() {
            return Promise.resolve(false);
          }
        },
        apiUrl: "https://envapi.tools.shared-multi.k8s.invision.works/api",
        supportFallback: false,
        events: events
      };

      const apiConfig = new ApiConfig(options);
      apiConfig.request = rp;

      apiConfig
        .fetch(testService, clusterDef)
        .should.be.fulfilled.then(envs => {
          expect(rp.callCount).to.equal(1);
          expect(rp.firstCall.args[0].uri).to.include(
            "https://envapi.tools.shared-multi.k8s.invision.works/api/v3"
          );
          expect(envs).to.deep.equal({
            env: [
              { name: "GET_HOSTS_FROM", value: "dns" },
              { name: "MAX_RETRIES", value: "0" },
              {
                name: "MEMBER_HOSTS",
                value:
                  "mongoreplica-01-svc:27017,mongoreplica-02-svc:27017,mongoreplica-03-svc:27017"
              },
              { name: "REPLICA_SET_NAME", value: "rs0" },
              { name: "WAIT_TIME", value: "60000" }
            ]
          });
          expect(sentMetric).to.equal(true);
        });
    });
  });
});
