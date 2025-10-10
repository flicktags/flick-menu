import express from "express";
import cors from "cors";
// import authRoutes from "./routes/authRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";   
import lookupsApi from "./routes/LookupsAPI.js";
import userRouter from "./routes/user.js"
import menuItemRoutes from "./routes/menuItemRoutes.js";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
// app.use("/api/vendor", authRoutes);
// app.use("/api/branches", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/lookups", lookupsApi);
app.use('/api/user', userRouter);
app.use("/api/menu", menuItemRoutes);



//Defualt route if not found
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});
export default app;
  