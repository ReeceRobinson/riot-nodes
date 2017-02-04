"use strict";

var Rx = require("rx");
var request = require('request');
var RRule =  require('rrule-alt').RRule;

var START_EVENT = 'BEGIN:VEVENT';
var END_EVENT = 'END:VEVENT';
let offset = new Date().getTimezoneOffset()/-60;
var TZ_OFFSET = (offset >= 0)?'+'+offset+'00':'-'+offset+'00';
var options = {
    method: 'GET',
    url: 'http://calendar.local:5232/reece/caldav'
};
/**
 * Parse the caldav document response.
 * @param body
 * @returns {Array}
 */
function parseCalDav(data) {
    var events = [];
    var inEvent = false;
    var lines = data.body.split('\n');
    var event = {};

    for( var line = 0; line < lines.length; line++) {
        var text = lines[line];
        if(text === START_EVENT) {
            inEvent = true;
        }

        if( inEvent ) {
            var tuple = text.split(':');
            event[tuple[0].toLowerCase()] = tuple[1];
        }

        if(text === END_EVENT) {
            inEvent = false;
            events.push(event);
            event = {};
        }
    }
    events = parseDateTimeValues(events);
    return events;
}

/**
 * Convert the datetime text into actual Date.
 * @param events
 * @returns {*}
 */
function parseDateTimeValues(events){
    for(var idx = 0; idx < events.length; idx++) {
        var event = events[idx];
        for (var key in event) {
            if (event.hasOwnProperty(key)) {
                if(key.substr(0,2) === 'dt') {
                    var origValue = event[key];
                    // DateTime value that needs to be converted into an actual datetime type.
                    var date_time = event[key].split('T');
                    var date_part = date_time[0];
                    var time_part = date_time[1];
                    var year = date_part.substr(0,4);
                    var month = date_part.substr(4,2);
                    var date = date_part.substr(6,2);
                    var hour = time_part.substr(0,2);
                    var minute = time_part.substr(2,2);
                    var seconds = time_part.substr(4,2);
                    var isoString = year+'-'+month+'-'+date+'T'+hour+':'+minute+':'+seconds+TZ_OFFSET;
                    var newKey = key.split(';')[0];
                    event[newKey] = new Date(isoString);
                    event[newKey+'_orig'] =  origValue;
                }
            }
        }
    }
    return events;
}

function parseRRules(event, a, b){
    if(event.rrule !== undefined) {
        // This event has an associated rule.
        var options = RRule.parseString(event.rrule);
        options.dtstart = event.dtstart;
        event.rule = new RRule(options);
        event.rruleDates = event.rule.between(a, b, true);
    }
    return event;
}

function filterRRules(event, a, b) {
    if (event.rruleDates !== undefined && event.rruleDates.length > 0) {
        var source = Rx.Observable.from(event.rruleDates);
        source.subscribe(
            function(x) {
                console.log(after);
                console.log(before);
                console.log(event.rule.options.byhour+':'+ event.rule.options.byminute);
            },
            function(err) {},
            function() {}
        );
        return event;
    }
    return null;
}

var requestProto = Rx.Observable.fromNodeCallback(request);

var after = new Date();
var before = new Date(new Date(after).setHours(after.getHours() + 48));
var disposable = Rx.Scheduler.default.schedulePeriodic(
    0,
    100, /* 0.1 second */
    function (i) {
        console.log(i);

        // After three times, dispose
        if (++i > 0) { disposable.dispose(); }
        var requestStream = requestProto(options)
            .map(r => r[0].toJSON())
            .flatMap(parseCalDav)
            .map(event => parseRRules(event, after, before))
            .filter(event => filterRRules(event, after, before) );

        requestStream.subscribe(
            function(data) {
                console.log(data);
            },
            function(err) {
                console.log(err);
            },
            function(){
                console.log('completed');
            }
        );
        return i;
    });