import { useEffect, useState } from 'react';
import { Mail, Phone, MessageCircle } from 'lucide-react';
import { getCountdown } from '@/lib/countdown';
export function Brand({ className = 'w-[180px]' }: { className?: string }) {
  return <img className={`brand-logo ${className}`} src="/images/healtywayssa-logo-removebg-preview.png" alt="Healthy Ways SA — Organic Natural Wellness" width={720} height={480} />;
}
export function BotanicalImage() {
  return <img src="/images/botanical-hero.webp" className="botanical-image" alt="Sunlit green botanical leaves" width={1920} height={1280} fetchPriority="high" />;
}
export function Countdown() {
  const [countdown, setCountdown] = useState<ReturnType<typeof getCountdown> | null>(null);
  useEffect(() => {
    const update = () => setCountdown(getCountdown(Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, []);
  if (countdown?.finished) return <div className="my-8 reveal"><p className="section-title mb-2">We’re live. Welcome to a new chapter.</p><p className="text-xs text-muted-foreground mb-0">The new Healthy Ways SA experience is now live.</p></div>;
  return <div className="countdown" role="timer" aria-label="Time until midnight 1 November 2026, Johannesburg time">{(['days', 'hours', 'minutes', 'seconds'] as const).map(unit => <div className="countdown-unit" key={unit}><span className="countdown-value">{countdown?.[unit] ?? 0}</span><span className="countdown-label">{unit}</span></div>)}</div>;
}
export function ContactActions() {
  return <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4"><a className="contact-link" href="https://wa.me/27796871118" target="_blank" rel="noreferrer"><MessageCircle size={15} strokeWidth={1.8} /> WhatsApp</a><a className="contact-link" href="mailto:hello@healthywayssa.co.za"><Mail size={14} strokeWidth={1.8} /> Email</a><a className="contact-link" href="tel:+27796871118"><Phone size={14} strokeWidth={1.8} /> Call</a></div>;
}
export function Footer() {
  return <footer className="border-t border-border bg-background"><div className="footer-inner"><span>© 2026 Healthy Ways SA. Naturally, with care.</span><span>Rooted in nature. Made for your wellbeing.</span></div></footer>;
}
