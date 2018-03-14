"use strict";

const Promise = require("bluebird");
const rp = require("request-promise");
const logger = require("log4js").getLogger();
const EventEmitter = require("events");

/**
 * Class for accessing the EnvApi Service.
 */
class EnvApiClient {
  /**
	 * Requires the apiUrl and apiToken to be set included as parameters.
	 * @param  {[type]} options
	 */
  constructor(options) {
    super();
    this.apiToken = process.env.ENVAPI_ACCESS_TOKEN;
    if (!this.apiToken) {
      throw new Error(
        "The environment variable ENVAPI_ACCESS_TOKEN is required."
      );
    }
    if (!options.apiUrl) {
      throw new Error("The apiUrl is a required configuration value.");
    }
    this.apiUrl = options.apiUrl;
    this.apiToken = options.apiToken;
    this.timeout = options.timeout || 15000;
    this.k8sBranch = options.k8sBranch === true || false;
    this.request = rp;
    this.events = options.events || undefined;
  }

  /**
	 * The annotation name to look for
	 */
  static get annotationServiceName() {
    return "kit-deploymentizer/env-api-service";
  }

  static get annotationBranchName() {
    return "kit-deploymentizer/env-api-branch";
  }
  /**
	 * The provided service resource needs to contain an annotation specifiying the service name
	 * to use when invoking the env-api service. If this annotation is not present the request
	 * is skipped. The annotation is `kit-deploymentizer/env-api-service: [GIT-HUB-PROJECT-NAME]`
	 *
	 * Another, optional, annotation sets the branch to use by the env-api service. This annotation
	 * is `kit-deploymentizer/env-api-branch: [GIT-HUB-BRANCH-NAME]`
	 *
	 * Expects JSON results in the format of:
	 * {
	 *   env: {
	 *   		ENV_NAME_ONE: ENV_VALUE_ONE,
	 *   		ENV_NAME_TWO: ENV_VALUE_TWO,
	 *   		...
	 *   },
	 *   k8s: {
	 *     other: value,
	 *     ...
	 *   }
	 * }
	 *
	 * @param  {[type]} service     Resource to get envs for  -- checks for correct annotation
	 * @param  {[type]} cluster     the service is running in
	 * @return {[type]}             envs and configuration information
	 */
  fetch(service, cluster) {
    let self = this;
    return Promise.coroutine(function*() {
      if (
        !service.annotations ||
        !service.annotations[EnvApiClient.annotationServiceName]
      ) {
        logger.warn(`No env-api-service annotation found for ${service.name}`);
        return;
      }
      if (typeof cluster === "string") {
        throw new Error(
          "Invalid argument for 'cluster', requires cluster object not string."
        );
      }
      const resource = service.annotations[EnvApiClient.annotationServiceName];
      const uri = `${this.apiUrl}/${resource}`;
      let query = { env: cluster.name() };

      let tags = {
        app: "kit_deploymentizer",
        envapi_cluster: query.env,
        envapi_resource: service.name,
        envapi_version: "v2"
      };

      // if a branch is specified pass that along
      if (
        service.annotations ||
        service.annotations[EnvApiClient.annotationBranchName]
      ) {
        query.branch = service.annotations[EnvApiClient.annotationBranchName];
        tags.kitserver_envapi_branch = query.branch;
      }
      let options = {
        uri: uri,
        qs: query,
        headers: { "X-Auth-Token": this.apiToken },
        json: true,
        timeout: this.timeout
      };
      let config = yield this.request(options);
      let result = {};
      result = this.convertK8sResult(config, result);
      if (this.k8sBranch && result.branch && result.branch !== query.branch) {
        logger.debug(`Pulling envs from ${result.branch} branch`);
        options.qs.branch = result.branch;
        config = yield this.request(options);
      }
      result = this.convertEnvResult(config, result);

      if (self.options.events) {
        self.options.events.emitMetric({
          kind: "increment",
          name: "envapi.call",
          tags: tags
        });
      }

      return result;
    }).bind(this)().catch(function(err) {
      const errStr = JSON.stringify(err);
      // API call failed...
      logger.fatal(`Unable to fetch or convert ENV Config ${errStr}`);

      if (self.options.events) {
        let tags = {
          app: "kit_deploymentizer",
          envapi_version: "v2",
          envapi_resource:
            service.annotations[EnvApiClient.annotationServiceName]
        };
        if (typeof cluster !== "string") {
          tags.envapi_cluster = cluster.name();
        }
        self.options.events.emitMetric({
          kind: "event",
          title: "Failure getting envs through envapi",
          text: `Error getting envs with envapi: ${errStr}`,
          tags: tags
        });
      }
      throw err;
    });
  }

  /**
	 * Converts the returned results from the env-api service into the expected format.
	 */
  convertK8sResult(config, result) {
    // move the k8s values to the base object
    if (config.k8s && typeof config.k8s === "object") {
      let props = config.k8s;
      Object.keys(props).forEach(key => {
        result[key] = props[key];
      });
    }
    return result;
  }

  /**
	 * Converts the returned results from the env-api service into the expected format.
	 */
  convertEnvResult(config, result) {
    // convert env section to correct format
    result.env = [];
    if (config.env) {
      Object.keys(config.env).forEach(key => {
        result.env.push({
          name: key,
          value: config.env[key]
        });
      });
    }
    return result;
  }
}

module.exports = EnvApiClient;
