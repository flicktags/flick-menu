import Branch from "../models/Branch.js";

export const publicBranchRedirect = async (req, res) => {
  try {
    const slug = req.params.slug;

    if (!slug) {
      return res.status(400).json({ message: "Slug is required" });
    }

    const branch = await Branch.findOne({ publicSlug: slug }).lean();
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // 🔥 Return branchId as JSON instead of redirecting
    return res.json({
      branchId: branch.branchId
    });

  } catch (err) {
    console.error("⚠️ publicBranchRedirect error →", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// import Branch from "../models/Branch.js";

// export const publicBranchRedirect = async (req, res) => {
//   try {
//     const slug = req.params.slug;

//     const branch = await Branch.findOne({ publicSlug: slug }).lean();
//     if (!branch) {
//       return res.status(404).send("Invalid link");
//     }

//     // redirect to Flutter entry with hidden branchId
//     return res.redirect(`/index.html?branch=${branch.branchId}`);
//   } catch (err) {
//     console.error(err);
//     return res.status(500).send("Server error");
//   }
// };
