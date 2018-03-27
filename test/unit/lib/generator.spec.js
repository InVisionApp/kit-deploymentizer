"use strict";

const os = require("os");
const Promise = require("bluebird");
const YamlHandler = require("../../../src/util/yaml-handler");
const EventHandler = require("../../../src/util/event-handler");
const Generator = require("../../../src/lib/generator");
const fse = require("fs-extra");
const path = require("path");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
chai.should();
const expect = chai.expect;

const configStub = {
  fetch: function() {
    return Promise.resolve({
      env: [
        { name: "ENV_ONE", value: "value-one" },
        { name: "ENV_TWO", value: "value-two" },
        { name: "ENV_THREE", value: "value-three" },
        { name: "ENV_FOUR", value: "value-four" }
      ]
    });
  }
};

describe("Generator", () => {
  it("should not fail with empty cluster", () => {
    return YamlHandler.loadClusterDefinitions(
      "./test/fixture/empty-clusters"
    ).should.be.fulfilled.then(clusterDefs => {
      const clusterDef = clusterDefs[0];
      const generator = new Generator(
        clusterDef,
        {},
        "",
        os.tmpdir(),
        true,
        configStub,
        "testrosie",
        new EventHandler()
      );
      return generator.process().should.be.fullfilled;
    });
  });

  it("should create valid service file with valid cluster", () => {
    return YamlHandler.loadClusterDefinitions(
      "./test/fixture/clusters"
    ).should.be.fulfilled.then(clusterDefs => {
      const clusterDef = clusterDefs[1];
      const generator = new Generator(
        clusterDef,
        {},
        "./test/fixture/resources",
        os.tmpdir(),
        true,
        configStub
      );
      if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
        fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
      }
      // manually merge this here
      clusterDef.configuration().svc = clusterDef.resources().auth.svc;

      generator
        .processService(clusterDef.resources().auth, clusterDef.configuration())
        .should.be.fulfilled.then(() => {
          YamlHandler.loadFile(
            path.join(os.tmpdir(), clusterDef.name(), "auth-svc.yaml")
          ).should.be.fulfilled.then(svc => {
            const expected = {
              apiVersion: "v1",
              kind: "Service",
              metadata: { name: "auth-svc", labels: { app: "invisionapp" } }
            };
            Promise.resolve(svc).should.eventually.deep.equal(expected);
          });
        });
    });
  });

  describe("Local configuration", () => {
    const testingImage = "SOME-TESTING-IMAGE:branch-abc1";
    const developImageSHA = "abc2";
    const developImage = `SOME-DEVELOP-IMAGE:branch-${developImageSHA}`;
    const imageResources = {
      "node-auth": {
        testing: { image: testingImage },
        develop: { image: developImage }
      }
    };

    it("should send event to DD without SHA", () => {
      let events = new EventHandler();

      events.on("metric", function(msg) {
        expect(msg.kind).to.equal("event");
      });

      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(false);
          });
        }
      };

      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          configStub,
          undefined,
          events,
          undefined,
          undefined,
          undefined,
          mockLaunchDarkly
        );
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";

        return generator._createLocalConfiguration(
          clusterDef.configuration(),
          "auth",
          clusterDef.resources().auth
        ).should.be.fulfilled;
      });
    });

    it("should create copy of config, merging in values from resource", () => {
      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(false);
          });
        }
      };

      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          configStub,
          undefined,
          new EventHandler(),
          undefined,
          undefined,
          undefined,
          mockLaunchDarkly
        );

        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            "auth",
            clusterDef.resources().auth
          )
          .should.be.fulfilled.then(localConfig => {
            expect(localConfig).to.exist;
            expect(localConfig.svc).to.exist;
            expect(localConfig).to.not.equal(clusterDef.configuration());
            expect(localConfig.name).to.equal("auth");
            expect(localConfig["auth-con"].image).to.equal(developImage);
            expect(localConfig["auth-con"].env).to.include({
              name: "test",
              value: "testvalue"
            });
            expect(localConfig["auth-con"].env).to.include({
              name: "ENV_ONE",
              value: "value-one"
            });
            expect(localConfig["auth-con"].env).to.include({
              name: "ENV_THREE",
              value: "value-three"
            });
          });
      });
    });

    it("should create copy of config, without plugin", () => {
      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(false);
          });
        }
      };

      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          new EventHandler(),
          undefined,
          undefined,
          undefined,
          mockLaunchDarkly
        );
        expect(clusterDef).to.exist;

        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            "auth",
            clusterDef.resources().auth
          )
          .should.be.fulfilled.then(localConfig => {
            expect(localConfig).to.exist;
            expect(localConfig.svc).to.exist;
            expect(localConfig).to.not.equal(clusterDef.configuration());
            expect(localConfig["auth-con"].name).to.equal("auth");
            expect(localConfig["auth-con"].image).to.equal(developImage);
            expect(localConfig["auth-con"].env).to.include({
              name: "test",
              value: "testvalue"
            });
            expect(localConfig["auth-con"].env).to.not.include({
              name: "ENV_ONE",
              value: "value-one"
            });
          });
      });
    });

    it("should set the image as commitId when is passed in for one container", () => {
      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(true);
          });
        }
      };
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const sha = "3154cf1fff0c547c9628c266f6c013b53228fdc8";
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          new EventHandler(),
          undefined,
          undefined,
          sha,
          mockLaunchDarkly
        );
        expect(clusterDef).to.exist;

        // image_tag needed, since we dont preload the base cluster def in this test
        let auth = clusterDef.cluster.resources["auth"];
        auth.containers["auth-con"].image_tag = "invision/auth";

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            "auth",
            clusterDef.resources().auth
          )
          .should.be.fulfilled.then(localConfig => {
            expect(localConfig).to.exist;
            expect(localConfig.svc).to.exist;
            expect(localConfig["auth-con"].image).to.equal(
              `quay.io/invision/auth:release-${sha}`
            );
          });
      });
    });

    it("should throw an error when no primary set for service with 2 containers and commitId is passed in", () => {
      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(true);
          });
        }
      };

      const serviceName = "auth-two-containers";
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const sha = "3154cf1fff0c547c9628c266f6c013b53228fdc8";
        const clusterDef = clusterDefs[3];

        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          new EventHandler(),
          undefined,
          undefined,
          sha,
          mockLaunchDarkly
        );
        expect(clusterDef).to.exist;

        // image_tag needed, since we dont preload the base cluster def in this test
        const resource = clusterDef.cluster.resources[serviceName];
        resource.containers[serviceName + "-con"].image_tag =
          "invision/" + serviceName;

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            serviceName,
            resource
          )
          .should.be.rejectedWith(
            "No primary set for the resource auth-two-containers with containers > 1"
          );
      });
    });

    it("should set the image when primary set for service with 2 containers and commitId is passed in", () => {
      const mockLaunchDarkly = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(true);
          });
        }
      };

      const serviceName = "auth-two-containers";
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const sha = "3154cf1fff0c547c9628c266f6c013b53228fdc8";
        const clusterDef = clusterDefs[3];

        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          new EventHandler(),
          undefined,
          undefined,
          sha,
          mockLaunchDarkly
        );
        expect(clusterDef).to.exist;

        // image_tag and primary needed, since we dont preload the base cluster def in this test
        const resource = clusterDef.cluster.resources[serviceName];
        let primaryContainer = resource.containers[serviceName + "-con"];
        primaryContainer.image_tag = "invision/" + serviceName;
        primaryContainer.primary = true;

        let secondaryContainer =
          resource.containers[serviceName + "-datadog-con"];
        secondaryContainer.image_tag = "invision/" + serviceName + "-datadog";
        secondaryContainer.primary = false;

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            serviceName,
            resource
          )
          .should.be.fulfilled.then(localConfig => {
            expect(localConfig).to.exist;
            expect(localConfig.svc).to.exist;
            expect(localConfig[serviceName + "-con"].image).to.equal(
              `quay.io/invision/auth-two-containers:release-${sha}`
            );
          });
      });
    });

    it("should set the image as default when error in launchdarkly even whether commitId is passed in", () => {
      const mockFlagError = {
        toogle: function(feature) {
          return new Promise((resolve, reject) => {
            return resolve(false); // our ld client resolve to false always when ld has an internal error
          });
        }
      };
      let events = new EventHandler();

      events.on("metric", function(msg) {
        expect(msg.kind).to.equal("event");
        expect(msg.text).to.contains("launchdarkly error");
      });

      const serviceName = "auth";
      return YamlHandler.loadClusterDefinitions(
        "./test/fixture/clusters"
      ).should.be.fulfilled.then(clusterDefs => {
        const sha = "abc2"; //matching the same commitId as defined above in imageResources
        const clusterDef = clusterDefs[3];

        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          events,
          undefined,
          undefined,
          sha,
          mockFlagError
        );
        expect(clusterDef).to.exist;

        // image_tag needed, since we dont preload the base cluster def in this test
        let auth = clusterDef.resources().auth;
        auth.containers[serviceName + "-con"].image_tag = "node-auth";

        return generator
          ._createLocalConfiguration(
            clusterDef.configuration(),
            serviceName,
            auth
          )
          .should.be.fulfilled.then(localConfig => {
            expect(localConfig).to.exist;
            expect(localConfig.svc).to.exist;
            expect(localConfig[serviceName + "-con"].image).to.be.equal(
              developImage
            );
          });
      });
    });
  });

  describe("Verifying commit SHA", () => {
    const resourceConfig = {
      con1: {
        image: "image1:branch-abc1"
      },
      con2: {
        image: "image2:branch-abc2"
      }
    };

    it("should ignore blank commitId", () => {
      return Promise.resolve(
        Generator._verifyImagesForCommitId(resourceConfig)
      ).should.be.fulfilled.then(() => {
        return Promise.resolve(
          Generator._verifyImagesForCommitId(resourceConfig, null)
        ).should.be.fulfilled;
      });
    });

    it("should ignore a ResourceConfig with no containers", () => {
      return Promise.resolve(Generator._verifyImagesForCommitId({}, "abc1"))
        .should.be.fulfilled;
    });

    it("should fail for the wrong commitId", () => {
      try {
        Generator._verifyImagesForCommitId(resourceConfig, "wrong");
      } catch (err) {
        expect(err.message).to.be.equal(
          `This kit manifest generation was for commitId 'wrong', but none of the SHAs from images (abc1,abc2) match that.`
        );
      }
    });

    it("should succeed for the right commitId(s)", () => {
      return Promise.resolve(
        Generator._verifyImagesForCommitId(resourceConfig, "abc1")
      ).should.be.fulfilled.then(() => {
        return Promise.resolve(
          Generator._verifyImagesForCommitId(resourceConfig, "abc2")
        ).should.be.fulfilled;
      });
    });
  });
});
