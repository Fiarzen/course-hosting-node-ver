import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { coursesRouter } from "./routes/courses";
import { lessonsRouter } from "./routes/lessons";
import { enrollmentsRouter } from "./routes/enrollments";
import { paymentsRouter } from "./routes/payments";
import { webhooksRouter } from "./routes/webhooks";
import { authMiddleware } from "./middleware/auth";

dotenv.config();

const app = express();

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

const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/files", express.static(uploadsDir));

app.use("/auth", authRouter);
app.use("/users", usersRouter.publicRouter);
app.use("/courses", coursesRouter.publicRouter);
app.use("/files", (_req, _res, next) => next());

app.use(authMiddleware);

app.use("/users", usersRouter.protectedRouter);
app.use("/courses", coursesRouter.protectedRouter);
app.use("/lessons", lessonsRouter);
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
