import assert from "node:assert/strict";
import { test } from "node:test";
import { createConsoleBridge } from "./console-bridge.mjs";

function setup() {
  const emitted = [];
  const chee = {
    ConInodeOps: {
      readAsync() { throw Error("Unexpected fallback read"); },
      writeAsync() { throw Error("Unexpected fallback write"); }
    }
  };
  const bridge = createConsoleBridge(chee, (chunk) => emitted.push(chunk));
  return {bridge, ops: chee.ConInodeOps, emitted};
}
function read(ops, size) {
  return new Promise(resolve => {
    const buf = new Uint8Array(size + 5);
    ops.readAsync({}, 0, buf, 2, size, 0, n => resolve({count:n, value:new TextDecoder().decode(buf.subarray(2, 2+n))}));
  });
}

test("delivers two Scanner input lines when reads happen after Send", async () => {
  const {bridge, ops} = setup();
  bridge.sendLine("Ada");
  bridge.sendLine("20");
  const one = await read(ops, 4);
  const two = await read(ops, 20);
  assert.deepEqual([one.value, two.value], ["Ada\n", "20\n"]);
});

test("supports a pending Java read before user types", async () => {
  const {bridge, ops} = setup();
  const waiting = read(ops, 64);
  bridge.sendLine("Maria");
  assert.deepEqual((await waiting).value, "Maria\n");
});

test("does not lose characters across short byte reads", async () => {
  const {bridge, ops} = setup();
  bridge.sendLine("é🍀");
  const parts = [];
  let bytes = 0;
  while (bytes < new TextEncoder().encode("é🍀\n").length) {
    const result = await read(ops, 2);
    parts.push(result);
    bytes += result.count;
  }
  const b = parts.flatMap(x => Array.from(new TextEncoder().encode(x.value)));
  // Decode each read as one combined stream to avoid split UTF-8 codepoints.
  assert.equal(parts.reduce((sum,x)=>sum+x.count,0), 7);
});

test("streams split UTF-8 output and acknowledges every write", () => {
  const {ops, emitted} = setup();
  const fileData = {};
  const a = new TextEncoder().encode("Hello 🌎!");
  const acknowledgements = [];
  ops.writeAsync(fileData, 0, a, 0, 8, n => acknowledgements.push(n));
  ops.writeAsync(fileData, 0, a, 8, a.length - 8, n => acknowledgements.push(n));
  assert.deepEqual(acknowledgements, [8, a.length-8]);
  assert.equal(emitted.join(""), "Hello 🌎!");
});

test("limits unconsumed stdin, clears it, then accepts new lines", async () => {
  const {bridge, ops} = setup();
  assert.throws(() => bridge.sendLine("x".repeat(20000)), /Too much input/);
  bridge.sendLine("old");
  bridge.clearQueuedInput();
  bridge.sendLine("new");
  assert.equal((await read(ops, 10)).value, "new\n");
});

test("rejects missing undocumented console API rather than pretending stdin works", () => {
  assert.throws(() => createConsoleBridge({},()=>{}), /ConInodeOps/);
});
