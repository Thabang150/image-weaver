import { createFileRoute } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { Brand } from '@/components/wellness';
export const Route = createFileRoute('/preview')({
  head: () => ({ meta: [
    { title: 'Healthy Ways SA — Website Development Preview' },
    { name: 'description', content: 'Development preview of the new Healthy Ways SA website.' },
    { property: 'og:title', content: 'Healthy Ways SA — Website Development Preview' },
    { property: 'og:description', content: 'Follow the progress of the new Healthy Ways SA website.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
    { name: 'robots', content: 'noindex, nofollow' },
  ] }), component: Preview,
});
const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;
function Preview() {
  return <main className="dev-preview">
    <div className="logo-enter"><Brand className="w-[220px] mb-8" /></div>
    <span className="eyebrow reveal" style={d(250)}>Healthy Ways SA · Organic Natural Wellness</span>
    <h1 className="section-title mt-4 mb-4 reveal" style={d(400)}>Website Development Preview</h1>
    <p className="launch-copy reveal" style={d(550)}>This page will be updated as we build the new Healthy Ways SA website.</p>
    <div className="dev-update reveal" style={d(700)}>
      <span className="eyebrow">Latest update</span>
      <p className="font-display text-2xl mt-3 mb-2">Website foundation &amp; launch experience</p>
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-0"><span className="pulse-dot" /> Currently being developed</p>
    </div>
  </main>;
}
