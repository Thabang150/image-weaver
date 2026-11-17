import { createFileRoute } from "@tanstack/react-router";

import {
  Brand,
  BotanicalImage,
  ContactActions,
  Countdown,
  Footer,
} from "@/components/wellness";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Healthy Ways SA — Launching Friday" },
      {
        name: "description",
        content: "Healthy Ways SA launches Friday, 20 November 2026.",
      },
      { property: "og:title", content: "Healthy Ways SA — Launching Friday" },
      {
        property: "og:description",
        content: "A new chapter in natural wellness starts Friday.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: CountdownPage,
});

function CountdownPage() {
  return (
    <>
      <main className="botanical-scene launch-hero">
        <BotanicalImage />

        <div className="logo-enter">
          <Brand className="mb-6 w-[245px] sm:w-[270px]" />
        </div>

        <div className="reveal mb-2 flex items-center gap-3">
          <span className="w-8 border-t border-gold/50" />
          <span className="eyebrow">A new chapter in natural wellness</span>
          <span className="w-8 border-t border-gold/50" />
        </div>

        <h1 className="launch-heading">
          A healthier rhythm
          <br />
          <em>starts Friday.</em>
        </h1>

        <p className="launch-copy reveal">
          Healthy Ways SA is almost ready. We can’t wait to welcome you.
        </p>

        <div className="reveal flex w-full justify-center">
          <Countdown />
        </div>

        <div className="reveal">
          <span className="eyebrow">Launching</span>
          <p className="launch-date">
            <time dateTime="2026-11-20T00:00:00+02:00">
              FRIDAY, 20 NOVEMBER 2026
            </time>
            <span className="mt-2 block text-[10px] text-muted-foreground">
              Midnight · Johannesburg time
            </span>
          </p>
        </div>

        <div className="reveal mt-4">
          <ContactActions />
        </div>
      </main>

      <Footer />
    </>
  );
}