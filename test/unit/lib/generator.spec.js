"use strict";

const os = require("os");
const expect = require("chai").expect;
const Promise = require("bluebird");
const yamlHandler = require("../../../src/util/yaml-handler");
const EventHandler = require("../../../src/util/event-handler");
const Generator = require("../../../src/lib/generator");
const fse = require("fs-extra");
const path = require("path");

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
  describe("with empty cluster", () => {
    it("should not fail", done => {
      return Promise.coroutine(function*() {
        const eventHandler = new EventHandler();
        const clusterDefs = yield yamlHandler.loadClusterDefinitions(
          "./test/fixture/empty-clusters"
        );
        const clusterDef = clusterDefs[0];
        const generator = new Generator(
          clusterDef,
          {},
          "",
          os.tmpdir(),
          true,
          configStub,
          "testrosie",
          eventHandler
        );
        expect(clusterDef).to.exist;
        yield generator.process();
        done();
      })().catch(err => {
        done(err);
      });
    });
  });

  describe("with valid cluster", () => {
    it("should create valid service file", done => {
      return Promise.coroutine(function*() {
        const clusterDefs = yield yamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        const clusterDef = clusterDefs[1];
        const generator = new Generator(
          clusterDef,
          {},
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          configStub
        );
        expect(clusterDef).to.exist;
        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // manually merge this here
        clusterDef.configuration().svc = clusterDef.resources().auth.svc;
        yield generator.processService(
          clusterDef.resources().auth,
          clusterDef.configuration()
        );
        const svc = yield yamlHandler.loadFile(
          path.join(os.tmpdir(), clusterDef.name(), "auth-svc.yaml")
        );
        expect(svc.metadata.name).to.equal("auth-svc");
        expect(svc.metadata.labels.app).to.equal("invisionapp");
        done();
      })().catch(err => {
        done(err);
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

    it("should create copy of config, merging in values from resource", done => {
      const eventHandler = new EventHandler();
      return Promise.coroutine(function*() {
        const clusterDefs = yield yamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          configStub,
          undefined,
          eventHandler
        );
        expect(clusterDef).to.exist;
        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";
        const localConfig = yield generator._createLocalConfiguration(
          clusterDef.configuration(),
          "auth",
          clusterDef.resources().auth
        );
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
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should create copy of config, without plugin", done => {
      const eventHandler = new EventHandler();
      return Promise.coroutine(function*() {
        const clusterDefs = yield yamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          eventHandler
        );
        expect(clusterDef).to.exist;
        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";
        const localConfig = yield generator._createLocalConfiguration(
          clusterDef.configuration(),
          "auth",
          clusterDef.resources().auth
        );
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
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should succeed when commitId is specified", done => {
      const eventHandler = new EventHandler();
      return Promise.coroutine(function*() {
        const clusterDefs = yield yamlHandler.loadClusterDefinitions(
          "./test/fixture/clusters"
        );
        const clusterDef = clusterDefs[3];
        const generator = new Generator(
          clusterDef,
          imageResources,
          "./test/fixture/resources",
          os.tmpdir(),
          true,
          undefined,
          undefined,
          eventHandler
        );
        expect(clusterDef).to.exist;
        if (!fse.existsSync(path.join(os.tmpdir(), clusterDef.name()))) {
          fse.mkdirsSync(path.join(os.tmpdir(), clusterDef.name()));
        }
        // we add the image tag here, since we dont preload the base cluster def in this test
        clusterDef.resources().auth.containers["auth-con"].image_tag =
          "node-auth";
        const localConfig = yield generator._createLocalConfiguration(
          clusterDef.configuration(),
          "auth",
          clusterDef.resources().auth
        );
        expect(localConfig).to.exist;
        done();
      })().catch(err => {
        done(err);
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

    it("should ignore blank commitId", done => {
      return Promise.coroutine(function*() {
        Generator._verifyImagesForCommitId(resourceConfig);
        Generator._verifyImagesForCommitId(resourceConfig, null);
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should ignore a ResourceConfig with no containers", done => {
      return Promise.coroutine(function*() {
        Generator._verifyImagesForCommitId({}, "abc1");
        done();
      })().catch(err => {
        done(err);
      });
    });

    it("should fail for the wrong commitId", done => {
      return Promise.coroutine(function*() {
        Generator._verifyImagesForCommitId(resourceConfig, "wrong");
        done(
          new Error(
            "Expected _verifyImagesForCommitId to throw an error because it was for the wrong commitId."
          )
        );
      })().catch(err => {
        done();
      });
    });

    it("should succeed for the right commitId(s)", done => {
      return Promise.coroutine(function*() {
        Generator._verifyImagesForCommitId(resourceConfig, "abc1");
        Generator._verifyImagesForCommitId(resourceConfig, "abc2");
        done();
      })().catch(err => {
        done(err);
      });
    });
  });
});
