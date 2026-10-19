# Diagnóstico y blindaje del mapa

## Qué significa el error
"Google Maps rechazó la configuración del mapa" aparece solo cuando Google llama a `gm_authFailure`: Google rechazó la **clave del navegador** al cargar el mapa. No es un fallo de nuestra lógica de asignación. Causas posibles (a confirmar en el paso 1):
- Dominio no autorizado para la clave (la clave gestionada solo funciona en `*.lovable.app` / `*.lovableproject.com`).
- Cuota diaria o facturación agotada en la clave (Google también lo reporta como fallo de autenticación).
- Clave vacía/obsoleta en la versión publicada (en el entorno local no figura la clave del mapa en la configuración del proyecto, hay que confirmar la conexión).

Además encontré un problema propio: cuando ocurre una vez, la app guarda el error **para siempre** hasta recargar la página, así que todos los mapas (asignación, zona, resultados, vendedor) quedan rotos aunque el problema haya sido momentáneo.

## Pasos
1. **Confirmar la causa real (solo lectura)**: revisar la conexión de Google Maps del proyecto, qué clave usa la versión publicada, y desde qué dirección se abre la app (dominio). Revisar el consumo de consultas del día (límite de 6.000 por 24 h en el servidor) y las funciones del mapa (`complete-map-route`, `walking-route`, `prospect-discovery`, `generate-recommendations`) con una consulta mínima cada una.
2. **Corregir la causa**: si es la clave/conexión, volver a vincularla; si es dominio, explicar la clave propia; si es cuota, reducir consultas (abajo).
3. **Recuperación automática**: no guardar el error para siempre; botón "Reintentar mapa" y reintento automático una vez.
4. **Mapa no bloqueante**: si el mapa falla, la asignación sigue disponible desde la lista (seleccionar clientes/prospectos y asignar sin mapa), con aviso claro en vez de pantalla roja.
5. **Mensaje útil**: distinguir "clave rechazada", "dominio no autorizado", "cuota agotada" y "sin conexión", y registrar el motivo para diagnóstico.
6. **Ahorro de consultas**: cachear búsquedas de prospectos y recorridos repetidos por zona/día, evitar recalcular el recorrido a pie en cada cambio, y contador de uso diario visible para el administrador.
7. **Verificación**: abrir cada pantalla con mapa (Asignación, Mapa de zona, Resultados, Asignaciones de hoy, Vendedor) y probar asignar desde el mapa.

## Técnico
- `src/lib/googleMaps.ts`: quitar `authenticationError` persistente; exponer `resetGoogleMaps()`; capturar mensajes de consola de Google (`RefererNotAllowedMapError`, `OverQuotaMapError`, `ApiNotActivatedMapError`, `InvalidKeyMapError`) para clasificar el error.
- `useGoogleMap.ts`: estado `retry()`; los tres componentes muestran botón reintentar y siguen operables sin mapa.
- Cache en funciones de servidor por clave (centro redondeado, radio, tipos, fecha UTC-3).
