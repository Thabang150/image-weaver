import { createFileRoute } from "@tanstack/react-router";
import { Countdown } from "../components/Countdown";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4 bg-stone-50 text-stone-900">
      <img 
        src="/images/healthy-ways-logo.webp" 
        alt="Healthy Ways Logo" 
        className="w-48 mb-8"
      />
      <h1 className="text-3xl font-serif mb-8">Coming Soon</h1>
      <Countdown targetDate="2026-10-15T00:00:00+02:00" />
      <div className="mt-12 w-full max-w-4xl">
        <img 
          src="/images/botanical-hero.webp" 
          alt="Botanical Hero" 
          className="w-full h-auto rounded-lg shadow-xl"
        />
      </div>
    </div>
  );
}
