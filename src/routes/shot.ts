/**
 * GET /shot?p=<absolute screenshot path> — streams a ManicTime screenshot (or
 * thumbnail) as a cacheable JPEG. Much faster than shipping base64 through a
 * server function: the browser loads, decodes and caches it natively.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { screenshotResponse } = await import("../server/screenshots.js");
        return screenshotResponse(new URL(request.url).searchParams.get("p"));
      },
    },
  },
});
