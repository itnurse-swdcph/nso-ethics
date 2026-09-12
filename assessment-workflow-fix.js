/* Assessment workflow fix
 * Supervisors may evaluate subordinates immediately; self-assessment is not a prerequisite.
 * Also normalizes the supervisor dashboard label to "รอประเมิน".
 */
(function () {
  const originalApi = window.api;
  if (typeof originalApi !== 'function') return;

  window.api = async function (...args) {
    const result = await originalApi.apply(this, args);

    try {
      const action = args[0];
      if (action === 'get_ethics_dashboard' && result && !result.error) {
        // Do not let self-assessment status lock the supervisor's Other assessment.
        // Keep the real self status for reporting, but expose evaluation as available.
        if (Array.isArray(result.evaluateTasks)) {
          result.evaluateTasks = result.evaluateTasks.map(task => ({
            ...task,
            can_evaluate_other: task.status !== 'COMPLETED'
          }));
        }
      }
    } catch (error) {
      console.warn('Assessment workflow normalization failed:', error);
    }

    return result;
  };

  // Replace the legacy label wherever it is rendered in the supervisor status area.
  const replaceLegacyLabel = () => {
    document.querySelectorAll('.badge, button, span').forEach(el => {
      if (el.textContent && el.textContent.includes('รอ Self')) {
        el.innerHTML = el.innerHTML.replaceAll('รอ Self ก่อน', 'รอประเมิน').replaceAll('รอ Self', 'รอประเมิน');
      }
    });
  };

  const observer = new MutationObserver(replaceLegacyLabel);
  const start = () => {
    replaceLegacyLabel();
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
