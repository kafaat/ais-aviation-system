"use strict";

// Loaded only by the isolated subprocess regression. Keep the real Pino and
// thread-stream implementations; stall the owned destination's end handshake.
const { isMainThread } = require("node:worker_threads");

if (!isMainThread) {
  module.exports = async function stalledDestination(options) {
    const { probeOriginalTarget, ...originalOptions } = options;
    const builder = require(probeOriginalTarget);
    const destination = await (builder.default || builder)(originalOptions);
    destination.end = function stalledEnd() {
      require("node:fs").writeSync(2, "[privacy-stall] destination:end\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    return destination;
  };
} else {
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function controlledLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    if (request !== "thread-stream") return exported;
    return new Proxy(exported, {
      construct(target, [options], newTarget) {
        return Reflect.construct(
          target,
          [
            {
              ...options,
              filename: __filename,
              workerData: {
                ...options.workerData,
                probeOriginalTarget: options.filename,
              },
            },
          ],
          newTarget
        );
      },
    });
  };
}
