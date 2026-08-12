import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Public browser configuration. The fallback prevents a deployment from
// producing a blank page if the hosting build does not inject Vite env vars.
const PUBLIC_BACKEND_URL = "https://ofwhxaglbcgyksauwjby.supabase.co";
const PUBLIC_BACKEND_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9md2h4YWdsYmNneWtzYXV3amJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDIyMDgsImV4cCI6MjA3NTQxODIwOH0.9HIeqKfq2z4Xi6oXgEBUg2_ttFj2VajlYVO-e84hSpw";
// Clave de navegador de Google Maps (restringida por dominio en Google Cloud).
const PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "AIzaSyBmvJph4LmrbtW7skeczzpBIyb9WWzFKo4";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL || PUBLIC_BACKEND_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_BACKEND_KEY,
      ),
      // Se fija la clave verificada: algunas builds inyectan una clave expirada
      // por variable de entorno y eso deja los mapas sin cargar en producción.
      "import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY": JSON.stringify(
        PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
      ),
      "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(PUBLIC_GOOGLE_MAPS_BROWSER_KEY),
    },
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
