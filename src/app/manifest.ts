import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Pocket Base", short_name: "Pocket Base",
    description: "Make little games, share your worlds, and keep them in your pocket.",
    start_url: "/", scope: "/", display: "standalone", lang: "en",
    background_color: "#faf8f2", theme_color: "#faf8f2",
    categories: ["games", "education"], prefer_related_applications: false,
    icons: [192,512].flatMap(size => [
      { src: `/icons/pocket-base-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" as const },
      { src: `/icons/pocket-base-maskable-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "maskable" as const },
    ]),
  };
}
