# Funcionamiento de CUPRA

## Roles y visitas

| Perfil | Operaciones |
|---|---|
| Administrador | Usuarios, datos comerciales, planificación y supervisión. |
| Asignador | Importación, revisión de prospectos, planificación, asignación y supervisión. |
| Vendedor o perfil de ventas | Pendientes propios, visitas, feedback y autoasignación. |

La vista del vendedor incluye únicamente sus pendientes. El catálogo compartido
permite buscar clientes de otras carteras con nombre, dirección, contacto y
vendedor comercial. La ficha detallada requiere una visita asignada, actual o
histórica. Asignadores y administradores mantienen acceso de supervisión.

**Tomar una visita** transfiere el pendiente del mismo día, si existe, o crea uno.
Se guarda el movimiento y una notificación para los asignadores y administradores
activos en la misma transacción. Reintentar la operación conserva una sola visita
y un solo aviso. La cartera comercial permanente se cambia desde su operación
específica de asignación, con auditoría.

Al salir un vendedor, desactivar su perfil bloquea el acceso. Desde Perfiles se
pueden **reasignar sus pendientes** a una persona activa con perfil de ventas.
Las fechas programadas y las visitas realizadas permanecen en el historial.

## Preparación de una jornada

1. Elegir vendedores, zona, rubros y estados comerciales de interés.
2. El motor compara centros de la zona y una referencia comercial cuando hay
   clientes elegibles. Combina clientes y prospectos por cercanía.
3. Busca negocios nuevos en radios de 150, 300, 600, 1000 y hasta 1500 metros.
   También busca cuando ya hay ocho clientes disponibles pero están dispersos.
4. Revisar los ocho destinos, sus categorías y cualquier sustitución de estado.
5. Consultar **Calcular recorrido a pie** para ver un orden sugerido y la medida
   por calles. Confirmar la asignación después de revisar la selección.

El rubro se respeta. La frecuencia orienta la prioridad y podrá ajustarse con las
pruebas de campo; no obliga a alejar la ruta. Los estados comerciales se calculan
con la fecha actual de Argentina: activo hasta 30 días sin comprar, inactivo
hasta 90, perdido después de 90 y potencial sin compras registradas.

Varios negocios distintos de una misma calle son destinos válidos. La cercanía
por sí sola no los convierte en duplicados. Los comercios nuevos o con pocas
reseñas pueden completar la jornada. Se excluyen cierres vigentes, negocios
convertidos a clientes y destinos ya ocupados para la jornada.

Si no hay cartera disponible, una zona puede completarse con ocho prospectos.
Si no se encuentran ocho candidatos válidos, se informa el faltante y se bloquea
la confirmación. El radio de 1,5 km es un límite geográfico desde el centro,
no una promesa de que toda la caminata mida 1,5 km. Sin respuesta del proveedor,
la distancia por calles queda identificada como pendiente de verificar.

En el mapa, los clientes elegidos manualmente se conservan como puntos fijos.
**Completar prospectos** agrega vecinos hasta llegar a ocho. La selección se
valida nuevamente al guardar con las coordenadas vigentes de la base.

## Prospectos e información persistente

**Revisar coincidencias** compara identidad, teléfono, dirección y ubicación.
El operador puede unificar con un cliente, con otro prospecto o indicar que son
negocios distintos. La decisión y la información complementada quedan guardadas.
Una unión requiere revisión; no se fusionan negocios solo por compartir cuadra.

Los resultados descubiertos se incorporan a la base y enriquecen datos conocidos.
Un error de búsqueda no se presenta como una zona sin negocios. Los formularios
y selecciones se conservan en borradores separados por usuario; el navegador
muestra un aviso si no puede guardarlos. Un borrador no equivale a una asignación.

## Carga de Excel

Elegir archivo, hoja y tipo de información, revisar la vista previa y confirmar
el modo agregar o reemplazar. Las ventas se cargan por lotes y la consolidación
trabaja sobre toda la importación. Los errores identifican la etapa que falló.
La comprobación debe comparar filas y totales con el archivo original antes de
usar el resultado comercial.

## Pruebas operativas

- Dos vendedores: cada uno ve sus pendientes; tomar una visita ajena transfiere
  una sola visita y deja un aviso visible para el asignador.
- Vendedor desactivado: pierde acceso; sus pendientes pueden transferirse sin
  alterar visitas realizadas ni fechas futuras.
- Ocho clientes dispersos y prospectos vecinos: la propuesta elige una ruta
  compacta; negocios distintos de la misma calle permanecen separados.
- Zona sin clientes: intenta ocho prospectos dentro del límite geográfico.
- Revisar y unificar: volver a abrir la ficha confirma los datos guardados.
- Recargar un borrador y cambiar de usuario: cada persona recupera solo el suyo.
- Importar un archivo de prueba y conciliar filas y montos antes de la carga real.
