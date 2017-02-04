# riot-xbee
## A collection of Node Red nodes for interaction with IOT devices over an XBee (ZigBee) mesh network.

This project builds upon the [xbee-rx](http://github.com/101100/xbee-rx/) and [xbee-api](http://github.com/jouz/xbee-api/) modules and adds Node Red Digital I/O and Analog nodes. 

This project provides the following nodes:

* Digital IO Change Detector - configure a digital input pin with Digital IO Change Detection mask and this node will receive state change tranmissions.
* Digital IO Output - drive a digital pin high or low
* Analog Input - configure an IO Sampling Rate for your XBee; this node will receive the value transmissions. 

## Usage

First, you will need to install the `riot-xbee` module (i.e.
`npm install riot-xbee`).

**Note:** Configure your XBee for **API mode 2**.

(c) Reece Robinson 2017
