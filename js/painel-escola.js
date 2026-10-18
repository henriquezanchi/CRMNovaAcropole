// Página isolada: sem SDK, login nominal legado ou consulta direta às tabelas do CRM.
(() => {
    'use strict';
    const chave=new URLSearchParams(location.hash.slice(1)).get('chave') || '';
    const porId=id=>document.getElementById(id);
    const rotulos={apoio:{presenca:'Conferir presença',acolhimento:'Acolher após visita',inscricao:'Auxiliar inscrição',cadastro:'Conferir cadastro',outro:'Apoio combinado'},inscricao:{solicitada:'Inscrição solicitada',dados_pendentes:'Dados a conferir',aguardando_registro:'Aguardando registro',conferida:'Cadastro conferido'},proximo:{responder:'Responder dúvida',convidar:'Preparar convite',confirmar:'Confirmar presença',ouvir:'Ouvir após a visita',inscrever:'Auxiliar inscrição',conferir:'Conferir registro',retornar:'Retorno combinado'}};
    let inicio=0,numeroConsulta=0,controlador=null;
    function linha(card,rotulo,valor){if(valor===null||valor===undefined||valor==='')return;const p=document.createElement('p');const b=document.createElement('strong');b.textContent=rotulo+': ';p.append(b,document.createTextNode(String(valor)));card.append(p);}
    function formatarData(valor){const data=new Date(valor);return Number.isFinite(data.getTime())?data.toLocaleString('pt-BR'):'Data a conferir';}
    function montarPessoa(pessoa){const card=document.createElement('article');const titulo=document.createElement('h2');titulo.textContent=pessoa.nome||'Nome a conferir';card.append(titulo);
        linha(card,'Etapa do acompanhamento',pessoa.etapa);
        linha(card,'Apoio solicitado',rotulos.apoio[pessoa.apoio]);
        if(pessoa.pedido){const p=document.createElement('p');p.className='pedido';p.textContent=pessoa.pedido;card.append(p);}
        linha(card,'Inscrição',rotulos.inscricao[pessoa.inscricao]);linha(card,'Próximo passo',rotulos.proximo[pessoa.proximo]);
        linha(card,'Responsável pelo acompanhamento',pessoa.responsavel);if(pessoa.proxima_em)linha(card,'Data combinada',formatarData(pessoa.proxima_em));
        linha(card,'Atividade',pessoa.atividade);if(pessoa.data_atividade)linha(card,'Dia da atividade',pessoa.data_atividade.split('-').reverse().join('/'));
        if(pessoa.atividade){linha(card,'Convite',({confirmado:'Confirmou',talvez:'Talvez — sem confirmação',recusado:'Não participará',pendente:'Sem confirmação'})[pessoa.resposta_convite]||'A conferir');linha(card,'Presença',pessoa.compareceu===true?'Compareceu':pessoa.compareceu===false?'Não compareceu':'Ainda não conferida');}
        return card;
    }
    async function consultar(){const numero=++numeroConsulta;controlador?.abort();controlador=new AbortController();porId('pessoas').replaceChildren();porId('estado').textContent='Consultando o acompanhamento da escola…';porId('anterior').disabled=true;porId('proximo').disabled=true;porId('pagina').textContent='';porId('atualizado').textContent='';
        if(!/^[a-f0-9]{64}$/.test(chave)){porId('estado').textContent='Abra o link completo fornecido pela equipe da sua escola.';return;}
        try{const resposta=await fetch('https://eovgljcowblwoxmobeno.supabase.co/functions/v1/painel-escola',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave,busca:porId('busca').value,categoria:porId('categoria').value,inicio}),signal:controlador.signal,cache:'no-store'});const dados=await resposta.json();if(numero!==numeroConsulta)return;if(!resposta.ok)throw new Error(dados.erro||'Não foi possível consultar.');
            porId('escolaNome').textContent=dados.escola;porId('estado').textContent=dados.total?`${dados.total} pessoa(s) neste acompanhamento.`:'Nenhuma pessoa nesta situação no momento.';
            porId('atualizado').textContent='Consultado em '+formatarData(dados.consultado_em)+'. Os registros dependem das atualizações da equipe e dos sistemas.';
            porId('pessoas').replaceChildren(...dados.itens.map(montarPessoa));porId('anterior').disabled=inicio===0;porId('proximo').disabled=inicio+dados.itens.length>=dados.total;porId('pagina').textContent=dados.total?`${inicio+1}–${inicio+dados.itens.length} de ${dados.total}`:'';
        }catch(erro){if(numero===numeroConsulta&&erro.name!=='AbortError')porId('estado').textContent=erro.message;}
    }
    porId('atualizar').addEventListener('click',()=>{inicio=0;consultar();});porId('categoria').addEventListener('change',()=>{inicio=0;consultar();});porId('busca').addEventListener('keydown',evento=>{if(evento.key==='Enter'){inicio=0;consultar();}});
    porId('anterior').addEventListener('click',()=>{inicio=Math.max(0,inicio-50);consultar();});porId('proximo').addEventListener('click',()=>{inicio+=50;consultar();});consultar();
})();
