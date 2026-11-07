// Panel de administración: inicio con todos los empleados, página de cada empleado
// (resumen, horarios, viáticos, datos) y un menú con proyectos, direcciones, reporte,
// viáticos de todos y configuración.
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs, Timestamp,
} from "./fb.js";
import * as XLSX from "xlsx";
import { MARCAS, CONFIG_DEFECTO, calcularJornada, hhmm, fechaIso, distanciaM, cajaRadio } from "./calculos.js";

// ---------------------------------------------------------------- utilidades
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...hijos) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h != null && h !== false) n.append(h.nodeType ? h : document.createTextNode(h));
  return n;
};
const hora = (ms) => (ms ? new Date(ms).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const ddmm = (f) => f.split("-").reverse().join("/");
const horas = (min) => Math.round((min / 60) * 100) / 100;
const horasTxt = (min) => `${horas(min).toLocaleString("es-AR")} h`;
const mapa = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;
const pesos = (n) => (n < 0 ? "−$ " : "$ ") + Math.abs(Number(n || 0)).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const normal = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const iniciales = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const PLANILLAS = { "": "Sin planilla mensual", auto_bsm: "Auto BSM", auto_personal: "Auto personal", solo: "Solo almuerzo, SUBE y otros" };
const TIPOS_GASTO = { almuerzo: "Almuerzo", estacionamiento: "Estacionamiento", otro: "Otro gasto", nafta: "Nafta Auto BSM", sube: "SUBE" };
const API = (window.VIATICOS_API || "").replace(/\/$/, "");

function lunesDe(f) {
  const d = new Date(f + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fechaIso(d);
}
function diasEntre(desde, hasta) {
  const out = [], d = new Date(desde + "T12:00:00"), fin = new Date(hasta + "T12:00:00");
  while (d <= fin) { out.push(fechaIso(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function aviso(texto, tipo = "info") {
  const a = $("#aviso");
  a.textContent = texto; a.className = `aviso ${tipo}`; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), 6000);
}
async function intentar(fn) {
  try { await fn(); } catch (e) { console.error(e); aviso(e.message || String(e), "error"); }
}

// ---------------------------------------------------------------- estado
let cfg = { ...CONFIG_DEFECTO };
let empleados = [], proyectos = [], marcasHoy = [];
let actual = null;          // empleado abierto
let filtro = "todos";
let ultimoReporte = null, ultimoEmpleado = null;
let listo = false;          // sesión de administración confirmada
const nombreDe = (uid, x) => empleados.find((e) => e.uid === uid)?.nombre || x?.nombre || uid;

// ---------------------------------------------------------------- ingreso
$("#form-login").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(() => signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pass").value));
});
$("#btn-salir").addEventListener("click", () => { cerrarMenu(); signOut(auth); });

onAuthStateChanged(auth, async (u) => {
  listo = false; $("#btn-menu").hidden = true; cerrarMenu();
  if (!u) return mostrar("login");
  const yo = await getDoc(doc(db, "empleados", u.uid));
  if (!yo.exists() || yo.data().rol !== "admin") {
    mostrar("login");
    return aviso("Esta cuenta no tiene permiso de administración.", "error");
  }
  const c = await getDoc(doc(db, "config", "general"));
  if (c.exists()) cfg = { ...CONFIG_DEFECTO, ...c.data() };
  await Promise.all([cargarEmpleados(), cargarProyectos(), cargarMarcasHoy()]);
  prepararFormularios();
  listo = true; $("#btn-menu").hidden = false;
  ruta();
});

// ---------------------------------------------------------------- navegación (#/…)
const VISTAS = ["login", "empleados", "empleado", "proyectos", "direcciones", "reporte", "viaticos", "config"];
function mostrar(v) {
  for (const n of VISTAS) $(`#v-${n}`).hidden = n !== v;
  window.scrollTo(0, 0);
}
function ruta() {
  if (!listo) return;
  cerrarMenu();
  const [, seccion, id] = (location.hash || "#/").split("/");
  if (seccion === "empleado" && id) return abrirEmpleado(decodeURIComponent(id));
  if (["proyectos", "direcciones", "reporte", "viaticos", "config"].includes(seccion)) {
    if (seccion === "direcciones") renderCasas();
    return mostrar(seccion);
  }
  renderLista();
  mostrar("empleados");
}
window.addEventListener("hashchange", ruta);

function cerrarMenu() { $("#menu").hidden = true; $("#btn-menu").setAttribute("aria-expanded", "false"); }
$("#btn-menu").addEventListener("click", (ev) => {
  ev.stopPropagation();
  const abrir = $("#menu").hidden;
  $("#menu").hidden = !abrir; $("#btn-menu").setAttribute("aria-expanded", String(abrir));
});
document.addEventListener("click", (ev) => { if (!$("#menu").contains(ev.target)) cerrarMenu(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cerrarMenu(); });

// ---------------------------------------------------------------- datos
async function cargarEmpleados() {
  empleados = (await getDocs(collection(db, "empleados"))).docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  $("#r-empleado").replaceChildren(el("option", { value: "" }, "Todos"), ...empleados.map((e) => el("option", { value: e.uid }, e.nombre)));
}
async function cargarMarcasHoy() {
  marcasHoy = (await getDocs(query(collection(db, "marcas"), where("fecha", "==", fechaIso())))).docs
    .map((d) => ({ id: d.id, ...d.data(), ts: d.data().ts ? d.data().ts.toMillis() : null })).filter((m) => m.ts);
}
// Marcas de una persona entre dos fechas (igualdades: no necesita índices compuestos).
async function marcasDe(uid, desde, hasta) {
  const dias = diasEntre(desde, hasta), out = [];
  for (let i = 0; i < dias.length; i += 30) {
    const q = query(collection(db, "marcas"), where("uid", "==", uid), where("fecha", "in", dias.slice(i, i + 30)));
    out.push(...(await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), ts: d.data().ts ? d.data().ts.toMillis() : null })));
  }
  return out.filter((m) => m.ts);
}
async function marcasDeTodos(desde, hasta) {
  const q = query(collection(db, "marcas"), where("fecha", ">=", desde), where("fecha", "<=", hasta));
  return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data(), ts: d.data().ts ? d.data().ts.toMillis() : null })).filter((m) => m.ts);
}
function jornadas(marcas) {
  const porDia = {};
  for (const m of marcas) (porDia[`${m.uid}|${m.fecha}`] ||= []).push(m);
  return Object.entries(porDia).map(([k, ms]) => {
    const [uid, fecha] = k.split("|");
    return { uid, nombre: nombreDe(uid, ms[0]), fecha, ...calcularJornada(ms, cfg) };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
}
async function guardarEmpleado(e, cambios) {
  await updateDoc(doc(db, "empleados", e.uid), cambios);
  Object.assign(e, cambios);
  aviso("Guardado.", "ok");
  if (actual?.uid === e.uid) { renderCabecera(); renderDatos(); renderResumenDatos(); }
}

// ---------------------------------------------------------------- inicio: tarjetas
function estadoHoy(uid) {
  const ms = marcasHoy.filter((m) => m.uid === uid).sort((a, b) => a.ts - b.ts);
  const u = ms[ms.length - 1];
  if (!u) return { texto: "Sin marcas hoy", clase: "", trabajando: false };
  const trabajo = [...ms].reverse().find((m) => m.tipo === "inicio" || m.tipo === "cambio");
  switch (u.tipo) {
    case "salida_casa": return { texto: `Salió de casa ${hora(u.ts)}`, clase: "", trabajando: true };
    case "llegada_trabajo": return { texto: `Llegó${u.lugar ? " a " + u.lugar : ""} ${hora(u.ts)}`, clase: "", trabajando: true };
    case "inicio": case "cambio": return { texto: `Trabajando · ${u.proyectoNombre || "Depósito"}`, clase: "trab", trabajando: true };
    case "fin": return { texto: `Terminó ${hora(u.ts)}${trabajo?.proyectoNombre ? " · " + trabajo.proyectoNombre : ""}`, clase: "", trabajando: true };
    case "salida_trabajo": return { texto: "Volviendo a casa", clase: "", trabajando: true };
    case "llegada_casa": return { texto: `Llegó a casa ${hora(u.ts)}`, clase: "", trabajando: false };
    case "no_salgo_casa": return { texto: "No sale de casa", clase: "", trabajando: true };
    case "no_voy_casa": return { texto: "No vuelve a casa", clase: "", trabajando: false };
    default: return { texto: MARCAS[u.tipo]?.texto || u.tipo, clase: "", trabajando: true };
  }
}
function planillasTxt(e) {
  const p = { mensual: "", semanal: true, ...(e.planillas || {}) };
  return [p.mensual ? PLANILLAS[p.mensual] : "Sin planilla mensual", p.semanal ? "Semanal" : ""].filter(Boolean).join(" · ");
}
function tarjeta(e) {
  const pend = e.estado !== "activo";
  const est = pend ? { texto: e.estado === "inactivo" ? "Desactivado" : "Pendiente de aprobar", clase: e.estado === "inactivo" ? "" : "pend" } : estadoHoy(e.uid);
  const detalle = pend
    ? [e.creado?.toDate ? `Se registró el ${e.creado.toDate().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}` : "Se registró en la app",
      e.casa ? "" : "falta cargar la casa"].filter(Boolean).join(" · ")
    : planillasTxt(e) + (e.casa ? "" : " · sin casa cargada");
  return el("a", { class: "emp", href: `#/empleado/${encodeURIComponent(e.uid)}` },
    el("div", { class: "av" }, iniciales(e.nombre)),
    el("div", { class: "info" }, el("b", {}, e.nombre || e.email), el("small", {}, detalle), el("span", { class: `estado ${est.clase}` }, est.texto)),
    el("span", { class: "chev", "aria-hidden": "true" }, "›"));
}
function renderLista() {
  const q = normal($("#buscar-emp").value).split(/\s+/).filter(Boolean);
  const coincide = (e) => q.every((p) => normal(`${e.nombre} ${e.email}`).includes(p));
  const pendientes = empleados.filter((e) => e.estado === "pendiente" && coincide(e));
  const activos = empleados.filter((e) => e.estado === "activo" && coincide(e) && (filtro !== "trabajando" || estadoHoy(e.uid).trabajando));
  const inactivos = empleados.filter((e) => e.estado !== "activo" && e.estado !== "pendiente" && coincide(e));
  const nPend = empleados.filter((e) => e.estado === "pendiente").length;
  $('[data-filtro="pendientes"]').textContent = nPend ? `Pendientes (${nPend})` : "Pendientes";
  const grupo = (titulo, lista) => lista.length ? [el("div", { class: "grupo" }, `${titulo} · ${lista.length}`), el("div", { class: "grilla" }, lista.map(tarjeta))] : [];
  const partes = [];
  if (filtro !== "trabajando") partes.push(...grupo("Pendientes de aprobar", pendientes));
  if (filtro !== "pendientes") partes.push(...grupo(filtro === "trabajando" ? "Trabajando hoy" : "Activos", activos));
  if (filtro === "todos") partes.push(...grupo("Desactivados", inactivos));
  $("#lista-emp").replaceChildren(...(partes.length ? partes : [el("p", { class: "vacio" }, "No hay empleados para mostrar.")]));
}
$("#buscar-emp").addEventListener("input", renderLista);
for (const b of document.querySelectorAll("[data-filtro]")) b.addEventListener("click", () => {
  filtro = b.dataset.filtro;
  for (const x of document.querySelectorAll("[data-filtro]")) x.setAttribute("aria-pressed", String(x === b));
  renderLista();
});

// ---------------------------------------------------------------- un empleado
function abrirEmpleado(uid) {
  const e = empleados.find((x) => x.uid === uid);
  if (!e) { location.hash = "#/"; return; }
  const nuevo = actual?.uid !== uid;
  actual = e;
  mostrar("empleado");
  renderCabecera();
  if (nuevo) {
    const hoy = fechaIso(), d = new Date();
    $("#e-desde").value = fechaIso(new Date(d.getFullYear(), d.getMonth(), 1));
    $("#e-hasta").value = hoy; $("#e-fecha").value = hoy; $("#e-semana").value = hoy;
    $("#e-mes").value = hoy.slice(0, 7);
    $("#e-jornadas").replaceChildren(); $("#e-totales").replaceChildren(); $("#e-marcas").replaceChildren();
    $("#e-gastos").replaceChildren(); $("#e-gastos-mes").replaceChildren();
    elegirTab("resumen");
  }
  renderDatos();
  intentar(renderResumen);
}
function renderCabecera() {
  const e = actual;
  $("#e-av").textContent = iniciales(e.nombre);
  $("#e-nombre").textContent = e.nombre || e.email;
  const est = e.estado === "activo" ? estadoHoy(e.uid).texto : e.estado === "pendiente" ? "Pendiente de aprobar" : "Desactivado";
  $("#e-sub").textContent = [e.rol === "admin" ? "Administración" : "Empleado", e.email, est].filter(Boolean).join(" · ");
}
function elegirTab(t) {
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
  for (const p of ["resumen", "horarios", "viaticos", "datos"]) $(`#t-${p}`).hidden = p !== t;
  if (t === "horarios" && !$("#e-jornadas").children.length) intentar(async () => { await verJornadas(); await verMarcasDia(); });
  if (t === "viaticos" && !$("#e-gastos").children.length) intentar(async () => { await verSemana(); await verMes(); });
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => elegirTab(b.dataset.tab));

// Resumen
async function renderResumen() {
  const e = actual, hoy = fechaIso(), inicioMes = hoy.slice(0, 8) + "01";
  $("#r-mes-titulo").textContent = nombreMes(hoy);
  $("#r-numeros").replaceChildren(el("div", {}, el("small", {}, "Cargando…")));
  renderResumenDatos();
  const [ms, gastosSem, gastosMes] = await Promise.all([
    marcasDe(e.uid, inicioMes, hoy),
    getDocs(query(collection(db, "gastos"), where("uid", "==", e.uid), where("lunes", "==", lunesDe(hoy)))),
    getDocs(query(collection(db, "gastos"), where("uid", "==", e.uid), where("mes", "==", hoy.slice(0, 7)))),
  ]);
  if (actual?.uid !== e.uid) return;
  const js = jornadas(ms);
  const suma = (k) => js.reduce((s, j) => s + j[k], 0);
  $("#r-numeros").replaceChildren(
    el("div", {}, el("b", {}, String(js.length)), el("small", {}, "Días con marcas")),
    el("div", {}, el("b", {}, horasTxt(suma("trabajoMin"))), el("small", {}, "Trabajadas")),
    el("div", {}, el("b", {}, horasTxt(suma("extraMin"))), el("small", {}, "Extra")),
    el("div", {}, el("b", {}, `${suma("horasViajeExtra").toLocaleString("es-AR")} h`), el("small", {}, "Viaje a pagar")));
  const deHoy = ms.filter((m) => m.fecha === hoy).sort((a, b) => a.ts - b.ts);
  $("#r-hoy").replaceChildren(deHoy.length
    ? el("table", { class: "lista-hoy" }, deHoy.map((m) => el("tr", {}, el("td", {}, hora(m.ts)),
      el("td", {}, MARCAS[m.tipo]?.texto || m.tipo, m.proyectoNombre || m.lugar ? el("small", { class: "nota" }, ` · ${m.proyectoNombre || m.lugar}`) : null))))
    : el("p", { class: "nota" }, "Todavía no marcó nada hoy."));
  const sem = gastosSem.docs.map((d) => d.data()).filter(esSemanal);
  const mes = gastosMes.docs.map((d) => d.data()).filter((g) => (g.pago || "yo") === "yo" && !esSemanal(g));
  const p = { mensual: "", semanal: true, ...(e.planillas || {}) };
  $("#r-viaticos").replaceChildren(
    p.semanal ? dato(`Semana del ${ddmm(lunesDe(hoy)).slice(0, 5)}`, el("b", {}, pesos(sem.reduce((s, g) => s + (g.monto || 0), 0)))) : null,
    dato(`Mensual · ${PLANILLAS[p.mensual] || "sin asignar"}`, el("b", {}, pesos(mes.reduce((s, g) => s + (g.monto || 0), 0)))),
    dato("Planillas", el("span", { class: "valor" },
      p.semanal ? el("button", { class: "btn peq", type: "button", onclick: () => intentar(() => bajarSemanal(e.uid, lunesDe(hoy))) }, "Semanal") : null, " ",
      el("button", { class: "btn peq", type: "button", onclick: () => intentar(() => bajarMensual(e.uid, hoy.slice(0, 7))) }, "Mensual"))));
}
const dato = (k, v) => el("div", { class: "dato" }, el("span", {}, k), typeof v === "string" ? el("span", { class: "valor" }, v) : v);
function renderResumenDatos() {
  const e = actual;
  $("#r-datos").replaceChildren(
    dato("Casa", e.casa ? el("a", { href: mapa(e.casa.lat, e.casa.lng), target: "_blank", class: "valor" }, e.casa.direccion || "Ver en el mapa") : el("span", { class: "alerta" }, "Sin cargar")),
    dato("DNI", e.dni ? Number(e.dni).toLocaleString("es-AR") : "—"),
    dato("Planillas", planillasTxt(e)));
}

// Horarios
async function verJornadas() {
  const e = actual, desde = $("#e-desde").value, hasta = $("#e-hasta").value;
  const js = jornadas(await marcasDe(e.uid, desde, hasta));
  ultimoEmpleado = { uid: e.uid, desde, hasta, js };
  const suma = (k) => js.reduce((s, j) => s + j[k], 0);
  $("#e-totales").replaceChildren(
    el("div", {}, el("b", {}, String(js.length)), el("small", {}, "Días")),
    el("div", {}, el("b", {}, horasTxt(suma("trabajoMin"))), el("small", {}, "Trabajadas")),
    el("div", {}, el("b", {}, horasTxt(suma("extraMin"))), el("small", {}, "Extra")),
    el("div", {}, el("b", {}, hhmm(suma("viajeMin"))), el("small", {}, "Viaje total")),
    el("div", {}, el("b", {}, `${suma("horasViajeExtra").toLocaleString("es-AR")} h`), el("small", {}, "Viaje a pagar")));
  $("#e-jornadas").replaceChildren(...(js.length ? js.map((j) => filaJornada(j, false))
    : [el("tr", {}, el("td", { colspan: "10" }, "No hay marcas en ese período."))]));
}
function filaJornada(j, conNombre) {
  return el("tr", {}, el("td", {}, ddmm(j.fecha)), conNombre ? el("td", {}, j.nombre) : null,
    el("td", {}, hora(j.salidaCasa)), el("td", {}, hora(j.llegadaTrabajo), el("br"), el("small", {}, j.lugar)),
    el("td", {}, hora(j.salidaTrabajo), el("br"), el("small", {}, j.lugarSalida)), el("td", {}, hora(j.llegadaCasa)),
    el("td", {}, hhmm(j.viajeMin)), el("td", {}, j.horasViajeExtra ? `${j.horasViajeExtra} h` : "—"),
    el("td", {}, hhmm(j.trabajoMin)), el("td", {}, j.extraMin ? hhmm(j.extraMin) : "—"),
    el("td", {}, Object.entries(j.porProyecto).map(([p, m]) => el("div", {}, `${p}: ${hhmm(m)}`)),
      j.avisos.map((a) => el("div", { class: "alerta" }, a))));
}
$("#form-e-jornadas").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(verJornadas); });
$("#e-excel").addEventListener("click", () => intentar(async () => {
  if (!ultimoEmpleado || ultimoEmpleado.uid !== actual.uid) await verJornadas();
  const r = ultimoEmpleado, libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.js.map(filaExcel)), "Jornadas");
  XLSX.writeFile(libro, `Horarios ${actual.nombre} ${r.desde} a ${r.hasta}.xlsx`);
}));
const filaExcel = (n) => ({
  Fecha: ddmm(n.fecha), Empleado: n.nombre, "Salió de casa": hora(n.salidaCasa), "Llegó al trabajo": hora(n.llegadaTrabajo),
  "Lugar de llegada": n.lugar, "Salió del trabajo": hora(n.salidaTrabajo), "Lugar de salida": n.lugarSalida, "Llegó a casa": hora(n.llegadaCasa),
  "Viaje ida (min)": n.idaMin, "Viaje vuelta (min)": n.vueltaMin, "Viaje total (min)": n.viajeMin, "Excedente viaje (min)": n.viajeExcesoMin,
  "Horas de viaje a pagar": n.horasViajeExtra, "Arranco a Terminé (h)": horas(n.presenciaMin), "Almuerzo (h)": horas(n.almuerzoMin),
  "Horas trabajadas (sin almuerzo)": horas(n.trabajoMin), "Horas extra": horas(n.extraMin),
  Proyectos: Object.entries(n.porProyecto).map(([p, m]) => `${p} (${horas(m)} h)`).join("; "), Observaciones: n.avisos.join("; "),
});

async function verMarcasDia() {
  const e = actual, f = $("#e-fecha").value;
  const ms = (await marcasDe(e.uid, f, f)).sort((a, b) => a.ts - b.ts);
  $("#e-marcas").replaceChildren(...(ms.length ? ms.map((m) => {
    let dist = "";
    if (e.casa && m.lat && (m.tipo === "salida_casa" || m.tipo === "llegada_casa")) dist = ` · a ${Math.round(distanciaM(m, e.casa))} m de casa`;
    return el("tr", {}, el("td", {}, hora(m.ts)),
      el("td", {}, MARCAS[m.tipo]?.texto || m.tipo, m.proyectoNombre ? el("small", {}, ` · ${m.proyectoNombre}`) : null,
        m.lugar ? el("small", {}, ` · ${m.lugar}`) : null, typeof m.km === "number" ? el("small", {}, ` · ${m.km.toLocaleString("es-AR")} km`) : null,
        m.manual ? el("div", { class: "alerta" }, `Cargada a mano: ${m.motivo || ""}`) : null),
      el("td", {}, m.lat ? el("a", { href: mapa(m.lat, m.lng), target: "_blank" }, `mapa (±${m.acc ?? "?"} m)`) : "—", dist),
      el("td", {}, el("button", { class: "btn peq", type: "button", onclick: () => intentar(async () => {
        if (!confirm("¿Borrar esta marca? No se puede deshacer.")) return;
        await deleteDoc(doc(db, "marcas", m.id)); aviso("Marca borrada.", "ok"); await verMarcasDia();
      }) }, "Borrar")));
  }) : [el("tr", {}, el("td", { colspan: "4" }, "Sin marcas ese día."))]));
}
$("#form-e-marcas").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(verMarcasDia); });
$("#form-e-agregar").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const e = actual, f = $("#e-fecha").value, h = $("#a-hora").value, tipo = $("#a-tipo").value, motivo = $("#a-motivo").value.trim();
    if (!f || !h || !motivo) throw new Error("Completá fecha, hora y motivo.");
    const [a, mo, d] = f.split("-").map(Number), [hh, mm] = h.split(":").map(Number);
    const marca = { uid: e.uid, nombre: e.nombre, tipo, fecha: f, ts: Timestamp.fromDate(new Date(a, mo - 1, d, hh, mm)),
      manual: true, motivo, cargadaPor: auth.currentUser.uid };
    if (tipo === "inicio" || tipo === "cambio") {
      const p = proyectos.find((x) => x.id === $("#a-proyecto").value);
      if (!p) throw new Error("Elegí el proyecto.");
      marca.proyectoId = p.id; marca.proyectoNombre = p.cliente ? `${p.nombre} · ${p.cliente}` : p.nombre;
    }
    if (tipo === "llegada_trabajo" || tipo === "salida_trabajo") marca.lugar = $("#a-lugar").value.trim() || "Sin dato";
    await addDoc(collection(db, "marcas"), marca);
    ev.target.reset(); aviso("Marca agregada.", "ok");
    await verMarcasDia(); await verJornadas();
  });
});

// Viáticos
const esSemanal = (g) => g.tipo !== "nafta" && g.tipo !== "sube" && (g.planilla || "semanal") === "semanal" && (g.pago || "yo") === "yo";
function etiquetaPlanilla(g) {
  if ((g.pago || "yo") !== "yo") return `Factura para entregar (${g.pago === "corporativa" ? "corporativa" : "pagó Brensolma"})`;
  return esSemanal(g) ? "Semanal" : "Mensual";
}
const comprobante = (g) => g.fotoUrl ? el("a", { href: g.fotoUrl, target: "_blank" }, "Ver") : el("span", { class: "alerta" }, g.tipo === "sube" ? "PDF del mes" : "sin foto");
async function verSemana() {
  const e = actual, lunes = lunesDe($("#e-semana").value);
  const gs = (await getDocs(query(collection(db, "gastos"), where("uid", "==", e.uid), where("lunes", "==", lunes)))).docs
    .map((d) => d.data()).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.creadoMs || 0) - (b.creadoMs || 0));
  $("#e-gastos").replaceChildren(...(gs.length ? gs.map((g) => el("tr", {}, el("td", {}, ddmm(g.fecha).slice(0, 5)),
    el("td", {}, TIPOS_GASTO[g.tipo] || g.tipo), el("td", {}, etiquetaPlanilla(g)), el("td", {}, pesos(g.monto)),
    el("td", {}, g.proyecto || ""), el("td", {}, g.desc || ""), el("td", {}, comprobante(g))))
    : [el("tr", {}, el("td", { colspan: "7" }, "No cargó gastos esa semana."))]));
}
async function verMes() {
  const e = actual, mes = $("#e-mes").value;
  const gs = (await getDocs(query(collection(db, "gastos"), where("uid", "==", e.uid), where("mes", "==", mes)))).docs
    .map((d) => d.data()).filter((g) => (g.pago || "yo") === "yo" && !esSemanal(g)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  $("#e-gastos-mes").replaceChildren(...(gs.length ? gs.map((g) => el("tr", {}, el("td", {}, ddmm(g.fecha).slice(0, 5)),
    el("td", {}, TIPOS_GASTO[g.tipo] || g.tipo), el("td", {}, pesos(g.monto)), el("td", {}, g.desc || ""), el("td", {}, comprobante(g))))
    : [el("tr", {}, el("td", { colspan: "5" }, "No hay gastos de la planilla mensual ese mes."))]));
}
$("#form-e-semana").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(verSemana); });
$("#form-e-mes").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(verMes); });
$("#e-bajar-semanal").addEventListener("click", () => intentar(() => bajarSemanal(actual.uid, lunesDe($("#e-semana").value))));
$("#e-bajar-mensual").addEventListener("click", () => intentar(() => bajarMensual(actual.uid, $("#e-mes").value)));

async function descargar(ruta, campos, uid, porDefecto) {
  if (!API) throw new Error("Falta configurar el servidor de viáticos.");
  aviso("Armando la planilla… (si el servidor estaba dormido puede tardar un minuto)");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...campos, uid, descargar: "1" })) fd.append(k, v);
  const r = await fetch(API + ruta, { method: "POST", body: fd, headers: { Authorization: "Bearer " + await auth.currentUser.getIdToken() } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  const nombre = (r.headers.get("Content-Disposition") || "").match(/filename="(.+)"/)?.[1] || porDefecto;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob()); a.download = `${nombreDe(uid)} - ${nombre}`; a.click();
  aviso("Planilla descargada.", "ok");
}
const bajarSemanal = (uid, lunes) => descargar("/planilla", { lunes }, uid, "Planilla semanal.xlsx");
const bajarMensual = (uid, mes) => descargar("/planilla_mensual", { mes }, uid, "Planilla mensual.xlsx");

// Datos
function renderDatos() {
  const e = actual, p = { mensual: "", semanal: true, corporativa: false, ...(e.planillas || {}) };
  const guardarPlanillas = (c) => intentar(() => guardarEmpleado(e, { planillas: { ...p, ...c } }));
  const check = (texto, valor, alCambiar) => el("label", {}, Object.assign(el("input", { type: "checkbox", onchange: (ev) => alCambiar(ev.target.checked) }), { checked: !!valor }), texto);
  const activo = e.estado === "activo";
  $("#e-datos").replaceChildren(
    el("div", { class: "campo" }, el("span", {}, "Estado"),
      el("div", { class: "fila" }, el("b", {}, activo ? "Activo" : e.estado === "pendiente" ? "Pendiente de aprobar" : "Desactivado"),
        el("button", { type: "button", class: `btn peq ${activo ? "" : "prim"}`,
          onclick: () => intentar(() => guardarEmpleado(e, { estado: activo ? "inactivo" : "activo" })) }, activo ? "Desactivar" : "Activar"))),
    el("div", { class: "campo" }, el("span", {}, "Casa"),
      el("div", { class: "fila" }, e.casa ? el("a", { href: mapa(e.casa.lat, e.casa.lng), target: "_blank" }, e.casa.direccion || "Ver en el mapa")
        : el("span", { class: "alerta" }, "Sin cargar"),
        el("button", { type: "button", class: `btn peq ${e.casa ? "" : "prim"}`, onclick: () => editarCasa(e) }, e.casa ? "Cambiar" : "Cargar casa")),
      check("Puede marcar casa desde cualquier lugar", e.salidaLibre, (v) => intentar(() => guardarEmpleado(e, { salidaLibre: v })))),
    el("div", { class: "campo" }, el("span", {}, "DNI (va en las planillas)"),
      el("input", { value: e.dni || "", inputmode: "numeric", placeholder: "DNI",
        onchange: (ev) => intentar(() => guardarEmpleado(e, { dni: ev.target.value.replace(/\D/g, "") })) })),
    el("div", { class: "campo" }, el("span", {}, "Planillas"),
      el("select", { onchange: (ev) => guardarPlanillas({ mensual: ev.target.value }) },
        Object.entries(PLANILLAS).map(([k, t]) => el("option", { value: k, selected: p.mensual === k }, t))),
      check("Planilla semanal (técnicos: almuerzo y estacionamiento)", p.semanal, (v) => guardarPlanillas({ semanal: v })),
      check("Tiene tarjeta corporativa", p.corporativa, (v) => guardarPlanillas({ corporativa: v })),
      check("Paga mesas a cuenta con su tarjeta", e.mesaACuenta, (v) => intentar(() => guardarEmpleado(e, { mesaACuenta: v })))),
    el("div", { class: "campo" }, el("span", {}, "Rol"),
      el("select", { onchange: (ev) => intentar(() => guardarEmpleado(e, { rol: ev.target.value })) },
        el("option", { value: "empleado", selected: e.rol !== "admin" }, "Empleado"),
        el("option", { value: "admin", selected: e.rol === "admin" }, "Administración"))));
}

// ---------------------------------------------------------------- casa / direcciones (diálogo)
let alGuardarDir = null, dirOriginal = "", elegida = null;
function abrirDialogo(titulo, dir, guardar) {
  alGuardarDir = guardar; dirOriginal = dir || ""; elegida = null;
  $("#casa-titulo").textContent = titulo; $("#casa-dir").value = dir || "";
  $("#casa-resultados").replaceChildren(); $("#casa-guardar").disabled = true;
  $("#dlg-casa").showModal();
}
function editarCasa(e) {
  abrirDialogo(`Casa de ${e.nombre}`, e.casa?.direccion, async (lat, lng, direccion) => {
    const casa = { lat, lng, direccion, ...cajaRadio(lat, cfg.radioCasaM) };
    await updateDoc(doc(db, "empleados", e.uid), { casa, casaPropuesta: null });
    e.casa = casa; e.casaPropuesta = null;
    aviso(`Casa de ${e.nombre} guardada.`, "ok");
    if (actual?.uid === e.uid) { renderDatos(); renderResumenDatos(); }
    renderCasas();
  });
}
function editarDireccionProyecto(p) {
  abrirDialogo(`Dirección de ${p.nombre}`, p.ubicacion?.direccion, async (lat, lng, direccion) => {
    await updateDoc(doc(db, "proyectos", p.id), { ubicacion: { lat, lng, direccion } });
    await cargarProyectos(); aviso(`Dirección de ${p.nombre} guardada.`, "ok");
  });
}
function elegir(r, boton) {
  elegida = r;
  for (const b of document.querySelectorAll("#casa-resultados .btn")) b.classList.remove("prim");
  boton?.classList.add("prim"); $("#casa-guardar").disabled = false;
}
async function buscarDireccion() {
  const t = $("#casa-dir").value.trim();
  if (!t) return;
  const caja = $("#casa-resultados"), coords = t.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  let res;
  if (coords) res = [{ lat: +coords[1], lng: +coords[2], texto: `Coordenadas ${coords[1]}, ${coords[2]}` }];
  else {
    caja.replaceChildren(el("p", { class: "nota" }, "Buscando…"));
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ar&accept-language=es&q=" + encodeURIComponent(t));
    if (!r.ok) throw new Error("No se pudo buscar la dirección. Probá pegando las coordenadas de Google Maps.");
    res = (await r.json()).map((x) => ({ lat: +x.lat, lng: +x.lon, texto: x.display_name }));
  }
  if (!res.length) {
    caja.replaceChildren(el("p", { class: "alerta" }, "No encontré esa dirección. Probá con calle, número y localidad, o pegá las coordenadas de Google Maps."));
    return;
  }
  caja.replaceChildren(...res.map((x) => el("div", { class: "resultado" },
    el("button", { type: "button", class: "btn peq", onclick: (ev) => elegir(x, ev.currentTarget) }, "Elegir"), " ", x.texto, " · ",
    el("a", { href: mapa(x.lat, x.lng), target: "_blank" }, "ver en el mapa"))));
  if (res.length === 1) elegir(res[0], caja.querySelector(".btn"));
}
$("#casa-buscar").addEventListener("click", () => intentar(buscarDireccion));
$("#casa-dir").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); intentar(buscarDireccion); } });
$("#casa-guardar").addEventListener("click", () => intentar(async () => {
  if (!alGuardarDir || !elegida) return;
  const t = $("#casa-dir").value.trim();
  await alGuardarDir(elegida.lat, elegida.lng, /^\s*-?\d+(\.\d+)?\s*[,; ]/.test(t) ? dirOriginal : t);
  $("#dlg-casa").close();
}));
$("#casa-cancelar").addEventListener("click", () => $("#dlg-casa").close());

function renderCasas() {
  const b = cfg.brensolma || {};
  $("#c-lat").value = b.lat ?? ""; $("#c-lng").value = b.lng ?? "";
  $("#bsm-mapa").replaceChildren(b.lat ? el("a", { href: mapa(b.lat, b.lng), target: "_blank" }, "Ver Brensolma en el mapa") : "");
  $("#tabla-casas").replaceChildren(...empleados.filter((e) => e.estado !== "inactivo").map((e) => el("tr", {},
    el("td", {}, el("a", { href: `#/empleado/${encodeURIComponent(e.uid)}` }, e.nombre)),
    el("td", {}, e.casa ? el("a", { href: mapa(e.casa.lat, e.casa.lng), target: "_blank" }, e.casa.direccion || "Ver en el mapa") : el("span", { class: "alerta" }, "Sin cargar")),
    el("td", {}, el("button", { type: "button", class: `btn peq ${e.casa ? "" : "prim"}`, onclick: () => editarCasa(e) }, e.casa ? "Cambiar" : "Cargar casa")))));
}
$("#btn-ubic-bsm").addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition((p) => {
    $("#c-lat").value = p.coords.latitude.toFixed(6); $("#c-lng").value = p.coords.longitude.toFixed(6);
    aviso(`Ubicación tomada (±${Math.round(p.coords.accuracy)} m). Tocá Guardar.`);
  }, (err) => aviso(err.message, "error"), { enableHighAccuracy: true, timeout: 20000 });
});
$("#form-brensolma").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const brensolma = { lat: parseFloat($("#c-lat").value), lng: parseFloat($("#c-lng").value) };
    if (!Number.isFinite(brensolma.lat) || !Number.isFinite(brensolma.lng)) throw new Error("Revisá las coordenadas.");
    await setDoc(doc(db, "config", "general"), { brensolma }, { merge: true });
    cfg.brensolma = brensolma; renderCasas(); aviso("Ubicación de Brensolma guardada.", "ok");
  });
});

// ---------------------------------------------------------------- proyectos
async function cargarProyectos() {
  proyectos = (await getDocs(collection(db, "proyectos"))).docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  $("#tabla-proyectos").replaceChildren(...proyectos.map((p) => el("tr", { "data-buscar": normal(`${p.nombre} ${p.cliente || ""}`) },
    el("td", {}, p.nombre), el("td", {}, p.cliente || ""),
    el("td", {}, p.ubicacion ? [el("a", { href: mapa(p.ubicacion.lat, p.ubicacion.lng), target: "_blank" }, p.ubicacion.direccion || "Ver en el mapa"), " ",
      el("button", { type: "button", class: "btn peq", onclick: () => editarDireccionProyecto(p) }, "Cambiar")]
      : el("button", { type: "button", class: "btn peq", onclick: () => editarDireccionProyecto(p) }, "Cargar dirección")),
    el("td", {}, el("button", { type: "button", class: "btn peq", onclick: () => intentar(async () => {
      await updateDoc(doc(db, "proyectos", p.id), { activo: !p.activo }); await cargarProyectos();
    }) }, p.activo ? "Archivar" : "Archivado · activar")))));
  filtrarProyectos();
  $("#a-proyecto").replaceChildren(el("option", { value: "" }, "—"),
    ...proyectos.map((p) => el("option", { value: p.id }, p.cliente ? `${p.nombre} · ${p.cliente}` : p.nombre)));
}
function filtrarProyectos() {
  const q = normal($("#buscar-proyectos").value).split(/\s+/).filter(Boolean);
  for (const tr of document.querySelectorAll("#tabla-proyectos tr")) tr.hidden = !q.every((p) => tr.dataset.buscar.includes(p));
}
$("#buscar-proyectos").addEventListener("input", filtrarProyectos);
$("#form-proyecto").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const nombre = $("#p-nombre").value.trim();
    if (!nombre) return;
    await addDoc(collection(db, "proyectos"), { nombre, cliente: $("#p-cliente").value.trim(), activo: true });
    ev.target.reset(); await cargarProyectos(); aviso("Proyecto agregado.", "ok");
  });
});
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function geocodificar(t) {
  try {
    const r = await (await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&accept-language=es&q=" + encodeURIComponent(t))).json();
    return r[0] ? { lat: +r[0].lat, lng: +r[0].lon } : null;
  } catch { return null; }
}
async function importarProyectos(archivo) {
  const libro = XLSX.read(await archivo.arrayBuffer());
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { defval: "" });
  const col = (f, ...nombres) => { const k = Object.keys(f).find((x) => nombres.includes(normal(x))); return k ? String(f[k]).trim() : ""; };
  const items = filas.map((f) => ({ nombre: col(f, "proyecto", "numero", "nombre"), cliente: col(f, "cliente"),
    direccion: col(f, "direccion"), coords: col(f, "coordenadas", "ubicacion") })).filter((x) => x.nombre);
  if (!items.length) throw new Error("No encontré filas. La primera fila tiene que tener los títulos Proyecto y Cliente.");
  if (!confirm(`Se van a importar ${items.length} proyectos. ¿Seguimos?`)) return;
  let nuevos = 0, actualizados = 0, sinDir = 0;
  for (const [i, x] of items.entries()) {
    aviso(`Importando ${i + 1} de ${items.length}…`);
    const datos = { nombre: x.nombre, cliente: x.cliente };
    const c = x.coords.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    if (c) datos.ubicacion = { lat: +c[1], lng: +c[2], direccion: x.direccion };
    else if (x.direccion) {
      const g = await geocodificar(x.direccion);
      await esperar(1100);
      if (g) datos.ubicacion = { ...g, direccion: x.direccion }; else sinDir++;
    }
    const ya = proyectos.find((p) => normal(p.nombre) === normal(x.nombre));
    if (ya) { await updateDoc(doc(db, "proyectos", ya.id), datos); actualizados++; }
    else { await addDoc(collection(db, "proyectos"), { ...datos, activo: true }); nuevos++; }
  }
  await cargarProyectos();
  aviso(`Listo: ${nuevos} nuevos y ${actualizados} actualizados.` + (sinDir ? ` ${sinDir} direcciones no se encontraron: cargalas a mano.` : ""), "ok");
}
$("#btn-importar").addEventListener("click", () => $("#archivo-proyectos").click());
$("#archivo-proyectos").addEventListener("change", (ev) => {
  const a = ev.target.files[0]; ev.target.value = "";
  if (a) intentar(() => importarProyectos(a));
});
$("#btn-modelo").addEventListener("click", () => {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet([{ Proyecto: "20241226-868", Cliente: "Boldt", Dirección: "Av. Ejemplo 1234, Lanús", Coordenadas: "" }]), "Proyectos");
  XLSX.writeFile(libro, "Modelo proyectos.xlsx");
});

// ---------------------------------------------------------------- reporte general
$("#form-reporte").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(reporte); });
async function reporte() {
  const desde = $("#desde").value, hasta = $("#hasta").value, uid = $("#r-empleado").value;
  const marcas = (await marcasDeTodos(desde, hasta)).filter((m) => !uid || m.uid === uid);
  const js = jornadas(marcas), porProyecto = {}, porEmpleado = {};
  for (const j of js) {
    for (const [p, m] of Object.entries(j.porProyecto)) {
      porProyecto[p] ||= { total: 0, personas: {} };
      porProyecto[p].total += m; porProyecto[p].personas[j.nombre] = (porProyecto[p].personas[j.nombre] || 0) + m;
    }
    const t = (porEmpleado[j.nombre] ||= { dias: 0, trabajo: 0, extra: 0, viaje: 0, hViaje: 0 });
    t.dias++; t.trabajo += j.trabajoMin; t.extra += j.extraMin; t.viaje += j.viajeMin; t.hViaje += j.horasViajeExtra;
  }
  ultimoReporte = { desde, hasta, marcas, js, porProyecto, porEmpleado };
  $("#tabla-jornadas").replaceChildren(...js.map((j) => filaJornada(j, true)));
  $("#tabla-proyectos-horas").replaceChildren(...Object.entries(porProyecto).sort((a, b) => b[1].total - a[1].total).map(([p, x]) =>
    el("tr", {}, el("td", {}, p), el("td", {}, horasTxt(x.total)), el("td", {}, Object.entries(x.personas).map(([n, m]) => `${n} ${horas(m)} h`).join(" · ")))));
  $("#tabla-empleados-tot").replaceChildren(...Object.entries(porEmpleado).map(([n, t]) => el("tr", {}, el("td", {}, n), el("td", {}, t.dias),
    el("td", {}, horasTxt(t.trabajo)), el("td", {}, horasTxt(t.extra)), el("td", {}, hhmm(t.viaje)), el("td", {}, `${t.hViaje} h`))));
  $("#resultado").hidden = false; $("#sin-datos").hidden = js.length > 0;
}
$("#btn-excel").addEventListener("click", () => intentar(async () => {
  if (!ultimoReporte) throw new Error("Primero generá el reporte.");
  const r = ultimoReporte, libro = XLSX.utils.book_new(), hoja = (d, n) => XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(d), n);
  hoja(r.js.map(filaExcel), "Jornadas");
  hoja(Object.entries(r.porProyecto).flatMap(([p, x]) => Object.entries(x.personas).map(([n, m]) => ({ Proyecto: p, Empleado: n, Horas: horas(m) }))), "Horas por proyecto");
  hoja(Object.entries(r.porEmpleado).map(([n, t]) => ({ Empleado: n, Días: t.dias, "Horas trabajadas": horas(t.trabajo), "Horas extra": horas(t.extra),
    "Viaje total (h)": horas(t.viaje), "Horas de viaje a pagar": t.hViaje })), "Totales por empleado");
  hoja([...r.marcas].sort((a, b) => a.ts - b.ts).map((m) => ({ Fecha: ddmm(m.fecha), Hora: hora(m.ts), Empleado: nombreDe(m.uid, m),
    Marca: MARCAS[m.tipo]?.texto || m.tipo, Proyecto: m.proyectoNombre || "", Lugar: m.lugar || "", "Precisión GPS (m)": m.acc ?? "",
    Mapa: m.lat ? mapa(m.lat, m.lng) : "", Manual: m.manual ? `Sí (${m.motivo || ""})` : "" })), "Marcas");
  XLSX.writeFile(libro, `Horarios Brensolma ${r.desde} a ${r.hasta}.xlsx`);
}));

// ---------------------------------------------------------------- viáticos de todos
async function viaticosSemana(lunes) {
  const gs = (await getDocs(query(collection(db, "gastos"), where("lunes", "==", lunes)))).docs.map((d) => d.data())
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.creadoMs || 0) - (b.creadoMs || 0));
  const por = {};
  for (const g of gs) {
    const t = (por[g.uid] ||= { alm: 0, est: 0, n: 0, fotos: 0, nombre: nombreDe(g.uid, g) });
    if (esSemanal(g)) { if (g.tipo === "almuerzo") t.alm += g.monto; else t.est += g.monto; }
    t.n++; if (g.fotoUrl) t.fotos++;
  }
  $("#tabla-viaticos").replaceChildren(...(gs.length ? Object.entries(por).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre)).map(([uid, t]) =>
    el("tr", {}, el("td", {}, el("a", { href: `#/empleado/${encodeURIComponent(uid)}` }, t.nombre)), el("td", {}, pesos(t.alm)), el("td", {}, pesos(t.est)),
      el("td", {}, el("b", {}, pesos(t.alm + t.est))), el("td", {}, `${t.fotos} de ${t.n} con foto`),
      el("td", {}, el("button", { type: "button", class: "btn peq", onclick: () => intentar(() => bajarSemanal(uid, lunes)) }, "Planilla"))))
    : [el("tr", {}, el("td", { colspan: "6" }, "No hay gastos cargados esa semana."))]));
  $("#tabla-viaticos-det").replaceChildren(...gs.map((g) => el("tr", {}, el("td", {}, ddmm(g.fecha).slice(0, 5)), el("td", {}, nombreDe(g.uid, g)),
    el("td", {}, TIPOS_GASTO[g.tipo] || g.tipo), el("td", {}, etiquetaPlanilla(g)), el("td", {}, pesos(g.monto)),
    el("td", {}, g.proyecto || ""), el("td", {}, g.desc || ""), el("td", {}, comprobante(g)))));
}
$("#form-viaticos").addEventListener("submit", (ev) => { ev.preventDefault(); intentar(() => viaticosSemana(lunesDe($("#v-fecha").value))); });
function mensualesDe(mes) {
  const lista = empleados.filter((e) => e.estado === "activo");
  $("#tabla-mensuales").replaceChildren(...lista.map((e) => {
    const tipo = e.planillas?.mensual || "solo";
    return el("tr", {}, el("td", {}, el("a", { href: `#/empleado/${encodeURIComponent(e.uid)}` }, e.nombre)),
      el("td", {}, PLANILLAS[tipo] + (e.planillas?.mensual ? "" : " (sin asignar)")),
      el("td", {}, el("button", { type: "button", class: "btn peq", onclick: () => intentar(() => bajarMensual(e.uid, mes)) }, "Planilla")));
  }));
}
$("#form-mensuales").addEventListener("submit", (ev) => { ev.preventDefault(); mensualesDe($("#m-mes").value); });

// ---------------------------------------------------------------- configuración
const CAMPOS = ["jornadaMin", "almuerzoMin", "viajeIncluidoMin", "bloqueViajeMin", "horasPorBloque", "radioCasaM", "radioBrensolmaM"];
$("#form-config").addEventListener("submit", (ev) => {
  ev.preventDefault();
  intentar(async () => {
    const nuevo = { redondeoBloque: $("#c-redondeo").value };
    for (const k of CAMPOS) nuevo[k] = parseFloat($(`#c-${k}`).value);
    if (CAMPOS.some((k) => !Number.isFinite(nuevo[k]))) throw new Error("Revisá los números.");
    const cambioRadio = nuevo.radioCasaM !== cfg.radioCasaM;
    await setDoc(doc(db, "config", "general"), nuevo, { merge: true });
    cfg = { ...cfg, ...nuevo };
    if (cambioRadio) for (const e of empleados.filter((x) => x.casa)) {
      const casa = { ...e.casa, ...cajaRadio(e.casa.lat, cfg.radioCasaM) };
      await updateDoc(doc(db, "empleados", e.uid), { casa }); e.casa = casa;
    }
    aviso("Configuración guardada.", "ok");
  });
});

// ---------------------------------------------------------------- arranque de formularios
function prepararFormularios() {
  const hoy = fechaIso(), d = new Date();
  $("#desde").value = fechaIso(new Date(d.getFullYear(), d.getMonth(), 1)); $("#hasta").value = hoy;
  $("#v-fecha").value = hoy;
  const ant = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  $("#m-mes").value = fechaIso(ant).slice(0, 7);
  for (const k of CAMPOS) $(`#c-${k}`).value = cfg[k];
  $("#c-redondeo").value = cfg.redondeoBloque;
  $("#a-tipo").replaceChildren(...Object.entries(MARCAS).map(([k, m]) => el("option", { value: k }, m.texto)));
  mensualesDe($("#m-mes").value);
}
