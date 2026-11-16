// Grava as credenciais da Cora (Integração Direta) nos segredos das Edge Functions,
// sem mostrar o conteúdo na tela. Uso:
//   node tools/cora/gravar-segredos-cora.mjs "<pasta com cert_key_cora_stage_* e cert_key_cora_production_*>"
// O client-id é lido do próprio certificado (campo CN), que é público.
import fs from "fs"; import os from "os"; import path from "path"; import { execSync } from "child_process"; import crypto from "crypto";
const base = process.argv[2];
if (!base) { console.error("Informe a pasta das credenciais."); process.exit(1); }
const achar = (prefixo) => { const d = fs.readdirSync(base).filter((n) => n.startsWith(prefixo)).sort().pop(); if (!d) throw new Error("Pasta não encontrada: " + prefixo); return path.join(base, d); };
const st = achar("cert_key_cora_stage_"), pr = achar("cert_key_cora_production_");
const ler = (d, f) => fs.readFileSync(path.join(d, f), "utf8");
const cn = new crypto.X509Certificate(ler(pr, "certificate.pem")).subject.match(/CN=(\S+)/)[1];
const linhas = [
  `CORA_CLIENT_ID=${cn}`,
  `CORA_STAGE_CERT=${JSON.stringify(ler(st, "certificate.pem"))}`, `CORA_STAGE_KEY=${JSON.stringify(ler(st, "private-key.key"))}`,
  `CORA_PROD_CERT=${JSON.stringify(ler(pr, "certificate.pem"))}`, `CORA_PROD_KEY=${JSON.stringify(ler(pr, "private-key.key"))}`,
];
const tmp = path.join(os.tmpdir(), `cora-${Date.now()}.env`);
fs.writeFileSync(tmp, linhas.join("\n") + "\n", { mode: 0o600 });
try { execSync(`npx supabase secrets set --env-file "${tmp}"`, { stdio: "inherit" }); console.log("Segredos da Cora gravados (client-id " + cn.slice(0, 8) + "…)."); }
finally { fs.rmSync(tmp, { force: true }); }
