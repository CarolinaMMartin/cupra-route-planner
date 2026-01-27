import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Calcular fecha actual en hora Argentina para logging
    const nowArg = new Date().toLocaleString('es-AR', { 
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'full',
      timeStyle: 'long'
    });
    
    console.log(`🧹 Iniciando limpieza de asignaciones visitadas...`);
    console.log(`📅 Fecha/hora Argentina: ${nowArg}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Eliminar TODAS las asignaciones con estado "Visitado" sin importar la fecha de creación
    const { data: deletedAssignments, error: deleteError } = await supabase
      .from('asignaciones_vendedores_clientes')
      .delete()
      .eq('estado', 'Visitado')
      .select();

    if (deleteError) {
      console.error('❌ Error al eliminar asignaciones:', deleteError);
      throw deleteError;
    }

    const deletedCount = deletedAssignments?.length || 0;
    console.log(`✅ Se eliminaron ${deletedCount} asignaciones visitadas (sin filtro de fecha)`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Se eliminaron ${deletedCount} asignaciones visitadas`,
        deletedCount,
        timestamp: new Date().toISOString(),
        timestampArgentina: nowArg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Error en cleanup-visited-assignments:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
