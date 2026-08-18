// Cliente de IA compartido.
// Usa la API directa de Gemini (endpoint compatible con OpenAI) cuando hay
// GEMINI_API_KEY configurada, y cae al gateway de Lovable si falla o no está.
// El body es el mismo formato chat/completions en ambos casos.

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AiChatBody = Record<string, unknown> & { model: string };

export type AiChatResult = {
  ok: boolean;
  status: number;
  data: any;
  errorText: string;
  proveedor: "gemini" | "gateway" | "ninguno";
};

/** Gemini directo no acepta el prefijo de proveedor en el nombre del modelo. */
function modeloGemini(model: string): string {
  return model.replace(/^google\//, "");
}

async function llamar(url: string, key: string, body: AiChatBody): Promise<AiChatResult & { proveedor: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return { ok: false, status: res.status, data: null, errorText, proveedor: "gemini" };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data, errorText: "", proveedor: "gemini" };
}

export async function aiChat(body: AiChatBody): Promise<AiChatResult> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
  const gatewayKey = Deno.env.get("LOVABLE_API_KEY") || "";

  if (geminiKey) {
    try {
      const r = await llamar(GEMINI_URL, geminiKey, { ...body, model: modeloGemini(body.model) });
      if (r.ok) return { ...r, proveedor: "gemini" };
      console.error(`[ai-chat] Gemini ${r.status}: ${r.errorText.slice(0, 500)}`);
      // 400/404 = pedido inválido para Gemini; el resto puede ser cuota o red.
      if (!gatewayKey) return { ...r, proveedor: "gemini" };
    } catch (e) {
      console.error("[ai-chat] Gemini error de red", e);
      if (!gatewayKey) {
        return { ok: false, status: 0, data: null, errorText: String(e), proveedor: "gemini" };
      }
    }
  }

  if (!gatewayKey) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorText: "No hay GEMINI_API_KEY ni LOVABLE_API_KEY configuradas",
      proveedor: "ninguno",
    };
  }

  try {
    const r = await llamar(GATEWAY_URL, gatewayKey, body);
    return { ...r, proveedor: "gateway" };
  } catch (e) {
    return { ok: false, status: 0, data: null, errorText: String(e), proveedor: "gateway" };
  }
}

export function hayProveedorIA(): boolean {
  return Boolean(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY"));
}
