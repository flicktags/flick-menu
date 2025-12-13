import Branch from "../models/Branch.js";

export const publicBranchRedirect = async (req, res) => {
  try {
    const slug = req.params.slug;

    const branch = await Branch.findOne({ publicSlug: slug }).lean();
    if (!branch) {
      return res.status(404).send("Invalid link");
    }

    // redirect to Flutter entry with hidden branchId
    return res.redirect(`/index.html?branch=${branch.branchId}`);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
};
