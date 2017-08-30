"use strict";

const _ = require("lodash");
const request = require("request-promise");
const errors = require("request-promise/errors");
const Promise = require("bluebird");

const MaxCount = 300;

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
        }
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
      // Format for elroy
      const cluster = {
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
        resources: {}
      };
      // Populate resources in new format
      _.each(def.cluster.resources, (resource, name) => {
        // Only include the resource if it's NOT disabled
        // TODO: include resource data in config
        if (!resource.disable) {
          cluster.resources[name] = {
            config: {}
          };
        }
      });
      events.emitDebug(`Saving Cluster ${cluster.name} to Elroy...`);
      return _self.createCluster(cluster, events, options).catch(reason => {
        if (reason.response && reason.response.statusCode) {
          // If error is because it already exists, lets do an update
          if (reason.response.statusCode == 409) {
            return _self.updateCluster(cluster, events, options);
          }
          // validation problem , ie the tier doesn't exists
          if (reason.response.statusCode == 404) {
            events.emitDebug(
              `Problem syncing the cluster ${cluster.name} with tier ${cluster.tier} to Elroy: 404`
            );
            return;
          }
          if (!retryCount) {
            retryCount = 0;
          }
          if (reason.response.statusCode == 504 && retryCount < 3) {
            retryCount++;
            events.emitWarn(
              `Problem syncing the cluster ${cluster.name} with tier ${cluster.tier} to Elroy: 504, retrying ${retryCount}`
            );
            return Promise.delay(500).then(() => {
              return _self.SaveToElroy(def, events, options, retryCount);
            });
          }
        }
        events.emitWarn(
          `Error adding Cluster ${cluster.name} to Elroy: ${reason}`
        );
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
        events.emitDebug(
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
}
module.exports = ElroySync;
