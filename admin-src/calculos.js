// Cálculo de la jornada a partir de las marcas de un día (recuperado del panel en uso).
export const MARCAS = {
  salida_casa: { orden: 1, texto: "Salió de casa" },
  no_salgo_casa: { orden: 1, texto: "No sale de casa" },
  llegada_trabajo: { orden: 2, texto: "Llegó al primer lugar de trabajo" },
  inicio: { orden: 3, texto: "Arrancó a trabajar" },
  cambio: { orden: 3, texto: "Cambió de proyecto" },
  fin: { orden: 4, texto: "Terminó de trabajar" },
  salida_trabajo: { orden: 5, texto: "Salió del último lugar de trabajo" },
  llegada_casa: { orden: 6, texto: "Llegó a casa" },
  no_voy_casa: { orden: 6, texto: "No vuelve a casa" },
};

export const CONFIG_DEFECTO = {
  jornadaMin: 540, almuerzoMin: 60, almuerzoDesdeMin: 360, viajeIncluidoMin: 144, bloqueViajeMin: 25,
  horasPorBloque: 0.5, redondeoBloque: "abajo", radioCasaM: 150, radioBrensolmaM: 250,
  brensolma: { lat: -34.8357, lng: -58.38 },
};

const minutos = (a, b) => Math.round((b - a) / 60000);

export function distanciaM(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371e3 * Math.asin(Math.sqrt(h));
}

export function cajaRadio(lat, radioM) {
  return { dLat: radioM / 111320, dLng: radioM / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

// Medias horas: de cada hora sobrante, desde 25 min suma 0,5 h y desde 55 min, 1 h
// (hoja "Procedimiento Registro de hs" de la agenda de Claudia).
export function redondeo(min) {
  if (!(min > 0)) return 0;
  const h = Math.floor(Math.round(min) / 60), r = Math.round(min) % 60;
  return h + (r >= 55 ? 1 : r >= 25 ? 0.5 : 0);
}

const tramo = (m, hasta) => ({
  proyectoId: m.proyectoId || "", proyectoNombre: m.proyectoNombre || "Sin proyecto",
  desde: m.t, hasta, min: Math.round((hasta - m.t) / 60000),
});

// c puede traer jornadaMin y beneficioMin propios de cada empleado.
export function calcularJornada(marcas, c = CONFIG_DEFECTO) {
  const ms = [...marcas].map((m) => ({ ...m, t: +new Date(m.ts) })).sort((a, b) => a.t - b.t);
  // En el depósito no se cuentan los minutos antes de las 8:00.
  const enDeposito = ms.find((m) => m.tipo === "llegada_trabajo")?.lugar === "Brensolma";
  for (const m of ms) if (enDeposito && (m.tipo === "inicio" || m.tipo === "cambio")) {
    const ocho = new Date(m.t); ocho.setHours(8, 0, 0, 0);
    if (m.t < +ocho) m.t = +ocho;
  }
  const primera = (tipo) => ms.find((m) => m.tipo === tipo);
  const ultima = (tipo) => [...ms].reverse().find((m) => m.tipo === tipo);
  const avisos = [];
  const salCasa = primera("salida_casa"), llegTrab = primera("llegada_trabajo");
  const salTrab = ultima("salida_trabajo"), llegCasa = ultima("llegada_casa");
  const noSale = !salCasa && ms.some((m) => m.tipo === "no_salgo_casa");
  const ida = salCasa && llegTrab ? minutos(salCasa.t, llegTrab.t) : noSale ? 0 : null;
  const noVuelve = !llegCasa && ms.some((m) => m.tipo === "no_voy_casa");
  const vuelta = salTrab && llegCasa ? minutos(salTrab.t, llegCasa.t) : noVuelve ? 0 : null;
  if (ida === null) avisos.push("Falta el viaje de ida completo");
  if (vuelta === null) avisos.push("Falta el viaje de vuelta completo");
  if (noVuelve) avisos.push("No volvió a casa: sin viaje de vuelta");
  if (noSale) avisos.push("No salió de casa: sin viaje de ida");
  const viajeMin = (ida ?? 0) + (vuelta ?? 0);
  const tramos = [];
  let abierto = null;
  for (const m of ms) {
    if (m.tipo === "inicio" || m.tipo === "cambio") {
      if (m.tipo === "inicio" && abierto) avisos.push("Hay un 'Arranco' sin 'Terminé'");
      if (abierto) tramos.push(tramo(abierto, m.t));
      abierto = m;
    } else if (m.tipo === "fin" && abierto) { tramos.push(tramo(abierto, m.t)); abierto = null; }
  }
  if (abierto) avisos.push("Quedó la jornada abierta (falta 'Terminé')");
  const presencia = tramos.reduce((s, x) => s + x.min, 0);
  const almuerzo = presencia >= (c.almuerzoDesdeMin ?? 360) ? (c.almuerzoMin ?? 60) : 0;
  const trabajo = presencia - almuerzo;
  // Horas extra, adicionales por viaje y no trabajadas, con las reglas de la agenda.
  const excesoViaje = Math.max(0, viajeMin - c.viajeIncluidoMin);
  const requerido = Math.max(0, c.jornadaMin - (c.beneficioMin || 0));
  let adicViaje = 0, extras = 0, noTrab = 0;
  if (tramos.length) {
    if (presencia >= requerido) { adicViaje = redondeo(excesoViaje); extras = redondeo(presencia - c.jornadaMin); }
    else {
      const falta = requerido - presencia;
      if (excesoViaje >= falta) { adicViaje = redondeo(excesoViaje - falta); if (falta) avisos.push(`El viaje adicional compensa ${falta} min no trabajados`); }
      else noTrab = -redondeo(falta - excesoViaje);
    }
  }
  const extra = extras * 60;
  const porProyecto = {};
  for (const x of tramos) porProyecto[x.proyectoNombre] = (porProyecto[x.proyectoNombre] || 0) + x.min;
  if (almuerzo && presencia) {
    let resta = almuerzo;
    const orden = Object.keys(porProyecto).sort((a, b) => porProyecto[b] - porProyecto[a]);
    orden.forEach((p, i) => {
      const parte = i === orden.length - 1 ? resta : Math.round((almuerzo * porProyecto[p]) / presencia);
      porProyecto[p] -= parte; resta -= parte;
    });
  }
  const kmIni = typeof salCasa?.km === "number" ? salCasa.km : null;
  const kmFin = typeof llegCasa?.km === "number" ? llegCasa.km : null;
  const km = kmIni !== null && kmFin !== null && kmFin >= kmIni ? kmFin - kmIni : null;
  if (kmIni !== null && kmFin !== null && kmFin < kmIni) avisos.push("El odómetro de llegada es menor que el de salida");
  return {
    kmInicio: kmIni, kmFin, km, patente: salCasa?.patente || llegCasa?.patente || "",
    salidaCasa: salCasa?.t ?? null, llegadaTrabajo: llegTrab?.t ?? null, salidaTrabajo: salTrab?.t ?? null, llegadaCasa: llegCasa?.t ?? null,
    lugar: llegTrab?.lugar || "", lugarSalida: salTrab?.lugar || "",
    idaMin: ida, vueltaMin: vuelta, viajeMin, viajeExcesoMin: excesoViaje, horasViajeExtra: adicViaje, noTrabajadas: noTrab,
    presenciaMin: presencia, almuerzoMin: almuerzo, trabajoMin: trabajo, extraMin: extra, tramos, porProyecto, avisos,
  };
}

export function hhmm(min) {
  if (min == null) return "—";
  const signo = min < 0 ? "-" : "", t = Math.abs(Math.round(min));
  return `${signo}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function fechaIso(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
