/**
 * (c) Reece Robinson 27/01/17.
 */

var Rx = require("rx");
var request = require('request');
var RRule =  require('rrule-alt').RRule;

var START_EVENT = 'BEGIN:VEVENT';
var END_EVENT = 'END:VEVENT';
var LOOK_AHEAD_HOURS = 24;
let offset = new Date().getTimezoneOffset()/-60;
var TZ_OFFSET = (offset >= 0)?'+'+offset+'00':'-'+offset+'00';

var StatusEnum = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    MESSAGE : 'message',
    NONE: ''
};

/**
 * Show the node status in the UI
 * @param node
 * @param state
 * @param msg
 */
function showStatus(node, state, msg){
    if(msg === undefined) {
        msg = "";
    }
    switch (state) {
        case StatusEnum.CONNECT:
            node.status({fill:"green",shape:"dot",text:"connected "+msg});
            break;
        case StatusEnum.DISCONNECT:
            node.status({fill:"red",shape:"ring",text:"disconnected "+msg});
            break;
        case StatusEnum.MESSAGE:
            node.status({text:msg});
            break;
        default:
            node.status({});
            break;
    }

}

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
}

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

/**
 * Test if the entry already exists in the collection.
 * @param room
 * @param entry
 * @returns {boolean}
 */
function isUnique(room, entry) {
    for(var i = 0; i < room.length; i++) {
        if(room[i].type === entry.type && room[i].command === entry.command && room[i].time.getTime() === entry.time.getTime() && room[i].subject === entry.subject) {
            return false;
        }
    }
    return true;
}

/**
 * Remove adjacent start/end events that coinside.
 * @param events
 * @returns {*}
 */
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

/**
 * Resolve the overlaps in events by command.
 * @param room
 * @returns {Array}
 */
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
            } else if (room[i].command == room[i - 1].command) {
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

/**
 * Process a event for control purposes.
 * @param rooms
 * @param event
 */
function processor(rooms, event) {
    var room = rooms[event.room]|| [];
    if(!(room instanceof Array) ){
        room = [];
    }

    // Ensure we have a valid event before processing
    if(event === undefined || event.start === undefined || event.end === undefined || event.command === undefined || event.room === undefined || event.title == undefined) {
        return;
    }

    var start = event.start;
    var end = event.end;
    var command = event.command.toLowerCase();
    var roomname = event.room.toLowerCase();
    var subject = event.title.toLowerCase();

    // Start of event window
    var entry = {
        type:'start',
        time: start,
        command: command,
        room: roomname,
        subject: subject
    };

    if( isUnique(room, entry) ) {
        room.push( entry );
    }

    // end of event window
    entry = {
        type:'end',
        time: end,
        command: command,
        room: roomname,
        subject: subject
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
function calculateActive(activeEvents,rooms, now) {
    // Create and maintain the active list
    var roomKeys = Object.keys(rooms);

    for(var i = 0; i < roomKeys.length; i++){
        var roomKey = roomKeys[i];
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
    }

    var activeKeys = Object.keys(activeEvents);
    var eventsToFire = [];

    for (var i = 0; i < activeKeys.length; i++) {
        var roomKey = activeKeys[i];
        // Fire any events that are due and remove them if fired
        var pruneIndex = -1;
        if(activeEvents[roomKey] !== undefined) {
            for (var k = 0; k < activeEvents[roomKey].length; k++) {
                var event = activeEvents[roomKey][k];
                if (event.time <= now) {
                    // build command to emmit for firing
                    //console.log("Expired Event: ",event);
                    //eventsToFire.push(event.subject + "/command/" + event.room + "/" + event.command + event.type);
                    pruneIndex = k + 1;
                }
            }
            if (pruneIndex > -1) {
                // Prune fired events
                var event = activeEvents[roomKey][pruneIndex-1];
                eventsToFire.push(event.subject + "/command/" + event.room + "/" + event.command + event.type);
                //console.log("Pruning fired events: ", activeEvents[roomKey].slice(0, pruneIndex));
                activeEvents[roomKey] = activeEvents[roomKey].slice(pruneIndex);
            }
        }
    }

    //console.log("ACTIVE EVENTS: ",activeEvents);
    //console.log("FIRE EVENTS: ",eventsToFire);
    return eventsToFire;
}

module.exports = function(RED) {

    var request = require('request');
    var util = require("util");
    var events = require("events");
    var Rx = require("rx");
    //var settings = RED.settings;

    function RiotCalDavEventsNode(config) {
        RED.nodes.createNode(this,config);
        this.name = config.name;
        this.repeat = config.repeat * 1000 || 300000; // msec
        this.server = config.server || "calendar.local";
        this.port = config.port || "5232";
        this.box = config.box || "caldav";
        this.protocol = config.protocol || "HTTP";
        if (this.credentials && this.credentials.hasOwnProperty("userid")) {
            this.userid = this.credentials.userid;
        } else {
                this.error(RED._("server.errors.nouserid"));
        }
        // TODO: Support server login
        //if (this.credentials && this.credentials.hasOwnProperty("password")) {
        //    this.password = this.credentials.password;
        //} else {
        //    this.warn(RED._("server.errors.nopassword"));
        //}

        var node = this;
        // Store configuration values here
        node.serverConfig = {
            protocol:this.protocol,
            name:this.server,
            port:this.port,
            userid:this.userid,
            box:this.box
        };

        node.caldav = caldavPool.get(this.serverConfig);
        // Provide any relevant status info
        showStatus(node, StatusEnum.DISCONNECT);

        node.log(util.format("Calendar Server on %s:%s", node.serverConfig.name, node.serverConfig.port));

        var disposable = Rx.Scheduler.default.schedulePeriodic(
            0,
            this.repeat, /* msec */
            function (i) {
                i++;
                var eventStream = node.caldav.listenCalendarEvents(node.serverConfig);
                var resp = [];
                node.caldav.subscription = eventStream
                    .subscribe(function (response) {
                        resp.push(response);
                        //var msg = {};
                        //msg.payload = response;
                        //node.send(msg);

                    }, function (error) {
                        //console.log("Error during monitoring:\n", error);
                        showStatus(node,StatusEnum.DISCONNECT);
                    }, function () {
                        //console.log("Monitoring stream ended; exiting.");
                        var msg = {};
                        msg.payload = resp;
                        node.send(msg);
                    });
                return i;
            });

        showStatus(node,StatusEnum.CONNECT);

        node.on('close', function() {
            //this.caldav.subscription.dispose();
            disposable.dispose();
            showStatus(node,StatusEnum.DISCONNECT);
        });

        this.on("close", function(done) {
            if (this.serverConfig) {
                // something
                done();
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("caldav-events",RiotCalDavEventsNode,{
        credentials: {
            userid: {type: "text"},
            password: {type: "password"}
        }
    });

    function RiotCalDavProcessorNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;

        var node = this;

        // Node functions
        node.on('input', function(msg) {
            var rooms = {};
            var events = msg.payload;
            //console.log("events: ",events);
            for( var i = 0; i < events.length; i++) {
                //console.log("processing: ",events[i]);
                processor(rooms, events[i]);
            }

            node.context().flow.set('rooms',rooms);

            // Create and maintain the active list

            var activeEvents = node.context().global.get('activeEvents') || {};

            eventsToFire = calculateActive(activeEvents,rooms, new Date());

            // Store the current active events
            node.context().global.set('activeEvents',activeEvents);
            var msgs = [];
            for(i = 0; i < eventsToFire.length; i++) {
                msg.payload = eventsToFire[i];
                msg.topic = eventsToFire[i];
                msgs.push(msg)
            }

            node.send(msgs);
        });

    }

    RED.nodes.registerType("caldav-processor",RiotCalDavProcessorNode);

    var caldavPool = (function() {
        var connections = {};
        return {
            get:function(server) {
                var id = server.name;
                if (!connections[id]) {
                    connections[id] = (function() {
                        var obj = {
                            _emitter: new events.EventEmitter(),
                            caldav: null,
                            _closing: false,
                            tout: null,
                            on: function(a,b) { this._emitter.on(a,b); },
                            close: function(cb) { this.xbee.close(cb); },
                            listenCalendarEvents: function(serverConfig) {
                                RED.log.info(RED._("server.command.fetch", {serverhost: id}));

                                var requestProto = Rx.Observable.fromNodeCallback(request);

                                var after = new Date();
                                var before = new Date(new Date(after).setHours(after.getHours() + LOOK_AHEAD_HOURS));
                                var url = serverConfig.protocol+"://"+serverConfig.name+":"+serverConfig.port+"/"+serverConfig.userid+"/"+serverConfig.box;

                                return requestProto(url)
                                    .map(r => r[0].toJSON())
                                    .flatMap(parseCalDav)
                                    .map(event => parseRRules(event, after, before))
                                    .filter(event => filterRRules(event, after, before))
                                    .flatMap(simpleEvents);
                            }
                        };
                        var setupCalDav = function() {
                            obj.caldav = {};
                        };
                        setupCalDav();
                        //console.log('caldavPool: setupCalDav completed.');
                        return obj;
                    }());
                }

                return connections[id];
            },
            close: function(port,done) {
                if (connections[port]) {
                    // ToDo: Not sure how to handle cleanup here.
                    done();
                } else {
                    done();
                }
            }
        }
    }());
};