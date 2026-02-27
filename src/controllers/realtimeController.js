import Ably from "ably";

function getAblyRest() {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    throw new Error("Missing ABLY_API_KEY");
  }
  return new Ably.Rest({ key });
}

function buildCapability(branchId, stationKey, isMainLike) {
  const branchChannel = `kds:branch:${branchId}`;
  const stationChannel = `kds:branch:${branchId}:station:${stationKey}`;

  // MAIN / ALL can subscribe to whole branch
  if (isMainLike) {
    return {
      [branchChannel]: ["subscribe", "presence"],
    };
  }

  // station device can subscribe only to its own station channel
  return {
    [stationChannel]: ["subscribe", "presence"],
  };
}

export const createRealtimeTokenRequest = async (req, res) => {
  try {
    const branchId = String(
      req.body?.branchId || req.query?.branchId || "",
    ).trim();

    const stationKeyRaw = String(
      req.body?.stationKey || req.query?.stationKey || "MAIN",
    ).trim();

    const stationKey = stationKeyRaw.toUpperCase();

    if (!branchId) {
      return res.status(400).json({ error: "Missing branchId" });
    }

    const isMainLike =
      !stationKey || stationKey === "MAIN" || stationKey === "ALL";

    const capability = buildCapability(
      branchId,
      stationKey || "MAIN",
      isMainLike,
    );

    const clientId = `${req.user?.uid || "unknown"}:${branchId}:${stationKey || "MAIN"}`;

    const ably = getAblyRest();

    const tokenRequest = await ably.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify(capability),
      ttl: 60 * 60 * 1000, // 1 hour
    });

    return res.status(200).json({
      ok: true,
      realtime: {
        clientId,
        branchId,
        stationKey: stationKey || "MAIN",
        capability,
        tokenRequest,
      },
    });
  } catch (err) {
    console.error("createRealtimeTokenRequest error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};