import Ably from "ably";

let _ably = null;

function getAbly() {
  if (_ably) return _ably;

  const key = process.env.ABLY_API_KEY;
  if (!key) {
    throw new Error("Missing ABLY_API_KEY");
  }

  _ably = new Ably.Rest({ key });
  return _ably;
}

export function branchChannel(branchId) {
  return `kds:branch:${String(branchId || "").trim()}`;
}

export function stationChannel(branchId, stationKey) {
  return `kds:branch:${String(branchId || "").trim()}:station:${String(
    stationKey || "MAIN",
  )
    .trim()
    .toUpperCase()}`;
}

export async function publishEvent(channelName, eventName, payload) {
  try {
    const ably = getAbly();
    await ably.channels.get(channelName).publish(eventName, payload);
    console.log(`[ABLY] published ${eventName} -> ${channelName}`);
  } catch (err) {
    // never break main API flow if Ably fails
    console.error(
      `[ABLY] publish failed ${eventName} -> ${channelName}:`,
      err?.message || err,
    );
  }
}

/**
 * Publish to branch channel + all station channels involved in items.
 */
export async function publishOrderFanout({
  branchId,
  eventName,
  payload,
  items = [],
}) {
  const branch = String(branchId || "").trim();
  if (!branch) return;

  // 1) publish to MAIN / branch-wide channel
  await publishEvent(branchChannel(branch), eventName, payload);

  // 2) publish to each station involved
  const stations = new Set(
    (Array.isArray(items) ? items : [])
      .map((it) => String(it?.kdsStationKey || "MAIN").trim().toUpperCase())
      .filter(Boolean),
  );

  for (const st of stations) {
    await publishEvent(
      stationChannel(branch, st),
      eventName,
      {
        ...payload,
        stationKey: st,
      },
    );
  }
}