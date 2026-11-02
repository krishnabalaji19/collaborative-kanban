const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "The server is running" });
});

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/boards", require("./routes/board.routes"));
app.use("/api/columns", require("./routes/column.routes"));
app.use("/api/tasks", require("./routes/task.routes"));
app.use("/api/activity", require("./routes/activity.routes"));
app.use("/api/members", require("./routes/member.routes"));
app.use("/api/organizations", require("./routes/organization.routes"));
app.use("/api/tenants", require("./routes/tenant.routes"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
