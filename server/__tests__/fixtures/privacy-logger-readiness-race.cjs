"use strict";

// Child-process regression fixture. It delegates to the real Pino destination
// and controls only scheduling, so formatting, output, end and worker close are
// real. No application or dependency implementation is replaced.
const { isMainThread, parentPort } = require("node:worker_threads");

if (!isMainThread) {
  module.exports = async function gatedDestination(options) {
    const { probeGate, probeOriginalTarget, ...originalOptions } = options;
    const gate = new Int32Array(probeGate);
    const builder = require(probeOriginalTarget);
    const destination = await (builder.default || builder)(originalOptions);
    const write = destination.write;
    const end = destination.end;
    let first = true;
    let bytes = 0;
    let records = "";

    destination.write = function controlledWrite(chunk, ...args) {
      if (first) {
        first = false;
        if (Atomics.wait(gate, 0, 0, 3000) === "timed-out")
          throw new Error("Readiness fixture scheduling gate timed out");
      }
      records += chunk;
      bytes += Buffer.byteLength(chunk);
      const accepted = write.call(this, chunk, ...args);
      const expected = Atomics.load(gate, 2);
      if (expected > 0 && bytes >= expected) {
        const done = () =>
          setImmediate(() => {
            // ThreadStream updates its read index after write()/drain returns.
            Atomics.store(gate, 1, 1);
            Atomics.notify(gate, 1);
          });
        if (accepted) done();
        else destination.once("drain", done);
      }
      return accepted;
    };
    destination.end = function controlledEnd(...args) {
      parentPort.postMessage({
        code: "EVENT",
        name: "fixture-records",
        args: [records],
      });
      return end.apply(this, args);
    };
    return destination;
  };
} else {
  const assert = require("node:assert/strict");
  const { once } = require("node:events");
  const { writeSync } = require("node:fs");
  const { resolve } = require("node:path");
  const { pathToFileURL } = require("node:url");
  const Module = require("node:module");
  const started = performance.now();
  const gateBuffer = new SharedArrayBuffer(16);
  const gate = new Int32Array(gateBuffer);
  const originalLoad = Module._load;
  let transport;
  let log;
  let records;
  let resolvePrepared;
  let rejectPrepared;
  let snapshot = () => ({});
  const prepared = new Promise((resolve, reject) => {
    resolvePrepared = resolve;
    rejectPrepared = reject;
  });
  function mark(phase, details = {}) {
    writeSync(
      2,
      JSON.stringify({
        phase,
        elapsedMs: Math.round(performance.now() - started),
        ...details,
      }) + "\n"
    );
  }

  // A test-only constructor seam supplies the scheduling wrapper. The actual
  // ThreadStream class, READY handler, wait algorithm, and logger all run.
  Module._load = function controlledLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    if (request !== "thread-stream") return exported;
    const { READ_INDEX, WRITE_INDEX } = originalLoad.call(
      this,
      "thread-stream/lib/indexes",
      parent,
      false
    );
    return new Proxy(exported, {
      construct(target, [options], newTarget) {
        transport = Reflect.construct(
          target,
          [
            {
              ...options,
              filename: __filename,
              workerData: {
                ...options.workerData,
                probeGate: gateBuffer,
                probeOriginalTarget: options.filename,
              },
            },
          ],
          newTarget
        );
        // Read private indices to prove the scheduling precondition. Production
        // cleanup uses only end()/close; this fixture never changes these indices.
        const implementation = Object.getOwnPropertySymbols(transport)
          .map(key => transport[key])
          .find(value => value && value.state instanceof Int32Array);
        assert.ok(implementation);
        const state = implementation.state;
        snapshot = () => ({
          readIndex: Atomics.load(state, READ_INDEX),
          writeIndex: Atomics.load(state, WRITE_INDEX),
          ready: transport.ready,
          closed: transport.closed,
        });
        transport.on("fixture-records", value => {
          records = value;
        });
        transport.on("error", error =>
          mark("transport:error", { message: error.message })
        );
        transport.worker.on("message", message => {
          if (message.code !== "READY") return;
          try {
            // The library's earlier READY listener captured this write index.
            const capturedWrite = Atomics.load(state, WRITE_INDEX);
            assert.ok(capturedWrite > 0);
            assert.equal(Atomics.load(state, READ_INDEX), 0);
            log.info("READINESS_RECORD_B");
            setImmediate(() => {
              try {
                const finalWrite = Atomics.load(state, WRITE_INDEX);
                assert.ok(finalWrite > capturedWrite);
                Atomics.store(gate, 2, finalWrite);
                Atomics.store(gate, 0, 1);
                Atomics.notify(gate, 0);
                // Model the main thread being descheduled while the worker
                // consumes both writes, skipping the captured index.
                assert.notEqual(Atomics.wait(gate, 1, 0, 3000), "timed-out");
                assert.equal(Atomics.load(state, READ_INDEX), finalWrite);
                setImmediate(() => {
                  try {
                    // The scheduling precondition is met: the worker's read
                    // index skipped the captured write index. Up to
                    // thread-stream 4.2.0 the READY wait compared the read
                    // index with `===`, so this left `ready` false for ever
                    // and only the logger's end()-first shutdown survived it;
                    // 4.2.1 compares with `>=` and resolves readiness itself.
                    // The shutdown contract below is asserted either way.
                    mark("readiness:overshot", {
                      capturedWrite,
                      upstreamResolvedReadiness: transport.ready,
                      ...snapshot(),
                    });
                    resolvePrepared();
                  } catch (error) {
                    rejectPrepared(error);
                  }
                });
              } catch (error) {
                rejectPrepared(error);
              }
            });
          } catch (error) {
            rejectPrepared(error);
          }
        });
        return transport;
      },
    });
  };

  // A failing fixture watchdog, never a successful shutdown path.
  const watchdog = setTimeout(async () => {
    mark("fixture:timeout", snapshot());
    process.exitCode = 1;
    await transport?.worker.terminate();
  }, 8500);

  (async () => {
    const loggerFile = resolve(
      process.argv[2] || "server/services/logger.service.ts"
    );
    const { createServiceLogger, closeLogger } = await import(
      pathToFileURL(loggerFile).href
    );
    Module._load = originalLoad;
    log = createServiceLogger("readiness-regression");
    log.info("READINESS_RECORD_A");
    await prepared;
    await Promise.all([closeLogger(), closeLogger()]);
    assert.equal(transport.closed, true);
    assert.equal(transport.worker.exited, true);
    const parsed = records
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    assert.deepEqual(
      parsed.map(row => row.message),
      ["READINESS_RECORD_A", "READINESS_RECORD_B"]
    );
    await closeLogger();
    clearTimeout(watchdog);
    mark("LOGGER_READINESS_RACE_COMPLETE", {
      recordsRetained: true,
      workerExited: transport.worker.exited,
      ...snapshot(),
    });
  })().catch(async error => {
    Module._load = originalLoad;
    mark("fixture:failed", { message: error.message, ...snapshot() });
    process.exitCode = 1;
    // Preserve the failure while closing this fixture's owned worker.
    if (transport && !transport.closed) {
      const closed = once(transport, "close");
      transport.end();
      await closed.catch(() => {});
    }
    clearTimeout(watchdog);
  });
}
