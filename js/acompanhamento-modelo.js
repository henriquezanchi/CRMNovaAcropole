// Regras determinísticas: IA não escolhe contatos nem deduz intenção.
(function (raiz) {
    'use strict';
    const campos = {
        relacao: { desconhecida: 'A confirmar', interessado: 'Ainda não é aluno', visitante: 'Já visitou a escola', ativo: 'Aluno ativo', antigo: 'Antigo aluno' },
        inscricao: { nao_iniciada: 'Inscrição não iniciada', solicitada: 'Pessoa pediu inscrição', dados_pendentes: 'Faltam dados para conferir', aguardando_registro: 'Aguardando registro no sistema', conferida: 'Cadastro conferido na fonte informada' },
        fonte_registro: { desconhecida: 'Ainda não conferido', mercurio: 'Mercúrio', mercury: 'Mercury', escola: 'Responsável da escola' },
        origem: { desconhecida: 'A confirmar', ulisses: 'Ulisses / evento', ex_aluno: 'Histórico de aluno', instagram: 'Instagram', indicacao: 'Indicação', outro: 'Outra origem' },
        entrada: { desconhecida: 'A confirmar', base_existente: 'Base existente', espontanea: 'Procura espontânea', ativa: 'Prospecção ativa' },
        intencao: { desconhecida: 'Ainda não sabemos', conhecer: 'Quer conhecer', participar: 'Quer participar em data definida', inscrever: 'Quer se inscrever', depois: 'Prefere outra ocasião', nao: 'Não tem interesse agora' },
        contato: { verificar: 'Conferir antes de abordar', permitido: 'Contato combinado', pausado: 'Pausar contato', nao_contatar: 'Não contatar' },
        experiencia: { desconhecida: 'Não informada', positiva: 'Positiva, conforme relato', mista: 'Mista, conforme relato', negativa: 'Negativa, conforme relato' },
        proximo: { nenhum: 'Sem próximo passo', responder: 'Responder dúvida/pedido', convidar: 'Fazer convite', confirmar: 'Confirmar presença', ouvir: 'Ouvir após a visita', inscrever: 'Auxiliar inscrição', conferir: 'Conferir registro oficial', retornar: 'Retornar na data combinada' },
    };
    function normalizar(valor) {
        const dado = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
        const resultado = {};
        Object.keys(campos).forEach(chave => { resultado[chave] = Object.hasOwn(campos[chave], dado[chave]) ? dado[chave] : Object.keys(campos[chave])[0]; });
        ['responsavel', 'proxima_em', 'pausa_ate', 'nota', 'atualizado_em', 'atualizado_por', 'referencia_registro', 'conferido_em'].forEach(chave => { resultado[chave] = typeof dado[chave] === 'string' ? dado[chave] : ''; });
        resultado.revisao = Number.isSafeInteger(dado.revisao) && dado.revisao >= 0 ? dado.revisao : 0;
        return resultado;
    }
    function impedimento(valor, agora = Date.now()) {
        const dado = normalizar(valor);
        if (dado.contato === 'nao_contatar') return 'Pedido de não contato';
        if (dado.contato === 'pausado') {
            if (!dado.pausa_ate || !Number.isFinite(Date.parse(dado.pausa_ate)) || Date.parse(dado.pausa_ate) > agora) return 'Contato pausado';
            return 'Pausa terminou: confirmar preferência antes de campanha';
        }
        if (dado.contato !== 'permitido') return 'Preferência de contato ainda não conferida';
        if (dado.intencao === 'nao' || dado.intencao === 'depois') return 'Interesse atual não autoriza campanha';
        return '';
    }
    function prioridade(lead, agora = Date.now()) {
        const dado = normalizar(lead.acompanhamento);
        if (dado.relacao === 'ativo') return { nivel: 9, motivo: 'Aluno ativo: não incluir em captação', campanha: false };
        if (dado.contato === 'pausado' && dado.pausa_ate && Number.isFinite(Date.parse(dado.pausa_ate)) && Date.parse(dado.pausa_ate) <= agora) return { nivel: 0, motivo: 'Pausa terminou: rever preferência individualmente', campanha: false };
        if (dado.contato === 'permitido' && ['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao)) return { nivel: 1, motivo: 'Inscrição precisa de acompanhamento', campanha: false };
        const motivo = impedimento(dado, agora);
        if (motivo) return { nivel: 9, motivo, campanha: false };
        const vencido = dado.proxima_em && Number.isFinite(Date.parse(dado.proxima_em)) && Date.parse(dado.proxima_em) <= agora;
        if (vencido) return { nivel: 0, motivo: 'Compromisso de atendimento vencido', campanha: false };
        if (dado.proxima_em && Date.parse(dado.proxima_em) > agora) return { nivel: 8, motivo: 'Aguardar a data combinada', campanha: false };
        if (dado.intencao === 'inscrever' || dado.proximo === 'responder') return { nivel: 1, motivo: 'Pedido de ajuda ou inscrição', campanha: false };
        if (dado.intencao === 'participar') return { nivel: 2, motivo: 'Interesse explícito em participar', campanha: true };
        if (dado.intencao === 'conhecer') return { nivel: 3, motivo: 'Quer conhecer a escola', campanha: true };
        return { nivel: 4, motivo: 'Conferir contexto e interesse', campanha: false };
    }
    function validar(valor) {
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Registro inválido.');
        Object.keys(campos).forEach(chave => { if (!Object.hasOwn(campos[chave], valor[chave])) throw new Error('Escolha uma opção válida para ' + chave + '.'); });
        const dado = normalizar(valor);
        if (dado.nota.length > 600 || dado.responsavel.length > 120) throw new Error('Resuma a observação e o responsável.');
        ['proxima_em', 'pausa_ate'].forEach(chave => { if (dado[chave] && !Number.isFinite(Date.parse(dado[chave]))) throw new Error('Data inválida.'); });
        if (dado.proximo !== 'nenhum' && (!dado.responsavel.trim() || !dado.proxima_em)) throw new Error('Defina responsável e data do próximo passo.');
        if (dado.proxima_em && dado.proximo === 'nenhum') throw new Error('Escolha o próximo passo para essa data.');
        if (dado.contato === 'nao_contatar' && ['convidar', 'confirmar', 'retornar'].includes(dado.proximo)) throw new Error('Respeite o pedido de não contato.');
        if (dado.referencia_registro.length > 160) throw new Error('Resuma a referência de conferência.');
        if (dado.conferido_em && !Number.isFinite(Date.parse(dado.conferido_em))) throw new Error('Data de conferência inválida.');
        if (dado.inscricao === 'conferida' && (dado.fonte_registro === 'desconhecida' || !dado.referencia_registro.trim() || !dado.conferido_em)) throw new Error('Informe fonte, referência e data da conferência.');
        return dado;
    }
    function textoBusca(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    function selecionarFila(leads, opcoes = {}, agora = Date.now()) {
        const filtro = opcoes.filtro || 'todos';
        const busca = textoBusca(opcoes.busca);
        const responsavel = textoBusca(opcoes.responsavel);
        return leads.map(lead => ({ lead, prioridade: prioridade(lead, agora) })).filter(item => {
            const dado = normalizar(item.lead.acompanhamento);
            if (busca && !textoBusca([item.lead.pessoaNome, item.lead.pessoaIdentificador, dado.responsavel].join(' ')).includes(busca)) return false;
            if (opcoes.somenteMeus && (!responsavel || textoBusca(dado.responsavel) !== responsavel)) return false;
            if (filtro === 'todos') return true;
            if (filtro === 'retornos') return item.prioridade.nivel <= 1;
            if (filtro === 'restritos') return item.prioridade.nivel >= 8;
            if (filtro === 'inscricoes') return ['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao);
            if (filtro === 'sem_responsavel') return !dado.responsavel.trim();
            return dado.origem === filtro;
        }).sort((a, b) => a.prioridade.nivel - b.prioridade.nivel || (a.lead.acompanhamento?.proxima_em || '9999').localeCompare(b.lead.acompanhamento?.proxima_em || '9999') || String(a.lead.pessoaIdentificador).localeCompare(String(b.lead.pessoaIdentificador)));
    }
    function resumir(leads, agora = Date.now()) {
        const resultado = { total: leads.length, atencao: 0, inscricoes: 0, semResponsavel: 0, preferenciaPendente: 0, cadastrosConferidos: 0 };
        leads.forEach(lead => {
            const dado = normalizar(lead.acompanhamento);
            if (prioridade(lead, agora).nivel <= 1) resultado.atencao++;
            if (['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao)) resultado.inscricoes++;
            if (!dado.responsavel.trim()) resultado.semResponsavel++;
            if (dado.contato === 'verificar') resultado.preferenciaPendente++;
            if (dado.inscricao === 'conferida') resultado.cadastrosConferidos++;
        });
        return resultado;
    }
    function sugerirConversa(valor, agora = Date.now()) {
        const dado = normalizar(valor);
        const bloqueio = impedimento(dado, agora);
        if (bloqueio) return { orientacao: bloqueio + '. Confira o contexto antes de iniciar uma conversa.', texto: '' };
        if (dado.relacao === 'ativo') return { orientacao: 'Aluno ativo: confira a necessidade de atendimento, sem convite de captação.', texto: '' };
        if (dado.intencao === 'nao' || dado.intencao === 'depois') return { orientacao: 'Respeite o momento declarado. Retome apenas se houver combinação válida.', texto: '' };
        if (dado.proxima_em && Date.parse(dado.proxima_em) > agora) return { orientacao: 'Aguarde o retorno combinado. Não é necessário mandar outra mensagem agora.', texto: '' };
        if (dado.inscricao === 'aguardando_registro' || dado.proximo === 'conferir') return { orientacao: 'Confira o registro com a escola ou no sistema antes de perguntar ao interessado.', texto: '' };
        if (dado.proximo === 'confirmar' || dado.proximo === 'convidar') return { orientacao: 'Abra a atividade na Agenda. Confira proposta, data, horário, local e condições antes de preparar o convite; peça uma resposta clara.', texto: '' };
        if (dado.proximo === 'ouvir') return { orientacao: 'Ouça a experiência sem presumir satisfação ou interesse em matrícula.', texto: 'Olá! Como foi a atividade para você? O que fez sentido e ficou alguma dúvida? Gostaria de participar de outra oportunidade ou prefere outro momento?' };
        if (dado.inscricao === 'solicitada' || dado.inscricao === 'dados_pendentes' || dado.intencao === 'inscrever') return { orientacao: 'Ajude na inscrição sem solicitar documentos por um canal inadequado. Confirme o que realmente falta com a escola.', texto: 'Olá! Posso ajudar a dar continuidade à sua inscrição? Ficou alguma dúvida sobre os próximos passos?' };
        if (dado.relacao === 'antigo' || dado.origem === 'ex_aluno') return { orientacao: 'Acolha o momento atual sem pedir detalhes íntimos ou presumir vontade de retornar.', texto: 'Olá! Aqui é da escola. Como você está? Faz sentido conversarmos sobre uma oportunidade de voltar a participar das atividades?' };
        if (dado.origem === 'ulisses') return { orientacao: 'Identifique-se e confira o evento real antes de contextualizar. Inscrição antiga não comprova interesse atual.', texto: 'Olá! Aqui é da escola. Você já se inscreveu em uma de nossas atividades. Ainda faz sentido conversarmos sobre conhecer a proposta da escola?' };
        return { orientacao: 'Identifique quem fala e a escola; pergunte se a pessoa deseja conversar, sem afirmar que já houve interesse.', texto: 'Olá! Aqui é da escola. Podemos conversar sobre nossas atividades abertas? Se preferir não receber contato, pode nos avisar.' };
    }
    raiz.AcompanhamentoModelo = Object.freeze({ campos, normalizar, validar, prioridade, impedimento, selecionarFila, resumir, sugerirConversa });
})(globalThis);
