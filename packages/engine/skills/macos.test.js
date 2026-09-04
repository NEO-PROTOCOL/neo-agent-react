import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillRegistry } from '../SkillRegistry.js';

test('SkillRegistry registra e expõe as skills nativas do macOS', () => {
  const registry = new SkillRegistry();

  assert.equal(registry.has('macos_list_calendar_events'), true);
  assert.equal(registry.has('macos_create_calendar_event'), true);
  assert.equal(registry.has('macos_list_reminders'), true);
  assert.equal(registry.has('macos_create_reminder'), true);
  assert.equal(registry.has('macos_task_chunker'), true);

  const tools = registry.listToolDeclarations([
    'macos_list_calendar_events',
    'macos_create_calendar_event',
    'macos_list_reminders',
    'macos_create_reminder',
    'macos_task_chunker',
  ]);

  assert.equal(tools.length, 5);
  assert.equal(tools[0].name, 'macos_list_calendar_events');
});

test('macos_task_chunker divide objetivos em blocos executáveis', async () => {
  const registry = new SkillRegistry();

  const result = await registry.execute({
    name: 'macos_task_chunker',
    params: {
      goal: 'Implementar autenticação',
      steps: ['Criar schema', 'Configurar handler', 'Validar token'],
      chunkMinutes: 25,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.totalSteps, 3);
  assert.equal(result.data.plan[0].estimatedMinutes, 25);
  assert.equal(result.data.plan[0].breakAfterMinutes, 5);
});
