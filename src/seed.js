// Default data written to data/focusflow.json on first run.
// A clean empty state: only the locked default project, no demo content.
// Returns a fresh deep copy each call so callers can freely mutate it.
export function defaultData() {
  return {
    rev: null, // data-generation token, set by the server when the seed is written
    activeDate: null, // set to todayKey() by the server when the seed is written
    projects: ['未分類'],
    newTaskProj: '未分類',
    currentId: null,
    mode: 'stopwatch',
    elapsed: 0,
    tab: 'notes',
    globalNote: '',
    tasks: [],
    ideas: [],
    replies: [],
    pauses: [],
    history: [],
  };
}
