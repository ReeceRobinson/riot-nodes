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

function hexStringToBytes(str){
    var a = [];
    for (var i = 0; i < str.length; i += 2) {
        a.push(parseInt("0x"+str.substr(i, 2)));
    }
    return a;
}

module.exports = function(RED) {
    var util = require("util");
    var events = require("events");
    var xbeeRx = require('xbee-rx');
    var rx = require("rx");
    //var settings = RED.settings;

    function XbeePortNode(node) {
        RED.nodes.createNode(this,node);
        this.serialport = node.serialport;
        this.addchar = node.addchar || "false";
        this.serialbaud = parseInt(node.serialbaud) || 57600;
        this.databits = parseInt(node.databits) || 8;
        this.parity = node.parity || "none";
        this.stopbits = parseInt(node.stopbits) || 1;
        this.module = node.module || "Zigbee";
        this.api_mode = node.api_mode || 2;
    }

    RED.nodes.registerType("xbee-port",XbeePortNode);

    function RiotXbeeDigitalOutNode(config) {
        RED.nodes.createNode(this,config);
        // Configuration Nodes
        this.serial = config.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            // Store configuration values here
            this.address = config.address;
            this.addressMethod = config.addressMethod;
            this.pin = config.pin;
            this.pinState = config.pinState;

            // Provide any relevant status info
            showStatus(node, StatusEnum.DISCONNECT)

            node.log(util.format("Get XBee on %s:%s", this.serialConfig.serialport, this.serialConfig.serialbaud));

            node.xbee = xbeePool.get(this.serialConfig)
            node.xbee.getLocalAddress();
            showStatus(node,StatusEnum.CONNECT);

            // Node functions
            node.on('input', function(msg) {
                msg.payload = "RIOT!";
                node.xbee.sendDigitalOut(this.addressMethod, this.address, this.pin, this.pinState);
                node.send(msg);
            });

            node.on('ready', function() {
                showStatus(node,StatusEnum.CONNECT);
            });

            node.on('close', function() {
                showStatus(node,StatusEnum.DISCONNECT);
            });

        } else {
            this.error(RED._("serial.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                xbeePool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("xbee-digital-out",RiotXbeeDigitalOutNode);

    function RiotXbeeDigitalInNode(config) {
        RED.nodes.createNode(this,config);
        // Configuration Nodes
        this.serial = config.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            // Store configuration values here
            this.address = config.address;
            this.addressMethod = config.addressMethod;
            this.pin = config.pin;
            this.pinState = config.pinState;

            // Provide any relevant status info
            showStatus(node, StatusEnum.DISCONNECT)

            node.log(util.format("Get XBee on %s:%s", this.serialConfig.serialport, this.serialConfig.serialbaud));

            node.xbee = xbeePool.get(this.serialConfig)
            node.xbee.getLocalAddress();
            //showStatus(node,StatusEnum.CONNECT);

            // Node functions
            showStatus(node,StatusEnum.CONNECT);
            var buttonPressStream = node.xbee.listenDigitalIn(this.addressMethod, this.address, this.pin);

            var subscription = buttonPressStream
                .subscribe(function (response) {
                    var msg = {};
                    msg.payload = response.interval;
                    node.send(msg);

                }, function (error) {
                    console.log("Error during monitoring:\n", error);
                    showStatus(node,StatusEnum.DISCONNECT);
                }, function () {
                    console.log("Monitoring stream ended; exiting.");
                    showStatus(node,StatusEnum.DISCONNECT);
                });

            node.on('close', function() {
                subscription.dispose();
                showStatus(node,StatusEnum.DISCONNECT);
            });

        } else {
            this.error(RED._("serial.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                xbeePool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("xbee-digital-in",RiotXbeeDigitalInNode);

    var xbeePool = (function() {
        var connections = {};
        return {
            get:function(serial, callback) {
                console.log("xbeepool get: ",serial);
                var id = serial.serialport;
                if (!connections[id]) {
                    connections[id] = (function() {
                        var obj = {
                            _emitter: new events.EventEmitter(),
                            xbee: null,
                            _closing: false,
                            tout: null,
                            on: function(a,b) { this._emitter.on(a,b); },
                            close: function(cb) { this.xbee.close(cb); },
                            sendDigitalOut: function(addressMethod, address, pin,pinState) {
                                RED.log.info(RED._("serial.command.digitalout",{command:pin,parameter:pinState,addressmethod:addressMethod,address:address}));
                                var params = {
                                    command: pin,
                                    commandParameter: [pinState]
                                };
                                // ToDo: It appears that destination16 is the only supported method of addressing on my hardware or there is a bug in xbee-rx/xbee-api?
                                switch(addressMethod) {
                                    case "destination64":
                                        params.destination64 = hexStringToBytes(address);
                                        break;
                                    case "destination16":
                                        params.destination16 = hexStringToBytes(address);
                                        break;
                                    case "destinationId":
                                        params.destinationId = address;
                                        break;
                                    default:
                                        RED.log.error(RED._("missing-address-method-conf",{port:serial.serialport}));
                                }

                                this.xbee.remoteCommand(params).subscribe(function (response) {
                                    // response will be [ 0 ] from thnode response frame
                                    RED.log.info(RED._("serial.response",{port:serial.serialport,response:response.toString('hex')}));

                                }, function (err) {
                                    RED.log.error(RED._("serial.errors.command",{port:serial.serialport,error:err.toString()}));
                                });

                            },
                            listenDigitalIn: function(addressMethod, address, pin) {
                                RED.log.info(RED._("serial.command.digitalin",{command:pin,addressmethod:addressMethod,address:address}));
                                var params = {
                                    command: pin
                                };
                                // ToDo: It appears that destination16 is the only supported method of addressing on my hardware or there is a bug in xbee-rx/xbee-api?
                                switch(addressMethod) {
                                    case "destination64":
                                        params.destination64 = hexStringToBytes(address);
                                        break;
                                    case "destination16":
                                        params.destination16 = hexStringToBytes(address);
                                        break;
                                    case "destinationId":
                                        params.destinationId = address;
                                        break;
                                    default:
                                        RED.log.error(RED._("missing-address-method-conf",{port:serial.serialport}));
                                }

                                var dio_map = {
                                    D0:"DIO0",
                                    D1:"DIO1",
                                    D2:"DIO2",
                                    D3:"DIO3",
                                    D4:"DIO4",
                                    D5:"DIO5",
                                    D6:"DIO6",
                                    D7:"DIO7",
                                    D10:"DIO10",
                                    D11:"DIO11",
                                    D12:"DIO12"
                                };
                                console.log('Digital Input subscribed to:',dio_map[pin]);
                                return this.xbee
                                    .monitorIODataPackets()
                                    // ignore any packets at program startup
                                    .skipUntil(rx.Observable.timer(100))
                                    // extract just the DIO3 sample (1 (released) or 0 (pressed))
                                    .pluck("digitalSamples", dio_map[pin])
                                    // pluck results in undefined if the sample doesn't exist, so filter that out
                                    .where(function (sample) {
                                        return sample !== undefined;
                                    })
                                    // ignore any repeats
                                    .distinctUntilChanged()
                                    .timeInterval()
                                    // the button is pressed when the button is released after being pressed for less than 1 second
                                    .where(function (x) {
                                        return x.value === 1 && x.interval < 1000;
                                    })
                                    // ignore multiple button presses within one second
                                    .throttle(1000);

                            },
                            getLocalAddress: function() {
                                this.xbee.localCommand({
                                    // ATMY
                                    // get my 16 bit address
                                    command: "MY"
                                }).subscribe(function (response) {
                                    // response will be an array of two bytes, e.g. [ 23, 167 ]
                                    RED.log.info(RED._("serial.response",{port:serial.serialport,response:response.toString('hex')}));
                                }, function (err) {
                                    RED.log.error(RED._("serial.errors.command",{port:serial.serialport,error:err.toString()}));

                                });
                            }
                        };
                        var olderr = "";
                        var setupXbee = function() {
                            obj.xbee = new xbeeRx({
                                serialport: serial.serialport,
                                serialPortOptions: {
                                    baudrate: serial.serialbaud
                                },
                                module: "ZigBee",
                                api_mode: 2
                            });
                        };
                        setupXbee();
                        console.log('xbeePool: setupXbee completed.');
                        return obj;
                    }());
                }
                return connections[id];
            },
            close: function(port,done) {
                console.log('Close called in xbee-pool! port: ',port);

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