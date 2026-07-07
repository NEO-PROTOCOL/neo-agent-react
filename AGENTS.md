# AGENTS.md

## Regras de Comportamento para LLMs e Agentes Locais

Ao atuar neste projeto, todos os agentes devem adotar o seguinte comportamento padrão:

1. **Inspeção Baseada na Realidade (Runtime Beats Docs):** Antes de assumir que o ambiente de runtime se comporta da forma sugerida, verifique os imports, configurações e arquivos locais na branch `main`. A realidade do repositório se sobrepõe a anotações esquecidas.
2. **Isolamento de Alterações:** Mudanças que afetem UI devem ser testadas/pensadas isoladas das mudanças que afetam o Worker.
3. **Segurança de Workspace:** Modificações envolvendo gerenciamento de pacotes (`pnpm-workspace.yaml`, `package.json` raíz) exigem altíssimo escrutínio e aprovação explícita, pois quebram as ligações vitais entre `packages/`, `apps/` e `services/`.
4. **Respostas Estruturadas:** Mantenha verbosidade técnica, separando diagnósticos e planos de ação. Nunca esconda estados de erro reais por detrás de fallbacks não implementados.
