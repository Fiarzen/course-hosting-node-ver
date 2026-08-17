import { app } from "./app";

const PORT = process.env.PORT || 8080;

// Express 4 does not catch rejections from async route handlers, so one failing
// third-party call would otherwise kill the container. Log and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
