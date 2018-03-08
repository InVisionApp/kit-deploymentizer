"use strict";

const _ = require("lodash");
const request = require("request-promise");
const errors = require("request-promise/errors");
const Promise = require("bluebird");

const MaxCount = 500;

/**
 * Handles Syncing Clusters to Elroy
 */
class ElroySync {
  /**
	 * Deactivates Clusters that are in elroy but no longer in cluster definitions
	 * @param {*} clusterDefs Array of cluster definitions
	 * @param {*} events 			Eventhandler to send events to
	 * @param {*} options     Elroy connection information
	 */
  static RemoveDeploymentEnvironments(clusterDefs, events, options) {
    events.emitDebug(`Getting list of DeploymentEnvironments from Elroy...`);
    const _self = this;
    const req = {
      uri: options.elroyUrl + "/api/v1/deployment-environment",
      headers: {
        "X-Auth-Token": options.elroySecret
      },
      qs: {
        limit: MaxCount
      },
      json: true
    };
    return request(req)
      .then(res => {
        if (res.count > MaxCount) {
          events.emitFatal(
            `DeploymentEnvironments returned to many Environments: ${res.count}`
          );
          return;
        }
        // If we load to few clusters from the file systems, something is wrong. Typically only 1-2 clusters
        // are deactivated at any one time, but the res contains existing inactive clusters - approx 15 at last check.
        // this is not ideal, but should keep a mass in activation from happening.
        if (clusterDefs.length < res.count - 50) {
          events.emitInfo(
            `To few cluster definitions to process ${clusterDefs.length} vs returned environments ${res.count}, skipping...`
          );
          return;
        }
        events.emitInfo(
          `Checking ${res.count} Clusters against definitions ${clusterDefs.length}`
        );
        let toDeactivate = [];
        res.items.forEach(function(deployEnv) {
          let found = _.some(clusterDefs, [
            "cluster.metadata.name",
            deployEnv.name
          ]);
          // If we dont find it in the cluster defs and it is active, deactivate it
          if (!found && deployEnv.active) {
            events.emitInfo(`Deactivating Cluster ${deployEnv.name}`);
            deployEnv.active = false;
            toDeactivate.push(_self.updateCluster(deployEnv, events, options));
          }
        });
        events.emitInfo(`Cluster count deactivated: ${toDeactivate.length}`);
        return Promise.all(toDeactivate);
      })
      .catch(err => {
        throw err;
      });
  }

  /**
	 * Saves the given cluster definition to an external Elroy instance. Returns a promise that is resolved on success.
	 *
	 * @param {[type]} def          Cluster Definition
	 */
  static SaveToElroy(def, events, options, retryCount) {
    const _self = this;
    return Promise.try(() => {
      const cluster = _self.populateCluster(def);

      return _self
        .retrieveCluster(cluster, events, options)
        .then(res => {
          events.emitDebug(`Updating Cluster ${cluster.name} to Elroy...`);
          return _self.updateCluster(cluster, events, options);
        })
        .catch(reason => {
          if (_self.isRequestError(reason)) {
            if (_self.isGetNotFound(reason)) {
              events.emitDebug(`Saving Cluster ${cluster.name} to Elroy...`);
              return _self.createCluster(cluster, events, options);
            }
          }
          if (!retryCount) {
            retryCount = 0;
          }
          if (reason.response.statusCode >= 502 && retryCount < 3) {
            retryCount++;
            return Promise.delay(500).then(() => {
              return _self.SaveToElroy(def, events, options, retryCount);
            });
          }
          throw reason;
        });
    });
  }

  static createCluster(cluster, events, options) {
    return request({
      simple: true,
      method: "POST",
      uri: options.elroyUrl + "/api/v1/deployment-environment",
      headers: {
        "X-Auth-Token": options.elroySecret
      },
      body: cluster,
      json: true
    }).then(res => {
      events.emitDebug(`Successfully added Cluster ${cluster.name} to Elroy`);
      return res;
    });
  }

  static updateCluster(cluster, events, options) {
    return request({
      method: "PUT",
      uri: options.elroyUrl + "/api/v1/deployment-environment/" + cluster.name,
      headers: {
        "X-Auth-Token": options.elroySecret
      },
      body: cluster,
      json: true
    })
      .then(res => {
        events.emitInfo(
          `Successfully updated Cluster ${cluster.name} to Elroy`
        );
        return res;
      })
      .catch(updateReason => {
        events.emitWarn(
          `Error updating Cluster ${cluster.name} to Elroy: ${updateReason}`
        );
        throw updateReason;
      });
  }

  static retrieveCluster(cluster, events, options) {
    return request({
      method: "GET",
      uri: options.elroyUrl + "/api/v1/deployment-environment/" + cluster.name,
      headers: {
        "X-Auth-Token": options.elroySecret
      },
      json: true
    })
      .then(res => {
        events.emitInfo(
          `Successfully retrieved Cluster ${cluster.name} from Elroy`
        );
        return res;
      })
      .catch(res => {
        events.emitWarn(
          `Error retrieving Cluster ${cluster.name} to Elroy: ${res}`
        );
        throw res;
      });
  }

  // populate Elroy cluster
  static populateCluster(def) {
    return {
      name: def.cluster.metadata.name,
      tier: def.cluster.metadata.type,
      active: def.cluster.metadata.active || true, // Clusters are active by default
      metadata: def.cluster.metadata,
      kubernetes: {
        cluster: def.cluster.metadata.cluster,
        namespace: def.cluster.metadata.namespace,
        server: def.server,
        resourceConfig: def.rsConfig
      },
      resources: this.populateResources(def.resources())
    };
  }

  // Populate resources in new format
  static populateResources(resources) {
    let result = {};
    _.each(resources, (resource, name) => {
      // Only include the resource if it's NOT disabled
      if (!resource.disable) {
        delete resource.disable;
        let config = {};
        _.extend(config, resource);
        result[name] = { config: config };
      }
    });
    return result;
  }

  static isRequestError(reason) {
    return (
      reason.response && reason.response.statusCode && reason.response.request
    );
  }

  static isGetNotFound(reason) {
    return (
      reason.response.request.method === "GET" &&
      reason.response.statusCode == 404
    );
  }
}
module.exports = ElroySync;
