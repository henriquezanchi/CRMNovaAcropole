// Edge Function: reenvia automaticamente mensagens de WhatsApp que
// falharam por motivo TEMPORÁRIO — pedido do usuário (2026-09-29/30),
// depois de um lote real de 453 falhas onde 312 eram
// "Business eligibility payment issue" (fatura em aberto na Meta) e 141
// eram "Message Undeliverable" (número sem WhatsApp de verdade).
//
// Princípio de segurança, deliberado: só reenvia códigos de erro que
// genuinamente podem se resolver sozinhos com o tempo (pendência de
// pagamento resolvida, limite de taxa passageiro) — NUNCA reenvia
// "Message Undeliverable" nem qualquer código fora da whitelist abaixo.
// Reenviar pra um número que nunca teve WhatsApp de verdade não vai
// funcionar nunca, só gasta chamada de API à toa e arrisca a reputação
// do número de negócio (a Meta penaliza contas que insistem em números
// ruins). Cada linha tem um limite de tentativas e uma janela de
// validade (ambos dentro da RPC `mensagens_falhas_retriaveis()`,
// migracao_rpc_falhas_retriaveis.sql) — depois disso, para de tentar
// sozinho (fica visível no histórico pra reenvio manual se alguém
// quiser).
//
// Chamada por pg_cron a cada 3h (migracao_agendamento_reenvio_falhas.sql).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";

// A whitelist de códigos retriáveis (131042 = fatura em aberto, 130429/
// 131056 = limite de taxa passageiro) vive DENTRO da RPC
// `mensagens_falhas_retriaveis()` (migracao_rpc_falhas_retriaveis.sql) —
// única fonte de verdade, pra nunca divergir entre o filtro em SQL e um
// filtro duplicado aqui em TS.
// Lote de 1 (serializado, mesma correção de 2026-10-05 em js/whatsapp.js
// — ver TAMANHO_LOTE_CONVITE_API) — 5 reenvios concorrentes também
// produzem a mesma assinatura de "rajada" que motivou um aviso de
// violação de política da Meta, mesmo com baixo volume total.
const TAMANHO_LOTE = 1;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Falha = {
    id: number;
    pessoaIdentificador: string | null;
    tipo: string;
    corpo_texto: string | null;
    payload_bruto: any;
    wa_status_erro: any;
    atendente_nome: string | null;
    tentativas_reenvio: number;
};

// Reconstrói o corpo exato que whatsapp-send espera, a partir do que já
// foi gravado na linha que falhou — cada tipo guarda o que precisa em
// payload_bruto (ver whatsapp-send: imagem_url/documento_url/audio_url/
// template_nome+idioma+params, adicionados especificamente pra isso).
function montarCorpoReenvio(f: Falha): Record<string, unknown> | null {
    // origemEnvio: 'campanha' — zero humano envolvido (cron puro), sempre
    // vira "API" no responsável da conversa, nunca o nome de quem mandou
    // a tentativa original que falhou.
    const base = { pessoaIdentificador: f.pessoaIdentificador, atendenteNome: f.atendente_nome || "Reenvio automático", origemEnvio: "campanha" };
    const pb = f.payload_bruto || {};
    if (f.tipo === "template" && pb.template_nome) {
        return { ...base, tipo: "template", templateNome: pb.template_nome, templateIdioma: pb.template_idioma || "pt_BR", templateParams: pb.template_params || [], templatePreview: f.corpo_texto };
    }
    if (f.tipo === "imagem" && pb.imagem_url) {
        return { ...base, tipo: "imagem", imagemUrl: pb.imagem_url, caption: f.corpo_texto && f.corpo_texto !== "[Imagem]" ? f.corpo_texto : undefined };
    }
    if (f.tipo === "documento" && pb.documento_url) {
        return { ...base, tipo: "documento", documentoUrl: pb.documento_url, nomeArquivo: pb.nome_arquivo };
    }
    if (f.tipo === "audio" && pb.audio_url) {
        return { ...base, tipo: "audio", audioUrl: pb.audio_url };
    }
    if (f.tipo === "texto" && f.corpo_texto) {
        return { ...base, tipo: "texto", texto: f.corpo_texto };
    }
    return null; // sem dado suficiente pra reconstruir (ex: template antigo, gravado antes desta migração) — pula, não força
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    // Filtro por código de erro feito DIRETO no banco (RPC) — bug real
    // achado testando: filtrar em memória sobre uma página arbitrária de
    // "as N falhas mais antigas" quase nunca pegava as retriáveis de
    // verdade (podiam estar todas fora da 1ª página). Ver
    // migracao_rpc_falhas_retriaveis.sql.
    const { data: candidatas, error } = await supabaseAdmin.rpc("mensagens_falhas_retriaveis", { p_limite: 500 });
    if (error) return json({ ok: false, erro: "falha_buscar_falhas", detalhe: error.message }, 500);

    const candidatasRetriaveis = candidatas as Falha[] || [];
    if (candidatasRetriaveis.length === 0) return json({ ok: true, reenviadas: 0, falharam_de_novo: 0, total_candidatas: 0 });

    const urlWhatsappSend = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    const authServiceRole = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    let reenviadas = 0, falharamDeNovo = 0, semDadoSuficiente = 0;
    for (let i = 0; i < candidatasRetriaveis.length; i += TAMANHO_LOTE) {
        const lote = candidatasRetriaveis.slice(i, i + TAMANHO_LOTE);
        await Promise.all(lote.map(async (f) => {
            // Conta a tentativa JÁ, antes de saber o resultado — evita
            // reprocessar a mesma linha pra sempre se algo quebrar no meio.
            await supabaseAdmin.from(NOME_TABELA_MENSAGENS)
                .update({ tentativas_reenvio: f.tentativas_reenvio + 1, ultima_tentativa_reenvio_em: new Date().toISOString() })
                .eq("id", f.id);

            const corpo = montarCorpoReenvio(f);
            if (!corpo) { semDadoSuficiente++; return; }

            try {
                const resp = await fetch(urlWhatsappSend, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: authServiceRole },
                    body: JSON.stringify(corpo),
                });
                const data = await resp.json();
                if (data?.ok) {
                    reenviadas++;
                    // A linha NOVA (bem-sucedida) já foi inserida por
                    // whatsapp-send — esta linha ORIGINAL só marca que foi
                    // superada, pra sair da fila de reenvio pra sempre.
                    await supabaseAdmin.from(NOME_TABELA_MENSAGENS).update({ wa_status: "reenviada" }).eq("id", f.id);
                } else {
                    falharamDeNovo++;
                }
            } catch {
                falharamDeNovo++;
            }
        }));
        // Pausa entre lotes (pedido do usuário, 2026-09-30: "sem controle
        // de throughput no disparo em massa além do lote de 5") — mesmo
        // espírito das pausas adicionadas em js/whatsapp.js. Aumentada em
        // 2026-10-05 (ver comentário de TAMANHO_LOTE acima).
        if (i + TAMANHO_LOTE < candidatasRetriaveis.length) await new Promise((r) => setTimeout(r, 1500));
    }

    return json({ ok: true, reenviadas, falharam_de_novo: falharamDeNovo, sem_dado_suficiente: semDadoSuficiente, total_candidatas: candidatasRetriaveis.length });
});
