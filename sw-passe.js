// Guarda o check-in (checkin.html) e o validador da segurança (validar.html) no aparelho para abrirem sem internet
// (13/11/2026). Rede primeiro; sem rede, a cópia guardada. Registrado com escopo ./checkin e ./validar.
var CACHE = 'passe-v11';
var ARQUIVOS = ['checkin.html', 'validar.html', 'passe.html', 'js/checkin.js', 'js/validar.js', 'css/recepcao.css', 'img/logo-nova-acropole.png'];
var APELIDOS = { checkin: 'checkin.html', inscrever: 'checkin.html', validar: 'validar.html', passe: 'passe.html' };

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('passe-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  var caminho = url.pathname.replace(/^\//, '');
  caminho = APELIDOS[caminho] || caminho;
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
