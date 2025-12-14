import Branch from "../models/Branch.js";

// You can call it with businessId "BR-000005"
export async function touchBranchMenuStampByBizId(branchId) {
  if (!branchId) return;

  await Branch.updateOne(
    { branchId },
    {
      $inc: { menuVersion: 1 },
      $set: { menuUpdatedAt: new Date() },
    }
  );
}
