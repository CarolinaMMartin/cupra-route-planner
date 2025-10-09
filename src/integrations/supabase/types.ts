export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      asignaciones_vendedores_clientes: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          vendedor_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          vendedor_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_vendedores_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_vendedores_clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string | null
          cuit_dni: string
          id: string
          last_recommendation_at: string | null
          razon_social: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          cuit_dni: string
          id?: string
          last_recommendation_at?: string | null
          razon_social: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          cuit_dni?: string
          id?: string
          last_recommendation_at?: string | null
          razon_social?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      clientes_recomendaciones_temporal: {
        Row: {
          avg_ticket: number | null
          ciudades: string[] | null
          cliente_id: string | null
          created_at: string | null
          cuit_dni: string | null
          days_since_last_purchase: number | null
          etiquetas: string[] | null
          first_purchase_at: string | null
          id: string
          last_purchase_at: string | null
          monto_total_vendido: number | null
          orders_count: number | null
          participacion: number | null
          priority_score: number | null
          provincias: string[] | null
          razon_social: string
          score_comercial: string | null
          score_recencia: string | null
          score_recencia_num: number | null
          score_volumen: string | null
          score_volumen_num: number | null
          telefonos: string[] | null
          vendedores: string[] | null
        }
        Insert: {
          avg_ticket?: number | null
          ciudades?: string[] | null
          cliente_id?: string | null
          created_at?: string | null
          cuit_dni?: string | null
          days_since_last_purchase?: number | null
          etiquetas?: string[] | null
          first_purchase_at?: string | null
          id?: string
          last_purchase_at?: string | null
          monto_total_vendido?: number | null
          orders_count?: number | null
          participacion?: number | null
          priority_score?: number | null
          provincias?: string[] | null
          razon_social: string
          score_comercial?: string | null
          score_recencia?: string | null
          score_recencia_num?: number | null
          score_volumen?: string | null
          score_volumen_num?: number | null
          telefonos?: string[] | null
          vendedores?: string[] | null
        }
        Update: {
          avg_ticket?: number | null
          ciudades?: string[] | null
          cliente_id?: string | null
          created_at?: string | null
          cuit_dni?: string | null
          days_since_last_purchase?: number | null
          etiquetas?: string[] | null
          first_purchase_at?: string | null
          id?: string
          last_purchase_at?: string | null
          monto_total_vendido?: number | null
          orders_count?: number | null
          participacion?: number | null
          priority_score?: number | null
          provincias?: string[] | null
          razon_social?: string
          score_comercial?: string | null
          score_recencia?: string | null
          score_recencia_num?: number | null
          score_volumen?: string | null
          score_volumen_num?: number | null
          telefonos?: string[] | null
          vendedores?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_recomendaciones_temporal_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          nombre: string
          rol: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          nombre?: string
          rol?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      recomendaciones_ia: {
        Row: {
          avg_ticket: number | null
          ciudades: string[] | null
          created_at: string
          cuit_dni: string | null
          days_since_last_purchase: number | null
          estado: string | null
          etiquetas: string[] | null
          first_purchase_at: string | null
          id: string
          justificacion: string
          last_purchase_at: string | null
          monto_total_vendido: number | null
          notas: string | null
          orders_count: number | null
          participacion: number | null
          priority_score: number | null
          provincias: string[] | null
          razon_social: string
          score_comercial: string | null
          score_recencia: string | null
          score_recencia_num: number | null
          score_volumen: string | null
          score_volumen_num: number | null
          telefonos: string[] | null
          ultima_sugerencia: string | null
          ultima_visita: string | null
          vendedores: string[] | null
        }
        Insert: {
          avg_ticket?: number | null
          ciudades?: string[] | null
          created_at?: string
          cuit_dni?: string | null
          days_since_last_purchase?: number | null
          estado?: string | null
          etiquetas?: string[] | null
          first_purchase_at?: string | null
          id?: string
          justificacion: string
          last_purchase_at?: string | null
          monto_total_vendido?: number | null
          notas?: string | null
          orders_count?: number | null
          participacion?: number | null
          priority_score?: number | null
          provincias?: string[] | null
          razon_social: string
          score_comercial?: string | null
          score_recencia?: string | null
          score_recencia_num?: number | null
          score_volumen?: string | null
          score_volumen_num?: number | null
          telefonos?: string[] | null
          ultima_sugerencia?: string | null
          ultima_visita?: string | null
          vendedores?: string[] | null
        }
        Update: {
          avg_ticket?: number | null
          ciudades?: string[] | null
          created_at?: string
          cuit_dni?: string | null
          days_since_last_purchase?: number | null
          estado?: string | null
          etiquetas?: string[] | null
          first_purchase_at?: string | null
          id?: string
          justificacion?: string
          last_purchase_at?: string | null
          monto_total_vendido?: number | null
          notas?: string | null
          orders_count?: number | null
          participacion?: number | null
          priority_score?: number | null
          provincias?: string[] | null
          razon_social?: string
          score_comercial?: string | null
          score_recencia?: string | null
          score_recencia_num?: number | null
          score_volumen?: string | null
          score_volumen_num?: number | null
          telefonos?: string[] | null
          ultima_sugerencia?: string | null
          ultima_visita?: string | null
          vendedores?: string[] | null
        }
        Relationships: []
      }
      sucursales: {
        Row: {
          barrio: string | null
          ciudad: string
          cliente_id: string | null
          created_at: string
          direccion: string
          estado: string
          google_place_id: string | null
          id_sucursal: string
          lat: number | null
          lng: number | null
          nombre_maps: string
          provincia: string
          telefono_local: string | null
          updated_at: string
        }
        Insert: {
          barrio?: string | null
          ciudad: string
          cliente_id?: string | null
          created_at?: string
          direccion: string
          estado?: string
          google_place_id?: string | null
          id_sucursal?: string
          lat?: number | null
          lng?: number | null
          nombre_maps: string
          provincia: string
          telefono_local?: string | null
          updated_at?: string
        }
        Update: {
          barrio?: string | null
          ciudad?: string
          cliente_id?: string | null
          created_at?: string
          direccion?: string
          estado?: string
          google_place_id?: string | null
          id_sucursal?: string
          lat?: number | null
          lng?: number | null
          nombre_maps?: string
          provincia?: string
          telefono_local?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sucursales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedores: {
        Row: {
          activo: boolean | null
          created_at: string | null
          email: string
          id: string
          nombre: string
          zona: string
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          nombre: string
          zona: string
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          nombre?: string
          zona?: string
        }
        Relationships: []
      }
      ventas_cupra: {
        Row: {
          alto: number | null
          ancho: number | null
          bonificacion: number | null
          calle: string | null
          cantidad: number | null
          categorias_cliente: string | null
          categorias_productos: string | null
          categorias_proveedor: string | null
          ciudad: string | null
          cliente_id: string | null
          codigo_oem: string | null
          codigo_postal: string | null
          codigo_producto: string | null
          codigo_proveedor: string | null
          codigo_variante: string | null
          condicion_pago: string | null
          costo_financiero_unit_bruto: number | null
          costo_unit_bruto: number | null
          costo_unit_neto: number | null
          created_at: string | null
          cuit_dni: string | null
          cupon_descuento: string | null
          departamento: string | null
          entrecalles: string | null
          envio: string | null
          envio_gratis_me: boolean | null
          envio_observacion: string | null
          etiqueta: string | null
          fantasia: string | null
          fecha_emision: string | null
          financiacion: string | null
          financiacion_aplicacion: string | null
          forma_envio: string | null
          id: number
          impuesto_interno: number | null
          iva: number | null
          kilogramos: number | null
          largo: number | null
          latitud: number | null
          letra: string | null
          longitud: number | null
          marca: string | null
          medio_pago_tienda: string | null
          numero: string | null
          numero_externo: string | null
          operador: string | null
          origen: string | null
          pais: string | null
          piso: string | null
          precio_total_final: number | null
          precio_total_neto: number | null
          precio_unit_final: number | null
          precio_unit_neto: number | null
          proveedor: string | null
          provincia: string | null
          razon_social: string | null
          recibo: string | null
          sucursal: string | null
          telefono: string | null
          ticket: string | null
          variante: string | null
          vendedor: string | null
        }
        Insert: {
          alto?: number | null
          ancho?: number | null
          bonificacion?: number | null
          calle?: string | null
          cantidad?: number | null
          categorias_cliente?: string | null
          categorias_productos?: string | null
          categorias_proveedor?: string | null
          ciudad?: string | null
          cliente_id?: string | null
          codigo_oem?: string | null
          codigo_postal?: string | null
          codigo_producto?: string | null
          codigo_proveedor?: string | null
          codigo_variante?: string | null
          condicion_pago?: string | null
          costo_financiero_unit_bruto?: number | null
          costo_unit_bruto?: number | null
          costo_unit_neto?: number | null
          created_at?: string | null
          cuit_dni?: string | null
          cupon_descuento?: string | null
          departamento?: string | null
          entrecalles?: string | null
          envio?: string | null
          envio_gratis_me?: boolean | null
          envio_observacion?: string | null
          etiqueta?: string | null
          fantasia?: string | null
          fecha_emision?: string | null
          financiacion?: string | null
          financiacion_aplicacion?: string | null
          forma_envio?: string | null
          id?: never
          impuesto_interno?: number | null
          iva?: number | null
          kilogramos?: number | null
          largo?: number | null
          latitud?: number | null
          letra?: string | null
          longitud?: number | null
          marca?: string | null
          medio_pago_tienda?: string | null
          numero?: string | null
          numero_externo?: string | null
          operador?: string | null
          origen?: string | null
          pais?: string | null
          piso?: string | null
          precio_total_final?: number | null
          precio_total_neto?: number | null
          precio_unit_final?: number | null
          precio_unit_neto?: number | null
          proveedor?: string | null
          provincia?: string | null
          razon_social?: string | null
          recibo?: string | null
          sucursal?: string | null
          telefono?: string | null
          ticket?: string | null
          variante?: string | null
          vendedor?: string | null
        }
        Update: {
          alto?: number | null
          ancho?: number | null
          bonificacion?: number | null
          calle?: string | null
          cantidad?: number | null
          categorias_cliente?: string | null
          categorias_productos?: string | null
          categorias_proveedor?: string | null
          ciudad?: string | null
          cliente_id?: string | null
          codigo_oem?: string | null
          codigo_postal?: string | null
          codigo_producto?: string | null
          codigo_proveedor?: string | null
          codigo_variante?: string | null
          condicion_pago?: string | null
          costo_financiero_unit_bruto?: number | null
          costo_unit_bruto?: number | null
          costo_unit_neto?: number | null
          created_at?: string | null
          cuit_dni?: string | null
          cupon_descuento?: string | null
          departamento?: string | null
          entrecalles?: string | null
          envio?: string | null
          envio_gratis_me?: boolean | null
          envio_observacion?: string | null
          etiqueta?: string | null
          fantasia?: string | null
          fecha_emision?: string | null
          financiacion?: string | null
          financiacion_aplicacion?: string | null
          forma_envio?: string | null
          id?: never
          impuesto_interno?: number | null
          iva?: number | null
          kilogramos?: number | null
          largo?: number | null
          latitud?: number | null
          letra?: string | null
          longitud?: number | null
          marca?: string | null
          medio_pago_tienda?: string | null
          numero?: string | null
          numero_externo?: string | null
          operador?: string | null
          origen?: string | null
          pais?: string | null
          piso?: string | null
          precio_total_final?: number | null
          precio_total_neto?: number | null
          precio_unit_final?: number | null
          precio_unit_neto?: number | null
          proveedor?: string | null
          provincia?: string | null
          razon_social?: string | null
          recibo?: string | null
          sucursal?: string | null
          telefono?: string | null
          ticket?: string | null
          variante?: string | null
          vendedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cupra_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas: {
        Row: {
          created_at: string | null
          estado: string | null
          fecha: string
          geolocalizacion: Json | null
          hora_checkin: string | null
          hora_checkout: string | null
          id: string
          notas: string | null
          sucursal_id: string
          vendedor_id: string
        }
        Insert: {
          created_at?: string | null
          estado?: string | null
          fecha: string
          geolocalizacion?: Json | null
          hora_checkin?: string | null
          hora_checkout?: string | null
          id?: string
          notas?: string | null
          sucursal_id: string
          vendedor_id: string
        }
        Update: {
          created_at?: string | null
          estado?: string | null
          fecha?: string
          geolocalizacion?: Json | null
          hora_checkin?: string | null
          hora_checkout?: string | null
          id?: string
          notas?: string | null
          sucursal_id?: string
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
    }
    Enums: {
      app_role: "asignador" | "vendedor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["asignador", "vendedor"],
    },
  },
} as const
