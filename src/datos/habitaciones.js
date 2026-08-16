// ============================================================
//  habitaciones.js — Catalogo de TIPOS de habitacion que vende MALIBUBOT.
//
//  Fuente: https://hotelmalibu.co/index.php/reserve (precios "desde", COP).
//  El agente de reservas (Fase 2) SOLO vende habitaciones; salones, restaurante
//  u otros planes se derivan a un link de consulta personal.
//
//  Los precios y detalles son referenciales y conviene confirmarlos con el
//  hotel; se centralizan aqui para poder actualizarlos en un solo lugar.
// ============================================================

export const TIPOS_HABITACION = [
  {
    id: 'estandar',
    nombre: 'Habitación Estándar',
    precioDesde: 309000,
    capacidad: 2,
    descripcion: 'Habitación estándar del hotel.',
  },
  {
    id: 'estandar_ubique',
    nombre: 'Habitación Estándar Ubique',
    precioDesde: 290550,
    capacidad: 2,
    descripcion: 'Tarifa/variante Ubique de la habitación estándar.',
  },
  {
    id: 'junior_king',
    nombre: 'Junior Suite King',
    precioDesde: 357000,
    capacidad: 2,
    descripcion: 'Junior suite con cama King.',
  },
  {
    id: 'junior_triple',
    nombre: 'Junior Suite Triple',
    precioDesde: 464100,
    capacidad: 3,
    descripcion: 'Junior suite con capacidad para tres personas.',
  },
  {
    id: 'suite_lujo',
    nombre: 'Suite de Lujo',
    precioDesde: 535000,
    ivaIncluido: true,
    capacidad: 2,
    descripcion: 'Suite de nivel superior. Precio con IVA incluido.',
  },
];

/** Formato corto en pesos colombianos, p. ej. "$309.000". */
export function precioCOP(valor) {
  if (!valor && valor !== 0) return '';
  return '$' + Number(valor).toLocaleString('es-CO');
}
