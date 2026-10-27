import { useEffect } from "react";
import { toast } from "sonner";
import { MAP_ERROR_EVENT } from "@/lib/googleMaps";

/**
 * Detecta cuando la pestaña quedó abierta con una versión vieja de la app
 * (los vendedores dejan la app abierta días). Compara el JS principal cargado
 * con el que sirve hoy el sitio y ofrece actualizar; ante un error del mapa
 * con versión vieja, recarga sola (los borradores quedan guardados).
 */
const CHECK_EVERY_MS = 5 * 60_000;

function currentBundle(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

async function publishedBundle(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/\/assets\/index-[^"']+\.js/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export function AppUpdateWatcher() {
  useEffect(() => {
    const loaded = currentBundle();
    if (!loaded) return; // entorno de desarrollo: no aplica
    let notified = false;

    const isStale = async () => {
      const latest = await publishedBundle();
      return !!latest && latest !== loaded;
    };

    const check = async () => {
      if (notified || !(await isStale())) return;
      notified = true;
      toast("Hay una versión nueva de la app", {
        description: "Actualizá para tener los últimos arreglos (también del mapa).",
        duration: Infinity,
        action: { label: "Actualizar", onClick: () => location.reload() },
      });
    };

    const onMapError = async () => {
      if (await isStale()) location.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(MAP_ERROR_EVENT, onMapError);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(MAP_ERROR_EVENT, onMapError);
    };
  }, []);

  return null;
}
