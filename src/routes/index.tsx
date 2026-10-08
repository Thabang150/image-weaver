import { createFileRoute } from '@tanstack/react-router';
import { ArrowDown, Leaf } from 'lucide-react';
import { Brand, BotanicalImage, Countdown, ContactActions, Footer } from '@/components/wellness';
export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'Healthy Ways SA — A Natural New Chapter' },
    { name: 'description', content: 'A new Healthy Ways SA wellness experience launches on 15 October 2026. Organic natural wellness, rooted in care.' },
    { property: 'og:title', content: 'Healthy Ways SA — A Natural New Chapter' },
    { property: 'og:description', content: 'Something better for your wellness is on its way. Launching 15 October 2026.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }), component: Index,
});
function Index() {
  return <><main className="botanical-scene launch-hero"><BotanicalImage /><Brand className="w-[245px] sm:w-[270px] mb-6" /><div className="flex items-center gap-3 mb-2"><span className="w-8 border-t border-gold/50" /><span className="eyebrow">A natural new chapter</span><span className="w-8 border-t border-gold/50" /></div><h1 className="launch-heading">Something better for<br className="hidden sm:block" /> your wellness <em>is on its way.</em></h1><p className="launch-copy">Healthy Ways SA is preparing a new online wellness experience, bringing natural supplements and a simpler way to discover your wellness essentials.</p><Countdown /><span className="eyebrow">Launching</span><p className="launch-date"><time dateTime="2026-10-15T00:00:00+02:00">15 OCTOBER 2026</time><span className="block text-[10px] text-muted-foreground mt-2">Midnight · South Africa</span></p><ContactActions /><div className="flex items-center gap-2 mt-10 text-[10px] text-muted-foreground"><Leaf size={13} strokeWidth={1.3} /> Organic Natural Wellness</div></main><section className="bg-secondary text-center px-6 py-9"><ArrowDown size={14} className="mx-auto text-gold mb-3" /><p className="font-display text-2xl mb-2">The same care. A fresh beginning.</p><p className="text-xs text-muted-foreground mb-0">Your familiar natural wellness brand, with a new way to connect.</p></section><Footer launch /></>;
}
