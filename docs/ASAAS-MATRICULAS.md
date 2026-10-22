# Matrículas cobradas pela escola com comissão via Asaas

Decisão de Henrique em 22/10/2026: a empresa recebe **30% do líquido após as taxas**. Não acrescentar uma segunda cobrança de taxas à comissão. Este fluxo ainda não está ativado: os endpoints financeiros não foram chamados para criar subcontas ou cobranças.

## Fluxo confirmado na documentação oficial

1. A escola é a titular da subconta, com seu nome e CPF/CNPJ reais e documentação aprovada. A cobrança é criada usando a credencial dessa subconta. A empresa não deve figurar como vendedora por simplesmente criar a cobrança na conta-pai e transferir 70% depois. A identificação exibida no checkout deve ser conferida no piloto, inclusive quando filiais compartilham a mesma pessoa jurídica.
2. Criar **um checkout individual por matrícula**, na subconta, com o valor da escola e identificação interna imutável do pedido. O checkout hospedado gera o link. A documentação de checkout suporta `splits`; não presumir o mesmo payload no Link de Pagamento genérico.
3. Informar em `splits` somente a carteira da empresa, com `percentualValue: 30`. Os 70% líquidos restantes ficam na subconta da escola. Não incluir a carteira da própria subconta como destinatária do split.
4. Exemplo: matrícula de R$150, taxa efetiva de R$2, líquido de R$148: empresa recebe R$44,40; escola fica com R$103,60. A taxa é apenas exemplo, não uma tarifa contratual consultada.
5. Webhook de pagamento confirma o pedido pago. `PAYMENT_SPLIT_DONE` confirma a comissão liquidada, identificada por `additionalInfo.splitId`. Esses são eventos diferentes: link criado ou pagamento iniciado não significa comissão recebida.
6. Uma fila idempotente cadastra a matrícula no Mercúrio somente depois da confirmação adequada e com os campos e permissões oficiais. A mesma pessoa/pedido/pagamento deve ter vínculo único. Se o cadastro falhar, repetir a operação acadêmica sem gerar outra cobrança. Reingressos precisam seguir o fluxo oficial, sem criar aluno duplicado.
7. Registrar o valor efetivamente liquidado da comissão na conciliação. Estorno do split reverte o recebimento correspondente. Pagamentos com split não podem voltar a gerar a mesma comissão no fechamento manual do CRM.

Payload ilustrativo, enviado **pelo servidor com credencial da subconta da escola**:

```json
{
  "billingTypes": ["PIX"],
  "chargeTypes": ["DETACHED"],
  "minutesToExpire": 60,
  "callback": {
    "cancelUrl": "URL_DO_PORTAL/cancelado",
    "expiredUrl": "URL_DO_PORTAL/expirado",
    "successUrl": "URL_DO_PORTAL/pagamento-em-conferencia"
  },
  "items": [{"name": "Matrícula na escola", "quantity": 1, "value": 150}],
  "splits": [{"walletId": "CARTEIRA_DA_EMPRESA", "percentualValue": 30}]
}
```

Não é um payload executável: URLs e carteira acima são marcadores. A referência de criação deve ser conferida ao implementar vínculo do pedido, dados do aluno e expiração. O redirecionamento de sucesso não substitui webhook verificado.

## O que falta para ativar

- Dados legais e responsáveis de cada titular/escola, aprovação documental e credenciais das subcontas. `POST /v3/accounts` devolve `apiKey` e `walletId`; a chave deve ser cifrada imediatamente, nunca enviada ao navegador ou registrada em logs. A conta-pai precisa ser PJ. A consulta de 22/10 confirmou conta configurada aprovada e uma subconta existente, sem criar novas.
- Enquadramento/homologação com o Asaas: a documentação atual limita a avaliação inicial a 10 subcontas, R$2.000 em cobranças por subconta e 60 dias. Como a operação contempla 13 filiais, confirmar o enquadramento e quais compartilham CNPJ antes de abrir contas. Há possíveis taxas de criação/manutenção conforme contrato; não foram presumidas.
- Acesso de **escrita** autorizado ao Mercúrio. As integrações atuais consultam dados; não comprovam permissão para criar aluno, matrícula, turma ou situação financeira. Pedir à equipe do Mercúrio o endpoint e a permissão de criação/reingresso, campos obrigatórios e regra de idempotência. Não inventar uma rota POST nem usar a base de consulta para escrita.
- Implementar cofre por filial, criação de checkout por pedido, webhooks verificados e idempotentes, fila acadêmica, conciliação de split/estorno e bloqueio de comissão duplicada. Validar primeiro com sandbox e um piloto aprovado.

## Fontes oficiais consultadas em 22/10/2026

- [Criação de subcontas](https://docs.asaas.com/docs/criacao-de-subcontas)
- [Referência de criação](https://docs.asaas.com/reference/criar-subconta)
- [Split de pagamentos — cálculo sobre netValue](https://docs.asaas.com/docs/split-de-pagamentos)
- [Checkout com split](https://docs.asaas.com/docs/checkout-com-split-de-pagamento)
- [Link de Pagamento genérico](https://docs.asaas.com/docs/criando-um-link-de-pagamentos)
- [Split em cobranças avulsas](https://docs.asaas.com/docs/split-em-cobrancas-avulsas)
