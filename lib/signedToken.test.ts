import assert from "node:assert/strict";
import test from "node:test";
import { createSignedToken, verifySignedToken } from "./signedToken";

test("signed tokens round-trip before expiry", () => {
  const token = createSignedToken({ sub: "123", email: "a@example.com" }, "secret", 60, 1000);
  assert.deepEqual(verifySignedToken(token, "secret", 2000), {
    sub: "123",
    email: "a@example.com",
  });
});

test("signed tokens reject tampering", () => {
  const token = createSignedToken({ redirectTo: "/upload" }, "secret", 60, 1000);
  const [body, signature] = token.split(".");
  const tampered = `${body.slice(0, -1)}x.${signature}`;
  assert.equal(verifySignedToken(tampered, "secret", 2000), null);
});

test("signed tokens reject expiry", () => {
  const token = createSignedToken({ redirectTo: "/upload" }, "secret", 60, 1000);
  assert.equal(verifySignedToken(token, "secret", 62_000), null);
});
