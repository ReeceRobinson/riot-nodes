/**
 * (c) Reece Robinson 27/01/17.
 */
var util = require("util");
var xbeeRx = require('xbee-rx');

var StatusEnum = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    MESSAGE : 'message',
    NONE: ''
}

function showStatus(node, state, msg){
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

function getLocalXbeeAddress(xbee, node){
    xbee.localCommand({
        // ATMY
        // get my 16 bit address
        command: "MY"
    }).subscribe(function (response) {
        // response will be an array of two bytes, e.g. [ 23, 167 ]
        console.log("ATMY response:\n", response);
        showStatus(node, StatusEnum.MESSAGE, response.toString('hex'));
    }, function (e) {
        console.log("Command failed:\n", e);
        showStatus(node,StatusEnum.DISCONNECT);
    });
}

function cleanup(xbee,callback){
    // Do some cleanup if necessary.
    if (xbee) {
        xbee.close();
    }
    callback();
}

module.exports = function(RED) {

    function RiotXbeeNode(config) {
        RED.nodes.createNode(this,config);

        // Store configuration values here
        this.serial = config.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);
        this.address = config.address;

        var node = this;

        // Provide any relevant status info
        showStatus(node, StatusEnum.DISCONNECT)

        try {
            node.log(util.format("Get XBee on %s:%s", this.serialConfig.serialport, this.serialConfig.serialbaud));

            node.xbee = xbeeRx({
                serialport: this.serialConfig.serialport,
                serialPortOptions: {
                    baudrate: this.serialConfig.serialbaud
                },
                module: "ZigBee",
                api_mode: 2
            });
            // Logic here for connection
            showStatus(node, StatusEnum.CONNECT)

        } catch(err) {
            node.log(util.format("Failed to get XBee on %s", this.serialConfig.serialport));
            showStatus(node, StatusEnum.DISCONNECT)
            this.error(err);
            return;
        }

        // Node functions
        this.on('input', function(msg) {
            msg.payload = "RIOT!";
            getLocalXbeeAddress(node.xbee, node);
            node.send(msg);
        });

        this.on('close', function(done) {
            cleanup(node.xbee, function() {
                node.log("Cleanup finished.");
                done();
            });
        });
    }
    RED.nodes.registerType("riot-xbee",RiotXbeeNode);
}