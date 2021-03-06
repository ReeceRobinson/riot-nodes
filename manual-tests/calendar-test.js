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

// Processor helper functions
var rooms = {};

function isUnique(room, entry) {
    if(entry === undefined) {
        return;
    }
    for(var i = 0; i < room.length; i++) {
        if(room[i].type === entry.type && room[i].mode === entry.mode && room[i].time.getTime() === entry.time.getTime()) {
            return false;
        }
    }
    return true;
}

function removeConflicts(events) {
    if(events === undefined || events.length === 0) {
        return events;
    }
    var optimized = [events[0]];
    for( var i = 1; i < events.length; i++) {
        if(events[i].type === 'end') {
            if(events[i-1].time === events[i].time) {
                // this is a redundant event
            } else {
                optimized.push(events[i]);
            }
        }
    }
    return optimized;
}

function optimiseEntries(room) {
    var optimised = [];
    var startArray = [];
    var endArray = [];

    for(var i = 0; i < room.length; i++) {

        if(room[i].type === 'start') {
            if(endArray.length > 0) { // Save the end item as we switch type
                optimised.push(endArray[endArray.length - 1]);
                endArray = [];
            }
            if(i === 0) {
                // This is the first entry so it is added by default.
                startArray.push(room[i]);
            } else if (room[i].mode == room[i - 1].mode) {
                // A redundant start
                startArray.push(room[i]);
            } else {
                if(startArray.length > 0) {
                    optimised.push(startArray[0]);
                    startArray = [];
                }
                startArray.push(room[i]);
            }
        } else { // This is an end item
            if(startArray.length > 0) {
                optimised.push(startArray[0]);
                startArray = [];
            }
            endArray.push(room[i]);
        }
    }
    if(endArray.length > 0) {
        optimised.push(endArray[endArray.length -1]);
    }
    // Finally remove end commands that have the same time as a start command.
    removeConflicts(optimised);
    return optimised;
}

function processor(rooms, event) {
    if(event === undefined) {
        return;
    }
    var room = rooms[event.room]|| [];
    if(!(room instanceof Array) ){
        room = [];
    }
    var start = event.start;
    var end = event.end;
    var mode = event.command;
    var roomname = event.room;

    // Start of event window
    var entry = {
        type:'start',
        time: start,
        mode: mode,
        room: roomname
    };

    if( isUnique(room, entry) ) {
        room.push( entry );
    }

    // end of event window
    entry = {
        type:'end',
        time: end,
        mode: mode,
        room: roomname
    };

    if( isUnique(room, entry)) {
        room.push(entry);
    }

    if(rooms.undefined !== undefined) {
        delete rooms.undefined;
    }

    room.sort(function(a,b){
        return a.time - b.time;
    });

    room = optimiseEntries(room);

    rooms[event.room] = room;
}

/**
 * Calculate the events that are due to be fired. Prune fired events from activeEvents.
 * @param activeEvents
 * @param rooms
 * @returns {*}
 */
function calculateActive(activeEvents,rooms) {
    // Create and maintain the active list
    var keys = Object.keys(rooms);
    for(var i = 0; i < keys.length; i++){
        var roomKey = keys[i];
        // Get the candidate events for this room
        var candidateRoomEvents = rooms[roomKey];

        // If there are existing active events for this room then maintain them.
        if(activeEvents[roomKey] !== undefined) {
            // 1. What is the earliest candidate event for this room? It is a sorted list so it is the first element
            var cutoffTime = candidateRoomEvents[0].time;

            // 2. Find active events at or after the cutoff time.
            var cutoffIndex = -1; // Nothing to prune
            for (var k = 0; k < activeEvents[roomKey].length; k++) {
                if (activeEvents[roomKey][k].time >= cutoffTime) {
                    cutoffIndex = k;
                    break;
                }
            }

            // 3. Prune active events from the cutoff index
            if (cutoffIndex > -1) {
                activeEvents[roomKey] = activeEvents[roomKey].slice(0, cutoffIndex);
            }
        } else {
            activeEvents[roomKey] = [];
        }
        for(var j = 0; j < candidateRoomEvents.length; j++) {
            activeEvents[roomKey].push(candidateRoomEvents[j]);
        }
        // Fire any events that are due and remove them if fired
        var now = new Date();
        var eventsToFire = [];
        var pruneIndex = -1;
        for (var k = 0; k < activeEvents[roomKey].length; k++){
            var event = activeEvents[roomKey][k];
            if(event.time <= now) {
                // build command to emmit for firing
                eventsToFire.push(event.subject+"/command/"+event.room+"/"+event.command);
                pruneIndex = k+1;
            }
        }
        if(pruneIndex > -1) {
            // Prune fired events
            console.log("Pruning fired events: ",activeEvents[roomKey].slice(0,pruneIndex));
            activeEvents[roomKey] = activeEvents[roomKey].slice(pruneIndex);
        }
    }
    console.log("ACTIVE EVENTS: ",activeEvents);
    return eventsToFire;
}
// Stream processing
var requestProto = Rx.Observable.fromNodeCallback(request);

var after = new Date();
var before = new Date(new Date(after).setHours(after.getHours() + 24));

var activeEvents = {};

var disposable = Rx.Scheduler.default.schedulePeriodic(
    0,
    5000, /* 0.1 second */
    function (i) {
        console.log(i);

        // After three times, dispose
        if (++i > 2) { disposable.dispose(); }
        var resp = [];

        var requestStream = requestProto(options)
            .map(r => r[0].toJSON())
            .flatMap(parseCalDav)
            .map(event => parseRRules(event, after, before))
            .filter(event => filterRRules(event, after, before) )
            .flatMap(simpleEvents);

        requestStream.subscribe(
            function(data) {
                resp.push(data);
                //console.log(data);
                //processor(data);
            },
            function(err) {
                console.log(err);
            },
            function(){
                console.log('completed');
                var rooms = {};
                console.log(resp);
                for( var i = 0; i < resp.length; i++) {
                    console.log('processing: ',resp[i]);
                    processor(rooms, resp[i]);
                }
                console.log("ROOMS: ",rooms);

                var eventsToFire = calculateActive(activeEvents,rooms);
                console.log("FIRE: ",eventsToFire);
            }
        );
        return i;
    });

