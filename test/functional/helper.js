"use strict";
var logger = require("log4js").getLogger();
var eventHandler = require("../../src/util/event-handler");

/**
 * Register event listener so we see some output during test runs.
 */
before( () => {

  // Enable logging of all events from the deploymentizer
  eventHandler.on(eventHandler.INFO, function(message) {
  	logger.info(message);
  });
  eventHandler.on(eventHandler.WARN, function(message) {
  	logger.warn(message);
  });
  eventHandler.on(eventHandler.FATAL, function(message) {
  	logger.fatal(message);
  });
	eventHandler.on(eventHandler.DEBUG, function(message) {
		logger.debug(message);
	});
});
