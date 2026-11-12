import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: "/preview",
      search: { view: "home" },
      replace: true,
    });
  },
  head: () => ({
    meta: [
      { title: "Healthy Ways SA — Home" },
      {
        name: "description",
        content: "Healthy Ways SA natural wellness storefront.",
      },
      { property: "og:title", content: "Healthy Ways SA — Home" },
      {
        property: "og:description",
        content: "Explore the Healthy Ways SA storefront.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return null;
}
