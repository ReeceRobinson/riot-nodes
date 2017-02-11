# riot-nodes
## A collection of Node Red nodes for interaction with IOT devices over an XBee (ZigBee) mesh network.

This project provides the following nodes:

## riot-xbee
**riot-xbee** is a set of three nodes that provide the following:

* Digital IO Change Detector - configure a digital input pin with Digital IO Change Detection mask and this node will receive state change tranmissions.
* Digital IO Output - drive a digital pin high or low
* Analog Input - configure an IO Sampling Rate for your XBee; this node will receive the value transmissions. 

**Note:** Configure your XBee for **API mode 2**.

## riot-caldav
**riot-caldav** is a set of two nodes that provide the following:

* CalDav Events - calendar integration to retrieve calendar events using the caldav protocol.
* CalDav Processor - processing of events that resolves event overlaps and emits 'commands' with event objects, based on calendar event content. 

**Note:** Server authentication is not currently supported.

(c) Reece Robinson 2017
