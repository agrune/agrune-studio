import type { ScenarioDefinition } from './contracts';

export const DEMO_URL = 'http://127.0.0.1:4178';

export const DEFAULT_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'manifest-health',
    title: 'Manifest health check',
    intent: 'Verify that the app exposes a usable manifest and that member search remains operable.',
    tags: ['smoke', 'manifest'],
    estimatedMs: 4200,
    steps: [
      { id: 'health-open', kind: 'open', label: 'Open demo workspace', url: DEMO_URL },
      { id: 'health-board', kind: 'expect-target', label: 'Confirm board navigation target', target: 'nav_board_tab' },
      { id: 'health-members', kind: 'click', label: 'Open members', target: 'nav_members_tab' },
      { id: 'health-search-ready', kind: 'expect-target', label: 'Confirm member search target', target: 'member_search_input' },
      { id: 'health-search', kind: 'fill', label: 'Search for Alice', target: 'member_search_input', value: 'Alice Chen' },
      { id: 'health-result', kind: 'expect-text', label: 'Confirm filtered result', value: 'Alice Chen' },
    ],
  },
  {
    id: 'task-entry',
    title: 'Task entry path',
    intent: 'Exercise the first task creation step without mutating the board.',
    tags: ['critical', 'form'],
    estimatedMs: 3600,
    steps: [
      { id: 'task-open', kind: 'open', label: 'Open demo workspace', url: DEMO_URL },
      { id: 'task-board', kind: 'click', label: 'Reset to board', target: 'nav_board_tab' },
      { id: 'task-new', kind: 'click', label: 'Open new task wizard', target: 'board_new_task_button' },
      { id: 'task-title-ready', kind: 'expect-target', label: 'Confirm title field', target: 'wizard_title_input' },
      {
        id: 'task-title',
        kind: 'fill',
        label: 'Enter regression title',
        target: 'wizard_title_input',
        value: 'Regression guardrail check',
      },
      { id: 'task-next-ready', kind: 'expect-target', label: 'Confirm next action', target: 'wizard_next_button' },
      { id: 'task-close', kind: 'click', label: 'Close task wizard', target: 'wizard_close_button' },
    ],
  },
  {
    id: 'navigation-sweep',
    title: 'Workspace navigation sweep',
    intent: 'Traverse the high-level work areas and verify that their manifest routes stay resolvable.',
    tags: ['navigation', 'regression'],
    estimatedMs: 5000,
    steps: [
      { id: 'nav-open', kind: 'open', label: 'Open demo workspace', url: DEMO_URL },
      { id: 'nav-docs', kind: 'click', label: 'Open documents', target: 'nav_docs_tab' },
      { id: 'nav-doc-ready', kind: 'expect-target', label: 'Confirm document controls', target: 'doc_refresh_button' },
      { id: 'nav-workflow', kind: 'click', label: 'Open workflow', target: 'nav_workflow_tab' },
      { id: 'nav-canvas-ready', kind: 'expect-target', label: 'Confirm workflow canvas', target: 'workflow_canvas_pane' },
      { id: 'nav-messenger', kind: 'click', label: 'Open messenger', target: 'nav_messenger_tab' },
      {
        id: 'nav-conversation',
        kind: 'click',
        label: 'Open Alice conversation',
        target: 'messenger_conversations[key=member-1].messenger_conversation',
      },
      { id: 'nav-message-ready', kind: 'expect-target', label: 'Confirm message input', target: 'messenger_input' },
    ],
  },
];
