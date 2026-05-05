import { Writable, Readable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { KimiflareAcpAgent } from "./agent.js";

// stdout is used for ACP JSON-RPC messages — redirect console to stderr
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

function nodeToWebWritable(nodeStream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        nodeStream.write(Buffer.from(chunk), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  });
}

// Note: this eagerly enqueues without backpressure. Acceptable for a
// stdio-based ACP connection where the client writes at human speed.
function nodeToWebReadable(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
  });
}

// Ensure stdin is flowing before creating the ReadableStream so that the
// "data" listener attached inside start() receives events immediately.
process.stdin.resume();

const stream = ndJsonStream(
  nodeToWebWritable(process.stdout),
  nodeToWebReadable(process.stdin),
);

const connection = new AgentSideConnection(
  (conn) => new KimiflareAcpAgent(conn),
  stream,
);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  // Drain stdout before exiting so in-flight sessionUpdate notifications
  // are not lost.
  if (!process.stdout.writableEnded) {
    await new Promise<void>((resolve) => {
      if ((process.stdout as NodeJS.WriteStream).writableNeedDrain) {
        process.stdout.once("drain", resolve);
      } else {
        resolve();
      }
    });
  }
  process.exit(0);
}

connection.closed.then(shutdown);

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
