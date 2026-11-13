import { createFileRoute } from "@tanstack/react-router";
import { handleRequest } from "../server/http";
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
    },
  },
});
