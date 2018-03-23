"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
chai.should();
const expect = chai.expect;
const FeatureFlag = require("../../../src/lib/feauture-flag");

describe("FeatureFlag", () => {
  it("should not fail when no FEATURES_ENABLED env", () => {
    const flag = new FeatureFlag();
    expect(flag.isEnabled("nope")).to.be.false;
  });

  it("should split the FEATURES_ENABLED env", () => {
    process.env["FEATURES_ENABLED"] = "one";
    let flag = new FeatureFlag();
    expect(flag.isEnabled("one")).to.be.true;

    process.env["FEATURES_ENABLED"] = "one,two";
    flag = new FeatureFlag();
    expect(flag.isEnabled("one")).to.be.true;
    expect(flag.isEnabled("two")).to.be.true;
    expect(flag.isEnabled("nope")).to.be.false;

    delete process.env["FEATURES_ENABLED"];
  });
});
