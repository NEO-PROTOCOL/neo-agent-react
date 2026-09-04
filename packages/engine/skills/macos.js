import { exec } from "node:child_process";
import { promisify } from "node:util";
import { defineSkill } from "./contracts.js";

const execAsync = promisify(exec);

/**
 * Escapes string for safe insertion into AppleScript literal quotes
 */
function escapeAppleScriptString(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

/**
 * Skill: Lista eventos do Calendário do macOS
 */
export const macosListCalendarEventsSkill = defineSkill({
  name: "macos_list_calendar_events",
  description: "Consulta eventos do Calendário do macOS para hoje ou próximos dias, permitindo identificar compromissos e janelas livres de foco",
  parametersSchema: {
    type: "object",
    properties: {
      daysAhead: { type: "number", description: "Quantos dias à frente buscar (padrão: 1 para apenas hoje)" },
      calendarName: { type: "string", description: "Nome do calendário (ex: Trabalho, Pessoal). Se omitido, busca em todos." },
    },
    additionalProperties: false,
  },
  async run(params) {
    const days = Number(params?.daysAhead) || 1;
    const targetCal = params?.calendarName ? escapeAppleScriptString(params.calendarName) : null;

    const script = `
tell application "Calendar"
  set startDate to current date
  set hours of startDate to 0
  set minutes of startDate to 0
  set seconds of startDate to 0
  
  set endDate to startDate + (${days} * 24 * 60 * 60)
  
  set results to {}
  ${
    targetCal
      ? `set calList to (every calendar whose name is "${targetCal}")`
      : `set calList to calendars`
  }
  
  repeat with aCal in calList
    set evs to (every event of aCal whose start date is greater than or equal to startDate and start date is less than endDate)
    repeat with ev in evs
      set evTitle to summary of ev
      set evCal to name of aCal
      set evStart to (start date of ev) as «class ktxt»
      set evEnd to (end date of ev) as «class ktxt»
      set end of results to (evTitle & "||" & evCal & "||" & evStart & "||" & evEnd)
    end repeat
  end repeat
  
  set AppleScript's text item delimiters to "\\n"
  return results as text
end tell
`;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      const lines = stdout.trim().split("\n").filter(Boolean);
      const events = lines.map((line) => {
        const [title, calendar, start, end] = line.split("||");
        return { title, calendar, start, end };
      });
      return {
        count: events.length,
        events,
        queryPeriodDays: days,
      };
    } catch (err) {
      return {
        count: 0,
        events: [],
        error: err.message,
      };
    }
  },
});

/**
 * Skill: Cria um evento ou bloco de foco no Calendário do macOS
 */
export const macosCreateCalendarEventSkill = defineSkill({
  name: "macos_create_calendar_event",
  description: "Cria um novo evento ou bloco de foco protegido no Calendário do macOS",
  parametersSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título do evento ou bloco de foco" },
      startDate: { type: "string", description: "Data/hora de início (ex: '2026-09-04 16:00:00' ou formato AppleScript legível)" },
      durationMinutes: { type: "number", description: "Duração do bloco em minutos (padrão: 45)" },
      calendarName: { type: "string", description: "Nome do calendário alvo (padrão: Trabalho)" },
      description: { type: "string", description: "Notas ou detalhes da tarefa" },
    },
    required: ["title", "startDate"],
    additionalProperties: false,
  },
  async run(params) {
    const title = escapeAppleScriptString(params.title);
    const calName = escapeAppleScriptString(params.calendarName || "Trabalho");
    const duration = Number(params.durationMinutes) || 45;
    const notes = escapeAppleScriptString(params.description || "Bloco de foco agendado pelo NEO Agent");

    // Usa JavaScript em runtime Date do Node para calcular a data exata e converter para o formato local
    const startObj = new Date(params.startDate);
    const validDate = isNaN(startObj.getTime()) ? new Date() : startObj;
    const endObj = new Date(validDate.getTime() + duration * 60 * 1000);

    // Formata para string compatível com o AppleScript do sistema
    const formatAppleDate = (d) => {
      const pad = (n) => String(n).padStart(2, "0");
      // Formato ISO simplificado compatível
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const script = `
tell application "Calendar"
  set targetCal to first calendar whose name is "${calName}"
  set startD to (current date)
  -- Configura a data
  set targetEvent to make new event at targetCal with properties {summary:"${title}", description:"${notes}", start date:(date "${validDate.toLocaleString()}"), end date:(date "${endObj.toLocaleString()}")}
  return id of targetEvent
end tell
`;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      return {
        created: true,
        eventId: stdout.trim(),
        title: params.title,
        calendar: params.calendarName || "Trabalho",
        durationMinutes: duration,
        start: validDate.toISOString(),
        end: endObj.toISOString(),
      };
    } catch (err) {
      throw new Error(`Falha ao criar evento no Calendário: ${err.message}`);
    }
  },
});

/**
 * Skill: Lista lembretes pendentes
 */
export const macosListRemindersSkill = defineSkill({
  name: "macos_list_reminders",
  description: "Lista tarefas e lembretes pendentes no app Lembretes do macOS",
  parametersSchema: {
    type: "object",
    properties: {
      listName: { type: "string", description: "Nome da lista (padrão: Lembretes)" },
    },
    additionalProperties: false,
  },
  async run(params) {
    const listName = escapeAppleScriptString(params?.listName || "Lembretes");

    const script = `
tell application "Reminders"
  tell list "${listName}"
    set res to {}
    set uncompleted to (every reminder whose completed is false)
    repeat with r in uncompleted
      set rName to name of r
      set rBody to ""
      try
        if body of r is not missing value then
          set rBody to body of r
        end if
      end try
      set end of res to (rName & "||" & rBody)
    end repeat
    set AppleScript's text item delimiters to "\\n"
    return res as text
  end tell
end tell
`;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      const lines = stdout.trim().split("\n").filter(Boolean);
      const items = lines.map((line) => {
        const [name, body] = line.split("||");
        return { name, body };
      });
      return {
        count: items.length,
        listName: params?.listName || "Lembretes",
        items,
      };
    } catch (err) {
      return {
        count: 0,
        items: [],
        error: err.message,
      };
    }
  },
});

/**
 * Skill: Cria um lembrete no app nativo Lembretes do macOS
 */
export const macosCreateReminderSkill = defineSkill({
  name: "macos_create_reminder",
  description: "Cria um novo lembrete com alarme no app Lembretes do macOS para descarregar a memória de trabalho",
  parametersSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Texto do lembrete" },
      notes: { type: "string", description: "Notas adicionais ou links" },
      listName: { type: "string", description: "Nome da lista de lembretes (padrão: Lembretes)" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async run(params) {
    const title = escapeAppleScriptString(params.title);
    const notes = escapeAppleScriptString(params.notes || "");
    const listName = escapeAppleScriptString(params.listName || "Lembretes");

    const script = `
tell application "Reminders"
  tell list "${listName}"
    set rem to make new reminder with properties {name:"${title}", body:"${notes}"}
    return id of rem
  end tell
end tell
`;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      return {
        created: true,
        reminderId: stdout.trim(),
        title: params.title,
        list: params.listName || "Lembretes",
      };
    } catch (err) {
      throw new Error(`Falha ao criar lembrete: ${err.message}`);
    }
  },
});

/**
 * Skill: Descompressor Cognitivo de Tarefas (Decompõe objetivos grandes em micro-ações com pausas)
 */
export const macosTaskChunkerSkill = defineSkill({
  name: "macos_task_chunker",
  description: "Decompõe uma tarefa complexa de desenvolvimento em micro-passos executáveis de baixo atrito para combater a paralisia executiva",
  parametersSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "Objetivo geral ou tarefa que parece pesada" },
      steps: {
        type: "array",
        items: { type: "string" },
        description: "Lista de micro-ações sequenciais (máximo 4 passos de cada vez)",
      },
      chunkMinutes: { type: "number", description: "Duração de cada bloco de trabalho (padrão: 30)" },
    },
    required: ["goal", "steps"],
    additionalProperties: false,
  },
  async run(params) {
    const chunkMin = Number(params.chunkMinutes) || 30;
    const plan = params.steps.map((step, idx) => ({
      stepNumber: idx + 1,
      action: step,
      estimatedMinutes: chunkMin,
      breakAfterMinutes: idx < params.steps.length - 1 ? 5 : 15,
      rule: "Focar exclusivamente nesta ação. Não abrir outras abas até concluir.",
    }));

    return {
      goal: params.goal,
      totalSteps: plan.length,
      plan,
      guidance: "Execute apenas o Passo 1. Ao terminar, faça a pausa de 5 minutos antes de olhar o Passo 2.",
    };
  },
});

export const MACOS_SKILLS = [
  macosListCalendarEventsSkill,
  macosCreateCalendarEventSkill,
  macosListRemindersSkill,
  macosCreateReminderSkill,
  macosTaskChunkerSkill,
];
