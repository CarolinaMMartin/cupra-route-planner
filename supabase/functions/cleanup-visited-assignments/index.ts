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
    console.log('🧹 Iniciando limpieza de asignaciones visitadas...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Obtener la fecha de inicio del día actual (00:00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(`📅 Limpiando asignaciones visitadas desde: ${today.toISOString()}`);

    // Eliminar asignaciones con estado "Visitado" creadas hoy
    const { data: deletedAssignments, error: deleteError } = await supabase
      .from('asignaciones_vendedores_clientes')
      .delete()
      .eq('estado', 'Visitado')
      .gte('created_at', today.toISOString())
      .select();

    if (deleteError) {
      console.error('❌ Error al eliminar asignaciones:', deleteError);
      throw deleteError;
    }

    const deletedCount = deletedAssignments?.length || 0;
    console.log(`✅ Se eliminaron ${deletedCount} asignaciones visitadas del día`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Se eliminaron ${deletedCount} asignaciones visitadas`,
        deletedCount,
        timestamp: new Date().toISOString(),
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
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
