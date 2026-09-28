# Asignación desde el mapa — 28/09/2026

## Flujo

1. Elegir vendedor: carga su cartera completa y muestra los clientes con ubicación guardada. La resolución de nombres es la misma que utiliza el motor; el dueño actual prevalece sobre vendedores históricos. Se informan y listan los clientes sin coordenadas.
2. Elegir barrio, localidad o comuna entre las zonas presentes en esa cartera. También funciona fuera de CABA. Los filtros de estado y rubro se aplican a los clientes; no eliminan los destinos ya elegidos.
3. Tocar clientes y agregarlos a la ruta. El centro es el promedio de las coordenadas de los clientes seleccionados. Todos deben quedar dentro de 1,5 km de ese centro. Al cambiar los clientes se retiran las sugerencias anteriores y se recalcula el centro.
4. Pulsar **Completar con prospectos**. Consulta prospectos guardados y Google Places alrededor del centro, con radios de 150, 300, 600, 1000 y 1500 metros. Amplía sólo si falta completar ocho. Los prospectos no cambian el centro.
5. Los prospectos más cercanos completan automáticamente los lugares libres. Se muestran alternativas en el mapa, rubro, reseñas y distancia al cliente más próximo. Se puede quitar un prospecto y reemplazarlo; volver a completar respeta los que se quitaron.
6. **Asignar 8 visitas** confirma la selección. Buscar prospectos no asigna visitas. Se conserva el guardado transaccional y la protección frente a reintentos.

## Búsqueda y límites

- Incluye vinotecas, wine bars, restaurantes, bares y hoteles; ofrece filtros de rubro independientes de los filtros de clientes.
- Los hoteles encontrados en Google necesitan al menos 4/5 y 15 reseñas. Para otros negocios se conservan los umbrales comerciales existentes. Las cargas manuales/Excel no necesitan reseñas.
- Se ordena por distancia al centro; las valoraciones desempatan distancias equivalentes. Las distancias se expresan en línea recta. Una cercanía de metros no certifica que compartan cuadra o acceso peatonal.
- Google devuelve como máximo veinte resultados por rubro. Si se repiten lugares descartados y todavía faltan visitas, se consulta en seis sectores del círculo. Se filtra nuevamente por el centro original y el límite de 1,5 km. Presupuesto máximo: 60 consultas y 45 segundos.
- Se excluyen clientes existentes, duplicados entre fuentes, prospectos convertidos, cerrados, descartados, con feedback que impide visitarlos o asignados/visitados hoy. No se pisa el estado de un prospecto ya registrado.
- Si faltan negocios válidos, se muestra el faltante y se mantiene la confirmación bloqueada. Un error de Google se informa expresamente; no se presenta como una zona vacía.
- Cambiar vendedor/zona, vaciar ruta o salir cancela la solicitud en la interfaz y descarta respuestas anteriores.

## Conservación del avance

- Guardado automático sin demora en este navegador, separado por usuario. Conserva mapa, filtros, selección manual, recomendaciones, etapa del flujo y cambios de vendedor en las tablas de asignación/edición.
- Cada vendedor tiene su propio borrador de mapa. Cambiar de barrio o pantalla no borra la ruta. Cambiar clientes sí invalida los prospectos sugeridos, porque modifica el centro de búsqueda.
- Recargar o cerrar y volver a abrir conserva el borrador. El guardado es local: no sincroniza entre dispositivos y se pierde si se borran los datos del navegador. Entre pestañas se reciben las actualizaciones; si se edita el mismo campo simultáneamente, prevalece el último guardado.
- Al volver al mapa, relee cartera, ubicaciones y prospectos. Conserva los destinos que necesitan revisión, los marca como no disponibles y bloquea la asignación. El servidor vuelve a validar al confirmar.
- Si el almacenamiento está bloqueado o lleno, conserva el avance en memoria durante la navegación, muestra el problema con opción de reintentar y activa la advertencia del navegador antes de recargar/cerrar. Cerrar pese a esa advertencia puede perder los cambios que no se pudieron guardar.
- Guardar un borrador no asigna visitas. La selección se limpia después de una asignación exitosa o al descartarla explícitamente. El mapa pide confirmar el descarte.
- Las recomendaciones anteriores se migran al nuevo guardado sin recuperar indicadores de carga que podrían quedar trabados tras una recarga.

## Protección al confirmar

`guardar_ruta_mapa` verifica permisos, exactamente ocho destinos únicos, al menos un cliente y vendedor activo. Relee y bloquea ubicaciones/clientes/prospectos, calcula el centro exclusivamente con los clientes y rechaza cualquier destino a más de 1,5 km. Impide tomar un prospecto asignado a otro vendedor mientras se preparaba la ruta. Delega el guardado en `guardar_asignaciones` dentro de la misma transacción. No cambia el dueño de la cartera.

## Validación

`npm run check`: 148 pruebas aprobadas (87 de reglas/motor/búsqueda, 22 de base, 28 de importaciones, 9 de borradores y 2 de empaquetado), TypeScript y compilación de producción.

Las pruebas nuevas cubren centroides, distintas carteras, localidades fuera de CABA, coordenadas faltantes, cuatro clientes más cuatro prospectos, orden por distancia, ampliación progresiva, búsqueda de cobertura, hoteles, filtros, duplicados, fallos de Google, rutas incompletas, guardado de ocho, cambio concurrente de ubicación/disponibilidad, permisos, rollback y reintentos.

Prueba de interfaz en Chromium con servicios simulados: vendedor → cartera completa → Palermo → cuatro clientes → cuatro prospectos; reemplazo de un prospecto; cambio de clientes; guardado; cambio de vendedor durante la búsqueda; error/reintento; recarga; navegación a otra pantalla y regreso; borradores separados por vendedor; selección manual recuperada; fallo de almacenamiento, advertencia al cerrar y reintento; vista móvil sin desbordamiento. Sin errores de ejecución. Google se simula en las pruebas automatizadas; la disponibilidad real depende del servicio y de negocios existentes con ubicación válida.

## Publicación

Aplicar y registrar `20260928140000_ruta_mapa.sql`. Desplegar `complete-map-route` y `generate-recommendations` (la regla de hoteles es compartida). Publicar el frontend de `main`, conectado a Lovable. Esta migración sólo incorpora un RPC y permisos: no inserta visitas ni cambia clientes, prospectos o ventas existentes.

Las reglas de cartera, filtrado y geometría viven en `_shared/` para que cada función pueda desplegarse de forma independiente. Las pruebas de empaquetado recorren los imports y rechazan dependencias de carpetas de otras funciones.
