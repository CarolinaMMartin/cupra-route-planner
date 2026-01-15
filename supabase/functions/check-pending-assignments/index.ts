import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting check-pending-assignments function...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calcular fecha hace 3 días
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const threeDaysAgoISO = threeDaysAgo.toISOString();

    console.log(`Buscando asignaciones pendientes anteriores a: ${threeDaysAgoISO}`);

    // Buscar asignaciones que llevan más de 3 días sin cierre
    const { data: asignacionesPendientes, error: fetchError } = await supabase
      .from("asignaciones_vendedores_clientes")
      .select(`
        id,
        vendedor_id,
        client_id,
        prospecto_place_id,
        es_prospecto,
        estado,
        created_at
      `)
      .in("estado", ["Asignado", "Por visitar"])
      .lt("created_at", threeDaysAgoISO);

    if (fetchError) {
      console.error("Error fetching asignaciones:", fetchError);
      throw fetchError;
    }

    console.log(`Encontradas ${asignacionesPendientes?.length || 0} asignaciones pendientes`);

    if (!asignacionesPendientes || asignacionesPendientes.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No hay asignaciones pendientes que requieran notificación",
          processed: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener notificaciones existentes para evitar duplicados
    const asignacionIds = asignacionesPendientes.map((a) => a.id);
    const { data: notificacionesExistentes, error: notifError } = await supabase
      .from("notificaciones")
      .select("asignacion_id")
      .in("asignacion_id", asignacionIds)
      .eq("tipo", "asignacion_pendiente");

    if (notifError) {
      console.error("Error fetching notificaciones existentes:", notifError);
      throw notifError;
    }

    const asignacionesConNotificacion = new Set(
      (notificacionesExistentes || []).map((n) => n.asignacion_id)
    );

    // Filtrar asignaciones que no tienen notificación
    const asignacionesSinNotificacion = asignacionesPendientes.filter(
      (a) => !asignacionesConNotificacion.has(a.id)
    );

    console.log(
      `${asignacionesSinNotificacion.length} asignaciones requieren nueva notificación`
    );

    if (asignacionesSinNotificacion.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Todas las asignaciones pendientes ya tienen notificación",
          processed: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener información de clientes y prospectos para personalizar mensajes
    const clientIds = asignacionesSinNotificacion
      .filter((a) => a.client_id)
      .map((a) => a.client_id);
    const prospectoIds = asignacionesSinNotificacion
      .filter((a) => a.prospecto_place_id)
      .map((a) => a.prospecto_place_id);

    const [clientesRes, prospectosRes] = await Promise.all([
      clientIds.length > 0
        ? supabase
            .from("clientes")
            .select("client_id, razon_social")
            .in("client_id", clientIds)
        : Promise.resolve({ data: [] }),
      prospectoIds.length > 0
        ? supabase
            .from("prospectos")
            .select("place_id, nombre")
            .in("place_id", prospectoIds)
        : Promise.resolve({ data: [] }),
    ]);

    const clientesMap = new Map<string, string>();
    (clientesRes.data || []).forEach((c: any) =>
      clientesMap.set(c.client_id, c.razon_social)
    );

    const prospectosMap = new Map<string, string>();
    (prospectosRes.data || []).forEach((p: any) =>
      prospectosMap.set(p.place_id, p.nombre)
    );

    // Crear notificaciones
    const notificacionesACrear = asignacionesSinNotificacion.map((asig) => {
      const diasPendiente = Math.floor(
        (now.getTime() - new Date(asig.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      let nombreCliente = "Cliente";
      if (asig.es_prospecto && asig.prospecto_place_id) {
        nombreCliente = prospectosMap.get(asig.prospecto_place_id) || "Prospecto";
      } else if (asig.client_id) {
        nombreCliente = clientesMap.get(asig.client_id) || "Cliente";
      }

      return {
        vendedor_id: asig.vendedor_id,
        tipo: "asignacion_pendiente",
        titulo: "Asignación pendiente de cierre",
        mensaje: `"${nombreCliente}" lleva ${diasPendiente} días sin cerrar. Por favor, actualiza el estado o registra tu visita.`,
        asignacion_id: asig.id,
        leida: false,
      };
    });

    const { data: createdNotifs, error: createError } = await supabase
      .from("notificaciones")
      .insert(notificacionesACrear)
      .select();

    if (createError) {
      console.error("Error creating notificaciones:", createError);
      throw createError;
    }

    console.log(`Creadas ${createdNotifs?.length || 0} notificaciones`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Se crearon ${createdNotifs?.length || 0} notificaciones`,
        processed: createdNotifs?.length || 0,
        details: {
          asignacionesPendientes: asignacionesPendientes.length,
          yaNotificadas: asignacionesConNotificacion.size,
          nuevasNotificaciones: createdNotifs?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in check-pending-assignments:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
