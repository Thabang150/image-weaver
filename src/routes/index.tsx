import { createFileRoute } from "@tanstack/react-router";
import { Leaf, Mail, MessageCircle, Phone } from "lucide-react";
import type { CSSProperties } from "react";

import { Brand, BotanicalImage, Countdown, Footer } from "@/components/wellness";
import { CartTrigger } from "@/components/storefront/cart";
import { Catalogue } from "@/components/storefront/catalogue";

const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const product = search["product"];
    return typeof product === "string" && productSlugPattern.test(product) ? { product } : {};
  },
  head: () => ({
    meta: [
      { title: "Healthy Ways SA — A Natural New Chapter" },
      {
        name: "description",
        content:
          "A new Healthy Ways SA online wellness experience launches on 1 November 2026. Organic natural wellness, rooted in care.",
      },
      { property: "og:title", content: "Healthy Ways SA — A Natural New Chapter" },
      {
        property: "og:description",
        content: "A new Healthy Ways SA online experience arrives 1 November 2026.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const leaves = [
  { top: "14%", left: "7%", size: 34, t: "19s", d: "0s" },
  { top: "62%", left: "4%", size: 22, t: "23s", d: "-6s" },
  { top: "22%", right: "8%", size: 26, t: "21s", d: "-3s" },
  { top: "72%", right: "10%", size: 38, t: "25s", d: "-9s" },
];

export function LaunchExperience() {
  return (
    <>
      <main className="botanical-scene launch-hero">
        <div className="launch-header-actions">
          <CartTrigger />
        </div>
        <BotanicalImage />
        <div className="ambient-glow" style={{ top: "10%", left: "20%" }} aria-hidden />
        {leaves.map(({ size, t, d: delay, ...pos }, i) => (
          <Leaf
            key={i}
            aria-hidden
            className="floating-leaf"
            size={size}
            strokeWidth={1}
            style={{ ...pos, ["--t" as string]: t, ["--d" as string]: delay } as CSSProperties}
          />
        ))}
        <div className="logo-enter">
          <Brand className="mb-6 w-[245px] sm:w-[270px]" />
        </div>
        <div className="reveal mb-2 flex items-center gap-3" style={d(300)}>
          <span className="w-8 border-t border-gold/50" />
          <span className="eyebrow">Established care · A new chapter</span>
          <span className="w-8 border-t border-gold/50" />
        </div>
        <h1 className="launch-heading reveal" style={d(450)}>
          Natural wellness,
          <br className="hidden sm:block" /> <em>beautifully renewed.</em>
        </h1>
        <p className="launch-copy reveal" style={d(600)}>
          A new Healthy Ways SA online experience is almost here — the same trusted, personal care
          you know, now a little closer to home.
        </p>
        <div className="reveal flex w-full justify-center" style={d(750)}>
          <Countdown />
        </div>
        <div className="reveal" style={d(900)}>
          <span className="eyebrow">Launching</span>
          <p className="launch-date">
            <time dateTime="2026-11-01T00:00:00+02:00">1 NOVEMBER 2026</time>
            <span className="mt-2 block text-[10px] text-muted-foreground">
              Midnight · South Africa
            </span>
          </p>
        </div>
        <div
          className="reveal mt-4 flex items-center gap-2 text-[10px] text-muted-foreground"
          style={d(1050)}
        >
          <Leaf size={13} strokeWidth={1.3} /> Organic Natural Wellness
        </div>
        <a className="enquiry-button primary mt-7" href="#catalogue">
          Explore the catalogue
        </a>
      </main>
      <section className="enquiry" aria-labelledby="enquiry-title">
        <span className="eyebrow">Before we launch</span>
        <h2 id="enquiry-title" className="section-title mt-4 mb-4">
          Have an enquiry before launch?
        </h2>
        <p className="launch-copy mx-auto mb-8">
          Whether you have a question about our products or would like to learn more about Healthy
          Ways SA, we’d be happy to hear from you.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            className="enquiry-button primary"
            href="https://wa.me/27796871118"
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={15} strokeWidth={1.5} /> Chat on WhatsApp
          </a>
          <a className="enquiry-button secondary" href="mailto:info@healtywayssa.co.za">
            <Mail size={15} strokeWidth={1.5} /> Email Us
          </a>
        </div>
        <a className="contact-link mt-6 text-muted-foreground" href="tel:+27796871118">
          <Phone size={14} strokeWidth={1.5} /> 079 687 1118
        </a>
      </section>
    </>
  );
}

function Index() {
  const { product } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <LaunchExperience />
      <Catalogue
        selectedSlug={product}
        onSelectProduct={(slug) => {
          void navigate({ search: { product: slug } });
        }}
        onBackToCatalogue={() => {
          void navigate({ search: {} });
        }}
      />
      <Footer />
    </>
  );
}
