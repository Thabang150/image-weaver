export const LAUNCH_TIME = Date.parse("2026-10-15T00:00:00+02:00");
export function getCountdown(now: number) {
  const seconds = Math.max(0, Math.ceil((LAUNCH_TIME - now) / 1000));
  return { days: Math.floor(seconds / 86400), hours: Math.floor((seconds % 86400) / 3600), minutes: Math.floor((seconds % 3600) / 60), seconds: seconds % 60, finished: seconds === 0 };
}
