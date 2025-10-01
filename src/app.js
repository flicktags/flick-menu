import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import lookupsApi from "./routes/LookupsAPI.js";  // <-- add this

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/vendor", authRoutes);
app.use("/api/branches", authRoutes);
app.use("/api/lookups", lookupsApi);  // <-- register lookups routes//




//Defualt route if not found
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});
export default app;
  