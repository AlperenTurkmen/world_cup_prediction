import { createHmac, timingSafeEqual } from "node:crypto";

interface SignedTokenEnvelope<T> {
  exp: number;
  payload: T;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function createSignedToken<T>(
  payload: T,
  secret: string,
  maxAgeSeconds: number,
  now = Date.now(),
): string {
  const envelope: SignedTokenEnvelope<T> = {
    exp: now + maxAgeSeconds * 1000,
    payload,
  };
  const body = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySignedToken<T>(
  token: string | undefined | null,
  secret: string,
  now = Date.now(),
): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(body, secret))) return null;

  try {
    const decoded = Buffer.from(body, "base64url").toString("utf8");
    const envelope = JSON.parse(decoded) as SignedTokenEnvelope<T>;
    if (!envelope || typeof envelope.exp !== "number" || now > envelope.exp) {
      return null;
    }
    return envelope.payload;
  } catch {
    return null;
  }
}
