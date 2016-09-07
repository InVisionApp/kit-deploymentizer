"use strict";

const expect = require("chai").expect;
const os = require("os");
const path = require("path");
const fse = require("fs-extra");
const Deploymentizer = require("../../../src/lib/deploymentizer");
const yamlHandler = require("../../../src/util/yaml-handler");
const resourceHandler = require("../../../src/util/resource-handler");
const Promise = require("bluebird");

describe("Deploymentizer", () => {
	describe("generate files", () => {
		it("should run successfully", (done) => {

			Promise.coroutine(function* () {
				process.env.SECRET_USERNAME = "myusername";
				process.env.SECRET_PASSWORD = "mypassword";
				process.env.GITHUB_TOKEN = "s@mpler@ndomt0ken";
				fse.mkdirsSync(path.join(os.tmpdir(), "generated"));

				const conf = yield yamlHandler.loadFile("/test/fixture/kit.yaml");
				const deployer = new Deploymentizer ({
						clean: true,
						save: true,
						conf: conf
					});
				expect(deployer).to.exist;
				// generate the files from our test fixtures
				yield deployer.process();
				// load them back in and validate values
				const authSvc = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "test-fixture", "auth-svc.yaml"));
				expect(authSvc).to.exist;
				expect(authSvc.metadata.name).to.equal("auth-svc");
				expect(authSvc.metadata.labels.app).to.exist;
				expect(authSvc.metadata.labels.app).to.equal("invisionapp");

				const auth = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "test-fixture", "auth-deployment.yaml"));
				expect(auth).to.exist;
				expect(auth.metadata.name).to.equal("auth-deployment");
				expect(auth.spec.template.spec.imagePullSecrets).to.include({"name": "docker-quay-secret"});
				expect(auth.spec.replicas).to.equal(2);
				expect(auth.spec.strategy).to.exist;
				expect(auth.spec.strategy.type).to.equal("RollingUpdate");
				expect(auth.spec.strategy.rollingUpdate.maxUnavailable).to.equal(1);
				expect(auth.spec.strategy.rollingUpdate.maxSurge).to.equal(1);
				expect(auth.spec.selector.matchLabels.name).to.equal("auth-pod");
				expect(auth.spec.template.spec.containers[0]).to.exist;
				expect(auth.spec.template.spec.containers[0].name).to.equal("auth-con");
				expect(auth.spec.template.spec.containers[0].imagePullPolicy).to.equal("IfNotPresent");
				expect(auth.spec.template.spec.containers[0].image).to.exist;
				expect(auth.spec.template.spec.containers[0].image).to.contain("master");
				expect(auth.spec.template.spec.containers[0].livenessProbe).to.exist;
				expect(auth.spec.template.spec.containers[0].livenessProbe.initialDelaySeconds).to.equal(30);
				expect(auth.spec.template.spec.containers[0].livenessProbe.timeoutSeconds).to.equal(3);
				expect(auth.spec.template.spec.containers[0].env.length).to.equal(4);
				expect(auth.spec.template.spec.containers[0].env).to.include({"name": "ENV_TWO", "value": "value two"});
				expect(auth.spec.template.spec.containers[0].env).to.include({"name": "test", "value": "testvalue"});

				// This is "disabled" and should not be generated
				expect(fse.existsSync(path.join(os.tmpdir(), "generated", "test-fixture", "activity-deployment.yaml"))).to.equal(false);

				const secret = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "test-fixture", "example-secret.yaml"));
				expect(secret).to.exist;
				expect(secret.data.GITHUB_TOKEN).to.equal("s@mpler@ndomt0ken");
				expect(secret.data.SECRET_USERNAME).to.equal(resourceHandler.encode("myusername", "base64"));
				expect(secret.data.SECRET_PASSWORD).to.equal(resourceHandler.encode("mypassword", "base64"));
				done();
			})().catch( (err) => {
				done(err);
			});
		});

		it("should create multiple clusters and not not mingle image tags", (done) => {

			Promise.coroutine(function* () {
				process.env.SECRET_USERNAME = "myusername";
				process.env.SECRET_PASSWORD = "mypassword";
				process.env.GITHUB_TOKEN = "s@mpler@ndomt0ken";
				fse.mkdirsSync(path.join(os.tmpdir(), "generated"));

				let conf = yield yamlHandler.loadFile("/test/fixture/kit.yaml");
				// remove the plugin 
				delete conf.plugin;

				const deployer = new Deploymentizer ({
						clean: true,
						save: true,
						conf: conf
					});
				expect(deployer).to.exist;
				// generate the files from our test fixtures
				yield deployer.process();
				// load them back in and validate values
				const authOther = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "other-test-fixture", "auth-deployment.yaml"));
				expect(authOther).to.exist;
				expect(authOther.metadata.name).to.equal("auth-deployment");
				expect(authOther.spec.replicas).to.equal(7);
				expect(authOther.spec.template.spec.containers[0]).to.exist;
				expect(authOther.spec.template.spec.containers[0].image).to.exist;
				expect(authOther.spec.template.spec.containers[0].image).to.contain("test");

				const authTest = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "test-fixture", "auth-deployment.yaml"));
				expect(authTest).to.exist;
				expect(authTest.metadata.name).to.equal("auth-deployment");
				expect(authTest.spec.replicas).to.equal(2);
				expect(authTest.spec.template.spec.containers[0]).to.exist;
				expect(authTest.spec.template.spec.containers[0].image).to.exist;
				expect(authTest.spec.template.spec.containers[0].image).to.contain("develop");

				done();
			})().catch( (err) => {
				done(err);
			});
		});

		it("should create single resource for other cluster", (done) => {

			Promise.coroutine(function* () {
				process.env.SECRET_USERNAME = "myusername";
				process.env.SECRET_PASSWORD = "mypassword";
				process.env.GITHUB_TOKEN = "s@mpler@ndomt0ken";
				fse.mkdirsSync(path.join(os.tmpdir(), "generated"));

				let conf = yield yamlHandler.loadFile("/test/fixture/kit.yaml");
				// remove the plugin 
				delete conf.plugin;

				const deployer = new Deploymentizer ({
						clean: true,
						save: true,
						conf: conf,
						resource: "activity"
					});
				expect(deployer).to.exist;
				// generate the files from our test fixtures
				yield deployer.process();
				// load them back in and validate values
				const activityOther = yield yamlHandler.loadFile(path.join(os.tmpdir(), "generated", "other-test-fixture", "activity-deployment.yaml"));
				expect(activityOther).to.exist;
				expect(activityOther.metadata.name).to.equal("activity-deployment");
				expect(activityOther.spec.template.spec.containers[0].image).to.contain("test");
				// not requested
				const authOther = fse.existsSync(path.join(os.tmpdir(), "generated", "other-test-fixture", "auth-deployment.yaml"));
				expect(authOther).to.be.false;
				// disabled in this cluster
				const activityTest = fse.existsSync(path.join(os.tmpdir(), "generated", "test-fixture", "activity-deployment.yaml"));
				expect(activityTest).to.be.false;

				done();
			})().catch( (err) => {
				done(err);
			});
		});
	});
});
