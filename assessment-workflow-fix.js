/* Assessment workflow fix
 * Supervisors may evaluate subordinates immediately; self-assessment is not a prerequisite.
 * The real self status remains unchanged for reporting.
 */
(function () {
  const originalApi = window.api;
  if (typeof originalApi !== 'function') return;

  window.api = async function (...args) {
    const result = await originalApi.apply(this, args);
    try {
      if (args[0] === 'get_ethics_dashboard' && result && !result.error && Array.isArray(result.evaluateTasks)) {
        result.evaluateTasks = result.evaluateTasks.map(task => ({
          ...task,
          can_evaluate_other: task.status !== 'COMPLETED'
        }));
      }
    } catch (error) {
      console.warn('Assessment workflow normalization failed:', error);
    }
    return result;
  };

  const syncSupervisorStatusUI = () => {
    if (typeof state === 'undefined' || !state.dashboardData) return;
    const tasks = Array.isArray(state.dashboardData.evaluateTasks) ? state.dashboardData.evaluateTasks : [];

    // Update legacy wording.
    document.querySelectorAll('.badge, button, span').forEach(el => {
      if (el.textContent && el.textContent.includes('รอ Self')) {
        el.innerHTML = el.innerHTML.replaceAll('รอ Self ก่อน', 'รอประเมิน').replaceAll('รอ Self', 'รอประเมิน');
      }
    });

    // Existing render logic used self completion as a lock. Replace that disabled
    // button with an enabled Other-assessment button using the real task data.
    document.querySelectorAll('button[disabled]').forEach(button => {
      if (!button.textContent.includes('รอประเมิน') && !button.textContent.includes('รอ Self')) return;
      const row = button.closest('tr');
      if (!row) return;
      const nameCell = row.querySelector('td:nth-child(2) strong');
      const name = nameCell?.textContent?.trim();
      if (!name) return;

      const task = tasks.find(t => (t.target?.full_name || '').trim() === name && t.status !== 'COMPLETED');
      if (!task?.id || !task?.target_user_id) return;

      const targetRole = task.target?.role || 'NURSE';
      const enabled = document.createElement('button');
      enabled.className = 'btn small';
      enabled.type = 'button';
      enabled.innerHTML = '<i class="fa-solid fa-play"></i> เริ่มประเมิน';
      enabled.addEventListener('click', () => {
        if (typeof startAssessment === 'function') {
          startAssessment(task.id, targetRole, 'OTHER', task.target_user_id);
        }
      });
      button.replaceWith(enabled);
    });
  };

  const start = () => {
    syncSupervisorStatusUI();
    const observer = new MutationObserver(() => syncSupervisorStatusUI());
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(syncSupervisorStatusUI, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
