/**
 * (c) Reece Robinson 27/01/17.
 */

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

module.exports = function(RED) {

    var request = require('request');
    var util = require("util");
    var events = require("events");
    var Rx = require("rx");
    var settings = RED.settings;

    function RiotCalDavEventsNode(config) {
        RED.nodes.createNode(this,config);
        this.name = config.name;
        this.repeat = config.repeat * 1000 || 300000;
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
        this.serverConfig = {name:"foo", port:1234};

        node.caldav = caldavPool.get(config)
        // Provide any relevant status info
        showStatus(node, StatusEnum.DISCONNECT)

        node.log(util.format("Calendar Server on %s:%s", this.serverConfig.name, this.serverConfig.port));

        var eventStream = node.caldav.listenCalendarEvents(config);

        showStatus(node,StatusEnum.CONNECT);

        // Node functions
        node.on('ready', function() {
            showStatus(node,StatusEnum.CONNECT);
        });

        node.on('close', function() {
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

    //RED.nodes.registerType("caldav-events",RiotCalDavEventsNode);
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
                            listenCalendarEvents: function(server) {
                                RED.log.info(RED._("server.command.fetch",{command:id}));
                                var params = {
                                    command: server.name
                                };
                                // TODO: Configure a calendar request every "repeat" seconds to fetch calendar events and return them to the node.
                                //RED.log.info(RED._("server.command.analogin",{command:ad_map[pin],addressmethod:addressMethod,address:address}));
                                //return this.xbee
                                //    .monitorIODataPackets()
                                //    // ignore any packets at program startup
                                //    .skipUntil(rx.Observable.timer(100))
                                //    // extract just the DIO3 sample (1 (released) or 0 (pressed))
                                //    .pluck("analogSamples", ad_map[pin])
                                //    // pluck results in undefined if the sample doesn't exist, so filter that out
                                //    .where(function (sample) {
                                //        return sample !== undefined;
                                //    })
                                //    // ignore multiple values that arrive within one second
                                //    .throttle(1000);
                            }
                        };
                        var setupCalDav = function() {
                            obj.caldav = {};
                        };
                        setupCalDav();
                        console.log('caldavPool: setupCalDav completed.');
                        return obj;
                    }());
                }

                return connections[id];
            },
            close: function(port,done) {
                console.log('Close called in caldav-pool! port: ',port);

                if (connections[port]) {
                    // ToDo: Not sure how to handle cleanup here.
                    //    console.log('Cleaning up timeouts');
                    //    if (connections[port].tout != null) {
                    //        clearTimeout(connections[port].tout);
                    //    }
                    //    console.log('_closing to true');
                    //    connections[port]._closing = true;
                    //    try {
                    //        console.log('About to close xbee');
                    //        connections[port].close();
                    //        done();
                    //    } catch(err) {
                    //        console.log('Error: ',err);
                    //    }
                    //    delete connections[port];
                    //    console.log('All done.');
                    //
                    done();
                } else {
                    done();
                }
            }
        }
    }());
};