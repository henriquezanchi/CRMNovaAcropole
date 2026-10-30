// Comando do admin via resposta de WhatsApp — pedido do usuário
// (2026-10-08, plano "Resumo Diário"): responder o relatório diário
// (resumo-diario-admin) com "SIM"/variante aprova e ENVIA as sugestões
// de resposta da IA que já estavam esperando aprovação
// (sugestoes_resposta_wpp, status='pendente'). A IA NÃO decide nada
// novo aqui — só dispara o texto que já foi escrito e revisado pelo
// mecanismo normal (sugerir-resposta-whatsapp, cron 15 min). Chamado
// de dentro de whatsapp-webhook, ANTES de qualquer casamento por
// telefone — essa mensagem não é tráfego de lead.
//
// BUG REAL GRAVÍSSIMO (2026-10-08/09, achado em produção na hora): a
// 1ª versão fazia 1 SELECT de todas as pendentes e depois enviava em
// loop com pausa de 1,5s entre cada — pra 52 pendentes, isso levava
// ~78s, bem mais que o timeout de webhook da Meta. A Meta reenviou o
// MESMO evento de webhook (comportamento documentado dela, "at least
// once delivery") várias vezes seguidas enquanto a 1ª execução ainda
// rodava — cada reenvio disparava uma NOVA chamada de
// tratarComandoAdmin(), que buscava "quem ainda está pendente" de novo
// e tentava mandar pra quem a execução anterior (mais lenta) ainda não
// tinha marcado como 'enviada'. Resultado real em produção: 27 leads
// receberam a MESMA sugestão 2 a 5 VEZES (confirmado por query direta).
// Corrigido com 2 camadas:
//   1. CLAIM atômico por linha — ANTES de enviar, tenta marcar a linha
//      como 'enviada' condicionado a `status='pendente'` (UPDATE ...
//      WHERE id=X AND status='pendente'). Só quem de fato afetou 1 linha
//      (ganhou a "corrida") segue pro envio de verdade — qualquer
//      execução concorrente que chegue depois encontra a linha já
//      'enviada' e pula, SEM reenviar. Isso protege contra duplicata
//      não importa quantas vezes a Meta reentregue o mesmo webhook.
//      Se o envio em si falhar DEPOIS do claim, volta pra 'pendente'
//      (mesmo padrão de "update otimista + rollback" já usado no Kanban).
//   2. Lote pequeno por execução (LIMITE_ENVIOS_POR_EXECUCAO) — reduz o
//      tempo de resposta do webhook (menos chance de a Meta considerar
//      "sem resposta" e reentregar de novo por esse motivo específico),
//      e avisa o admin pra mandar "SIM" de novo se sobrar mais.
import { supabaseAdmin } from "./supabaseAdmin.ts";

const PALAVRAS_CONFIRMACAO = ["sim", "s", "enviar", "pode", "manda", "ok", "confirmo"];
// Nunca rajada — já causou aviso de violação de política da Meta uma
// vez neste projeto (ver whatsapp-reenviar-falhas) quando vários envios
// saíram juntos; serializa com pausa, mesmo remédio de sempre.
const PAUSA_ENTRE_ENVIOS_MS = 1500;
// Teto por execução — mantém o tempo total bem abaixo do timeout de
// webhook da Meta (ver bug acima). Sobrando mais, o admin manda "SIM"
// de novo pra continuar o lote.
const LIMITE_ENVIOS_POR_EXECUCAO = 12;

function pausa(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enviarWhatsapp(pessoaIdentificador: string, texto: string, atendenteNome: string): Promise<any> {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pessoaIdentificador, tipo: "texto", texto, atendenteNome }),
    });
    return resp.json().catch(() => ({ ok: false, erro: "resposta_invalida" }));
}

async function enviarParaAdmin(texto: string): Promise<void> {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`;
    try {
        await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ texto }),
        });
    } catch (e) {
        console.warn("Falha ao responder o admin:", e);
    }
}

// Tenta "ganhar a corrida" por 1 sugestão específica — só uma execução
// concorrente consegue, as demais recebem 0 linhas afetadas e pulam.
async function reivindicarSugestao(id: number): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from("sugestoes_resposta_wpp")
        .update({ status: "enviada" })
        .eq("id", id)
        .eq("status", "pendente")
        .select("id");
    if (error) { console.warn(`Falha ao reivindicar sugestão id=${id}:`, error.message); return false; }
    return !!(data && data.length > 0);
}

// Respostas atravessadas (bug real, 30/10/2026): o "SIM" mandou uma sugestão
// feita para uma mensagem antiga, depois que a equipe já tinha respondido.
// A sugestão só vale se a mensagem que a originou ainda for a última da
// conversa (envio nosso que falhou não conta, o lead nunca recebeu).
async function sugestaoDesatualizada(s: any): Promise<boolean> {
    if (!s.mensagem_origem_id) return false;
    const { data } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("id, direcao, wa_status")
        .eq("pessoaIdentificador", s.pessoaIdentificador)
        .gt("id", s.mensagem_origem_id)
        .limit(20);
    return (data || []).some((m: any) => !(m.direcao === "saida" && m.wa_status === "falhou"));
}

export async function tratarComandoAdmin(msg: any): Promise<void> {
    if (msg?.type !== "text") return; // comando só por texto, de propósito — nunca interpreta áudio/imagem/etc.
    const texto = String(msg.text?.body || "").trim().toLowerCase();

    if (!PALAVRAS_CONFIRMACAO.includes(texto)) {
        await enviarParaAdmin("Não entendi — responda *SIM* pra eu enviar as sugestões de resposta pendentes.");
        return;
    }

    const { data: pendentes, error } = await supabaseAdmin
        .from("sugestoes_resposta_wpp")
        .select('id, "pessoaIdentificador", sugestao_resposta, mensagem_origem_id')
        .eq("status", "pendente")
        .not("sugestao_resposta", "is", null)
        .order("id", { ascending: true })
        .limit(LIMITE_ENVIOS_POR_EXECUCAO);
    if (error) { await enviarParaAdmin(`Erro ao buscar sugestões pendentes: ${error.message}`); return; }
    if (!pendentes || pendentes.length === 0) { await enviarParaAdmin("Não há sugestões pendentes agora."); return; }

    let enviados = 0;
    let falharam = 0;
    let jaProcessadasPorOutraExecucao = 0;
    let desatualizadas = 0;
    for (const s of pendentes as any[]) {
        if (await sugestaoDesatualizada(s)) {
            await supabaseAdmin.from("sugestoes_resposta_wpp").update({ status: "descartada" }).eq("id", s.id).eq("status", "pendente");
            desatualizadas++;
            continue;
        }
        const ganhou = await reivindicarSugestao(s.id);
        if (!ganhou) { jaProcessadasPorOutraExecucao++; continue; } // outra execução (reentrega da Meta) já cuidou dessa

        const resultado = await enviarWhatsapp(s.pessoaIdentificador, s.sugestao_resposta, "Bot de IA (aprovado via comando do admin)");
        if (resultado?.ok) {
            enviados++;
        } else {
            falharam++;
            console.warn(`Falha ao enviar sugestão pendente (id=${s.id}):`, resultado?.erro || resultado);
            // Já tinha sido marcada 'enviada' pelo claim — reverte pra
            // 'pendente' já que o envio de verdade falhou (mesmo padrão
            // de "update otimista + rollback" já usado no Kanban).
            await supabaseAdmin.from("sugestoes_resposta_wpp").update({ status: "pendente" }).eq("id", s.id);
        }
        await pausa(PAUSA_ENTRE_ENVIOS_MS);
    }

    if (jaProcessadasPorOutraExecucao > 0 && jaProcessadasPorOutraExecucao + desatualizadas === pendentes.length) return; // reentrega da Meta pro MESMO comando — já foi tudo tratado, nem responde de novo

    const { count: restantes } = await supabaseAdmin
        .from("sugestoes_resposta_wpp")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .not("sugestao_resposta", "is", null);

    const partes = [`✅ Enviei ${enviados} sugestão(ões) de resposta.`];
    if (falharam > 0) partes.push(`${falharam} falharam e voltaram pra pendente.`);
    if (desatualizadas > 0) partes.push(`${desatualizadas} não foram enviadas porque a conversa já tinha andado.`);
    if (restantes && restantes > 0) partes.push(`Ainda restam ${restantes} — responda *SIM* de novo pra continuar.`);
    await enviarParaAdmin(partes.join(" "));
}
