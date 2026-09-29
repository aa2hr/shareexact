import type { SessionKind } from "./stocks";

export interface MarketSession {
  kind: SessionKind;
  label: string;
  detail: string;
  nyTime: string;
  nyDate: string;
  isNightDesk: boolean;
}

function nyParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  return {
    hour,
    minute,
    mins: hour * 60 + minute,
    weekday,
    nyTime: `${get("hour")}:${get("minute")}`,
    nyDate: `${weekday} ${get("month")} ${get("day")}`,
  };
}

export function getMarketSession(now = new Date()): MarketSession {
  const t = nyParts(now);
  const weekend = t.weekday === "Sat" || t.weekday === "Sun";
  const open = t.mins >= 9 * 60 + 30 && t.mins < 16 * 60;
  const pre = t.mins >= 4 * 60 && t.mins < 9 * 60 + 30;
  const after = t.mins >= 16 * 60 && t.mins < 20 * 60;

  if (weekend) {
    return {
      kind: "weekend",
      label: "Weekend tape",
      detail: "NYSE is closed. Stock Tokens still trade. Oracle feeds are stale until Sunday night / Monday open.",
      nyTime: t.nyTime,
      nyDate: t.nyDate,
      isNightDesk: true,
    };
  }
  if (open) {
    return {
      kind: "open",
      label: "Cash session",
      detail: "NYSE is open. Token price should track the cash print. Exact-transfer still applies — multipliers do not wait for the bell.",
      nyTime: t.nyTime,
      nyDate: t.nyDate,
      isNightDesk: false,
    };
  }
  if (pre) {
    return {
      kind: "pre",
      label: "Pre-market",
      detail: "Cash pre-market is thin. Token books on Robinhood Chain are already live.",
      nyTime: t.nyTime,
      nyDate: t.nyDate,
      isNightDesk: true,
    };
  }
  if (after) {
    return {
      kind: "after",
      label: "After hours",
      detail: "Cash after-hours until 20:00 ET. On-chain books do not close. This is the desk the chain was built for.",
      nyTime: t.nyTime,
      nyDate: t.nyDate,
      isNightDesk: true,
    };
  }
  return {
    kind: "after",
    label: "Overnight",
    detail: "US cash is dark. Tokenized NVDA, AAPL, TSLA still print on chain 4663.",
    nyTime: t.nyTime,
    nyDate: t.nyDate,
    isNightDesk: true,
  };
}
