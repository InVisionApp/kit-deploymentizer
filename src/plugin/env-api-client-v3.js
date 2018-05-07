"use strict";

const Promise = require("bluebird");
const rp = require("request-promise");
const logger = require("log4js").getLogger();

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
    this.supportFallback = false;
    if (
      options.supportFallback &&
      (options.supportFallback === "true" || options.supportFallback === true)
    ) {
      this.supportFallback = true;
    }
    this.events = options.events || undefined;
    this.launchDarkly = options.launchDarkly || undefined;
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
	 * Call is made to get environment varibles for a given service. Supports falling back to the
	 * v2 Endpoint if the v3 returns a 404.
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
    const self = this;
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
        service: service.annotations[EnvApiClient.annotationServiceName],
        environment: cluster.metadata().environment,
        cluster: cluster.name(),
        metadata: metadata
      };

      let tags = {
        app: "kit_deploymentizer",
        envapi_environment: params.environment,
        envapi_cluster: params.cluster,
        envapi_resource: params.service,
        envapi_version: "v3",
        kit_resource: params.service
      };

      return self
        .callv3Api(params)
        .then(resp => {
          if (self.events) {
            self.events.emitMetric({
              kind: "increment",
              name: "envapi.call",
              tags: tags
            });
          }

          const body = resp.body;
          const resultOK = {
            env: self.convertEnvResult(body.values)
          };

          const resultErr = {
            message: body.message || "No error message supplied",
            statusCode: resp.statusCode
          };

          if (resp.statusCode === 200) {
            return resultOK;
          }

          if (resp.statusCode === 206) {
            if (self.events) {
              self.events.emitMetric({
                kind: "event",
                title: "Partial Content",
                text: "Success with partial content: " + body.errors,
                tags: tags
              });
            }

            if (!self.launchDarkly) {
              if (self.events) {
                self.events.emitMetric({
                  kind: "event",
                  title: "LaunchDarkly undefined",
                  text: "Launchdarkly is undefined",
                  tags: tags
                });
              }
              return resultOK;
            }

            return self.launchDarkly
              .toggle("kit-deploymentizer-90-fail-deploy-envs")
              .then(isEnabled => {
                tags.feature_name = "kit-deploymentizer-90-fail-deploy-envs";
                self.events.emitMetric({
                  kind: "increment",
                  name: isEnabled ? "feature.enabled" : "feature.disabled",
                  tags: tags
                });
                if (isEnabled) {
                  logger.debug(
                    "enabled kit-deploymentizer-90-fail-deploy-envs: rejecting deployment..."
                  );
                  if (body.Errors) {
                    resultErr.Error += body.Errors;
                  }
                  throw resultErr;
                }
                logger.debug(
                  "disabled kit-deploymentizer-90-fail-deploy-envs: continue deployment..."
                );
                return resultOK;
              });
          }
          throw resultErr;
        })
        .catch(err => {
          // try v1 of API if supported and we receieved a 404 from v3 endpoint
          if (self.supportFallback && err.statusCode && err.statusCode == 404) {
            logger.warn(
              `Trying Fallback method with params ${self.defaultBranch}, ${service}, ${params.cluster}`
            );
            return self
              .callv1Api(self.defaultBranch, service, params.cluster)
              .then(result => {
                if (self.events) {
                  tags.kitserver_envapi_version = "v2";
                  self.events.emitMetric({
                    kind: "increment",
                    name: "envapi.call",
                    tags: tags
                  });
                }
                return result;
              })
              .catch(err => {
                logger.error("Fallback method error: " + JSON.stringify(err));
                throw err;
              });
          } else {
            logger.error(
              `Fallback not supported and/or wrong error code ${err.statusCode}: ${err.message}`
            );
            throw err.message;
          }
        });
    }).bind(this)().catch(err => {
      let errMsg = err.message || err;
      // API call failed, parse returned error message if possible...
      if (
        err.response &&
        err.response.body &&
        err.response.body.status === "error"
      ) {
        errMsg = self.convertErrorResponse(err.response.body);
      }

      let tags = {
        app: "kit_deploymentizer",
        envapi_resource:
          service.annotations[EnvApiClient.annotationServiceName],
        envapi_version: "v3_v2"
      };

      if (typeof cluster === "object") {
        if (cluster.metadata && typeof cluster.metadata === "function") {
          tags.envapi_environment = cluster.metadata().environment;
        }
        if (cluster.name && typeof cluster.name === "function") {
          tags.envapi_cluster = cluster.name();
        }
      }

      if (self.events) {
        self.events.emitMetric({
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
	 * Calls the v2 Endpoint. uses GET and query params
	 */
  callv1Api(branch, service, clusterName) {
    return Promise.coroutine(function*() {
      const uri = `${this.apiUrl}/v1/service/${service.annotations[
        EnvApiClient.annotationServiceName
      ]}`;
      let query = { env: clusterName };
      // if a branch is specified pass that along
      if (
        service.annotations ||
        service.annotations[EnvApiClient.annotationBranchName]
      ) {
        query.branch = service.annotations[EnvApiClient.annotationBranchName];
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
      result = this.convertK8sResult(config.k8s, result);
      if (this.k8sBranch && result.branch && result.branch !== query.branch) {
        logger.debug(`Pulling envs from ${result.branch} branch`);
        options.qs.branch = result.branch;
        config = yield this.request(options);
      }
      result.env = this.convertEnvResult(config.env);
      return result;
    }).bind(this)();
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
	 * Fetchs the envs
	 */
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
}

module.exports = EnvApiClient;
