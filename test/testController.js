var expect = require('chai').expect;
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
                    console.log("Expired Event: ",event);
                    //eventsToFire.push(event.subject + "/command/" + event.room + "/" + event.command + event.type);
                    pruneIndex = k + 1;
                }
            }
            if (pruneIndex > -1) {
                // Prune fired events
                var event = activeEvents[roomKey][pruneIndex-1];
                eventsToFire.push(event.subject + "/command/" + event.room + "/" + event.command + event.type);
                console.log("Pruning fired events: ", activeEvents[roomKey].slice(0, pruneIndex));
                activeEvents[roomKey] = activeEvents[roomKey].slice(pruneIndex);
            }
        }
    }

    console.log("ACTIVE EVENTS: ",activeEvents);
    console.log("FIRE EVENTS: ",eventsToFire);
    return eventsToFire;
}

// Configure event scenario
var events = [];
events.push({id: "668B475D-DB9D-4566-9116-3098D4A7C3C6",
    title: "AirCon",
    room: "bedroom",
    command: "Cool",
    start: new Date("2017-02-06T08:45:00.000Z"),
    end:  new Date("2017-02-06T19:30:00.000Z"),
    updated:  new Date("2017-02-05T08:35:41.000Z")});
events.push({id: "70D7F0EA-7B03-4477-8A93-1BAA764A0733",
    title: "AirCon",
    room: "reece",
    command: "Cool",
    start:  new Date("2017-02-06T03:03:00.000Z"),
    end:  new Date("2017-02-06T04:33:00.000Z"),
    updated:  new Date("2017-02-05T13:38:29.000Z")});
events.push({id: "73E813F9-F4E8-40E1-93D8-6879FB12C22B",
    title: "AirCon",
    room: "reece",
    command: "Cool",
    start:  new Date("2017-02-06T02:40:00.000Z"),
    end:  new Date("2017-02-06T04:02:00.000Z"),
    updated:  new Date("2017-02-05T13:38:25.000Z")});

var rooms = {};
for( var i = 0; i < events.length; i++) {
    processor(rooms, events[i]);
}

console.log('1 - PROCESSED:',rooms);

var eventsToFire;
var activeEvents = {};
// Time now equal to start of event
eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T03:03:00.000Z"));
expect(eventsToFire).not.to.be.null;
expect(eventsToFire).to.have.length(1);
expect(eventsToFire).to.contain('aircon/command/reece/coolstart');
expect(activeEvents['reece']).to.have.length(1);
expect(activeEvents['bedroom']).to.have.length(2);

// Check what happens if re-run again
delete rooms['reece']; // the time has moved on so this nolonger is received from the calendar.
eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T03:04:00.000Z"));
expect(eventsToFire).not.to.be.null;
expect(eventsToFire).to.be.empty;
expect(activeEvents['reece']).to.have.length(1);
expect(activeEvents['bedroom']).to.have.length(2);

eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T03:05:00.000Z"));
expect(eventsToFire).not.to.be.null;
expect(eventsToFire).to.be.empty;
expect(activeEvents['reece']).to.have.length(1);
expect(activeEvents['bedroom']).to.have.length(2);

console.log("######################")
var events = [];
events.push({
    id:"123",
    title:"AirCon",
    room: "bedroom",
    command: "Cool",
    start: new Date("2017-02-06T08:45:00.000Z"),
    end: new Date("2017-02-06T19:30:00.000Z"),
    updated: new Date("2017-02-05T08:35:41.000Z")
});
events.push({
    id:"321",
    title:"AirCon",
    room: "bedroom",
    command: "Cool",
    start: new Date("2017-02-06T09:00:00.000Z"),
    end: new Date("2017-02-06T19:20:00.000Z"),
    updated: new Date("2017-02-05T08:35:41.000Z")
});
events.push({
    id:"456",
    title:"AirCon",
    room: "living",
    command: "Cool",
    start: new Date("2017-02-06T02:38:00.000Z"),
    end: new Date("2017-02-06T04:00:00.000Z"),
    updated: new Date("2017-02-05T08:35:41.000Z")
});

var rooms = {};
for( var i = 0; i < events.length; i++) {
    processor(rooms, events[i]);
}

console.log('2 - PROCESSED:',rooms);

var activeEvents = {};
activeEvents['bedroom'] = [
    {
        type    : "start",
        time    : new Date("2017-02-06T08:00:00.000Z"),
        command : "cool",
        room    : "bedroom",
        subject : "aircon"
    },
    {
        type    : "end",
        time    : new Date("2017-02-06T08:30:00.000Z"),
        command : "cool",
        room    : "bedroom",
        subject : "aircon"
    }
];
activeEvents['living'] = [
    {
        type    : "start",
        time    : new Date("2017-02-06T20:00:00.000Z"),
        command : "cool",
        room    : "living",
        subject : "aircon"
    },
    {
        type    : "end",
        time    : new Date("2017-02-06T20:30:00.000Z"),
        command : "cool",
        room    : "living",
        subject : "aircon"
    }
];

var rooms = {};
rooms['bedroom'] = [
    {
        type    : "start",
        time    : new Date("2017-02-06T08:00:00.000Z"),
        command : "cool",
        room    : "bedroom",
        subject : "aircon"
    },
    {
        type    : "end",
        time    : new Date("2017-02-06T08:30:00.000Z"),
        command : "cool",
        room    : "bedroom",
        subject : "aircon"
    }
];
rooms['living'] = [
    {
        type    : "start",
        time    : new Date("2017-02-06T20:00:00.000Z"),
        command : "cool",
        room    : "living",
        subject : "aircon"
    },
    {
        type    : "end",
        time    : new Date("2017-02-06T20:30:00.000Z"),
        command : "cool",
        room    : "living",
        subject : "aircon"
    }
];

// Sanity Checks
expect(activeEvents).not.to.be.null;
expect(activeEvents['bedroom']).to.not.be.empty;
expect(activeEvents['living']).to.not.be.empty;
expect(activeEvents['bedroom']).to.have.length(2);
expect(activeEvents['living']).to.have.length(2);

// Test Time passing *******
var eventsToFire;

// Time now equal to start of event
eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T08:00:00.000Z"));
expect(eventsToFire).not.to.be.null;
expect(eventsToFire).to.have.length(1);
expect(eventsToFire).to.contain('aircon/command/bedroom/coolstart');
expect(activeEvents['bedroom']).to.have.length(1);
expect(activeEvents['living']).to.have.length(2);

// Time now equal to end of event
delete rooms['bedroom'];
eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T08:30:00.000Z"));
expect(eventsToFire).not.to.be.null;
expect(eventsToFire).to.have.length(1);
expect(eventsToFire).to.contain('aircon/command/bedroom/coolend');
expect(activeEvents['bedroom']).to.have.length(0);
expect(activeEvents['living']).to.have.length(2);

// *****
// RESET for next test
//activeEvents = {};
//activeEvents['bedroom'] = [
//    {
//        type    : "start",
//        time    : new Date("2017-02-06T07:00:00.000Z"),
//        command : "cool",
//        room    : "bedroom",
//        subject : "aircon"
//    },
//    {
//        type    : "end",
//        time    : new Date("2017-02-06T07:30:00.000Z"),
//        command : "cool",
//        room    : "bedroom",
//        subject : "aircon"
//    }
//];
//activeEvents['living'] = [
//    {
//        type    : "start",
//        time    : new Date("2017-02-06T19:00:00.000Z"),
//        command : "cool",
//        room    : "living",
//        subject : "aircon"
//    },
//    {
//        type    : "end",
//        time    : new Date("2017-02-06T19:30:00.000Z"),
//        command : "cool",
//        room    : "living",
//        subject : "aircon"
//    }
//];
//
//rooms = {};
//rooms['bedroom'] = [
//    {
//        type    : "start",
//        time    : new Date("2017-02-06T08:00:00.000Z"),
//        command : "cool",
//        room    : "bedroom",
//        subject : "aircon"
//    },
//    {
//        type    : "end",
//        time    : new Date("2017-02-06T08:30:00.000Z"),
//        command : "cool",
//        room    : "bedroom",
//        subject : "aircon"
//    }
//];
//rooms['living'] = [
//    {
//        type    : "start",
//        time    : new Date("2017-02-06T20:00:00.000Z"),
//        command : "cool",
//        room    : "living",
//        subject : "aircon"
//    },
//    {
//        type    : "end",
//        time    : new Date("2017-02-06T20:30:00.000Z"),
//        command : "cool",
//        room    : "living",
//        subject : "aircon"
//    }
//];
//
//// Sanity Checks
//expect(activeEvents).not.to.be.null;
//expect(activeEvents['bedroom']).to.not.be.empty;
//expect(activeEvents['living']).to.not.be.empty;
//expect(activeEvents['bedroom']).to.have.length(2);
//expect(activeEvents['living']).to.have.length(2);
//
//// Test Time passing *******
//var eventsToFire;
//
//// Time now equal to start of event
//eventsToFire = calculateActive(activeEvents,rooms, new Date("2017-02-06T08:00:00.000Z"));
//expect(eventsToFire).not.to.be.null;
//expect(eventsToFire).to.have.length(1);
//expect(eventsToFire).to.contain('aircon/command/bedroom/coolstart');
//expect(activeEvents['bedroom']).to.have.length(1);
//expect(activeEvents['living']).to.have.length(2);
