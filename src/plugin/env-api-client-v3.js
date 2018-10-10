"use strict";

const Promise = require("bluebird");
const rp = require("request-promise");
const logger = require("log4js").getLogger();

const envAPIV4 = "v4";
const envAPIV3 = "v3";

/**
 * Class for accessing the EnvApi Service.
 */
class EnvApiClient {
  /**
	 * Requires the apiUrl to be set as parameters. The ENVAPI_ACCESS_TOKEN is required as a ENV var.
	 * @param  {[type]} options
	 */
  constructor(options) {
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
    if (process.env.ENVAPI_URL && process.env.ENVAPI_URL.length > 0) {
      this.apiUrl = process.env.ENVAPI_URL;
      logger.warn(`Overriding ENV-API Url with: ${this.apiUrl}`);
    }
    this.timeout = options.timeout || 15000;
    this.defaultBranch = options.defaultBranch || "master";
    this.request = rp;
    this.events = options.events || undefined;
    this.launchDarkly = options.launchDarkly || undefined;
    this.ref = options.commitId || "master";
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
   * This overrides the provided resource name for fetching env vars from envapi
   * https://invisionapp.atlassian.net/browse/EV-1429
   */
  static get annotationResourceName() {
    return "kit-deploymentizer/env-api-resource";
  }

  /**
	 * The provided service resource needs to contain an annotation specifiying the service name
	 * to use when invoking the env-api service. If this annotation is not present the request
	 * is skipped. The annotation is `kit-deploymentizer/env-api-service: [GIT-HUB-PROJECT-NAME]`
	 *
	 * Call is made to get environment varibles for a given service. Supports falling back to the
	 * v1 Endpoint if the v3 returns a 404.
	 *
	 * Example Result for both ENV and k8s request:
	 * ```
	 * {
	 *  "status": "success",
	 *  "message": "fetched 'env.yaml' values for 'testing-cluster' env on 'env-test' branch",
	 *  "values": {
	 *    "GET_HOSTS_FROM": "dns",
	 *    "NAME": "Rosie",
	 *    "PORT": "80",
	 *    "TEAM": "Engineering",
	 *    "TEST": "NOV 11, 12:55PM"
	 *  }
	 * }
	 * ```
	 * All results (including errors) contain status and message values.
	 * Error Results Status Codes:
	 * 	cluster-not-found: 500
	 *  file not found: 404
	 *  secret value: 500
	 *  partial content: 206 => services compatibility
	 *
	 *
	 * @param  {[type]} service     Resource to get envs for  -- checks for correct annotation
	 * @param  {[type]} cluster     the service is running in
	 * @return {[type]}             envs and configuration information
	 */
  fetch(service, cluster) {
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

      // Clean metadata so it does not have any booleans before we pass to envapi (booleans cause errors)
      const rawMetadata = cluster.metadata();
      const metadata = {};
      for (const key in rawMetadata) {
        if (
          rawMetadata[key] &&
          typeof rawMetadata[key].toString == "function"
        ) {
          metadata[key] = rawMetadata[key].toString();
        } else {
          metadata[key] = rawMetadata[key];
        }
      }

      let params = {
        environment: cluster.metadata().environment,
        cluster: cluster.name(),
        metadata: metadata,
        ref: this.ref
      };

      let tags = {
        app: "kit_deploymentizer",
        envapi_environment: params.environment,
        envapi_cluster: params.cluster,
        envapi_resource: params.service,
        envapi_version: envAPIV3,
        kit_resource: params.service,
        envapi_resource_ref: this.ref
      };

      const envapiVersion = yield this.determineApiVersionCall(tags);

      let resp;
      if (envapiVersion === envAPIV4) {
        params.service = this.getResourceName(service);
        tags.envapi_version = envAPIV4;
        resp = yield this.callv4Api(params);
      } else {
        params.service =
          service.annotations[EnvApiClient.annotationServiceName];
        resp = yield this.callv3Api(params);
      }

      return this.parseResponse(resp, envapiVersion, tags);
    }).bind(this)().catch(err => {
      let errMsg = err.message || err;
      // API call failed, parse returned error message if possible...
      if (
        err.response &&
        err.response.body &&
        err.response.body.status === "error"
      ) {
        errMsg = this.convertErrorResponse(err.response.body);
      }

      let tags = {
        app: "kit_deploymentizer",
        envapi_resource:
          service.annotations[EnvApiClient.annotationServiceName],
        status: "error"
      };

      if (typeof cluster === "object") {
        if (cluster.metadata && typeof cluster.metadata === "function") {
          tags.envapi_environment = cluster.metadata().environment;
        }
        if (cluster.name && typeof cluster.name === "function") {
          tags.envapi_cluster = cluster.name();
        }
      }

      if (this.events) {
        this.events.emitMetric({
          kind: "event",
          title: "Failure getting envs through envapi",
          text: `Error getting envs with envapi: ${errMsg}`,
          tags: tags
        });
      }
      throw new Error(errMsg);
    });
  }

  /**
   * Returns service name
   * @param {object} service 
   */
  getResourceName(service) {
    if (service.annotations[EnvApiClient.annotationResourceName]) {
      return service.annotations[EnvApiClient.annotationResourceName];
    }
    return service.resourceName;
  }

  /**
   * Determines the Endpoint's version based on feature flag .
   * @param {object} tags - key value pairs used for metrics tags
   * @returns - a string indicating which envapi version sohould be used
   */
  // TODO (Manuel): delete this after api v4 is stable and use v4 for all
  determineApiVersionCall(tags) {
    if (!this.launchDarkly) {
      logger.debug("launchDarkly is undefined");
      return Promise.resolve(envAPIV3);
    }

    return this.launchDarkly
      .toggle("kit-deploymentizer-94-api-v4-call")
      .then(isEnabled => {
        tags.feature_name = "kit-deploymentizer-94-api-v4-call";

        this.events.emitMetric({
          kind: "increment",
          name: isEnabled ? "feature.enabled" : "feature.disabled",
          tags: tags
        });

        if (isEnabled) {
          logger.debug("enabled envapi-v4-call ...");
          return envAPIV4;
        }

        logger.debug("disabled envapi-v4-call, so calling v3 endpoint ...");
        return envAPIV3;
      });
  }

  /**
   * Calls the V4 Endpoint.
   */
  callv4Api(params) {
    const uri = `${this
      .apiUrl}/v4/resources/${params.service}/deployment-environments/${params.cluster}?ref=${params.ref}`;
    let options = {
      method: "GET",
      uri: uri,
      headers: { "X-Auth-Token": this.apiToken },
      json: true,
      timeout: this.timeout,
      resolveWithFullResponse: true
    };
    return this.request(options);
  }

  /**
   * Calls the V3 Endpoint. This is a POST with all parameters in the body of the message
   */
  callv3Api(payload) {
    const uri = `${this.apiUrl}/v3/vars`;
    let options = {
      method: "POST",
      uri: uri,
      headers: { "X-Auth-Token": this.apiToken },
      body: payload,
      json: true,
      timeout: this.timeout,
      resolveWithFullResponse: true
    };
    return this.request(options);
  }

  /**
   * Convert the custom error messages into a String
   */
  convertErrorResponse(response) {
    logger.error(`Error in returned response ${response.message}`);
    let errMsg = response.message || "Received error";
    if (response.errors) {
      let errors = Array.isArray(response.errors)
        ? response.errors.join("\n")
        : response.errors;
      errMsg += `\n ${errors}`;
    }
    return errMsg;
  }

  /**
   * Converts the returned results from the env-api service into the expected format.
   */
  convertK8sResult(k8s, result) {
    if (k8s && typeof k8s === "object") {
      Object.keys(k8s).forEach(key => {
        result[key] = k8s[key];
      });
    }
    return result;
  }

  /**
   * Converts the returned results from the env-api service into the expected format.
   */
  convertEnvResult(values) {
    let envs = [];
    if (values) {
      Object.keys(values).forEach(key => {
        envs.push({
          name: key,
          value: values[key]
        });
      });
    }
    return envs;
  }

  /**
   * Parses the response from the env-api request
   * @param {object} resp - env-api response object
   * @param {string} envapiVersion - the version of api used for the envapi call
   * @param {object} tags - tags object
   * @returns - returns Promise that resolves to an resultOK or resultErr object
   */
  parseResponse(resp, envapiVersion, tags) {
    if (this.events) {
      this.events.emitMetric({
        kind: "increment",
        name: "envapi.call",
        tags: tags
      });
    }

    let resultOK = {};
    if (envapiVersion === envAPIV4) {
      resultOK.env = resp.body.values;
    } else {
      resultOK.env = this.convertEnvResult(resp.body.values);
    }

    const resultErr = {
      message: resp.body.message || "No error message supplied",
      statusCode: resp.statusCode
    };

    if (resp.statusCode === 200) {
      return Promise.resolve(resultOK);
    }

    if (resp.statusCode === 206) {
      const err = "Success with partial content: " + resp.body.errors;
      if (this.events) {
        this.events.emitMetric({
          kind: "event",
          title: "Partial Content",
          text: err,
          tags: tags
        });
      }

      if (!this.launchDarkly) {
        if (this.events) {
          this.events.emitMetric({
            kind: "event",
            title: "LaunchDarkly undefined",
            text: "Launchdarkly is undefined",
            tags: tags
          });
        }
        return Promise.resolve(resultOK);
      }

      return this.launchDarkly
        .toggle("kit-deploymentizer-90-fail-deploy-envs")
        .then(isEnabled => {
          tags.feature_name = "kit-deploymentizer-90-fail-deploy-envs";
          this.events.emitMetric({
            kind: "increment",
            name: isEnabled ? "feature.enabled" : "feature.disabled",
            tags: tags
          });
          if (isEnabled) {
            logger.debug(
              "enabled kit-deploymentizer-90-fail-deploy-envs: rejecting deployment..."
            );
            resultErr.message = err;
            throw resultErr;
          }
          logger.debug(
            "disabled kit-deploymentizer-90-fail-deploy-envs: continue deployment..."
          );
          return resultOK;
        });
    }
    Promise.reject(resultErr);
  }
}

module.exports = EnvApiClient;
