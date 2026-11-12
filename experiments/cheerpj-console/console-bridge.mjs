/**
 * CheerpJ 5 console adapter for the isolated Adminerva Java experiment.
 * Adapted in design (not copied verbatim) from leaningtech/browsercode's
 * Apache-2.0 licensed JavaConsole implementation.
 *
 * NOTE: ConInodeOps is an undocumented CheerpJ API. Validate each CheerpJ
 * version in a real browser before using it, and never inject this adapter
 * into the authenticated Adminerva application.
 */
const encoder = new TextEncoder();
const MAX_QUEUED_BYTES = 16384;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function createConsoleBridge(cheerpj, onOutput) {
  const operations = cheerpj?.ConInodeOps;
  if (!operations || typeof operations.readAsync !== "function" || typeof operations.writeAsync !== "function") {
    throw new Error("This CheerpJ build does not expose interactive console I/O (ConInodeOps).");
  }
  const originalRead = operations.readAsync;
  const originalWrite = operations.writeAsync;
  let queued = new Uint8Array(0);
  let pending = null;
  let outputBytes = 0;
  let truncated = false;
  let installed = true;
  const decoders = new WeakMap();

  function deliver() {
    if (!pending || !installed || !queued.length) return;
    const { target, callback } = pending;
    pending = null;
    const count = Math.min(queued.length, target.length);
    target.set(queued.subarray(0, count));
    queued = queued.slice(count);
    callback(count);
  }

  operations.readAsync = function (_fileData, _offset, buffer, off, len, _flags, callback) {
    if (!installed) return originalRead.apply(this, arguments);
    // Do not silently overwrite one outstanding read with another.
    if (pending) {
      onOutput("\n[Runtime error: overlapping console reads. Reset the page.]\n");
      callback(0);
      return;
    }
    pending = {target: new Uint8Array(buffer.buffer, buffer.byteOffset + off, len), callback};
    deliver();
  };

  operations.writeAsync = function (fileData, _offset, buffer, off, len, callback) {
    if (!installed) return originalWrite.apply(this, arguments);
    const amount = Math.max(0, Math.min(len, buffer.byteLength - off));
    try {
      let decoder = decoders.get(fileData);
      if (!decoder) {
        decoder = new TextDecoder();
        if (fileData && typeof fileData === "object") decoders.set(fileData, decoder);
      }
      if (outputBytes < MAX_OUTPUT_BYTES) {
        const byteCount = Math.min(amount, MAX_OUTPUT_BYTES - outputBytes);
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + off, byteCount);
        const text = decoder.decode(bytes, {stream: true});
        if (text) onOutput(text);
        outputBytes += byteCount;
        if (amount > byteCount && !truncated) {
          truncated = true;
          onOutput("\n[Output capped at 1 MiB. Stop/Reset to interrupt a noisy program.]\n");
        }
      } else if (!truncated) {
        truncated = true;
        onOutput("\n[Output capped at 1 MiB. Stop/Reset to interrupt a noisy program.]\n");
      }
    } catch (error) {
      console.error("CheerpJ console output error:", error);
    } finally {
      callback(len);
    }
  };

  return {
    sendLine(text) {
      if (!installed) throw new Error("Console bridge is no longer attached.");
      const bytes = encoder.encode(String(text) + "\n");
      if (bytes.length + queued.length > MAX_QUEUED_BYTES) {
        throw new Error("Too much input queued; wait for the Java program to read it.");
      }
      const next = new Uint8Array(queued.length + bytes.length);
      next.set(queued);
      next.set(bytes, queued.length);
      queued = next;
      deliver();
    },
    clearQueuedInput() {
      queued = new Uint8Array(0);
    },
    endRun() {
      queued = new Uint8Array(0);
      // Release any stale blocked read before the next compilation begins.
      if (pending) {
        const {callback} = pending;
        pending = null;
        callback(0);
      }
    },
    resetOutputLimit() {
      outputBytes = 0;
      truncated = false;
    },
    detach() {
      if (!installed) return;
      installed = false;
      queued = new Uint8Array(0);
      if (pending) {
        const {callback} = pending;
        pending = null;
        callback(0);
      }
      operations.readAsync = originalRead;
      operations.writeAsync = originalWrite;
    }
  };
}
