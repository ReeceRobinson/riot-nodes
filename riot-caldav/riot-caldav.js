/**
 * (c) Reece Robinson 27/01/17.
 */

var Rx = require("rx");
var request = require('request');
var RRule =  require('rrule-alt').RRule;

var START_EVENT = 'BEGIN:VEVENT';
var END_EVENT = 'END:VEVENT';
var LOOK_AHEAD_HOURS = 48;
let offset = new Date().getTimezoneOffset()/-60;
var TZ_OFFSET = (offset >= 0)?'+'+offset+'00':'-'+offset+'00';

var StatusEnum = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    MESSAGE : 'message',
    NONE: ''
};

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

module.exports = function(RED) {

    var request = require('request');
    var util = require("util");
    var events = require("events");
    var Rx = require("rx");
    var settings = RED.settings;

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
        if (this.credentials && this.credentials.hasOwnProperty("password")) {
            this.password = this.credentials.password;
        } else {
            this.warn(RED._("server.errors.nopassword"));
        }

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
                node.caldav.subscription = eventStream
                    .subscribe(function (response) {
                        var msg = {};
                        msg.payload = response;
                        node.send(msg);

                    }, function (error) {
                        //console.log("Error during monitoring:\n", error);
                        showStatus(node,StatusEnum.DISCONNECT);
                    }, function () {
                        //console.log("Monitoring stream ended; exiting.");
                    });
                return i;
            });

        showStatus(node,StatusEnum.CONNECT);

        node.on('close', function() {
            this.caldav.subscription.dispose();
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

    var caldavPool = (function() {
        var connections = {};
        return {
            get:function(server, callback) {
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