# kit-deploymentizer
**[DEPRECATED] Thanks for using this package, but we will no longer support it.**


![Team](https://img.shields.io/badge/team-container_application_lifecycle-lightgrey.svg)
![Status](https://img.shields.io/badge/status-live-green.svg)
[![Slack](https://img.shields.io/badge/slack-%23docker--kubernetes-blue.svg)](https://invisionapp.slack.com/messages/docker-kubernetes/)
[![Codeship](https://codeship.com/projects/1106f660-adcb-0133-cbe3-167728a5fef7/status?branch=master)](https://codeship.com/projects/132140)

This will be a docker image that will intelligently build deployment files as to allow reusability of environment variables and other forms of configuration. It will also support aggregating these deployments for multiple clusters. In the end, it will generate a list of clusters and a list of deployment files for each of these clusters.

## How it works

The `deploymentizer` uses a combination of ``*-cluster.yaml` files for cluster information, `*-var.yaml` files for configuration, and Mustache templates to generate the deployment files for a Kubernetes cluster. The `deploymentizer` also supports external services for retrieving ENV values that are passed to the templates during generation.

Deploymentizer uses base cluster definition files to define the over-all set of services and the configuration variables that will be used to generate the deployment files. Default values can be set here with the ability to override at the cluster type, and specific cluster level. ENV values are loaded from a external service. This service is loaded as an external plugin at runtime and the returned values are injected during template rendering.

Each cluster has its own `cluster.yaml` and _optional_ `configuration-var.yaml` file that is used to override and extend the base cluster definition. The cluster file can be used to set the default branch to use for that cluster as well as the list of services to override or exclude.

The `type` configuration files can be used to override/set default values based on which type of cluster is being deployed (testing, staging, production). This value is defined in the `cluster.yaml` file.

The `image` files contain the docker image to use for each service. This is based on which branch the cluster (or individual service) is set to. This value is injected when rendering the template along with the other variables.

When the `deploymentizer` is run, it will load the base-* files, the list of images, and the individual type files. Then it will load each cluster file, asynchronously merging in the base cluster definition, then the type configuration. Precedence goes from base -> type -> cluster with cluster overriding other values. Once that is complete it will render each template to a deployment/service file.

### Base Setup

An example directory layout would look like:

```sh
./manifests
  kit.yaml
  base-cluster.yaml
  base-var.yaml
  ./clusters
    ./[CLUSTER-NAME]
      ./cluster.yaml
      ./configuration-var.yaml
    ./[CLUSTER-NAME]
    ...
  ./resources/
    ./base-svc.yaml # This is the service template that is shared by all services that require a service
    ./[RESOURCE-NAME]
      ./[RESOURCE-NAME]-deployment.mustache
    ./[RESOURCE-NAME]
    ...
  ./type
    ./develop-var.yaml
    ./production-var.yaml
    ...
  ./images/invision
    ./[IMAGE-RESOURCE-NAME] # This comes from the base-cluster `resources.[RESOURCE].image_tag` field for each service.
      ./develop.yaml
      ./master.yaml
      ./release.yaml
      ...
    ./[IMAGE-RESOURCE-NAME]
    ...
./generated # This is where the generated file are saved
  ./[CLUSTER-NAME] # This comes from the `metadata.name` value of the cluster definition.
```

### Key Files and types

This section describe the files used by the `deploymentizer` to render the cluster manifest files. These files are expected to exist in the `LOAD` directory passed in at startup.

##### configuration default name: kit.yaml

This is a small configuration file used to configure paths and the plugin to be used by Deploymentizer. You can specify the file by passing in the `--conf` flag at startup. This is used to set the paths for the various files and configure the plugin used for loading env configuration. Paths can be a combination or relative or absolute paths. If relative, you can supply a `workdir` option from the command line to define the working directory, otherwise assumed to be the `$pwd`.

Default `kit.yaml` looks like:
```
version: '2'
base:
  path: /manifests
images:
  path: /manifests/images
  property: image
type:
  path: ./type
cluster:
  path: /manifests/clusters
resources:
  path: /manifests/resources
output:
  path: /generated
plugin:
  path: /src/plugin/env-api
```

##### base-cluster.yaml

Defines the over all list of resources.
These are included by default in all local cluster configuration unless explicitly disabled.


```
kind: ClusterNamespace
metadata:
  name: base
  branch: develop
resources:
  # Secrets
  docker-quay-secret:
    file: ./resources/secrets/docker-quay-secret.yaml

  # Application Resources
  auth:
    file: ./resources/auth/auth-deployment.mustache
    svc:
      name: auth-svc
      labels:
        - name: "app"
          value: "invisionapp"
        - name: "tier"
          value: "frontend"
        - name: "role"
          value: "service"
    containers:
      auth-con:
        image_tag: node-auth

  activity:
    file: ./resources/activity/activity-deployment.mustache
    image_tag: node-activity
    svc:
    ...
```

The `kind: ClusterNamespace` is used to determine what type of file this is (vs a `kind: ResourceConfig` for configuration). This file should list all deployable application resources. Each resource should contain at minimum a file, image_tag. If the resource requires a service, the values for that should be configured here also.
* file defines the path to the resources musache template or yaml file if the file does not use a template.
* image_tag indicates the name of the image directory that contains the `image` container values. NOTE: these are different than the Application Resource names.
* svc (Optionally) configuration for a Service. If not present, no service will be generated.

##### base-var.yaml

Defines default configuration information for our kubernetes deployments.

Example base-var.yaml might look like:

```
kind: ResourceConfig
# Deployment specific defaults
deployment:
  replicaCount: 3
  imagePullPolicy: IfNotPresent
  livenessProbe:
    path: /healthcheck
    port: 80
    initialDelaySeconds: 30
    timeoutSeconds: 3
  containerPort: 80
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 1
imagePullSecrets:
  - secret: docker-quay-secret
  - secret: docker-registry-secret

```
All values in this file are converted into data that is passed to the template rendering engine. All of these values can be overridden at the `type` or `cluster` level.

* `kind: ResourceConfig` indicates a resource configuration file (vs a cluster file).


##### `type/*-var.yaml`

This is used to override values for a cluster of a given type. For example you can set the image pull policy and replicaCount for all develop clusters.

An example *type* file:
```
# Cluster Type specific Configuration.
#
kind: ResourceConfig
metadata:
  type: develop
deployment:
  replicaCount: 5
  imagePullPolicy: Always
```

##### `*-cluster.yaml` files
Cluster specific files are used to override any values needed for a specific cluster. At the minimum it should contain the `kind`, and `metadata.(name, branch, type)` fields. This lets you override specific Resources, setting branch, disabling or adding specific ENV values.

Supported `metadata`
```
metadata:
  name: [Name of Cluster - required]
  branch: [Branch used for deployment of cluster, can be overridden at the resource level]
  type: [ type of cluster, used to import type specific deployment information, and can be used to limit which clusters are generated]
  disable: [ set to true to have deploymentizer skip processing of this cluster ]
```
An example file would look like:

```
kind: ClusterNamespace
metadata:
  name: example-1
  branch: master
  type: develop
resources:
  # auth
  auth:
    containers:
      auth-con:
        branch: develop
        env:
          - name: [ENV_NAME]
            value: [ENV_VALUE]
          - name: [ENV_NAME]
            external: true
            encoding: base64

  activity:
    disable: false
```
You can override individual resource values here, including which branch a resource should be deployed from, deployment specific values, and ENVs that are only for this `cluster.resource`. ENVs can be both externally defined (at build time) or predefinded here.

*External ENVs* are environment variables that are only available at build time. This allows the `deploymentizer` to generate a manifest using env values that may be too sensitive to commit to SourceControl. For example create a kubernetes secret from a template with the values injected at build time.

The name of the external ENV must match the defined name in the `resource.[RESOURCE-NAME].env.name` definition.

##### Disable a Service
By default any resource defined in a cluster is considered enabled. You can explicitly change this by setting the value `disable: true`.  
For example, in order to disable a service for a specific cluster, add the `resources.[RESOURCE-NAME].disable: true`. This will keep the `deploymentizer` from generating a deployment/service file for that specific resource.
If managing lots of clusters, it can be helpful to define your resource in the base cluster file, but configure it as `disable: true` initially. Then only enable it for clusters your want that service deployed on.
The other option is to configure it in the base cluster as `disable: false` and enabled it specifically for each cluster.

##### Adding a Service
You can add a service just for the cluster by defining the values here. This would allow you to test a service only on a specific cluster before rolling it out to all clusters. The required fields would be:

```
resources:
  ...
  [RESOURCE-NAME]:
    file: [PATH-TO-MUSTACHE-TEMPLATE]
    svc:
      name: [SERVICE-NAME]
      labels:
        - name: [KEYS]
          value: [VALUES]
```

The cluster specific configuration file is optional. If defined it would override the configuration defined by the Base/Type files. An example would be:

```
# Cluster specific Configuration
#
kind: ResourceConfig
```
### Templates

Current implementation uses the Mustache template engine to render the templates. Documentation for Mustache can be found at [http://mustache.github.io/](http://mustache.github.io/).

For an example the base-svc.mustache file looks like:

```
apiVersion: v1
kind: Service
metadata:
  name: {{{svc.name}}}
  labels:
  {{#svc.labels}}
    {{{name}}}: {{{value}}}
  {{/svc.labels}}
spec: {{{! If Ports are not defined, default to below }}}
  {{svc.ports}}
  {{^svc.ports}}
  ports:
    - name: web
      port: 80
      protocol: TCP
    - name: web-ssl
      port: 443
      protocol: TCP
  {{/svc.ports}}
  selector:
    name: {{{name}}}-pod
  {{svc.clusterIP}}

```


#### Mapping configuration in template
This is an example of the values passed to the mustache template engine to render. This example is from the test data located in the `/test/fixtures` directory.
``` json
{
    "kind": "ResourceConfig",
    "metadata": {
        "type": "test"
    },
    "deployment": {
        "replicaCount": 2,
        "imagePullPolicy": "IfNotPresent",
        "livenessProbe": {
            "path": "/healthcheck",
            "port": 80,
            "initialDelaySeconds": 30,
            "timeoutSeconds": 3
        },
        "containerPort": 80,
        "rollingUpdate": {
            "maxUnavailable": 1,
            "maxSurge": 1
        }
    },
    "imagePullSecrets": [
        {
            "secret": "docker-quay-secret"
        },
        {
            "secret": "docker-registry-secret"
        }
    ],
    "env": null,
    "branch": "develop",
    "name": "auth",
    "auth-con": {
        "image_tag": "invision/node-auth",
        "name": "auth",
        "annotations": {
            "kit-deploymentizer/env-api-service": "node-auth"
        },
        "env": [
            {
                "name": "test",
                "value": "testvalue"
            },
            {
                "name": "ENV_ONE",
                "value": "value one"
            },
            {
                "name": "ENV_TWO",
                "value": "value two"
            },
            {
                "name": "ENV_THREE",
                "value": "value three"
            }
        ],
        "branch": "master",
        "deployment": {
            "replicaCount": 10
        },
        "image": "quay.io/invision/node-auth:master-42e7122a0718e25b"
    },
    "svc": {
        "name": "auth-svc",
        "labels": [
            {
                "name": "app",
                "value": "invisionapp"
            }
        ]
    }
}
```

#### Plugin For ENV configuration
The plugin module should export a class that will be instantiated passing in any parameters defined in the
kit configuration file loaded by the deploymentizer to the objects constructor.

The class must contain a function named `fetch`, accepting the parameters `( service, cluster )`.
Service is the resource container object, and cluster is the cluster name as defined by the `ClusterNamespace.metadata.name`.

Example usage:
```
const envConfig = new EnvConfig(options);
envConfig.fetch( serviceName, cluster );
```
The `fetch` function must return a Promise. Promises will be converted to bluebird promise via `Promise.resolve(envService.fetch( serviceName, environment, cluster ))`

Any configuration values needed by the plugin should be supplied via the configuration file loaded by the deploymentizer at startup. This should also include the path the plugin to load. Example configuration file for the plugin:
```
plugin:
  path: ./src/plugin/file-config
  options:
    configPath: "/test/fixture/config"
```

Calling this with any invalid values (ie wrong service, cluster) should return a error and will stop processing.

This will be required at system startup and executed _asynchronously_ for every Resource listed in the cluster definition.

Any values returned from the Plugin are merged into the configuration before the template is rendered.

#### Support for Secrets

The `deploymentizer` will need to support generating a kubernetes secret file in a secure fashion. The `deploymentizer` supports reading ENVs at build time. These ENV's will be injected into the configuration that will be passed into the template engine for the resources template.

Note: Kubernetes Secret values will need to be base64 encoded before being passed to the template for generation.

#### Support for Service only

You can create a service without an associated `deployment` resource. Include the .svc at the resource level and do not include a resource.file value.

#### Limiting Cluster generation

If you have a large number of clusters you can limit the clusters that generated to save time and resources. There are 2 options for doing this, one is to set the type of cluster you want generated. Deploymentizer excepts `clusterType` as an option, and if present will only generate clusters that have the matching `metadata.type` tag. The other option is to mark specific clusters as disabled, using the `metadata.disable: true` field.


## Running

As long as you have access to our private docker registry, you can use the image as follows:

1. `docker run --rm quay.io/invision/kit-deploymentizer --help`

This will show you the help information for the deploymentizer command. If you would like to pass in some files to be parsed and have the generated output saved, you can use volumes. The syntax for this would be:

1. `docker run --rm -v <ABSOLUTE_PATH_FOR_GENERATED_FILES>:/generated -v <ABSOLUTE_PATH_TO_CLUSTER_FILES>:/manifests kit-deploymentizer --save true`

## Using as npm module

Add `kit-deploymentizer` to your `package.json` and require it like so:

```js
var Deploymentizer = require("kit-deploymentizer").Deploymentizer;

var deploymentizer = new Deploymentizer({
	save: true,
	output: "/output",
  load: "/manifests"
});

deploymentizer
	.process()
	.then(console.log)
	.catch(console.error)
	.done();
```

## Using as CLI

You can run the `./src/deploymentizer --help` to see how it works.

Note this method requires node and was tested on version `5.5.0`.

## Expected environment variables
The following environment variables are used by this service.

| Variable | Description | Required | Default |
| :--- | :--- | :--- | :--- |
| `CLEAN` | Set if the output directory should be deleted and re-created before generating manifest files | yes | `false` |
| `SAVE` | Sets if the generated manifest files are saved to the output diretory or not | yes | `true` |
| `CONF` | Sets the path the config file to load | yes | `/manifests/kit.yaml` |
| `WORKDIR` | Sets the working directory for reading paths defined in the conf file. Allows absolute paths in conf also. | no | `` |
| `RESOURCE` | Defines specific resource to generate. If not set, generates all resources. | no | `` |
| `CLUSTER_TYPE` | Defines the cluster type to process (testing, production, etc). If not defined processes all clusters found. You cannot define both CLUSTER_TYPE and CLUSTER_NAME at the same time.  | no | `` |
| `CLUSTER_NAME` | Defines the cluster name to process. If not defined processes all clusters found. You cannot define both CLUSTER_TYPE and CLUSTER_NAME at the same time.  | no | `` |
| `DEBUG` | Log debug events | no | `false` |

## Contributing

See the [Contributing guide](/CONTRIBUTING.md) for steps on how to contribute to this project.

## Todo

- [ ] Allow setting the output file name, not the template name. Allow reuse of individual templates (selectsync/mongoreplica examples)
- [ ] Remove dependency on `base` files and allow defining and importing of groups of resources instead
- [ ] Rethink `types`, is this still needed
- [ ] Change `image` handling - this should be more dynamic with services defining which branch/tag to use
- [ ] Allow setting the `svc` template to render
- [ ] Add validation of `yaml` files
- [ ] Allow `kit.yaml` to specify file names
- [x] Allow plugin to define disabled for service
- [x] Use event-handler for logging
- [x] Remove all sync hotspots
- [x] fix hardcoded path, using kit.yaml loader
- [x] Refactor plugin, move parsing of result/new format/support other properties
