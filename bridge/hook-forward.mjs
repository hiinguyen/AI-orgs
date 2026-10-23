#!/usr/bin/env node
/**
 * Claude Code hook forwarder. Reads hook JSON from stdin, POSTs it to the local
 * bridge and exits 0 no matter what. It prints nothing and never waits longer
 * than one second, so a stopped bridge can never slow a Claude Code session.
 */
import { request } from "node:http";

const TIMEOUT_MS = 1000;
const MAX_STDIN_BYTES = 256 * 1024;

// Hard deadline for the whole process, stdin included. A hook that never closes
// its stdin must not be able to hold a Claude Code session.
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    process.stdin.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_STDIN_BYTES) {
        process.exit(0);
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    process.stdin.on("error", () => {
      resolve(Buffer.alloc(0));
    });
  });
}

async function forward() {
  try {
    const body = await readStdin();
    const port = Number.parseInt(process.env.BRIDGE_PORT ?? "8791", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path: "/hook",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": body.length,
            },
            timeout: TIMEOUT_MS,
          },
          (res) => {
            res.resume();
            res.on("end", finish);
            res.on("error", finish);
          },
        );
        req.on("timeout", () => {
          req.destroy();
          finish();
        });
        req.on("error", finish);
        req.on("close", finish);
        req.end(body);
      } catch {
        finish();
      }
    });
  } catch {
    // The bridge is best effort. A Claude Code session must not notice it.
  }
}

process.exitCode = 0;
void forward();
