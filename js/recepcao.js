// Recepção do evento (13/11/2026, Dia Mundial da Filosofia). Página: recepcao.html#<chave>.
// - Busca por voz ou digitação, tolerante a erro de grafia; um toque marca a presença no Ulisses.
// - Cadastro na porta de quem chegou sem inscrição (inscreve no Ulisses e marca presença).
// - Funciona sem internet: a página fica guardada no aparelho (sw-recepcao.js), a lista fica em
//   localStorage e cada ação entra numa fila que é enviada sozinha quando a conexão volta.
//   Cada ação tem um client_id: reenviar nunca grava duas vezes.
(function () {
  'use strict';
  var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
  var chave = (location.hash || '').replace(/^#/, '');
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
    $('pinApelido').value = localStorage.getItem('rc_apelido') || '';
    setTimeout(function () { $('pinValor').focus(); }, 50);
  }
  $('formPin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var apelido = $('pinApelido').value.trim();
    try { localStorage.setItem('rc_apelido', apelido); } catch (e) { /* ok */ }
    $('pinErro').textContent = 'Entrando…';
    sessao = null;
    chamar({ acao: 'pin', pin: $('pinValor').value, apelido: apelido }).then(function (j) {
      if (!j.ok) { $('pinErro').textContent = j.erro || 'Não foi possível entrar.'; return; }
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

  function desenharPlacar() {
    var todos = inscritos();
    $('nInscritos').textContent = todos.length + inscricoesNaFila().length;
    $('nPresentes').textContent = todos.filter(function (x) { return x.presente; }).length + inscricoesNaFila().length;
    $('nPorta').textContent = todos.filter(function (x) { return x.na_porta; }).length + inscricoesNaFila().length;
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
  function verificarJaInscrito() {
    var achados = buscar($('cadNome').value, inscritos()).slice(0, 3);
    var area = $('cadVinculo'); area.textContent = '';
    if (!achados.length || $('cadNome').value.trim().split(/\s+/).length < 2) return;
    area.appendChild(document.createTextNode('Talvez já esteja inscrito(a): '));
    achados.forEach(function (p) {
      area.appendChild(el('button', { type: 'button', classe: 'chip', texto: p.nome + (p.presente ? ' ✓' : ''), onclick: function () {
        abrirAba('buscar'); $('busca').value = p.nome; desenharResultados();
      } }));
    });
  }
  function sugerirBase() {
    clearTimeout(timerBase);
    var termo = $('cadNome').value.trim();
    var area = $('sugestoesBase');
    if (termo.length < 5 || termo.split(/\s+/).length < 2 || !online || !sessao) { area.textContent = ''; return; }
    timerBase = setTimeout(function () {
      chamar({ acao: 'buscar_base', termo: termo }).then(function (j) {
        area.textContent = '';
        if (!j.ok || !(j.pessoas || []).length) return;
        area.appendChild(el('span', { classe: 'dica', texto: 'Já temos cadastro dessa pessoa? Toque para usar o celular e o e-mail que já estão no CRM:' }));
        j.pessoas.slice(0, 5).forEach(function (p) {
          var b = el('button', { type: 'button', texto: nomeProprio(p.nome) + ' · ' + String(p.filial || '').replace(/^Goiânia - /, '') + (p.final_tel ? ' · cel. final ' + p.final_tel : '') + (p.tem_email ? ' · tem e-mail' : ''),
            onclick: function () {
              var mesmo = pidEscolhido === p.pid;
              pidEscolhido = mesmo ? null : p.pid; pessoaBase = mesmo ? null : p;
              area.querySelectorAll('button').forEach(function (x) { x.classList.remove('escolhida'); });
              if (!mesmo) { b.classList.add('escolhida'); $('cadNome').value = nomeProprio(p.nome); }
              $('cadTel').placeholder = pessoaBase && pessoaBase.tem_tel ? 'usar o do cadastro (final ' + pessoaBase.final_tel + ')' : '99999-9999';
            } });
          area.appendChild(b);
        });
      }, function () { area.textContent = ''; });
    }, 450);
  }
  $('cadNome').addEventListener('input', function () { pidEscolhido = null; pessoaBase = null; $('cadTel').placeholder = '99999-9999'; sugerirBase(); verificarJaInscrito(); });

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
    aviso('✓ ' + nome.split(' ')[0] + ' cadastrado(a)' + (online ? '' : ' (envia quando a internet voltar)'));
    $('formCadastro').reset(); $('cadDdd').value = ddd || '62'; msg.textContent = '';
    $('sugestoesBase').textContent = ''; $('cadVinculo').textContent = ''; pidEscolhido = null; pessoaBase = null;
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
    var pend = inscricoesNaFila().map(function (f) { return { nome: f.dados.nome, pendente: true, porta: true }; });
    var pres = inscritos().filter(function (x) { return x.presente; });
    var todos = pend.concat(pres).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    if (!todos.length) { area.appendChild(el('p', { classe: 'vazio', texto: 'Ninguém marcado ainda.' })); return; }
    todos.forEach(function (p) {
      area.appendChild(el('div', { classe: 'pessoa presente' + (p.pendente ? ' pendente' : '') }, [
        el('div', { classe: 'nome', texto: p.nome }),
        el('div', { classe: 'info' }, [
          p.porta || p.na_porta ? el('span', { classe: 'selo fora', texto: 'inscrito na porta' }) : null,
          p.aluno ? el('span', { classe: 'selo', texto: 'Aluno' }) : (p.porta ? null : el('span', { classe: 'selo fora', texto: 'De fora' })),
          p.pendente ? el('span', { texto: 'enviando…' }) : null
        ])
      ]));
    });
  }

  // ---------- fila de envio ----------
  function enfileirar(acao, dados) {
    dados.client_id = uuid(); dados.criado_no_aparelho = new Date().toISOString();
    fila.push({ acao: acao, dados: dados, tentativas: 0 });
    gravar('fila', fila); desenharPlacar(); enviarFila();
  }
  var enviando = false, esperaFila = 0;
  function enviarFila() {
    if (enviando || !fila.length || !sessao) return;
    enviando = true;
    var item = fila[0];
    var corpo = Object.assign({ acao: item.acao }, item.dados);
    chamar(corpo).then(function (j) {
      enviando = false;
      if (j._status === 401 && j.precisa_pin) { mostrarPin('Sua sessão expirou. Entre de novo; nada do que foi marcado se perde.'); return; }
      if (j.ok) {
        tirar(item); esperaFila = 0;
        if (item.acao === 'presenca' && lista) lista.inscritos.forEach(function (x) { if (x.email_evento_id === item.dados.email_evento_id) x.compareceu = item.dados.compareceu; });
        if (item.acao === 'inscrever') atualizarLista();
      } else if (j.definitivo || j.inscrito || (j._status >= 400 && j._status < 500 && j._status !== 429)) {
        tirar(item);
        problemas.push({ nome: item.dados.nome || nomeDe(item.dados.email_evento_id), erro: j.erro || 'Recusado pelo servidor.' }); gravar('problemas', problemas);
        aviso('⚠ ' + (j.erro || 'Uma ação não foi aceita. Veja em Presentes.'));
        if (j.inscrito) atualizarLista();
      } else {
        item.tentativas++; esperaFila = Math.min(30000, 3000 * item.tentativas);
      }
      gravar('fila', fila); gravar('lista', lista); redesenhar();
      setTimeout(enviarFila, esperaFila);
    }, function () {
      enviando = false; item.tentativas++; gravar('fila', fila);
      esperaFila = Math.min(30000, 4000 * item.tentativas); desenharConexao();
      setTimeout(enviarFila, esperaFila);
    });
  }
  function tirar(item) { var i = fila.indexOf(item); if (i >= 0) fila.splice(i, 1); }
  function nomeDe(id) { var p = ((lista && lista.inscritos) || []).filter(function (x) { return x.email_evento_id === id; })[0]; return p ? p.nome : ''; }

  // ---------- lista do servidor ----------
  function atualizarLista() {
    if (!sessao) return Promise.resolve();
    return chamar({ acao: 'lista' }).then(function (j) {
      if (j._status === 401 && j.precisa_pin) { mostrarPin('Sua sessão expirou. Entre de novo.'); return; }
      if (!j.ok) return;
      lista = { inscritos: j.inscritos || [], evento: j.evento, rotulo: j.rotulo, em: j.agora };
      gravar('lista', lista); redesenhar();
    }, function () { /* sem internet: segue com a lista guardada */ });
  }
  function redesenhar() {
    if (lista && lista.evento) $('titulo').textContent = lista.evento.nome ? nomeProprio(lista.evento.nome.split(' - ')[0]) : 'Recepção do evento';
    if (anotando === null) desenharResultados(); else desenharPlacar();
    if (!$('abaPresentes').hidden) desenharPresentes();
  }

  // ---------- abas ----------
  function abrirAba(nome) {
    document.querySelectorAll('.abas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-aba') === nome)); });
    $('abaBuscar').hidden = nome !== 'buscar'; $('abaCadastrar').hidden = nome !== 'cadastrar'; $('abaPresentes').hidden = nome !== 'presentes';
    if (nome === 'presentes') desenharPresentes();
    if (nome === 'buscar') setTimeout(function () { $('busca').focus(); }, 30);
  }
  document.querySelectorAll('.abas button').forEach(function (b) { b.addEventListener('click', function () { abrirAba(b.getAttribute('data-aba')); }); });

  // ---------- início ----------
  function iniciar() {
    $('telaPin').hidden = true; $('telaPrincipal').hidden = false;
    redesenhar(); atualizarLista(); enviarFila();
    abrirAba('buscar');
  }
  window.addEventListener('online', function () { marcarConexao(true); enviarFila(); atualizarLista(); });
  window.addEventListener('offline', function () { marcarConexao(false); });
  setInterval(function () { if (!document.hidden) { atualizarLista(); enviarFila(); } }, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { atualizarLista(); enviarFila(); } });
  window.addEventListener('beforeunload', function (e) { if (fila.length) { e.preventDefault(); e.returnValue = ''; } });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-recepcao.js', { scope: './recepcao' }).catch(function () { /* sem cache offline */ });

  desenharConexao();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(chave)) { mostrarPin('Link incompleto: abra pelo link completo que você recebeu.'); return; }
  if (sessao && new Date(sessao.expira) > new Date()) iniciar(); else mostrarPin();
})();
