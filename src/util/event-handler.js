"use strict";

const EventEmitter = require("events");

class DeploymentizerEmitter extends EventEmitter {
  constructor() {
    super();
    this.DEBUG = "debug";
    this.INFO = "info";
    this.WARN = "warn";
    this.FATAL = "fatal";
  }

  emitInfo(msg) {
    this.emit(this.INFO, msg);
  }

  emitWarn(msg) {
    this.emit(this.WARN, msg);
  }

  emitFatal(msg) {
    this.emit(this.FATAL, msg);
  }

  emitDebug(msg) {
    this.emit(this.DEBUG, msg);
  }
}
const deploymentizerEmitter = new DeploymentizerEmitter();

module.exports = deploymentizerEmitter;
