import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/*
 * The notification service worker must be served from the site root so its scope
 * can be "/", which is what allows ServiceWorkerRegistration.showNotification()
 * to be used in place of the illegal `new Notification(...)` constructor.
 *
 * It is kept in the project root rather than public/ so that public/ stays free of
 * an index.html — a public/index.html shadows the app's real index.html in dev and
 * makes the page render blank.
 *
 * Vite copyPublicDir defaults to true, which is kept, so /Wasterovalreminder.png
 * and anything else in public/ still ships.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The app itself (dist/index.html, as before).
        main: "index.html",
        // Emitted as dist/notification-sw.js, unhashed and at the root.
        "notification-sw": "notification-sw.js"
      },
      output: {
        // Keep the worker at the root with its own name; only the app chunks go
        // into assets/ with content hashes.
        entryFileNames: chunkInfo =>
          chunkInfo.name === "notification-sw" ? "notification-sw.js" : "assets/[name]-[hash].js"
      }
    }
  }
});