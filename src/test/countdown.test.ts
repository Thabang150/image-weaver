import { describe, expect, it } from 'vitest';
import { getCountdown, LAUNCH_TIME } from '@/lib/countdown';
describe('Johannesburg launch countdown', () => {
  it('launches at midnight Johannesburg, not midnight UTC', () => { expect(new Date(LAUNCH_TIME).toISOString()).toBe('2026-10-31T22:00:00.000Z'); });
  it('computes units correctly', () => { expect(getCountdown(LAUNCH_TIME - 90061000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1, finished: false }); });
  it('finishes exactly at launch and never becomes negative', () => { expect(getCountdown(LAUNCH_TIME).finished).toBe(true); expect(getCountdown(LAUNCH_TIME + 10000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, finished: true }); expect(getCountdown(LAUNCH_TIME - 1).finished).toBe(false); });
});
