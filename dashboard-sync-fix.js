/* Live dashboard synchronization + supervisor evaluation availability
 * Supervisors can evaluate assigned subordinates immediately; self-assessment
 * is informational and must not block the supervisor's OTHER evaluation.
 */
(function () {
  const REFRESH_MS = 10000;
  let refreshing = false;

  // Normalize dashboard task data so the existing dashboard renderer does not
  // gate OTHER evaluation on the target's SELF status.
  function normalizeSupervisorTasks(res) {
    if (!res || !Array.isArray(res.evaluateTasks)) return res;

    res.evaluateTasks = res.evaluateTasks.map(task => ({
      ...task,
      target_self_done: true,
      target_self_status: 'COMPLETED'
    }));

    return res;
  }

  // The dashboard renderer is already written to show OTHER evaluation when
  // target_self_done is true. Wrapping api() here changes only the dashboard
  // display data; it does not modify or fabricate any saved assessment result.
  const originalApi = window.api;
  if (typeof originalApi === 'function' && !originalApi.__supervisorAvailabilityPatched) {
    const patchedApi = async function (action, payload) {
      const res = await originalApi.apply(this, arguments);
      if (action === 'get_ethics_dashboard' && res && !res.error) {
        return normalizeSupervisorTasks(res);
      }
      return res;
    };
    patchedApi.__supervisorAvailabilityPatched = true;
    window.api = patchedApi;
  }

  async function refreshDashboardSilently() {
    if (refreshing || document.visibilityState !== 'visible') return;
    if (typeof state === 'undefined' || typeof api !== 'function' || typeof renderDashboard !== 'function') return;
    if (state.currentPage !== 'dashboard' || !state.user?.id || state.currentAssessment) return;

    refreshing = true;
    try {
      const res = await api('get_ethics_dashboard', { user_id: state.user.id });
      if (res && !res.error) {
        state.dashboardData = normalizeSupervisorTasks(res);
        if (res.user?.role) state.user.role = res.user.role;
        localStorage.setItem('np_session', JSON.stringify(state.user));
        renderDashboard();
      }
    } catch (error) {
      console.warn('Silent dashboard refresh failed:', error);
    } finally {
      refreshing = false;
    }
  }

  // Replace the old UI wording if it is still rendered by cached/older code.
  function updateWaitingLabels() {
    document.querySelectorAll('button, span, div').forEach(el => {
      if (el.children.length === 0 && /รอ\s*Self\s*ก่อน/i.test(el.textContent || '')) {
        el.textContent = 'รอประเมินตนเอง';
      }
    });
  }

  function start() {
    setInterval(refreshDashboardSilently, REFRESH_MS);
    window.addEventListener('focus', refreshDashboardSilently);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshDashboardSilently();
    });
    updateWaitingLabels();
    const observer = new MutationObserver(updateWaitingLabels);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
