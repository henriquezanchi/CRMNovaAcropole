// Guarda a página da recepção no aparelho para abrir sem internet (13/11/2026).
// Rede primeiro (pega a versão nova quando há conexão); sem rede, usa a cópia guardada.
// Só cuida dos arquivos da própria página; as chamadas ao servidor não passam por aqui.
var CACHE = 'recepcao-v15';
var ARQUIVOS = ['recepcao.html', 'js/recepcao.js', 'css/recepcao.css', 'img/logo-nova-acropole.png', 'recepcao.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('recepcao-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  var caminho = url.pathname.replace(/^\//, '');
  if (caminho === 'recepcao') caminho = 'recepcao.html';
  if (ARQUIVOS.indexOf(caminho) < 0) return;
  // Rede primeiro, mas sem esperar para sempre: com internet lenta (3 s sem resposta), abre a cópia guardada
  // e a versão nova fica guardada para a próxima vez.
  e.respondWith(new Promise(function (resolver) {
    var feito = false;
    var entregar = function (r) { if (!feito && r) { feito = true; resolver(r); } };
    var relogio = setTimeout(function () { caches.match(caminho).then(entregar); }, 3000);
    fetch(e.request).then(function (r) {
      clearTimeout(relogio);
      if (r.ok) { var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(caminho, copia); }); }
      entregar(r);
    }).catch(function () {
      clearTimeout(relogio);
      caches.match(caminho).then(function (c) { entregar(c || Response.error()); });
    });
  }));
});
