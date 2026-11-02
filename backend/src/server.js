require("dotenv").config();
const http = require("http");
const app = require("./app");
const prisma = require("./config/database");
const { initSockets } = require("./sockets");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

initSockets(server);

server.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log("Database connected");
  } catch (err) {
    console.error("Database connection failed:", err.message);
  }
  console.log(`Server running on http://localhost:${PORT}`);
});
