// Tema claro / oscuro / automático. Se guarda en este celular o compu.
(function () {
  var raiz = document.documentElement;
  function leer() { try { return localStorage.getItem("tema") || "auto"; } catch (e) { return "auto"; } }
  function aplicar(t) {
    if (t === "claro" || t === "oscuro") raiz.setAttribute("data-tema", t); else raiz.removeAttribute("data-tema");
    var oscuro = t === "oscuro" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", oscuro ? "#1c211a" : "#ffffff");
    var bs = document.querySelectorAll(".selector-tema button");
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-pressed", bs[i].dataset.tema === t);
  }
  aplicar(leer());
  document.addEventListener("DOMContentLoaded", function () {
    aplicar(leer());
    var bs = document.querySelectorAll(".selector-tema button");
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener("click", function () {
      var t = this.dataset.tema;
      try { localStorage.setItem("tema", t); } catch (e) {}
      aplicar(t);
    });
  });
})();

// Botón redondo de la cabecera: alterna claro / oscuro.
document.addEventListener("DOMContentLoaded", function () {
  var b = document.getElementById("btn-tema");
  if (!b) return;
  b.addEventListener("click", function () {
    var raiz = document.documentElement;
    var oscuroAhora = raiz.getAttribute("data-tema") === "oscuro" ||
      (!raiz.getAttribute("data-tema") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var t = oscuroAhora ? "claro" : "oscuro";
    try { localStorage.setItem("tema", t); } catch (e) {}
    raiz.setAttribute("data-tema", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "oscuro" ? "#1c211a" : "#ffffff");
  });
});
