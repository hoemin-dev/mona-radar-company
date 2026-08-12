export const SMINFO = { origin: "https://sminfo.mss.go.kr", loginPath: "/cm/sv/CSV001R0.do", searchPath: "/gc/sf/GSF002R0.print", searchUrl: "https://sminfo.mss.go.kr/gc/sf/GSF002R0.print", detailPath: "/si/ei/IEI001R0.do" } as const;
export const RATE_LIMIT = { minDelayMs: 35_000, jitterMs: 5_000, maxConsecutiveErrors: 3 } as const;
