"use strict";

const _ = require("lodash");

class FeatureFlag {
  constructor() {
    this.flags = _.split(process.env.FEATURES_ACTIVED, ",");
  }

  isEnabled(feature) {
    return _.includes(this.flags, feature);
  }
}

module.exports = FeatureFlag;
