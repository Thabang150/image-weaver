import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Mail, Phone, MessageCircle, ArrowUpRight } from 'lucide-react';
import { getCountdown } from '@/lib/countdown';
export function Brand({ className = 'w-[180px]' }: { className?: string }) {
  return <img className={`brand-logo ${className}`} src="/images/healthy-ways-logo.webp" alt="Healthy Ways SA — Organic Natural Wellness" width={720} height={480} />;
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
  if (countdown?.finished) return <p className="section-title my-8">A new chapter has arrived.</p>;
  return <div className="countdown" role="timer" aria-label="Time until midnight 15 October 2026, Johannesburg time">{(['days', 'hours', 'minutes', 'seconds'] as const).map(unit => <div className="countdown-unit" key={unit}><span className="countdown-number" key={countdown?.[unit]}>{countdown ? String(countdown[unit]).padStart(2, '0') : '—'}</span><span className="countdown-label">{unit}</span></div>)}</div>;
}
export function ContactActions() {
  return <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-4"><a className="contact-link" href="https://wa.me/27796871118" target="_blank" rel="noreferrer"><MessageCircle size={15} strokeWidth={1.5} /> WhatsApp</a><a className="contact-link" href="tel:+27796871118"><Phone size={15} strokeWidth={1.5} /> Call us</a><a className="contact-link" href="mailto:info@healtywayssa.co.za"><Mail size={15} strokeWidth={1.5} /> Email us</a></div>;
}
export function Footer({ launch = false }: { launch?: boolean }) {
  return <footer className="border-t border-border bg-background"><div className="footer-inner"><span>© 2026 Healthy Ways SA. Naturally, with care.</span>{launch ? <Link className="contact-link" to="/preview">A glimpse of what’s growing <ArrowUpRight size={14} /></Link> : <Link className="contact-link" to="/">Launching 15 October 2026 <ArrowUpRight size={14} /></Link>}<span>Rooted in nature. Made for your wellbeing.</span></div></footer>;
}
