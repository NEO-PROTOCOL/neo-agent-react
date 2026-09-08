export const ALEXA_PRIVACY_PATH = "/privacy/alexa";

export function alexaPrivacyPolicy() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Política de Privacidade — Neo Assistente</title>
</head>
<body>
  <main>
    <h1>Política de Privacidade — Neo Assistente</h1>
    <p>Última atualização: 8 de setembro de 2026.</p>
    <p>A Skill Neo Assistente permite consultar, por voz ou texto, tarefas previamente autorizadas no runtime NEO Protocol.</p>

    <h2>Dados processados</h2>
    <p>Para autenticar solicitações, impedir repetição indevida e manter o contexto da conversa, processamos o identificador pseudônimo de usuário fornecido pela Alexa, identificadores e horários de Skill, sessão e solicitação, o conteúdo enviado à Skill, referências das tarefas consultadas, respostas e evidências operacionais.</p>
    <p>A Skill não solicita nem armazena localização, endereço, senha, dados bancários ou credenciais do usuário. Não utiliza Account Linking.</p>

    <h2>Finalidade e tratamento</h2>
    <p>Os dados são usados somente para responder consultas autorizadas, preservar contexto entre sessões, proteger o endpoint e auditar o funcionamento. Perguntas ambíguas podem ser classificadas por um provedor de inteligência artificial, sem lhe conceder autoridade para alterar tarefas ou executar ações.</p>

    <h2>Armazenamento, compartilhamento e retenção</h2>
    <p>O contexto e o histórico operacional ficam armazenados em infraestrutura protegida no Railway/PostgreSQL por até 30 dias. Os dados podem ser processados pelos fornecedores de hospedagem e inteligência artificial estritamente para prestar o serviço. Não vendemos dados, não os usamos para publicidade e não os compartilhamos para criação de perfis publicitários.</p>

    <h2>Controle e exclusão</h2>
    <p>O titular pode solicitar acesso ou exclusão dos dados associados à Skill pelo e-mail <a href="mailto:neo@neoprotocol.space">neo@neoprotocol.space</a>. A desativação da Skill impede novas interações, mas a exclusão antecipada deve ser solicitada pelo canal indicado.</p>

    <h2>Público</h2>
    <p>A Skill não é direcionada a crianças menores de 13 anos e não oferece compras ou publicidade.</p>

    <h2>Responsável</h2>
    <p>NEO Protocol — contato: <a href="mailto:neo@neoprotocol.space">neo@neoprotocol.space</a>.</p>
  </main>
</body>
</html>`;
}

export function registerAlexaPrivacy(app) {
  app.get(ALEXA_PRIVACY_PATH, async (_request, reply) => reply
    .header("Cache-Control", "public, max-age=3600")
    .type("text/html; charset=utf-8")
    .send(alexaPrivacyPolicy()));
}
