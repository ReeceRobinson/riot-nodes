/*jslint node:true */

/*
 * examples/temperature.js
 * https://github.com/101100/xbee-rx
 *
 * Example showing the use of monitorIODataPackets and some fun RxJS stream
 * manipulation.
 *
 * This requires that you have a node set up to send IO samples about once a second
 * and that a TMP36 is hooked up to the AD0 pin and included in the sample.  This
 * program will average 10 seconds of samples and print them if at least a minute
 * has gone by or the temperature changes.
 *
 * Copyright (c) 2015-2016 Jason Heard
 * Licensed under the MIT license.
 */

"use strict";

var moment = require("moment");
var R = require("ramda");
var rx = require("rx");
var xbeeRx = require("xbee-rx");

var xbee = xbeeRx({
    serialport: "/dev/tty.usbserial-004021",
    serialportOptions: {
        baudrate: 9600
    },
    module: "ZigBee",
    api_mode: 2,
    // turn on debugging to see what the library is doing
    debug: false
});

var lastValue;
var lastMoment;

var temperatureStream = xbee
    .monitorIODataPackets()
    .pluck("analogSamples", "AD2") // extract just the AD2 sample (in millivolts)
    .map(function (mv) { return mv; });
    //.map(function (mv) { return (mv - 500) / 10; }); // convert millivolts to Centigrade

var meanTemperatureStream = temperatureStream
    .buffer(function () { return rx.Observable.timer(5000); }) // collect 5 seconds of packets
    .map(R.mean) // compute the mean of the collected samples
    .map(function (value) { return Math.round(value * 10) / 10; }); // round to 1 decimal place

meanTemperatureStream
    .where(function (value) {
        return value !== lastValue || moment().diff(lastMoment, "seconds") > 10;
    })
    .do(function (value) {
        lastValue = value;
        lastMoment = moment();
    })
    .subscribe(function (value) {
        console.log(new Date(), "measurement:", value);
    }, function (error) {
        console.log("Error during monitoring:\n", error);
        xbee.close();
    }, function () {
        console.log("Monitoring stream ended; exiting.");
        xbee.close();
    });