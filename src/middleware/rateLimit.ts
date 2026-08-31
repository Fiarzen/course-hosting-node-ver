import rateLimit from "express-rate-limit";

// Disable rate limiting under the test runner so the suite's many same-IP
// requests aren't throttled. Jest sets NODE_ENV=test.
const isTest = process.env.NODE_ENV === "test";

// Tight limiter for credential-handling endpoints (login, password reset,
// email verification, registration). Keyed by IP. The goal is to make online
// brute-force / credential-stuffing and email-flooding impractical without
// hurting legitimate users.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTest || req.method === "OPTIONS", // don't count CORS preflights
  message: {
    error: "Too many attempts. Please try again later.",
    code: "RATE_LIMITED",
  },
});

// Looser global limiter applied to the whole API as a coarse abuse backstop.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTest || req.method === "OPTIONS",
  message: {
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMITED",
  },
});
