// Recepção do evento (13/11/2026, Dia Mundial da Filosofia). Página: recepcao.html#<chave>.
// - Busca por voz ou digitação, tolerante a erro de grafia; um toque marca a presença no Ulisses.
// - Cadastro na porta de quem chegou sem inscrição (inscreve no Ulisses e marca presença).
// - Funciona sem internet: a página fica guardada no aparelho (sw-recepcao.js), a lista fica em
//   localStorage e cada ação entra numa fila que é enviada sozinha quando a conexão volta.
//   Cada ação tem um client_id: reenviar nunca grava duas vezes.
(function () {
  'use strict';
  var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
  // #<chave>[&tela=participante] — a segunda tela usa o mesmo link com "&tela=participante".
  var partesHash = (location.hash || '').replace(/^#/, '').split('&');
  var chave = partesHash[0];
  var ehEspelho = partesHash.indexOf('tela=participante') > 0;
  var pref = 'rc_' + chave.slice(0, 12) + '_';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- armazenamento local ----------
  function ler(k, padrao) { try { var v = localStorage.getItem(pref + k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function gravar(k, v) { try { localStorage.setItem(pref + k, JSON.stringify(v)); } catch (e) { /* cheio: segue em memória */ } }
  var sessao = ler('sessao', null);
  var lista = ler('lista', null);          // última resposta "lista" do servidor
  var fila = ler('fila', []);              // ações a enviar
  var problemas = ler('problemas', []);    // ações recusadas de vez
  var online = navigator.onLine;
  // Quem está atendendo neste aparelho (sem login). Vai em cada ação, para saber quem registrou.
  var atendente = '';
  try { atendente = localStorage.getItem('rc_atendente') || ''; } catch (e) { /* ok */ }

  // Segunda tela: a janela do participante recebe o que está sendo digitado (mesmo navegador, funciona sem internet).
  var canal = 'BroadcastChannel' in window ? new BroadcastChannel('rc-' + chave.slice(0, 12)) : null;
  function espelhar(msg) { if (canal && !ehEspelho) canal.postMessage(msg); }
  function sha256(t) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x + 256).toString(16).slice(1); }).join('');
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'texto') n.textContent = attrs[k];
      else if (k === 'classe') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f != null) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }
  var timerAviso;
  function aviso(t) { var a = $('aviso'); a.textContent = t; a.hidden = false; clearTimeout(timerAviso); timerAviso = setTimeout(function () { a.hidden = true; }, 3200); }
  function normalizar(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nomeProprio(s) {
    var minusc = { da: 1, de: 1, 'do': 1, das: 1, dos: 1, e: 1 };
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
      .map(function (p, i) { return i > 0 && minusc[p] ? p : p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
  }

  // ---------- servidor ----------
  function chamar(corpo) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 25000);
    corpo.chave = chave; if (sessao) corpo.sessao = sessao.token;
    if (!corpo.atendente && atendente) corpo.atendente = atendente;
    return fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: ctrl.signal })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); })
      .then(function (j) { marcarConexao(true); return j; }, function (e) { marcarConexao(false); throw e; })
      .finally(function () { clearTimeout(t); });
  }
  function marcarConexao(ok) { online = ok; desenharConexao(); }
  function desenharConexao() {
    var c = $('conexao');
    c.textContent = online ? 'Online' : 'Sem internet';
    c.className = 'conexao' + (online ? '' : ' off');
    $('nPendentes').textContent = fila.length;
    $('caixaPendentes').className = 'pendentes' + (fila.length ? ' tem' : '');
  }

  // ---------- PIN ----------
  function mostrarPin(msg) {
    $('telaPrincipal').hidden = true; $('telaPin').hidden = false;
    $('pinErro').textContent = msg || '';
    setTimeout(function () { $('pinValor').focus(); }, 50);
  }
  $('formPin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var apelido = atendente;
    $('pinErro').textContent = 'Entrando…';
    sessao = null;
    var pinDigitado = $('pinValor').value;
    chamar({ acao: 'pin', pin: pinDigitado, apelido: apelido }).then(function (j) {
      if (!j.ok) { $('pinErro').textContent = j.erro || 'Não foi possível entrar.'; return; }
      sha256(chave + ':' + pinDigitado).then(function (h) { gravar('pinHash', h); });
      sessao = { token: j.sessao, expira: j.expira_em }; gravar('sessao', sessao);
      $('pinValor').value = '';
      iniciar();
    }, function () { $('pinErro').textContent = 'Sem internet. O primeiro acesso precisa de conexão.'; });
  });

  // ---------- estado combinado (servidor + ações ainda na fila) ----------
  function presencaLocal() {
    var m = {};
    fila.forEach(function (f) { if (f.acao === 'presenca') m[f.dados.email_evento_id] = f.dados.compareceu; });
    return m;
  }
  function inscritos() {
    var sobre = presencaLocal();
    return ((lista && lista.inscritos) || []).map(function (x) {
      var p = Object.prototype.hasOwnProperty.call(sobre, x.email_evento_id) ? sobre[x.email_evento_id] : x.compareceu === true;
      return { id: x.email_evento_id, nome: x.nome, norm: normalizar(x.nome), final_tel: x.final_tel, tel8: x.tel8 || '', email: x.email_mascara,
        aluno: x.aluno, escola: x.escola, presente: !!p, pendente: Object.prototype.hasOwnProperty.call(sobre, x.email_evento_id), na_porta: x.na_porta };
    });
  }
  function inscricoesNaFila() { return fila.filter(function (f) { return f.acao === 'inscrever'; }); }
  function reservas() { return (lista && lista.reservas) || []; }
  function vagasRestantes() {
    var cap = lista && Number(lista.capacidade);
    if (!cap) return null;
    return cap - ((lista.inscritos || []).length + reservas().length + inscricoesNaFila().length);
  }

  function desenharPlacar() {
    var todos = inscritos();
    var extra = inscricoesNaFila().length + reservas().length;
    $('nInscritos').textContent = todos.length + extra;
    $('nPresentes').textContent = todos.filter(function (x) { return x.presente; }).length + extra;
    $('nPorta').textContent = todos.filter(function (x) { return x.na_porta; }).length + extra;
    var vr = vagasRestantes();
    $('cadSemEmail').textContent = vr !== null && vr <= 0
      ? 'As vagas acabaram: só dá para inscrever com e-mail (inscrição completa no Ulisses).'
      : 'Sem e-mail? Pode deixar em branco: a vaga fica reservada' + (vr !== null ? ' (restam ' + vr + ')' : '') + ' e pedimos o e-mail depois pelo WhatsApp. Não invente e-mail.';
    desenharConexao();
  }

  // ---------- busca tolerante ----------
  function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    var v = []; for (var j = 0; j <= b.length; j++) v[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var ant = v[0]; v[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = v[j];
        v[j] = Math.min(v[j] + 1, v[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
        ant = tmp;
      }
    }
    return v[b.length];
  }
  function pontuar(pessoa, tokens, digitos) {
    if (digitos && digitos.length >= 3) {
      // Celular com ou sem 55/DDD/9: compara com os 8 últimos dígitos guardados.
      var t8 = pessoa.tel8 || '';
      if (!t8) return 0;
      if (digitos.length >= 8) return t8 === digitos.slice(-8) ? 60 : 0;
      if (digitos.length >= 4) return t8.indexOf(digitos) >= 0 ? (t8.slice(-digitos.length) === digitos ? 55 : 45) : 0;
      return t8.slice(-3) === digitos ? 40 : 0;
    }
    var nomes = pessoa.norm.split(' ').filter(function (t) { return t.length > 1 && ['da', 'de', 'do', 'das', 'dos'].indexOf(t) < 0; });
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var q = tokens[i], melhor = 0;
      for (var k = 0; k < nomes.length; k++) {
        var n = nomes[k], s = 0;
        if (n === q) s = 10;
        else if (q.length >= 2 && n.indexOf(q) === 0) s = 7;
        else if (q.length >= 4) { var d = distancia(q, n.slice(0, Math.max(q.length, n.length))); if (d <= (q.length >= 7 ? 2 : 1)) s = 6 - d; }
        if (k === 0 && i === 0 && s) s += 2; // primeiro nome bate com a primeira palavra dita
        if (s > melhor) melhor = s;
      }
      if (!melhor) return 0;
      total += melhor;
    }
    return total;
  }
  function buscar(texto, base) {
    var norm = normalizar(texto);
    var dig = texto.replace(/\D/g, '');
    var tokens = norm.split(' ').filter(function (t) { return t && ['da', 'de', 'do', 'das', 'dos', 'e'].indexOf(t) < 0 && !/^\d+$/.test(t); });
    if (!tokens.length && dig.length < 3) return [];
    return base.map(function (p) { return { p: p, s: pontuar(p, tokens, tokens.length ? '' : dig) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.p.nome.localeCompare(b.p.nome); })
      .slice(0, 25).map(function (r) { return r.p; });
  }

  // ---------- Chegada ----------
  var anotando = null; // id da pessoa em que estamos anotando "veio com quem / interesse"
  function cartaoPessoa(p) {
    var info = el('div', { classe: 'info' }, [
      p.aluno ? el('span', { classe: 'selo', texto: 'Aluno' }) : el('span', { classe: 'selo fora', texto: 'De fora' }),
      p.escola ? el('span', { texto: String(p.escola).replace(/^Goiânia - /, '') }) : null,
      p.final_tel ? el('span', { texto: 'cel. final ' + p.final_tel }) : null,
      p.email ? el('span', { texto: p.email }) : null,
      p.pendente ? el('span', { classe: 'selo fora', texto: 'enviando…' }) : null
    ]);
    var acao = p.presente
      ? el('div', { classe: 'acao' }, [el('span', { classe: 'ok-presente', texto: '✓ Presente' }),
          el('button', { type: 'button', classe: 'btn-desfazer', texto: 'desfazer', onclick: function () { marcar(p, false); } })])
      : el('div', { classe: 'acao' }, [el('button', { type: 'button', classe: 'btn-chegou', texto: 'Chegou', onclick: function () { marcar(p, true); } })]);
    var card = el('div', { classe: 'pessoa' + (p.presente ? ' presente' : '') + (p.pendente ? ' pendente' : '') }, [
      el('div', { classe: 'nome', texto: p.nome }), acao, info
    ]);
    if (anotando === p.id && p.presente && !p.aluno) card.appendChild(painelAnotar(p));
    return card;
  }
  function painelAnotar(p) {
    var veio = el('input', { placeholder: 'Veio com alguém? Quem?', maxlength: '120' });
    var interesse = null;
    var chips = ['Sim', 'Não'].map(function (t) {
      var c = el('button', { type: 'button', classe: 'chip', texto: t, onclick: function () {
        interesse = t === 'Sim'; chips.forEach(function (x) { x.classList.remove('ativo'); }); c.classList.add('ativo');
      } });
      return c;
    });
    return el('div', { classe: 'anotar' }, [
      el('div', { classe: 'linha' }, [veio]),
      el('div', { classe: 'linha' }, [el('span', { texto: 'Quer receber informações sobre o curso?' })].concat(chips)),
      el('div', { classe: 'linha' }, [
        el('button', { type: 'button', classe: 'btn principal', texto: 'Salvar', onclick: function () {
          var dados = { email_evento_id: p.id };
          if (veio.value.trim()) dados.veio_com = veio.value.trim();
          if (interesse !== null) dados.interesse_curso = interesse;
          if (Object.keys(dados).length > 1) enfileirar('anotar', dados);
          proximo();
        } }),
        el('button', { type: 'button', classe: 'btn secundario', texto: 'Pular', onclick: proximo })
      ])
    ]);
  }
  function proximo() { anotando = null; $('busca').value = ''; desenharResultados(); $('busca').focus(); }

  function marcar(p, compareceu) {
    enfileirar('presenca', { email_evento_id: p.id, compareceu: compareceu });
    if (compareceu) {
      aviso('✓ ' + p.nome.split(' ')[0] + ' marcado(a) como presente');
      espelhar({ tipo: 'boasvindas', nome: p.nome });
      mostrarPasse(p.nome, null, p.id);
      if (!p.aluno) { anotando = p.id; desenharResultados(); return; }
      proximo();
    } else { aviso('Presença desfeita: ' + p.nome); desenharResultados(); }
  }
  function desenharResultados() {
    var area = $('resultados'); area.textContent = '';
    var q = $('busca').value.trim();
    desenharPlacar();
    if (!lista) { area.appendChild(el('p', { classe: 'vazio', texto: 'Carregando a lista…' })); return; }
    if (!q) { area.appendChild(el('p', { classe: 'vazio', texto: 'Digite ou fale o nome. Também dá para buscar pelo celular, inteiro ou só o final.' })); return; }
    var achados = buscar(q, inscritos());
    if (!achados.length) {
      area.appendChild(el('p', { classe: 'vazio', texto: 'Ninguém com esse nome ou celular na lista de inscritos.' }));
      return;
    }
    achados.forEach(function (p) { area.appendChild(cartaoPessoa(p)); });
  }
  $('busca').addEventListener('input', function () { anotando = null; desenharResultados(); });
  $('irCadastrar').addEventListener('click', function () {
    var q = $('busca').value.trim();
    abrirAba('cadastrar');
    if (q && !/\d/.test(q)) { $('cadNome').value = nomeProprio(q); sugerirBase(); verificarJaInscrito(); }
    $('cadNome').focus();
  });

  // ---------- voz ----------
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var reconhecendo = null;
  function ouvir(botao, aoTerminar) {
    if (!Rec) { aviso('Este navegador não reconhece voz. Use o Chrome ou o Safari, ou digite.'); return; }
    if (reconhecendo) { reconhecendo.stop(); return; }
    var r = new Rec(); r.lang = 'pt-BR'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    reconhecendo = r; botao.classList.add('ouvindo'); $('dicaVoz').textContent = 'Ouvindo… diga o nome';
    r.onresult = function (e) {
      var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      aoTerminar(t, e.results[e.results.length - 1].isFinal);
    };
    r.onerror = function (e) {
      $('dicaVoz').textContent = e.error === 'network' ? 'A voz precisa de internet neste aparelho. Digite o nome.' :
        e.error === 'not-allowed' ? 'Permita o microfone nas configurações do navegador.' : e.error === 'no-speech' ? 'Não ouvi nada. Tente de novo.' : '';
    };
    r.onend = function () { reconhecendo = null; botao.classList.remove('ouvindo'); if (/Ouvindo/.test($('dicaVoz').textContent)) $('dicaVoz').textContent = ''; };
    try { r.start(); } catch (e) { reconhecendo = null; botao.classList.remove('ouvindo'); }
  }
  $('micBusca').addEventListener('click', function () {
    ouvir($('micBusca'), function (t) { $('busca').value = t; anotando = null; desenharResultados(); });
  });
  document.querySelectorAll('[data-mic]').forEach(function (b) {
    b.addEventListener('click', function () {
      var alvo = $(b.getAttribute('data-mic'));
      ouvir(b, function (t, final) { alvo.value = nomeProprio(t); if (final && alvo.id === 'cadNome') { sugerirBase(); verificarJaInscrito(); } });
    });
  });

  // ---------- Cadastro na porta ----------
  var pidEscolhido = null, pessoaBase = null, timerBase;
  // Antes de inscrever, confere se a pessoa já está inscrita: na lista do aparelho (nome, celular) e,
  // com internet, direto no Ulisses (pega quem se inscreveu depois da última atualização da lista).
  var timerVerificar, verificacaoAtual = 0;
  function dadosCadastro() {
    return { nome: $('cadNome').value.trim(), ddd: $('cadDdd').value.replace(/\D/g, ''), tel: $('cadTel').value.replace(/\D/g, ''),
      email: $('cadEmail').value.trim(), veio_com: $('cadVeioCom').value.trim() };
  }
  function verificarJaInscrito() {
    var d = dadosCadastro();
    espelhar({ tipo: 'cadastro', dados: d });
    var achados = [], vistos = {};
    var add = function (p, motivo) { if (!vistos[p.id]) { vistos[p.id] = 1; achados.push({ p: p, motivo: motivo }); } };
    var todos = inscritos();
    if (d.tel.length >= 8) todos.filter(function (p) { return p.tel8 && p.tel8 === d.tel.slice(-8); }).forEach(function (p) { add(p, 'mesmo celular'); });
    if (d.nome.split(/\s+/).length >= 2) buscar(d.nome, todos).slice(0, 3).forEach(function (p) { add(p, 'nome parecido'); });
    desenharJaInscrito(achados, false);
    clearTimeout(timerVerificar);
    var temBase = d.nome.split(/\s+/).length >= 2 || d.tel.length >= 8 || /@.+\./.test(d.email);
    if (!temBase || !online || !sessao) return;
    var minha = ++verificacaoAtual;
    timerVerificar = setTimeout(function () {
      desenharJaInscrito(achados, true);
      chamar({ acao: 'verificar', nome: d.nome, telefone: d.tel, email: d.email }).then(function (j) {
        if (minha !== verificacaoAtual) return;
        (j.achados || []).forEach(function (a) {
          var x = ((lista && lista.inscritos) || []).filter(function (i) { return i.email_evento_id === a.email_evento_id; })[0];
          if (!x && lista) { lista.inscritos.push({ email_evento_id: a.email_evento_id, nome: a.nome, final_tel: a.final_tel, tel8: '', compareceu: a.compareceu }); gravar('lista', lista); }
          var p = inscritos().filter(function (i) { return i.id === a.email_evento_id; })[0];
          if (p) add(p, 'no Ulisses (' + a.motivo + ')');
        });
        desenharJaInscrito(achados, false);
      }, function () { if (minha === verificacaoAtual) desenharJaInscrito(achados, false); });
    }, 700);
  }
  function desenharJaInscrito(achados, conferindo) {
    var area = $('cadVinculo'); area.textContent = '';
    if (achados.length) area.appendChild(el('span', { texto: 'Talvez já esteja inscrito(a):' }));
    achados.slice(0, 4).forEach(function (a) {
      var p = a.p;
      area.appendChild(el('div', { classe: 'achado' }, [
        el('strong', { texto: p.nome }),
        el('span', { texto: (p.final_tel ? 'cel. final ' + p.final_tel + ' · ' : '') + a.motivo }),
        p.presente ? el('span', { classe: 'ok-presente', texto: '✓ já presente' }) :
          el('button', { type: 'button', classe: 'chip ativo', texto: 'É esta pessoa: marcar presença', onclick: function () {
            enfileirar('presenca', { email_evento_id: p.id, compareceu: true });
            espelhar({ tipo: 'boasvindas', nome: p.nome });
            aviso('✓ ' + p.nome.split(' ')[0] + ' já estava inscrito(a): presença marcada');
            limparCadastro(); abrirAba('buscar'); $('busca').value = ''; desenharResultados();
            mostrarPasse(p.nome, null, p.id);
          } })
      ]));
    });
    if (conferindo) area.appendChild(el('span', { classe: 'conferindo', texto: 'Conferindo no Ulisses…' }));
  }
  function sugerirBase(termoCelular) {
    clearTimeout(timerBase);
    var termo = typeof termoCelular === 'string' ? termoCelular : $('cadNome').value.trim();
    var area = $('sugestoesBase');
    var porCelular = termo.replace(/\D/g, '').length >= 8;
    if ((!porCelular && (termo.length < 5 || termo.split(/\s+/).length < 2)) || !online || !sessao) { area.textContent = ''; return; }
    timerBase = setTimeout(function () {
      chamar({ acao: 'buscar_base', termo: termo }).then(function (j) {
        area.textContent = '';
        if (!j.ok || !(j.pessoas || []).length) return;
        area.appendChild(el('span', { classe: 'dica', texto: 'Já temos cadastro dessa pessoa? Toque para usar o celular e o e-mail que já estão no CRM:' }));
        j.pessoas.slice(0, 5).forEach(function (p) {
          var b = el('button', { type: 'button', texto: [nomeProprio(p.nome), String(p.filial || '').replace(/Goiânia - /g, ''), p.final_tel ? 'cel. final ' + p.final_tel : '', p.tem_email ? 'tem e-mail' : ''].filter(Boolean).join(' · '),
            onclick: function () {
              var mesmo = pidEscolhido === p.pid;
              pidEscolhido = mesmo ? null : p.pid; pessoaBase = mesmo ? null : p;
              area.querySelectorAll('button').forEach(function (x) { x.classList.remove('escolhida'); });
              if (!mesmo) { b.classList.add('escolhida'); $('cadNome').value = nomeProprio(p.nome); verificarJaInscrito(); }
              $('cadTel').placeholder = pessoaBase && pessoaBase.tem_tel ? 'usar o do cadastro (final ' + pessoaBase.final_tel + ')' : '99999-9999';
            } });
          area.appendChild(b);
        });
      }, function () { area.textContent = ''; });
    }, 450);
  }
  $('cadNome').addEventListener('input', function () { pidEscolhido = null; pessoaBase = null; $('cadTel').placeholder = '99999-9999'; sugerirBase(); verificarJaInscrito(); });
  ['cadTel', 'cadDdd', 'cadEmail', 'cadVeioCom'].forEach(function (id) { $(id).addEventListener('input', verificarJaInscrito); });
  // Celular digitado sem nome também procura na base do CRM.
  $('cadTel').addEventListener('input', function () { if ($('cadTel').value.replace(/\D/g, '').length >= 8 && !$('cadNome').value.trim()) sugerirBase($('cadTel').value); });
  function limparCadastro() {
    $('formCadastro').reset(); $('cadDdd').value = '62'; $('cadMsg').textContent = '';
    $('sugestoesBase').textContent = ''; $('cadVinculo').textContent = ''; pidEscolhido = null; pessoaBase = null;
    espelhar({ tipo: 'espera' });
  }

  $('formCadastro').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var nome = nomeProprio($('cadNome').value), ddd = $('cadDdd').value.replace(/\D/g, ''), tel = $('cadTel').value.replace(/\D/g, '');
    var email = $('cadEmail').value.trim();
    var msg = $('cadMsg');
    if (nome.split(' ').length < 2) { msg.textContent = 'Informe nome e sobrenome.'; return; }
    var usaCadastro = !tel && pessoaBase && pessoaBase.tem_tel;
    if (!usaCadastro && (ddd.length !== 2 || tel.length < 8)) { msg.textContent = 'Informe o celular com DDD.'; return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'E-mail inválido.'; return; }
    var inter = (document.querySelector('input[name="cadInteresse"]:checked') || {}).value;
    var dados = { nome: nome, ddd: usaCadastro ? '' : ddd, telefone: usaCadastro ? '' : tel, email: email, pid: pidEscolhido,
      veio_com: $('cadVeioCom').value.trim() || null, interesse_curso: inter === 'sim' ? true : inter === 'nao' ? false : null };
    enfileirar('inscrever', dados);
    aviso('✓ ' + nome.split(' ')[0] + (email || (pessoaBase && pessoaBase.tem_email) ? ' cadastrado(a)' : ' com vaga reservada (sem e-mail)') + (online ? '' : ' (envia quando a internet voltar)'));
    espelhar({ tipo: 'boasvindas', nome: nome });
    if (!document.body.classList.contains('modo-totem')) mostrarPasse(nome, null, null);
    limparCadastro(); $('cadDdd').value = ddd || '62';
    abrirAba('buscar'); $('busca').value = ''; desenharResultados();
  });

  // ---------- Presentes ----------
  function desenharPresentes() {
    var prob = $('problemas'); prob.textContent = '';
    problemas.slice(-20).reverse().forEach(function (p, i) {
      prob.appendChild(el('div', { classe: 'problema' }, [
        el('strong', { texto: p.nome || 'Ação' }), ' — ' + p.erro + ' ',
        el('button', { type: 'button', classe: 'btn-desfazer', texto: 'ok, entendi', onclick: function () {
          problemas.splice(problemas.length - 1 - i, 1); gravar('problemas', problemas); desenharPresentes();
        } })
      ]));
    });
    var area = $('listaPresentes'); area.textContent = '';
    var pend = inscricoesNaFila().map(function (f) { return { nome: f.dados.nome, pendente: true, porta: true, semEmail: !f.dados.email }; })
      .concat(reservas().map(function (r) { return { nome: r.nome, porta: true, reserva: true }; }));
    var pres = inscritos().filter(function (x) { return x.presente; });
    var todos = pend.concat(pres).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    if (!todos.length) { area.appendChild(el('p', { classe: 'vazio', texto: 'Ninguém marcado ainda.' })); return; }
    todos.forEach(function (p) {
      area.appendChild(el('div', { classe: 'pessoa presente' + (p.pendente ? ' pendente' : '') }, [
        el('div', { classe: 'nome', texto: p.nome }),
            el('div', { classe: 'acao' }, [
          el('button', { type: 'button', classe: 'chip', texto: cartoesVinculados[p.nome] ? 'Cartão nº ' + cartoesVinculados[p.nome] : 'Entregar cartão', onclick: function () {
            var n = window.prompt('Número do cartão de entrada entregue a ' + p.nome.split(' ')[0] + ':', cartoesVinculados[p.nome] || '');
            if (n !== null) vincularCartao(p.nome, p.id || null, n);
          } })
        ]),
        el('div', { classe: 'info' }, [
          p.porta || p.na_porta ? el('span', { classe: 'selo fora', texto: p.reserva || p.semEmail ? 'vaga reservada na porta' : 'inscrito na porta' }) : null,
          p.aluno ? el('span', { classe: 'selo', texto: 'Aluno' }) : (p.porta ? null : el('span', { classe: 'selo fora', texto: 'De fora' })),
          p.pendente ? el('span', { texto: 'enviando…' }) : null
        ])
      ]));
    });
  }

  // ---------- fila de envio ----------
  function enfileirar(acao, dados) {
    dados.client_id = uuid(); dados.criado_no_aparelho = new Date().toISOString();
    // No autoatendimento quem registra é a própria pessoa: canal próprio no painel de números.
    var noTotem = document.body.classList.contains('modo-totem');
    dados.atendente = noTotem ? 'Autoatendimento (tablet)' : atendente;
    // A mesa entrega cartão: não pede ao servidor o desenho do QR code (menos internet e processamento).
    if (!noTotem && (acao === 'presenca' || acao === 'inscrever')) dados.sem_passe = true;
    fila.push({ acao: acao, dados: dados, tentativas: 0 });
    gravar('fila', fila); desenharPlacar(); enviarFila();
  }
  var enviando = false, esperaFila = 0, falhasSeguidas = 0;
  function enviarFila() {
    if (enviando || !fila.length || !sessao) return;
    enviando = true;
    var item = fila[0];
    var corpo = Object.assign({ acao: item.acao }, item.dados);
    chamar(corpo).then(function (j) {
      enviando = false;
      if (j._status === 401 && j.precisa_pin) { mostrarPin('Sua sessão expirou. Entre de novo; nada do que foi marcado se perde.'); return; }
      if (j.ok) {
        tirar(item); esperaFila = 0; falhasSeguidas = 0;
        if (j.passe) receberPasse(j.passe, item);
        if (item.acao === 'presenca' && lista) lista.inscritos.forEach(function (x) { if (x.email_evento_id === item.dados.email_evento_id) x.compareceu = item.dados.compareceu; });
        // Reserva sem e-mail entra na conta na hora (a lista do servidor chega em seguida).
        if (item.acao === 'inscrever' && j.reservado && lista && !j.repetido) lista.reservas = (lista.reservas || []).concat([{ client_id: item.dados.client_id, nome: item.dados.nome }]);
        if (item.acao === 'inscrever') atualizarLista();
        if (item.acao === 'cartao' && j.em_uso_por) aviso('⚠ O cartão nº ' + j.numero + ' estava com ' + j.em_uso_por + ', que não passou pela segurança. Agora está com ' + item.dados.nome.split(' ')[0] + '.');
      } else if (j.definitivo || j.inscrito || (j._status >= 400 && j._status < 500 && j._status !== 429)) {
        tirar(item);
        problemas.push({ nome: item.dados.nome || nomeDe(item.dados.email_evento_id), erro: j.erro || 'Recusado pelo servidor.' }); gravar('problemas', problemas);
        aviso('⚠ ' + (j.erro || 'Uma ação não foi aceita. Veja em Presentes.'));
        if (j.inscrito) atualizarLista();
      } else {
        // Erro passageiro do servidor: este item vai para o fim da fila (não trava os próximos) e nada se perde.
        item.tentativas++; falhasSeguidas++;
        if (fila.length > 1) { tirar(item); fila.push(item); }
        esperaFila = Math.min(30000, 2000 * falhasSeguidas);
      }
      gravar('fila', fila); gravar('lista', lista); redesenhar();
      setTimeout(enviarFila, esperaFila);
    }, function () {
      // Sem conexão: mantém a ordem e tenta de novo com intervalo crescente (até 30 s), sem gastar internet à toa.
      enviando = false; item.tentativas++; falhasSeguidas++; gravar('fila', fila);
      esperaFila = Math.min(30000, 4000 * falhasSeguidas); desenharConexao();
      setTimeout(enviarFila, esperaFila);
    });
  }
  // Passe devolvido pelo servidor: mostra na tela (atendente / tablet) e na 2ª tela. Se chegou atrasado
  // (fila que ficou presa sem internet), só guarda: dá para mostrar depois pela aba Presentes.
  var passesGuardados = ler('passes', {});
  function svgDe(texto) {
    var svg = new DOMParser().parseFromString(texto || '', 'image/svg+xml').documentElement;
    return svg && svg.nodeName.toLowerCase() === 'svg' ? document.importNode(svg, true) : null;
  }
  function receberPasse(passe, item) {
    passesGuardados[passe.nome] = { svg: passe.svg, url: passe.url, em: passe.em }; gravar('passes', passesGuardados);
    var recente = Date.now() - new Date(item.dados.criado_no_aparelho || 0).getTime() < 3 * 60000;
    // Na recepção a pessoa recebe um cartão (a tela já abriu ao marcar); o QR code na tela só no autoatendimento.
    if (recente && document.body.classList.contains('modo-totem')) totemChegouPasse(passe);
    if (!$('abaPresentes').hidden) desenharPresentes();
  }
  // svgTexto vazio = sem internet: a tela abre mesmo assim para a recepção entregar um cartão.
  var passeAtual = null;
  function mostrarPasse(nome, svgTexto, eeId) {
    var totem = document.body.classList.contains('modo-totem');
    if (svgTexto) espelhar({ tipo: 'passe', nome: nome, svg: svgTexto });
    if (totem) return svgTexto ? totemPasse(nome, svgTexto) : null;
    var mesmo = passeAtual && passeAtual.nome === nome && !$('painelPasse').hidden;
    passeAtual = { nome: nome, eeId: eeId || (passeAtual && mesmo ? passeAtual.eeId : null) };
    // Recepção: entrada só pelo cartão (a tela do passe não é mostrada aqui).
    $('ppTitulo').textContent = 'Cartão para ' + String(nome).split(' ')[0];
    if (!mesmo) $('ppCartaoNum').value = cartoesVinculados[nome] ? String(cartoesVinculados[nome]) : '';
    $('painelPasse').hidden = false;
    setTimeout(function () { $('ppCartaoNum').focus(); }, 50);
  }
  // ---------- cartões de entrada (poucos, reutilizáveis) ----------
  // A recepção entrega um cartão numerado a quem não tem celular; a segurança lê, recolhe e devolve.
  var cartoesVinculados = ler('cartoes', {});
  var MAX_CARTAO = 36; // impressos: 24 (2 folhas); folga para uma 3ª folha
  function vincularCartao(nome, eeId, numTexto) {
    var num = parseInt(String(numTexto || '').replace(/\D/g, ''), 10);
    if (!(num >= 1)) { aviso('Digite o número impresso no cartão.'); return false; }
    if (num > MAX_CARTAO) { aviso('⚠ Não existe cartão nº ' + num + '. Os cartões vão de 1 a ' + MAX_CARTAO + '. Confira o número impresso.'); return false; }
    var outro = Object.keys(cartoesVinculados).filter(function (n) { return n !== nome && cartoesVinculados[n] === num; })[0];
    if (outro) delete cartoesVinculados[outro];
    cartoesVinculados[nome] = num; gravar('cartoes', cartoesVinculados);
    enfileirar('cartao', { cartao: num, nome: nome, email_evento_id: eeId || null });
    aviso('✓ Cartão nº ' + num + ' com ' + String(nome).split(' ')[0] + '. Ele(a) entrega à segurança.');
    if (!$('abaPresentes').hidden) desenharPresentes();
    return true;
  }
  $('ppCartaoOk').addEventListener('click', function () {
    if (passeAtual && vincularCartao(passeAtual.nome, passeAtual.eeId, $('ppCartaoNum').value)) $('ppFechar').click();
  });
  $('ppCartaoNum').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('ppCartaoOk').click(); } });
  $('ppFechar').addEventListener('click', function () { $('painelPasse').hidden = true; espelhar({ tipo: 'espera' }); if (!$('abaBuscar').hidden) $('busca').focus(); });

  function tirar(item) { var i = fila.indexOf(item); if (i >= 0) fila.splice(i, 1); }
  function nomeDe(id) { var p = ((lista && lista.inscritos) || []).filter(function (x) { return x.email_evento_id === id; })[0]; return p ? p.nome : ''; }

  // ---------- lista do servidor ----------
  // O aparelho manda a "versão" da lista que já tem; se nada mudou, o servidor responde só "igual" (poucos bytes).
  // A lista inteira (uns 15 KB compactados) só vem quando alguém chegou/se inscreveu, e ao menos a cada 10 minutos.
  var ultimaListaCompleta = 0, pedindoLista = false;
  function atualizarLista(completa) {
    if (!sessao || pedindoLista) return Promise.resolve();
    var corpo = { acao: 'lista' };
    if (!completa && lista && lista.versao && Date.now() - ultimaListaCompleta < 600000) corpo.versao = lista.versao;
    pedindoLista = true;
    return chamar(corpo).then(function (j) {
      pedindoLista = false;
      if (j._status === 401 && j.precisa_pin) { mostrarPin('Sua sessão expirou. Entre de novo.'); return; }
      if (!j.ok || j.igual) return;
      lista = { inscritos: j.inscritos || [], reservas: j.reservas || [], capacidade: j.capacidade, evento: j.evento, rotulo: j.rotulo, em: j.agora, versao: j.versao || null };
      ultimaListaCompleta = Date.now();
      gravar('lista', lista); redesenhar();
    }, function () { pedindoLista = false; /* sem internet: segue com a lista guardada */ });
  }
  function redesenhar() {
    if (lista && lista.evento) $('titulo').textContent = lista.evento.nome ? nomeProprio(lista.evento.nome.split(' - ')[0]) : 'Recepção do evento';
    if (anotando === null) desenharResultados(); else desenharPlacar();
    if (!$('abaPresentes').hidden) desenharPresentes();
  }

  // ---------- Segunda tela (participante confere o cadastro) ----------
  function telefoneBonito(ddd, tel) {
    if (!tel) return '';
    var t = tel.slice(-9);
    var meio = t.length === 9 ? t.slice(0, 5) + '-' + t.slice(5) : t.length === 8 ? t.slice(0, 4) + '-' + t.slice(4) : t;
    return (ddd ? '(' + ddd + ') ' : '') + meio;
  }
  function iniciarEspelho() {
    document.body.classList.add('modo-espelho');
    $('telaPin').hidden = true; $('telaPrincipal').hidden = true; $('telaEspelho').hidden = false;
    if (lista && lista.evento && lista.evento.nome) $('titulo').textContent = nomeProprio(lista.evento.nome.split(' - ')[0]);
    var area = $('espelhoConteudo'), timer;
    var nomeEvento = $('titulo').textContent;
    function espera() {
      area.textContent = '';
      area.appendChild(el('p', { classe: 'grande', texto: 'Boas-vindas!' }));
      area.appendChild(el('p', { classe: 'medio', texto: nomeEvento }));
    }
    function campo(rotulo, valor, vazio) {
      return el('div', { classe: 'campo' }, [el('span', { texto: rotulo }), el('strong', { classe: valor ? '' : 'vazio-campo', texto: valor || vazio })]);
    }
    espera();
    if (!canal) { area.appendChild(el('p', { classe: 'rodape', texto: 'Este navegador não permite a segunda tela. Use o Chrome ou o Edge.' })); return; }
    canal.onmessage = function (e) {
      var m = e.data || {};
      clearTimeout(timer);
      if (m.tipo === 'cadastro') {
        var d = m.dados || {};
        if (!d.nome && !d.tel && !d.email) { espera(); return; }
        area.textContent = '';
        area.appendChild(el('h2', { texto: 'Confira seus dados' }));
        area.appendChild(campo('Nome', nomeProprio(d.nome), 'digitando…'));
        area.appendChild(campo('Celular (WhatsApp)', telefoneBonito(d.ddd, d.tel), '—'));
        area.appendChild(campo('E-mail', d.email, '(opcional)'));
        area.appendChild(el('p', { classe: 'rodape', texto: 'Algo errado? Avise quem está atendendo você.' }));
      } else if (m.tipo === 'passe') {
        area.textContent = '';
        area.appendChild(el('h2', { texto: 'Seu QR code de entrada, ' + nomeProprio(String(m.nome || '').split(' ')[0]) }));
        var q = el('div', { classe: 'ck-qr espelho-qr' }); var sv = svgDe(m.svg); if (sv) q.appendChild(sv); area.appendChild(q);
        area.appendChild(el('p', { classe: 'rodape', texto: 'Aponte a câmera do seu celular para guardar o QR code. A segurança vai pedir na entrada.' }));
        timer = setTimeout(espera, 60000);
      } else if (m.tipo === 'boasvindas') {
        area.textContent = '';
        area.appendChild(el('p', { classe: 'grande', texto: 'Boas-vindas, ' + nomeProprio(String(m.nome || '').split(' ')[0]) + '!' }));
        area.appendChild(el('p', { classe: 'medio', texto: 'Presença confirmada. Bom evento!' }));
        timer = setTimeout(espera, 7000);
      } else espera();
    };
  }

  // ---------- Autoatendimento (o participante faz o próprio check-in) ----------
  var totemTimer;
  function entrarTotem() {
    gravar('totem', true);
    document.body.classList.add('modo-totem');
    $('telaPrincipal').hidden = true; $('telaTotem').hidden = false;
    totemInicio();
  }
  function sairTotem() {
    gravar('totem', false);
    document.body.classList.remove('modo-totem');
    $('telaTotem').hidden = true; $('telaPrincipal').hidden = false;
    abrirAba('buscar');
  }
  function totemTela(filhos, tempo) {
    var area = $('totemConteudo'); area.textContent = '';
    filhos.forEach(function (f) { if (f) area.appendChild(f); });
    clearTimeout(totemTimer);
    totemTimer = setTimeout(totemInicio, tempo || 90000); // sem uso, volta ao começo
    var campo = area.querySelector('input'); if (campo) setTimeout(function () { campo.focus(); }, 50);
  }
  function totemInicio() {
    var entrada = el('input', { placeholder: 'Seu celular ou seu nome', autocomplete: 'off', 'aria-label': 'Celular ou nome' });
    var mic = el('button', { type: 'button', classe: 'mic', 'aria-label': 'Falar', title: 'Falar' });
    mic.innerHTML = $('micBusca').innerHTML;
    mic.addEventListener('click', function () { ouvir(mic, function (t) { entrada.value = t; }); });
    var seguir = function () { if (entrada.value.trim()) totemProcurar(entrada.value.trim()); };
    entrada.addEventListener('keydown', function (e) { if (e.key === 'Enter') seguir(); });
    totemTela([
      el('h2', { texto: 'Faça seu check-in' }),
      el('p', { classe: 'sub', texto: 'Digite seu celular com DDD ou seu nome completo.' }),
      el('div', { classe: 'busca-grande' }, [entrada, mic]),
      el('button', { type: 'button', classe: 'btn principal', texto: 'Continuar', onclick: seguir }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Ainda não me inscrevi', onclick: function () { totemInscrever(''); } })
    ], 600000);
  }
  function totemProcurar(q) {
    var dig = q.replace(/\D/g, '');
    var todos = inscritos();
    var achados = dig.length >= 8 ? todos.filter(function (p) { return p.tel8 === dig.slice(-8); }) : buscar(q, todos).slice(0, 6);
    if (achados.length) return totemEscolher(achados, dig.length >= 8);
    totemTela([el('h2', { texto: 'Procurando sua inscrição…' })]);
    if (!online || !sessao) return totemNaoAchou(q);
    chamar({ acao: 'verificar', nome: dig.length >= 8 ? '' : q, telefone: dig }).then(function (j) {
      var novos = (j.achados || []).map(function (a) {
        if (lista && !lista.inscritos.some(function (i) { return i.email_evento_id === a.email_evento_id; })) {
          lista.inscritos.push({ email_evento_id: a.email_evento_id, nome: a.nome, final_tel: a.final_tel, tel8: '', compareceu: a.compareceu }); gravar('lista', lista);
        }
        return inscritos().filter(function (i) { return i.id === a.email_evento_id; })[0];
      }).filter(Boolean);
      if (novos.length) totemEscolher(novos, dig.length >= 8); else totemNaoAchou(q);
    }, function () { totemNaoAchou(q); });
  }
  function totemEscolher(achados, porCelular) {
    if (achados.length === 1 && porCelular) return totemConfirmar(achados[0]);
    totemTela([
      el('h2', { texto: 'Escolha seu nome' }),
      el('div', { classe: 'escolha-nome' }, achados.map(function (p) {
        return el('button', { type: 'button', texto: p.nome, onclick: function () { porCelular ? totemConfirmar(p) : totemDigitos(p, 0); } });
      })),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Meu nome não está aqui', onclick: function () { totemNaoAchou(''); } }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Voltar', onclick: totemInicio })
    ]);
  }
  // Quem buscou pelo nome confirma com os 4 últimos números do celular (ninguém faz check-in de outra pessoa).
  function totemDigitos(p, erros) {
    if (!p.final_tel) return totemConfirmar(p);
    var ent = el('input', { inputmode: 'numeric', maxlength: '4', placeholder: '_ _ _ _', 'aria-label': 'Últimos 4 números do celular' });
    var ok = function () {
      if (ent.value.replace(/\D/g, '') === p.final_tel) return totemConfirmar(p);
      if (erros >= 2) return totemTela([el('h2', { texto: 'Não conseguimos confirmar' }), el('p', { classe: 'sub', texto: 'Procure a equipe da recepção, que vai ajudar você.' }),
        el('button', { type: 'button', classe: 'btn principal', texto: 'Voltar ao início', onclick: totemInicio })], 15000);
      totemDigitos(p, erros + 1);
    };
    ent.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
    totemTela([
      el('h2', { texto: p.nome.split(' ')[0] + ', confirme' }),
      el('p', { classe: 'sub', texto: erros ? 'Não confere. Tente de novo: os 4 últimos números do seu celular.' : 'Digite os 4 últimos números do seu celular.' }),
      ent,
      el('button', { type: 'button', classe: 'btn principal', texto: 'Confirmar', onclick: ok }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Voltar', onclick: totemInicio })
    ]);
  }
  // O QR code de entrada chega do servidor um instante depois do check-in. Ele só aparece quando a pessoa
  // terminou de responder; se não chegar (sem internet), a tela manda pegar um cartão na recepção.
  var totemPasses = {}, totemEsperando = null, totemTimerPasse;
  function totemChegouPasse(passe) {
    totemPasses[normalizar(passe.nome)] = passe.svg;
    if (totemEsperando && totemEsperando === normalizar(passe.nome)) { clearTimeout(totemTimerPasse); totemEsperando = null; totemPasse(passe.nome, passe.svg); }
  }
  function totemAguardarPasse(nome, jaFeito) {
    var k = normalizar(nomeProprio(nome));
    if (totemPasses[k]) { var svg = totemPasses[k]; delete totemPasses[k]; return totemPasse(nome, svg); }
    totemEsperando = k;
    totemTela([
      el('p', { classe: 'grande', texto: jaFeito ? 'Seu check-in já estava feito!' : '✓ Check-in feito!' }),
      el('p', { classe: 'sub', texto: 'Preparando seu QR code de entrada…' })
    ], 60000);
    clearTimeout(totemTimerPasse);
    totemTimerPasse = setTimeout(function () {
      if (totemEsperando !== k) return;
      totemEsperando = null;
      totemTela([
        el('p', { classe: 'grande', texto: 'Boas-vindas, ' + nomeProprio(String(nome).split(' ')[0]) + '!' }),
        el('h2', { texto: 'Check-in feito. Agora peça seu cartão de entrada na recepção.' }),
        el('p', { classe: 'sub', texto: 'A segurança pede o cartão na entrada do evento.' }),
        el('button', { type: 'button', classe: 'btn principal', texto: 'Entendi', onclick: totemInicio })
      ], 20000);
    }, 8000);
  }
  function totemConfirmar(p) {
    // Já presente: marca de novo só para receber o QR code de entrada (não muda nada no Ulisses).
    enfileirar('presenca', { email_evento_id: p.id, compareceu: true });
    espelhar({ tipo: 'boasvindas', nome: p.nome });
    if (p.presente || p.aluno) return totemAguardarPasse(p.nome, p.presente);
    var resposta = function (v) { enfileirar('anotar', { email_evento_id: p.id, interesse_curso: v }); totemAguardarPasse(p.nome); };
    totemTela([
      el('p', { classe: 'grande', texto: '✓ Check-in feito!' }),
      el('h2', { texto: 'Quer receber informações sobre o Curso de Filosofia?' }),
      el('button', { type: 'button', classe: 'btn principal', texto: 'Sim, quero', onclick: function () { resposta(true); } }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Agora não', onclick: function () { resposta(false); } })
    ], 40000);
  }
  function totemNaoAchou(q) {
    totemTela([
      el('h2', { texto: 'Não encontramos sua inscrição' }),
      el('p', { classe: 'sub', texto: 'Sem problema: faça agora, leva menos de um minuto.' }),
      el('button', { type: 'button', classe: 'btn principal', texto: 'Fazer minha inscrição', onclick: function () { totemInscrever(q); } }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Tentar de novo', onclick: totemInicio })
    ]);
  }
  function totemInscrever(q) {
    var dig = String(q || '').replace(/\D/g, '');
    var nome = el('input', { placeholder: 'Nome e sobrenome', autocapitalize: 'words', maxlength: '120', value: dig ? '' : nomeProprio(q || '') });
    var ddd = el('input', { inputmode: 'numeric', maxlength: '2', value: dig.length >= 10 ? dig.slice(-11, -9) || dig.slice(-10, -8) : '62' });
    var tel = el('input', { inputmode: 'tel', maxlength: '15', placeholder: 'Celular (WhatsApp)', value: dig.length >= 8 ? dig.slice(dig.length >= 10 ? 2 : 0) : '' });
    var email = el('input', { type: 'email', inputmode: 'email', maxlength: '120', placeholder: 'E-mail (opcional)', autocapitalize: 'off' });
    var interesse = null;
    var chips = ['Sim', 'Não'].map(function (t) {
      var c = el('button', { type: 'button', classe: 'chip', texto: t, onclick: function () {
        interesse = t === 'Sim'; chips.forEach(function (x) { x.classList.remove('ativo'); }); c.classList.add('ativo');
      } });
      return c;
    });
    var msg = el('p', { classe: 'erro', role: 'alert' });
    var enviar = function () {
      var n = nomeProprio(nome.value), dd = ddd.value.replace(/\D/g, ''), t = tel.value.replace(/\D/g, ''), e = email.value.trim();
      if (n.split(' ').length < 2) { msg.textContent = 'Escreva seu nome e sobrenome.'; return; }
      if (dd.length !== 2 || t.length < 8) { msg.textContent = 'Escreva seu celular com DDD.'; return; }
      if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { msg.textContent = 'Confira o e-mail.'; return; }
      var ja = inscritos().filter(function (p) { return p.tel8 && p.tel8 === t.slice(-8); })[0];
      if (ja) return totemConfirmar(ja); // já estava inscrito com esse celular
      enfileirar('inscrever', { nome: n, ddd: dd, telefone: t, email: e, interesse_curso: interesse });
      espelhar({ tipo: 'boasvindas', nome: n });
      totemAguardarPasse(n);
    };
    totemTela([
      el('h2', { texto: 'Sua inscrição' }),
      nome,
      el('div', { classe: 'linha2' }, [ddd, tel]),
      email,
      el('div', { classe: 'anotar' }, [el('div', { classe: 'linha' }, [el('span', { texto: 'Quer receber informações sobre o Curso de Filosofia?' })].concat(chips))]),
      msg,
      el('button', { type: 'button', classe: 'btn principal', texto: 'Confirmar inscrição e check-in', onclick: enviar }),
      el('button', { type: 'button', classe: 'btn secundario', texto: 'Voltar', onclick: totemInicio })
    ], 180000);
  }
  function totemPasse(nome, svgTexto) {
    var q = el('div', { classe: 'ck-qr' }); var s = svgDe(svgTexto); if (s) q.appendChild(s);
    totemTela([
      el('h2', { texto: 'Seu QR code de entrada, ' + nomeProprio(String(nome).split(' ')[0]) }),
      el('p', { classe: 'sub', texto: 'Aponte a câmera do seu celular para este QR code e guarde-o: a segurança vai pedir na entrada.' }),
      q,
      el('p', { classe: 'sub', texto: 'Sem celular? Peça um cartão de entrada na recepção.' }),
      el('button', { type: 'button', classe: 'btn principal', texto: 'Pronto', onclick: totemInicio })
    ], 45000);
  }
  function totemSucesso(nome, texto) {
    totemTela([
      el('p', { classe: 'grande', texto: 'Boas-vindas, ' + nomeProprio(String(nome).split(' ')[0]) + '!' }),
      el('p', { classe: 'sub', texto: texto || 'Check-in feito. Bom evento!' })
    ], 6000);
  }
  $('totemSair').addEventListener('click', function () {
    var pin = prompt('PIN da equipe para sair do autoatendimento:');
    if (!pin) return;
    sha256(chave + ':' + pin.replace(/\D/g, '')).then(function (h) {
      if (h === ler('pinHash', '')) sairTotem(); else aviso('PIN incorreto.');
    });
  });
  $('btnTotem').addEventListener('click', function () {
    if (!ler('pinHash', '')) { aviso('Entre de novo com o PIN para ativar o autoatendimento.'); return; }
    if (confirm('Transformar este aparelho em autoatendimento? Para voltar, toque em "Equipe" no canto e digite o PIN.')) entrarTotem();
  });
  $('btnSegundaTela').addEventListener('click', function () {
    var w = window.open(location.href.split('#')[0] + '#' + chave + '&tela=participante', 'rc_participante', 'popup,width=1000,height=760');
    if (!w) { aviso('O navegador bloqueou a janela. Permita pop-ups para este site.'); return; }
    aviso('Arraste a janela para a segunda tela e aperte F11 para tela cheia.');
    setTimeout(verificarJaInscrito, 800);
  });

  // ---------- quem está atendendo ----------
  function recentesAtendentes() { try { return JSON.parse(localStorage.getItem('rc_atendentes') || '[]'); } catch (e) { return []; } }
  function desenharAtendente() { $('chipAtendente').textContent = atendente ? 'Atendendo: ' + atendente.split(' ')[0] : 'Quem atende?'; }
  function definirAtendente(nome) {
    nome = nomeProprio(nome);
    if (nome.length < 2) return;
    atendente = nome;
    var rec = recentesAtendentes().filter(function (n) { return n !== nome; }); rec.unshift(nome);
    try { localStorage.setItem('rc_atendente', nome); localStorage.setItem('rc_atendentes', JSON.stringify(rec.slice(0, 8))); } catch (e) { /* ok */ }
    $('painelAtendente').hidden = true; desenharAtendente();
    aviso('Atendendo agora: ' + nome);
    if (!$('abaBuscar').hidden) $('busca').focus();
  }
  function abrirAtendente() {
    var rec = $('atendentesRecentes'); rec.textContent = '';
    recentesAtendentes().forEach(function (n) { rec.appendChild(el('button', { type: 'button', texto: n, onclick: function () { definirAtendente(n); } })); });
    $('atendenteBusca').value = ''; $('atendentesSugestoes').textContent = '';
    $('painelAtendente').hidden = false;
    setTimeout(function () { $('atendenteBusca').focus(); }, 50);
  }
  var timerEquipe;
  $('atendenteBusca').addEventListener('input', function () {
    clearTimeout(timerEquipe);
    var termo = $('atendenteBusca').value.trim(), area = $('atendentesSugestoes');
    if (termo.length < 3 || !online || !sessao) { area.textContent = ''; return; }
    timerEquipe = setTimeout(function () {
      chamar({ acao: 'buscar_equipe', termo: termo }).then(function (j) {
        area.textContent = '';
        (j.pessoas || []).slice(0, 6).forEach(function (p) {
          area.appendChild(el('button', { type: 'button', texto: p.nome + (p.filial ? ' · ' + String(p.filial).replace(/Goiânia - /g, '') : ''), onclick: function () { definirAtendente(p.nome); } }));
        });
      }, function () { area.textContent = ''; });
    }, 350);
  });
  $('atendenteBusca').addEventListener('keydown', function (e) { if (e.key === 'Enter') definirAtendente($('atendenteBusca').value); });
  $('atendenteUsar').addEventListener('click', function () { definirAtendente($('atendenteBusca').value); });
  $('chipAtendente').addEventListener('click', abrirAtendente);
  $('painelAtendente').addEventListener('click', function (e) { if (e.target === $('painelAtendente') && atendente) $('painelAtendente').hidden = true; });

  // ---------- Números do evento ----------
  // Chegadas a cada 15 min por canal, perfil de cada canal, comparecimento por perfil/antecedência e escolas.
  var CORES_CANAL = { 'Recepção (atendente)': '#086357', 'Autoatendimento (tablet)': '#009485', 'QR check-in': '#FFCA00', 'QR inscrição': '#F39300' };
  var timerNumeros;
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '—'; }
  function tabelaNum(cab, linhas) {
    var t = el('table', { classe: 'tab-num' });
    t.appendChild(el('tr', {}, cab.map(function (c) { return el('th', { texto: c }); })));
    linhas.forEach(function (l) { t.appendChild(el('tr', {}, l.map(function (c) { return el('td', { texto: String(c) }); }))); });
    return t;
  }
  function carregarNumeros() {
    clearTimeout(timerNumeros);
    if (!online || !sessao) { $('painelNumeros').textContent = ''; $('painelNumeros').appendChild(el('p', { classe: 'vazio', texto: 'Os números precisam de internet.' })); return; }
    // Não redesenha enquanto alguém mexe na simulação (perderia o que está sendo digitado).
    var foco = document.activeElement;
    if (foco && foco.closest && foco.closest('.sim-box')) { timerNumeros = setTimeout(carregarNumeros, 30000); return; }
    chamar({ acao: 'numeros' }).then(function (j) {
      if (j.ok) desenharNumeros(j.numeros || {}, j.agora);
      if (!$('abaNumeros').hidden) timerNumeros = setTimeout(carregarNumeros, 30000);
    }, function () { timerNumeros = setTimeout(carregarNumeros, 30000); });
  }
  function desenharNumeros(n, agora) {
    var area = $('painelNumeros'); area.textContent = '';
    var r = n.resumo || {};
    var cartoes = [['Presentes', r.presentes, pct(r.presentes, r.inscritos) + ' dos inscritos'], ['Alunos', r.presentes_alunos, ''], ['De fora', r.presentes_fora, ''],
      ['Inscritos na porta', r.inscritos_na_porta, (r.reservados_sem_email || 0) + ' com vaga reservada'], ['Vieram acompanhados', r.veio_acompanhado, ''],
      ['Querem info do curso', r.querem_info_curso, (r.nao_querem_info || 0) + ' não querem'], ['Marcados no Ulisses', r.marcados_no_ulisses, 'fora desta página'],
      ['Passaram pela segurança', n.validacoes, 'QR codes e cartões lidos']];
    area.appendChild(el('div', { classe: 'num-cartoes' }, cartoes.map(function (c) {
      return el('div', { classe: 'num-cartao' }, [el('strong', { texto: String(c[1] || 0) }), el('span', { texto: c[0] }), c[2] ? el('small', { texto: c[2] }) : null]);
    })));
    if (n.pendentes_ulisses || n.reservas_com_email) {
      var txt = [];
      if (n.pendentes_ulisses) txt.push(n.pendentes_ulisses + ' registro(s) ainda não chegaram ao Ulisses (são reenviados sozinhos)');
      if (n.reservas_com_email) txt.push(n.reservas_com_email + ' inscrição(ões) com e-mail ficaram como vaga reservada (completar depois do evento)');
      var linha = el('p', { classe: 'dica', texto: '⚠ ' + txt.join('; ') + '. Ninguém deixa de entrar por isso. ' });
      if (n.pendentes_ulisses) linha.appendChild(el('button', { type: 'button', classe: 'btn-desfazer', texto: 'Enviar agora', onclick: function () {
        aviso('Enviando ao Ulisses…');
        chamar({ acao: 'reconciliar' }).then(function (j) { aviso(j.ok ? 'Enviados: ' + j.enviados + '. Faltam: ' + j.restam + '.' : 'Não foi possível agora.'); carregarNumeros(); }, function () { aviso('Sem internet.'); });
      } }));
      area.appendChild(linha);
    }
    var hor = n.por_horario || [];
    area.appendChild(el('h3', { texto: 'Chegadas a cada 15 minutos' }));
    if (!hor.length) area.appendChild(el('p', { classe: 'vazio', texto: 'Ainda não há chegadas.' }));
    else {
      var max = Math.max.apply(null, hor.map(function (h) { return h.total; }));
      var pico = hor.filter(function (h) { return h.total === max; })[0];
      area.appendChild(el('p', { classe: 'dica', texto: 'Horário de maior movimento: ' + pico.faixa + ' (' + max + ' chegadas).' }));
      var graf = el('div', { classe: 'num-graf' });
      hor.forEach(function (h) {
        var barra = el('div', { classe: 'num-barra', title: h.faixa + ': ' + h.total });
        Object.keys(h.canais || {}).forEach(function (c) {
          var seg = el('div', { classe: 'num-seg', title: c + ': ' + h.canais[c] });
          seg.style.height = (100 * h.canais[c] / max) + '%'; seg.style.background = CORES_CANAL[c] || '#5b6b67';
          barra.appendChild(seg);
        });
        graf.appendChild(el('div', { classe: 'num-col' }, [el('span', { classe: 'num-val', texto: String(h.total) }), barra, el('span', { classe: 'num-rot', texto: h.faixa })]));
      });
      area.appendChild(graf);
      area.appendChild(el('div', { classe: 'num-legenda' }, Object.keys(CORES_CANAL).map(function (c) {
        var q = el('i'); q.style.background = CORES_CANAL[c]; return el('span', {}, [q, c]);
      })));
    }
    var can = n.por_canal || [];
    area.appendChild(el('h3', { texto: 'Por onde cada pessoa entrou' }));
    if (can.length) area.appendChild(tabelaNum(['Canal', 'Pessoas', 'Alunos', 'De fora', 'Convidados pela campanha', 'Inscritos na hora', 'Querem info'],
      can.map(function (c) { return [c.canal, c.total, c.alunos, c.fora, c.convidados, c.na_porta, c.querem_info]; })));
    else area.appendChild(el('p', { classe: 'vazio', texto: 'Sem registros ainda.' }));
    var comp = n.comparecimento || {};
    area.appendChild(el('h3', { texto: 'Quem se inscreveu e veio' }));
    area.appendChild(tabelaNum(['Perfil', 'Inscritos', 'Presentes', 'Comparecimento'],
      (comp.por_perfil || []).map(function (c) { return [c.perfil, c.inscritos, c.presentes, pct(c.presentes, c.inscritos)]; })));
    area.appendChild(tabelaNum(['Inscrição feita', 'Inscritos', 'Presentes', 'Comparecimento'],
      (comp.por_antecedencia || []).map(function (c) { return [c.faixa, c.inscritos, c.presentes, pct(c.presentes, c.inscritos)]; })));
    var esc = n.por_escola || [];
    if (esc.length) {
      area.appendChild(el('h3', { texto: 'Presentes por escola' }));
      area.appendChild(tabelaNum(['Escola', 'Presentes'], esc.map(function (e) { return [String(e.escola).replace(/^Goiânia - /, ''), e.presentes]; })));
    }
    desenharJornada(area, n, r);
    area.appendChild(el('p', { classe: 'dica', texto: 'Atualiza sozinho a cada 30 segundos. Última atualização: ' + new Date(agora || Date.now()).toLocaleTimeString('pt-BR') + '.' }));
  }

  // ---------- Tempo da jornada: medido (segurança) + simulação da fila ----------
  function mmss(seg) { seg = Math.round(seg || 0); var m = Math.floor(seg / 60), x = seg % 60; return m ? m + ' min ' + (x < 10 ? '0' : '') + x + ' s' : x + ' s'; }
  var simParams = null;
  // Tempos de atendimento de uma pessoa real (segundos). O sistema responde em menos de 2 s em cada passo
  // (medido em 13/11: check-in pelo celular 1,6 s; marcar presença 0,7 s; vincular cartão 0,4 s; leitura 0,2 s).
  var SIM_TEMPOS = [['triagem', 'Triagem (pergunta e orienta)', 10], ['celular', 'Check-in pelo celular (QR do cartaz)', 60],
    ['mesaInscrito', 'Mesa: já inscrito (busca, Chegou, cartão)', 35], ['mesaCadastro', 'Mesa: cadastro na hora + cartão', 100],
    ['caminhada', 'Caminhar da mesa até a segurança', 15], ['segQr', 'Segurança: ler QR code do celular', 6], ['segCartao', 'Segurança: ler e recolher cartão', 8]];
  function simularEntrada(p) {
    var seed = 12345;
    function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function varia(t) { return t * (0.6 + 0.8 * rnd()); }
    function chegada() { var J = p.janela * 60, c = 0.75, u = rnd(); return u < c ? J * Math.sqrt(u * c) : J - J * Math.sqrt((1 - u) * (1 - c)); }
    // Fila com vários atendentes, por ordem de chegada.
    function fila(itens, servidores, campoServ) {
      var livres = []; for (var i = 0; i < servidores; i++) livres.push(0);
      itens.slice().sort(function (a, b) { return a._pronto - b._pronto; }).forEach(function (x) {
        var k = 0; for (var j = 1; j < livres.length; j++) if (livres[j] < livres[k]) k = j;
        x._ini = Math.max(livres[k], x._pronto); livres[k] = x._ini + x[campoServ]; x._fim = livres[k];
      });
    }
    function maiorFila(itens) {
      var ev = []; itens.forEach(function (x) { if (x._ini > x._pronto + 0.5) { ev.push([x._pronto, 1]); ev.push([x._ini, -1]); } });
      ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); var c = 0, m = 0; ev.forEach(function (e) { c += e[1]; m = Math.max(m, c); }); return m;
    }
    var R = 20, acum = { total: [], porCaminho: {}, filas: { triagem: 0, mesas: 0, seguranca: 0 }, fimApos: 0 };
    for (var rep = 0; rep < R; rep++) {
      var gente = [];
      for (var i = 0; i < p.pessoas; i++) gente.push({ chegou: chegada(), semInscricao: rnd() < p.semInscricao / 100, celular: rnd() < p.celular / 100, sTri: varia(p.t.triagem) });
      gente.forEach(function (x) { x._pronto = x.chegou; }); fila(gente, p.triagemN || 1, 'sTri');
      acum.filas.triagem = Math.max(acum.filas.triagem, maiorFila(gente));
      gente.forEach(function (x) { x.fimTri = x._fim; });
      var mesa = gente.filter(function (x) { return !x.celular; });
      mesa.forEach(function (x) { x._pronto = x.fimTri; x.sMesa = varia(x.semInscricao ? p.t.mesaCadastro : p.t.mesaInscrito); });
      fila(mesa, p.mesas, 'sMesa'); acum.filas.mesas = Math.max(acum.filas.mesas, maiorFila(mesa));
      gente.forEach(function (x) {
        x._pronto = x.celular ? x.fimTri + varia(p.t.celular) : x._fim + varia(p.t.caminhada);
        x.sSeg = varia(x.celular ? p.t.segQr : p.t.segCartao);
      });
      fila(gente, p.seguranca, 'sSeg'); acum.filas.seguranca = Math.max(acum.filas.seguranca, maiorFila(gente));
      var ultChegada = 0, ultEntrada = 0;
      gente.forEach(function (x) {
        var dur = x._fim - x.chegou, cam = x.celular ? (x.semInscricao ? 'Inscrição pelo celular' : 'Check-in pelo celular') : (x.semInscricao ? 'Mesa: cadastro na hora' : 'Mesa: já inscrito');
        acum.total.push(dur); (acum.porCaminho[cam] = acum.porCaminho[cam] || []).push(dur);
        ultChegada = Math.max(ultChegada, x.chegou); ultEntrada = Math.max(ultEntrada, x._fim);
      });
      acum.fimApos = Math.max(acum.fimApos, ultEntrada - ultChegada);
    }
    function est(v) { v = v.slice().sort(function (a, b) { return a - b; }); return { n: Math.round(v.length / R), med: v[Math.floor(v.length * 0.5)], p90: v[Math.floor(v.length * 0.9)], max: v[v.length - 1] }; }
    var out = { total: est(acum.total), caminhos: {}, filas: acum.filas, fimApos: acum.fimApos };
    Object.keys(acum.porCaminho).sort().forEach(function (k) { out.caminhos[k] = est(acum.porCaminho[k]); });
    return out;
  }
  function desenharJornada(area, n, r) {
    area.appendChild(el('h3', { texto: 'Tempo da jornada até a entrada' }));
    var jor = n.jornada || [];
    if (jor.length) {
      area.appendChild(el('p', { classe: 'dica', texto: 'Medido: do check-in (ou da entrega do cartão) até a leitura na segurança.' }));
      area.appendChild(tabelaNum(['Entrada', 'Pessoas', 'Metade em até', '9 em 10 em até', 'Mais demorado'],
        jor.map(function (j) { return [j.entrada, j.pessoas, mmss(j.mediana_seg), mmss(j.p90_seg), mmss(j.max_seg)]; })));
    } else area.appendChild(el('p', { classe: 'vazio', texto: 'Medido: aparece quando a segurança começar a ler os QR codes e cartões.' }));
    var box = el('div', { classe: 'sim-box' }); area.appendChild(box);
    if (!simParams) {
      var t = {}; SIM_TEMPOS.forEach(function (x) { t[x[0]] = x[2]; });
      simParams = { pessoas: Math.max(60, Math.round((r.inscritos || 150) * 0.6) + 20), semInscricao: 15, celular: 40, janela: 60, triagemN: 1, mesas: 3, seguranca: 1, t: t };
    }
    desenharSimulacao(box);
  }
  function desenharSimulacao(box) {
    box.textContent = '';
    var p = simParams;
    box.appendChild(el('h4', { texto: 'Simulação da entrada (estimativa)' }));
    box.appendChild(el('p', { classe: 'dica', texto: 'Do momento em que a pessoa chega até entrar no espaço do evento, com filas. Mude os números e toque em Simular.' }));
    function campo(rot, chave, sub) {
      var i = el('input', { type: 'number', min: '0', value: String(sub ? p.t[chave] : p[chave]) });
      i.addEventListener('change', function () { var v = Math.max(0, Number(i.value) || 0); if (sub) p.t[chave] = v; else p[chave] = v; });
      return el('label', { classe: 'sim-campo' }, [el('span', { texto: rot }), i]);
    }
    box.appendChild(el('div', { classe: 'sim-campos' }, [campo('Pessoas chegando', 'pessoas'), campo('% sem inscrição', 'semInscricao'), campo('% fazem check-in pelo celular', 'celular'),
      campo('Chegadas ao longo de (min)', 'janela'), campo('Pessoas na triagem', 'triagemN'), campo('Mesas de atendimento', 'mesas'), campo('Seguranças lendo QR', 'seguranca')]));
    box.appendChild(el('details', {}, [el('summary', { texto: 'Tempos de atendimento (segundos)' }), el('div', { classe: 'sim-campos' }, SIM_TEMPOS.map(function (x) { return campo(x[1], x[0], true); }))]));
    var res = el('div', { classe: 'sim-res' });
    box.appendChild(el('button', { type: 'button', classe: 'btn principal', texto: 'Simular', onclick: function () { calcular(); } }));
    box.appendChild(res);
    function calcular() {
      if (!(p.pessoas > 0 && p.triagemN > 0 && p.mesas > 0 && p.seguranca > 0 && p.janela > 0)) { res.textContent = 'Preencha pessoas, mesas, seguranças e minutos.'; return; }
      var s = simularEntrada(p); res.textContent = '';
      res.appendChild(el('div', { classe: 'num-cartoes' }, [
        el('div', { classe: 'num-cartao' }, [el('strong', { texto: mmss(s.total.med) }), el('span', { texto: 'jornada típica' }), el('small', { texto: 'metade entra em até' })]),
        el('div', { classe: 'num-cartao' }, [el('strong', { texto: mmss(s.total.p90) }), el('span', { texto: '9 em cada 10' }), el('small', { texto: 'entram em até' })]),
        el('div', { classe: 'num-cartao' }, [el('strong', { texto: mmss(s.total.max) }), el('span', { texto: 'pior caso' }), el('small', { texto: 'quem mais esperou' })]),
        el('div', { classe: 'num-cartao' }, [el('strong', { texto: mmss(s.fimApos) }), el('span', { texto: 'para esvaziar' }), el('small', { texto: 'depois da última chegada' })])]));
      res.appendChild(tabelaNum(['Caminho', 'Pessoas', 'Metade em até', '9 em 10 em até'],
        Object.keys(s.caminhos).map(function (k) { var c = s.caminhos[k]; return [k, c.n, mmss(c.med), mmss(c.p90)]; })));
      res.appendChild(tabelaNum(['Etapa', 'Maior fila (pessoas esperando)'], [['Triagem', s.filas.triagem], ['Mesas', s.filas.mesas], ['Segurança', s.filas.seguranca]]));
      var f = s.filas, gargalo = f.mesas >= f.seguranca && f.mesas >= f.triagem ? 'as mesas' : f.seguranca >= f.triagem ? 'a segurança' : 'a triagem';
      res.appendChild(el('p', { classe: 'dica', texto: 'Maior gargalo: ' + gargalo + '. Simulação com 20 rodadas e variação de 40% para mais ou para menos em cada atendimento; o pico das chegadas é perto do início do evento.' }));
    }
    calcular();
  }

  // ---------- abas ----------
  function abrirAba(nome) {
    document.querySelectorAll('.abas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-aba') === nome)); });
    $('abaBuscar').hidden = nome !== 'buscar'; $('abaCadastrar').hidden = nome !== 'cadastrar'; $('abaPresentes').hidden = nome !== 'presentes';
    $('abaNumeros').hidden = nome !== 'numeros';
    if (nome === 'presentes') desenharPresentes();
    if (nome === 'numeros') carregarNumeros();
    if (nome === 'buscar') setTimeout(function () { $('busca').focus(); }, 30);
  }
  document.querySelectorAll('.abas button').forEach(function (b) { b.addEventListener('click', function () { abrirAba(b.getAttribute('data-aba')); }); });

  // ---------- início ----------
  function iniciar() {
    $('telaPin').hidden = true; $('telaPrincipal').hidden = false; $('acoesTopo').hidden = false;
    redesenhar(); atualizarLista(); enviarFila();
    abrirAba('buscar');
    desenharAtendente();
    if (ler('totem', false)) entrarTotem();
    else if (!atendente) abrirAtendente();
  }
  window.addEventListener('online', function () { marcarConexao(true); if (!ehEspelho) { enviarFila(); atualizarLista(); } });
  window.addEventListener('offline', function () { marcarConexao(false); });
  // A cada 15 s confere a fila de envio (não usa internet se estiver vazia); a lista, a cada 60 s.
  var tiques = 0;
  setInterval(function () {
    if (document.hidden || ehEspelho) return;
    enviarFila();
    if (++tiques % 4 === 0) atualizarLista();
  }, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !ehEspelho) { atualizarLista(); enviarFila(); } });
  window.addEventListener('beforeunload', function (e) { if (!ehEspelho && fila.length) { e.preventDefault(); e.returnValue = ''; } });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-recepcao.js', { scope: './recepcao' }).catch(function () { /* sem cache offline */ });

  desenharConexao();
  if (ehEspelho) { iniciarEspelho(); return; }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(chave)) { mostrarPin('Link incompleto: abra pelo link completo que você recebeu.'); return; }
  if (sessao && new Date(sessao.expira) > new Date()) iniciar(); else mostrarPin();
})();
