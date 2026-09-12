/* Live dashboard synchronization
 * Keeps supervisor evaluation availability in sync after a staff member
 * completes their self-assessment, without requiring a manual page reload.
 */
(function () {
  const REFRESH_MS = 10000;
  let refreshing = false;

  async function refreshDashboardSilently() {
    if (refreshing || document.visibilityState !== 'visible') return;
    if (typeof state === 'undefined' || typeof api !== 'function' || typeof renderDashboard !== 'function') return;
    if (state.currentPage !== 'dashboard' || !state.user?.id || state.currentAssessment) return;

    refreshing = true;
    try {
      const res = await api('get_ethics_dashboard', { user_id: state.user.id });
      if (res && !res.error) {
        state.dashboardData = res;
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

  function start() {
    setInterval(refreshDashboardSilently, REFRESH_MS);
    window.addEventListener('focus', refreshDashboardSilently);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshDashboardSilently();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
