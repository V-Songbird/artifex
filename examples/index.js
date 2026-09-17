// The example set. Five idioms that break each other's assumptions.
//
// There is never exactly one, because one example is a template and a template
// is a scope. None of these is the starter: a scaffolder emits something that
// draws nothing in particular and says so. See docs/subject-neutrality.md.

'use strict';

module.exports = {
  drift: require('./drift.js'),
  specimen: require('./specimen.js'),
  readout: require('./readout.js'),
  partition: require('./partition.js'),
  contours: require('./contours.js'),
};
