// import dotenv from "dotenv";
// import http from "http";
// import app from "./src/app.js";
// import connectDB from "./src/config/db.js";

// dotenv.config();

// // Connect to DB
// connectDB();

// const PORT = process.env.PORT || 5000;

// const server = http.createServer(app);

// server.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
// });
import dotenv from "dotenv";
import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB(); // wait for DB connection
    console.log("✅ MongoDB connected");

    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
}

startServer();
