const MAX_CLOCK_SAMPLES = 7;
const BEST_SAMPLE_COUNT = 5;
const MAX_SAMPLE_RTT_MS = 4000;
const DIAGNOSTIC_STORAGE_KEY = "mq_sync_diagnostics";
const DIAGNOSTIC_QUERY_KEYS = new Set(["mqDebugSync", "debugSync"]);

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isDiagnosticEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of DIAGNOSTIC_QUERY_KEYS) {
      if (params.has(key)) return true;
    }
    return localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function recordSyncDiagnostic(scope, event, details = {}) {
  if (!isDiagnosticEnabled()) {
    return;
  }

  const bucket = window.__mqSyncDiagnostics ||= [];
  bucket.push({
    at: new Date().toISOString(),
    scope,
    event,
    ...details,
  });

  if (bucket.length > 120) {
    bucket.splice(0, bucket.length - 120);
  }
}

export class ClockSync {
  constructor(scope = "clock") {
    this.scope = scope;
    this.offsetMs = 0;
    this.samples = [];
    this.initialized = false;
  }

  updateFromServerTime(serverTimeUnix, timing = null) {
    const serverMs = toFiniteNumber(serverTimeUnix, 0) * 1000;
    if (!(serverMs > 0)) {
      return false;
    }

    const requestStartedAtMs = toFiniteNumber(timing?.requestStartedAtMs);
    const responseReceivedAtMs = toFiniteNumber(timing?.responseReceivedAtMs);
    const rttMs = toFiniteNumber(
      timing?.rttMs,
      requestStartedAtMs !== null && responseReceivedAtMs !== null
        ? responseReceivedAtMs - requestStartedAtMs
        : null
    );
    const hasTiming = requestStartedAtMs !== null
      && responseReceivedAtMs !== null
      && rttMs !== null
      && rttMs >= 0
      && rttMs <= MAX_SAMPLE_RTT_MS;

    if (!hasTiming) {
      if (!this.initialized) {
        this.offsetMs = Date.now() - serverMs;
        this.initialized = true;
        recordSyncDiagnostic(this.scope, "clock-fallback", {
          offsetMs: Math.round(this.offsetMs),
        });
      }
      return false;
    }

    const estimatedServerAtResponseMs = serverMs + (rttMs / 2);
    const sampleOffsetMs = responseReceivedAtMs - estimatedServerAtResponseMs;
    if (!Number.isFinite(sampleOffsetMs)) {
      return false;
    }

    this.samples.push({
      offsetMs: sampleOffsetMs,
      rttMs,
      atMs: responseReceivedAtMs,
    });
    this.samples.sort((a, b) => a.rttMs - b.rttMs);
    this.samples = this.samples.slice(0, MAX_CLOCK_SAMPLES);

    const bestOffsets = this.samples
      .slice(0, BEST_SAMPLE_COUNT)
      .map((sample) => sample.offsetMs);
    this.offsetMs = median(bestOffsets);
    this.initialized = true;

    recordSyncDiagnostic(this.scope, "clock-sample", {
      rttMs: Math.round(rttMs),
      offsetMs: Math.round(this.offsetMs),
      samples: this.samples.length,
    });
    return true;
  }

  getNowMs() {
    return Date.now() - this.offsetMs;
  }

  getNowUnix() {
    return this.getNowMs() / 1000;
  }

  getOffsetMs() {
    return this.offsetMs;
  }
}
