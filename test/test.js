var xbeeRx = require('xbee-rx');

var xbee = xbeeRx({
    serialport: '/dev/tty.usbserial-004021',
    serialPortOptions: {
        baudrate: 9600
    },
    module: "ZigBee",
    api_mode: 2
});
function hexStringToBytes(str){
    var a = [];
    for (var i = 0; i < str.length; i += 2) {
        a.push(parseInt("0x"+str.substr(i, 2)));
    }
    return a;
}
//xbee.localCommand({
//    // ATMY
//    // get my 16 bit address
//    command: "MY"
//}).subscribe(function (response) {
//    // response will be an array of two bytes, e.g. [ 23, 167 ]
//    console.log("ATMY response:\n", response.toString('hex'));
//
//}, function (e) {
//    console.log("Command failed:\n", e);
//});
//
//xbee.remoteCommand({
//    // ATD3
//    // get the status of digital pin 3
//    command: "D3",
//    // destination addresses can be in hexidecimal or byte arrays
//    destination16: [ 0xd2, 0x03 ]
//}).subscribe(function (response) {
//    // response will be a single value in an array, e.g. [ 1 ]
//    console.log("ATD3 response from node:\n", response.toString('hex'));
//
//}, function (e) {
//    console.log("Command failed:\n", e);
//
//});
//
xbee.remoteCommand({
    // ATD3
    // get the status of digital pin 3
    command: "D3",
    // destination addresses can be in hexidecimal or byte arrays
    destination16: [ 0xd2, 0x03 ]
}).subscribe(function (response) {
    // response will be a single value in an array, e.g. [ 1 ]
    console.log("ATD3 response from node:\n", response.toString('hex'));

}, function (e) {
    console.log("Command failed:\n", e);

});

xbee.remoteCommand({
    // ATD1 4/5
    // Turn digital output 1 off/on
    command: "D1",
    commandParameter: [ 4 ],
    // destination addresses can be in hexidecimal or byte arrays
    // serial number from the bottom of the module (or combination of ATSH and ATSL)
    destination16: hexStringToBytes("d203")
    //destination64: hexStringToBytes('0013a200403bb1ba')
    //destinationId: "Breadboard"
}).subscribe(function (response) {
    // response will be [ 0 ] from thnode response frame
    console.log("Success! "+response.toString('hex'));
    xbee.close();
}, function (e) {
    console.log("Command failed:\n", e);
    xbee.close();
});

//var subscription = xbee
//    .monitorIODataPackets()
//    .subscribe(function (ioSamplePacket) {
//        // do something with the packet
//        console.log("Analog sample from A2:", ioSamplePacket.analogSamples.AD2);
//        console.log("Button sample from D3:", ioSamplePacket.digitalSamples.DIO3);
//    });