import { useState, useEffect } from 'react';

interface CountdownProps {
  targetDate: string;
}

export const Countdown = ({ targetDate }: CountdownProps) => {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const target = new Date(targetDate).getTime();

    const updateCountdown = () => {
      const now = new Date().getTime();
      const difference = target - now;

      if (difference <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      });
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  if (!isMounted || !timeLeft) return <div className="h-16" />; // Prevent hydration mismatch

  return (
    <div className="flex gap-4 text-center">
      <div className="flex flex-col">
        <span className="text-4xl font-bold tabular-nums">{timeLeft.days}</span>
        <span className="text-xs uppercase text-stone-500">Days</span>
      </div>
      <div className="flex flex-col">
        <span className="text-4xl font-bold tabular-nums">{timeLeft.hours}</span>
        <span className="text-xs uppercase text-stone-500">Hours</span>
      </div>
      <div className="flex flex-col">
        <span className="text-4xl font-bold tabular-nums">{timeLeft.minutes}</span>
        <span className="text-xs uppercase text-stone-500">Min</span>
      </div>
      <div className="flex flex-col">
        <span className="text-4xl font-bold tabular-nums">{timeLeft.seconds}</span>
        <span className="text-xs uppercase text-stone-500">Sec</span>
      </div>
    </div>
  );
};
