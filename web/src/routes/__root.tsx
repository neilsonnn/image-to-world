import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../style.css";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "image-to-world | Spatial studio" },
    ],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme
          appearance="dark"
          accentColor="gray"
          grayColor="gray"
          radius="small"
          scaling="90%"
        >
          <Outlet />
        </Theme>
        <Scripts />
      </body>
    </html>
  ),
});
