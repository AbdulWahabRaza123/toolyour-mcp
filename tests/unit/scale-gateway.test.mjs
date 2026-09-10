import test from "node:test";
import assert from "node:assert/strict";
import { Semaphore } from "../../dist/gateway/semaphore.js";
import { CircuitBreaker } from "../../dist/gateway/circuit-breaker.js";

test("semaphore releases waiters without holding during delay", async () => {
  const sem = new Semaphore(1);
  const release1 = await sem.acquire();
  let secondAcquired = false;
  const p2 = sem.acquire().then((release) => {
    secondAcquired = true;
    release();
  });
  assert.equal(sem.stats().waiting, 1);
  assert.equal(secondAcquired, false);
  release1();
  await p2;
  assert.equal(secondAcquired, true);
  assert.equal(sem.stats().active, 0);
  assert.equal(sem.stats().waiting, 0);
});

test("semaphore acquire timeout fails fast", async () => {
  const sem = new Semaphore(1);
  const release = await sem.acquire();
  await assert.rejects(() => sem.acquire(20), /timed out|gateway_busy/i);
  release();
});

test("circuit breaker half-open admits one probe", async () => {
  const br = new CircuitBreaker({ openMs: 40, failureThreshold: 3, windowMs: 10_000 });
  for (let i = 0; i < 3; i++) br.recordFailure("node");
  assert.equal(br.isOpen("node"), true);
  assert.ok(br.snapshot().node.retryAfterMs > 0);

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(br.isOpen("node"), false); // first probe admitted
  assert.equal(br.snapshot().node.halfOpen, true);
  assert.equal(br.isOpen("node"), true); // second blocked while probing
  br.recordSuccess("node");
  assert.equal(br.isOpen("node"), false);
  assert.equal(br.snapshot().node.halfOpen, false);
});

test("half-open probe failure re-opens breaker", async () => {
  const br = new CircuitBreaker({ openMs: 30, failureThreshold: 2, windowMs: 10_000 });
  br.recordFailure("node");
  br.recordFailure("node");
  assert.equal(br.isOpen("node"), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(br.isOpen("node"), false); // probe
  const opened = br.recordFailure("node");
  assert.equal(opened, true);
  assert.equal(br.isOpen("node"), true);
});
