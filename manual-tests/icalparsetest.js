/**
 * Created by reecerobinson on 4/02/17.
 */
var rrulestr =  require('rrule-alt').rrulestr


var rule = rrulestr('RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU');
var events = rule.between(new Date(2017,0,1), new Date(2018,2,28));
console.log(rule);
console.log(events);
