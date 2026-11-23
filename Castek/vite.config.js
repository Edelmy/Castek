import { defineConfig } from "vite";

// Vite (5173) le pasa a Flask (5000) todo lo que empiece con /api o /uploads.
// Así el navegador siempre habla con UN solo sitio (el 5173): funciona en localhost
// y también cuando otra persona entra por un enlace público (ngrok / cloudflared).
export default defineConfig({
  server: {
    host: true,          // acepta conexiones de otros equipos
    allowedHosts: true,  // acepta el dominio temporal del túnel
    proxy: {
      "^/api/": "http://127.0.0.1:5000",
      "^/uploads/": "http://127.0.0.1:5000",
    },
  },
});
