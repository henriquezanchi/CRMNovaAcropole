// Helper compartilhado pelos scripts do scraper (ulisses.js, mercurio.js) —
// lê credenciais cifradas e grava o status de cada tentativa de
// sincronização, usando a SUPABASE_SERVICE_ROLE_KEY (nunca a chave
// publishable) — só ela tem permissão de chamar
// ler_credencial_scraper()/está isenta do RLS fechado de
// credenciais_scraper (migracao_credenciais_scraper.sql +
// migracao_credenciais_scraper_leitura.sql).
//
// Variáveis de ambiente esperadas (configuradas como Secrets do
// repositório no GitHub — Settings > Secrets and variables > Actions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENCIAIS_SCRAPER_CHAVE
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CREDENCIAIS_SCRAPER_CHAVE = process.env.CREDENCIAIS_SCRAPER_CHAVE;

for (const [nome, valor] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENCIAIS_SCRAPER_CHAVE })) {
    if (!valor) throw new Error(`Variável de ambiente ${nome} não configurada (defina como Secret do repositório no GitHub).`);
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// sistema: 'ulisses' | 'mercurio'. filial: nome exato da filial (Ulisses)
// ou null/undefined (Mercúrio, sempre 'GLOBAL' — 1 senha só). Devolve
// { usuario, senha } ou lança erro se não houver credencial salva.
export async function lerCredencial(sistema, filial) {
    const { data, error } = await supabaseAdmin.rpc('ler_credencial_scraper', {
        p_sistema: sistema,
        p_filial: filial || 'GLOBAL',
        p_chave: CREDENCIAIS_SCRAPER_CHAVE,
    });
    if (error) throw new Error(`Erro ao ler credencial de ${sistema}/${filial || 'GLOBAL'}: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`Nenhuma credencial salva pra ${sistema}/${filial || 'GLOBAL'} — configure em "Login Automático" na aba Importar do CRM.`);
    return data[0]; // { usuario, senha }
}

// Grava 1 linha em status_sincronizacao_automatica — chamar SEMPRE ao
// final de uma tentativa (sucesso ou falha), pra alimentar o alerta
// "Sincronização travada" na Central de Notificações do CRM.
export async function registrarStatusSincronizacao(sistema, filial, sucesso, mensagem) {
    const { error } = await supabaseAdmin.from('status_sincronizacao_automatica').insert({
        sistema,
        filial: filial || 'GLOBAL',
        sucesso,
        mensagem: mensagem ? String(mensagem).slice(0, 2000) : null,
    });
    if (error) console.error('Erro ao registrar status de sincronização (não interrompe o job):', error.message);
}
