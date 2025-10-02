import dotenv from "dotenv";
import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";

dotenv.config();

// Connect to DB
connectDB();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
}); //
