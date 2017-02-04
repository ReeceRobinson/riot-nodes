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
    var RRule = require('rrule-alt').RRule;
    var request = require('request');
    var util = require("util");
    //var events = require("events");
    //var rx = require("rx");
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

        // Provide any relevant status info
        showStatus(node, StatusEnum.DISCONNECT)

        node.log(util.format("Calendar Server on %s:%s", this.serverConfig.name, this.serverConfig.port));

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

    RED.nodes.registerType("caldav-events",RiotCalDavEventsNode,{
        credentials: {
        userid: { type:"text" },
        password: { type: "password" }
    }
    });

};