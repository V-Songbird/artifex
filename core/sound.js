// Summing voices: many sources into one input, added in one order every time.
//
// Web Audio adds up everything connected to one input. Installed Edge adds a
// node's three or more inputs in an order that changes between renders, and
// floats added in another order round differently, so one graph renders samples
// that differ in their last bits. Two inputs add up the same either way round,
// so a graph whose every input takes at most two renders the same bytes each
// time in one browser.

'use strict';

/**
 * Connect every node in `nodes` to `into` through a balanced tree of gain nodes
 * at unity, each taking at most two inputs; `into` takes at most two of them, so
 * it must take no other input. The result is the sum one input would make,
 * always added in the same order. Each node's position in `nodes` fixes its
 * place in the tree; three or more nodes cost `nodes.length - 2` gain nodes.
 */
function sumInto(ctx, nodes, into) {
  let parts = nodes;
  if (nodes.length > 2) {
    const half = Math.ceil(nodes.length / 2);
    parts = [nodes.slice(0, half), nodes.slice(half)].map((part) => {
      if (part.length === 1) return part[0];
      const node = ctx.createGain();
      sumInto(ctx, part, node);
      return node;
    });
  }
  for (const n of parts) n.connect(into);
}

module.exports = { sumInto };
