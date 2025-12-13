import express from "express";
import cors from "cors";
import path from "path";

// Routes
import authRouter from "./routes/authRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";   
import lookupsApi from "./routes/LookupsAPI.js";
import userRouter from "./routes/user.js"
import menuItemRoutes from "./routes/menuItemRoutes.js";
import QrCodeRouter from "./routes/qrRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import ordersRoutes from "./routes/ordersRoutes.js";
import themeMappingRoutes from "./routes/themeMappingRoutes.js";

// Public redirect
import { publicBranchRedirect } from "./routes/publicRedirect.js";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/vendor", vendorRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/lookups", lookupsApi);
app.use("/api/user", userRouter);
app.use("/api/menu", menuItemRoutes);
app.use("/api/qrcode", QrCodeRouter);
app.use("/api/public", publicRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/vendor", themeMappingRoutes);

// --- Public branch redirect ---
app.get("/api/public/branch/redirect/:slug", publicBranchRedirect);

// Serve Flutter static files
const webBuildPath = path.join(process.cwd(), "build/web");
app.use(express.static(webBuildPath));

// Catch-all SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(webBuildPath, 'index.html'));
});

// Default 404 for APIs
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

export default app;

// import express from "express";
// import cors from "cors";
// // import authRoutes from "./routes/authRoutes.js";
// import authRouter from "./routes/authRoutes.js";

// import vendorRoutes from "./routes/vendorRoutes.js";
// import branchRoutes from "./routes/branchRoutes.js";   
// import lookupsApi from "./routes/LookupsAPI.js";
// import userRouter from "./routes/user.js"
// import menuItemRoutes from "./routes/menuItemRoutes.js";
// import QrCodeRouter from "./routes/qrRoutes.js";
// import publicRoutes from "./routes/publicRoutes.js";
// import ordersRoutes from "./routes/ordersRoutes.js";
// import themeMappingRoutes from "./routes/themeMappingRoutes.js";

// // New redirect import
// import { publicBranchRedirect } from "./routes/publicRedirect.js";

// const app = express();

// // Middlewares
// app.use(cors());
// app.use(express.json());

// // Routes
// // app.use("/api/vendor", authRoutes);
// // app.use("/api/branches", authRoutes);
// app.use("/api/auth", authRouter);     // GET /api/auth/bootstrap
// app.use("/api/vendor", vendorRoutes);
// app.use("/api/branches", branchRoutes);
// app.use("/api/lookups", lookupsApi);
// app.use('/api/user', userRouter);
// app.use("/api/menu", menuItemRoutes);
// app.use("/api/qrcode", QrCodeRouter);
// app.use("/api/public", publicRoutes);
// app.use("/api/orders", ordersRoutes);
// app.use("/api/vendor", themeMappingRoutes);

// // --- Public branch redirect route ---
// // IMPORTANT: This must be BEFORE the Flutter static serving
// app.get("/api/public/branch/redirect/:slug", publicBranchRedirect);

// import path from "path";
// const webBuildPath = path.join(process.cwd(), "build/web");
// app.use(express.static(webBuildPath));

// // Catch-all SPA fallback (for Flutter routing)
// app.get("/*", (req, res) => {
//   res.sendFile(path.join(webBuildPath, "index.html"));
// });

// //Defualt route if not found
// app.use((req, res) => {
//   res.status(404).json({ error: "Not Found" });
// });
// export default app;
  