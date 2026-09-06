// CORS liberado (*) — consistente com a chave publishable já exposta
// no index.html hoje: o app não tem login, então não há origem "de
// confiança" real pra restringir.
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Chame no início de cada function. Se retornar uma Response, devolva-a
// direto (é o preflight OPTIONS); se retornar null, segue o processamento normal.
export function handleCors(req: Request): Response | null {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    return null;
}
