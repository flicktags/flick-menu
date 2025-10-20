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
// import dotenv from "dotenv";
// import http from "http";
// import app from "./src/app.js";
// import connectDB from "./src/config/db.js";

// dotenv.config();

// const PORT = process.env.PORT || 5000;

// async function startServer() {
//   try {
//     await connectDB(); // wait for DB connection
//     console.log("✅ MongoDB connected");

//     const server = http.createServer(app);

//     server.listen(PORT, () => {
//       console.log(`🚀 Server running on port ${PORT}`);
//     });
//   } catch (err) {
//     console.error("❌ Failed to connect to MongoDB:", err.message);
//     process.exit(1);
//   }
// }

// startServer();

// server.js (Vercel entrypoint)
import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';

// Ensure a single DB connection per cold start.
let dbPromise;
function ensureDb() {
  if (!dbPromise) {
    console.log('[BOOT] Cold start: connecting MongoDB…');
    dbPromise = connectDB()
      .then(() => console.log('✅ [BOOT] MongoDB connected'))
      .catch((err) => {
        console.error('❌ [BOOT] MongoDB connect failed:', err?.message || err);
        // Re-throw so the first request gets a clear 500 response
        throw err;
      });
  }
  return dbPromise;
}

// Vercel reads the default export. Do NOT call listen() here.
export default async function handler(req, res) {
  try {
    await ensureDb();
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'DB connection failed',
        message: e?.message || String(e),
      })
    );
    return;
  }

  // Delegate to your Express app (which has all routes mounted).
  return app(req, res);
}

