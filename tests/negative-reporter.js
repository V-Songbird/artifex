'use strict';

// The mutation runner's second reporter for its control: one JSON line per
// test result, [file, title], so each mutation can run only the file that
// holds its expected test.
module.exports = async function* (source) {
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') yield `${JSON.stringify([data.file, data.name])}\n`;
  }
};
