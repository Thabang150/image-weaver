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

  useEffect(() => {
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

  if (!timeLeft) return null;

  return (
    <div className="flex gap-4 text-center">
      <div>
        <div className="text-4xl font-bold">{timeLeft.days}</div>
        <div className="text-sm uppercase">Days</div>
      </div>
      <div>
        <div className="text-4xl font-bold">{timeLeft.hours}</div>
        <div className="text-sm uppercase">Hours</div>
      </div>
      <div>
        <div className="text-4xl font-bold">{timeLeft.minutes}</div>
        <div className="text-sm uppercase">Minutes</div>
      </div>
      <div>
        <div className="text-4xl font-bold">{timeLeft.seconds}</div>
        <div className="text-sm uppercase">Seconds</div>
      </div>
    </div>
  );
};
