import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import dotenv from "dotenv";

import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { coursesRouter } from "./routes/courses";
import { lessonsRouter } from "./routes/lessons";
import { assessmentsRouter } from "./routes/assessments";
import { enrollmentsRouter } from "./routes/enrollments";
import { paymentsRouter } from "./routes/payments";
import { webhooksRouter } from "./routes/webhooks";
import { authMiddleware } from "./middleware/auth";
import { authLimiter, globalLimiter } from "./middleware/rateLimit";

dotenv.config();

const app = express();

// Railway terminates TLS at a single proxy hop in front of the app. Trust
// exactly one hop so express-rate-limit reads the real client IP from
// X-Forwarded-For. Do NOT use `true` here — that would let clients spoof
// X-Forwarded-For and bypass the rate limiter.
app.set("trust proxy", 1);

// Security response headers (HSTS, nosniff, frame options, etc.).
app.use(helmet());

const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ||
  "https://mind-leaf.netlify.app,http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true,
  }),
);

app.use("/webhooks", express.raw({ type: "application/json" }), webhooksRouter);

app.use(express.json());

// Coarse global abuse backstop. Mounted after the raw-body webhook route so
// Stripe/PayPal webhook traffic is not throttled.
app.use(globalLimiter);

const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/files", express.static(uploadsDir));

app.use("/auth", authLimiter, authRouter);
app.use("/users", usersRouter.publicRouter);
app.use("/courses", coursesRouter.publicRouter);
app.use("/files", (_req, _res, next) => next());

app.use(authMiddleware);

app.use("/users", usersRouter.protectedRouter);
app.use("/courses", coursesRouter.protectedRouter);
app.use("/lessons", lessonsRouter);
app.use("/assessments", assessmentsRouter);
app.use("/enrollments", enrollmentsRouter);
app.use("/payments", paymentsRouter);

app.get("/", (_req, res) => {
  res.json({ message: "Courses Node backend is running" });
});

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

export { app };
