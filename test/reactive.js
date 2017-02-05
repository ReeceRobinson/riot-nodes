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
 * Trim the given `str`.
 *
 * @api private
 * @param {string} str
 * @return {string}
 */
function trim(str) {
    if(str === undefined) {
        return;
    }
    return str.replace(/^\s+|\s+$/g, '');
};

/**
 * Map an iCal event structure to a view model projection.
 * @param event
 * @returns {{id: number, title: string, room: string, command: string, start: *, end: *, updated: *, actionedStart: boolean, actionedEnd: boolean}}
 */
function mapEvent(event) {
   return {
        'id': event.uid,
        'title': trim(event.summary),
        'room': (event.location === undefined) ? "" : trim(event.location),
        'command': (event.description === undefined) ? "" : trim(event.description),
        'start': event.dtstart,
        'end': event.dtend,
        'updated': event.dtstamp
    };
}

/**
 * Convert an event to one or more view model events based on the rruleDates collection it may contain.
 * @param event
 * @returns {Array}
 */
function simpleEvents(event) {
    var events = [];
    // Check to see if there are multiple rruleDates and handle them.
    if(event.rruleDates !== undefined && event.rruleDates.length > 0) {
        for (var i = 0; i < event.rruleDates.length; i++) {
            var duration = event.dtend - event.dtstart;
            var simpleEvent = mapEvent(event);
            simpleEvent.start = event.rruleDates[i];
            simpleEvent.end = new Date(event.rruleDates[i].getTime()+duration);
            events.push(simpleEvent);
        }

    } else {
        events.push( mapEvent(event) );
    }
    return events;
}

/**
 * Parse the caldav document response.
 * @param data
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

/**
 * Process the rrules for this event and add start dates to the rrules date collection if the
 * start date is between the after and before parameter values.
 * @param event
 * @param a
 * @param b
 * @returns {*}
 */
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

/**
 * Filter an event based on the rrules dates if prescent or the start date of a non-repeating event.
 * @param event
 * @param a
 * @param b
 * @returns {*}
 */
function filterRRules(event, a, b) {
    if (event.rruleDates !== undefined) {
        if (event.rruleDates.length > 0) {
            // The fact that there are rruleDates means that the event is between the after and before dates.

            //var source = Rx.Observable.from(event.rruleDates);
            //source.subscribe(
            //    function (x) {
            //        console.log(after);
            //        console.log(before);
            //        console.log(event.rule.options.byhour + ':' + event.rule.options.byminute);
            //    },
            //    function (err) {
            //    },
            //    function () {
            //    }
            //);
            return event;
        } else {
            // Given there is an empty rruleDates array means that this event should be filtered out.
            return null;
        }
    } else {
        // This is a non-repeating event so just check the start date
        if(event.dtstart > a && event.dtstart < b) {
            return event;
        } else {
            return null;
        }
    }
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
            .filter(event => filterRRules(event, after, before) )
            .flatMap(simpleEvents);

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