/* Nursing ethics command structure admin editor */
(function () {
  'use strict';

  const CONFIG = () => window.NURSEPULSE_CONFIG || {};
  const API_URL = () => `${CONFIG().supabaseUrl}/functions/v1/org-structure-api`;

  async function orgApi(action, input = {}) {
    const token = sessionStorage.getItem('np_admin_token') || '';
    const c = CONFIG();
    const res = await fetch(API_URL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': c.supabaseAnonKey || '',
        'Authorization': `Bearer ${c.supabaseAnonKey || ''}`,
        'x-admin-token': token,
      },
      body: JSON.stringify({ action, ...input }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.details || data.error || `HTTP ${res.status}`);
    return data;
  }

  const esc = (v) => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const personName = (p) => p?.full_name || '—';

  function selectHtml(list, selected, placeholder, cls, extra = '') {
    return `<select class="org-select ${cls}" ${extra}>
      <option value="">${esc(placeholder)}</option>
      ${list.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.position ? ` — ${esc(p.position)}` : ''}</option>`).join('')}
    </select>`;
  }

  function ensureStyles() {
    if (document.getElementById('org-structure-admin-style')) return;
    const style = document.createElement('style');
    style.id = 'org-structure-admin-style';
    style.textContent = `
      .org-structure-modal{position:fixed;inset:0;z-index:10000;background:rgba(8,24,38,.58);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}
      .org-structure-card{width:min(1500px,100%);height:min(92vh,900px);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}
      .org-structure-head{padding:18px 22px;border-bottom:1px solid #e5edf2;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      .org-structure-head h2{margin:0;font-size:20px;color:#12364a}.org-structure-head p{margin:4px 0 0;color:#6a7d88;font-size:13px}
      .org-structure-body{padding:16px 18px;overflow:auto;flex:1}.org-structure-table{width:100%;border-collapse:separate;border-spacing:0;min-width:1050px}
      .org-structure-table th{position:sticky;top:0;background:#edf7fa;color:#18485d;text-align:left;padding:11px 10px;border-bottom:2px solid #cfe5eb;font-size:13px;z-index:2}
      .org-structure-table td{padding:9px 10px;border-bottom:1px solid #e7eef1;vertical-align:middle;font-size:13px}.org-structure-table tr:hover td{background:#fbfdfe}
      .org-group{font-weight:700;color:#17485c;min-width:240px}.org-unit{min-width:230px}.org-select{width:100%;min-width:230px;border:1px solid #cbd9df;border-radius:9px;background:#fff;padding:9px 10px;font-family:inherit;font-size:13px;color:#173746}
      .org-save{white-space:nowrap}.org-status{font-size:12px;margin-left:8px}.org-status.ok{color:#087a4b}.org-status.err{color:#b42318}
      .org-toolbar{display:flex;gap:8px;align-items:center}.org-btn{border:0;border-radius:9px;padding:9px 13px;cursor:pointer;font-family:inherit;font-weight:600}.org-btn.primary{background:#0d7892;color:#fff}.org-btn.secondary{background:#edf4f6;color:#234858}.org-btn:disabled{opacity:.55;cursor:wait}
      .org-empty{text-align:center;padding:40px;color:#71838c}.org-note{background:#f7fbfc;border:1px solid #dcecef;border-radius:10px;padding:10px 12px;margin-bottom:12px;color:#526c78;font-size:12px}
      @media(max-width:700px){.org-structure-modal{padding:0}.org-structure-card{height:100vh;border-radius:0}.org-structure-head{padding:14px}.org-structure-body{padding:10px}.org-structure-table{min-width:980px}}
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById('org-structure-modal')?.remove();
  }

  async function renderStructure() {
    ensureStyles();
    closeModal();
    const modal = document.createElement('div');
    modal.id = 'org-structure-modal';
    modal.className = 'org-structure-modal';
    modal.innerHTML = `<div class="org-structure-card">
      <div class="org-structure-head">
        <div><h2><i class="fa-solid fa-sitemap"></i> โครงสร้างสายบังคับบัญชา</h2><p>กำหนดหัวหน้างาน หัวหน้ากลุ่มงาน และหัวหน้าพยาบาล ซึ่งจะมีผลต่อ Flow การประเมินและการติดตามบุคลากร</p></div>
        <div class="org-toolbar"><button class="org-btn secondary" id="org-close"><i class="fa-solid fa-xmark"></i> ปิด</button></div>
      </div>
      <div class="org-structure-body"><div id="org-content">กำลังโหลด...</div></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#org-close').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    try {
      const data = await orgApi('get');
      const rows = data.rows || [];
      const content = modal.querySelector('#org-content');
      if (!rows.length) { content.innerHTML = '<div class="org-empty">ยังไม่มีข้อมูลโครงสร้าง</div>'; return; }
      content.innerHTML = `<div class="org-note"><i class="fa-solid fa-circle-info"></i> การเปลี่ยน <b>หัวหน้ากลุ่มงาน</b> จะมีผลกับทุกหน่วยงานภายในกลุ่มงานนั้น และการเปลี่ยน <b>หัวหน้าพยาบาล</b> จะมีผลกับทั้งโครงสร้างทันที ส่วน <b>หัวหน้างาน</b> มีผลเฉพาะหน่วยงานในแถวนั้น</div>
        <div style="overflow:auto"><table class="org-structure-table"><thead><tr>
          <th>กลุ่มงาน</th><th>ชื่อหน่วยงาน</th><th>หัวหน้างาน</th><th>หัวหน้ากลุ่มงาน</th><th>หัวหน้าพยาบาล</th><th>การดำเนินการ</th>
        </tr></thead><tbody>
          ${rows.map((r, i) => `<tr data-unit="${esc(r.unit_department_id)}" data-index="${i}">
            <td class="org-group">${esc(r.group_department?.name || '—')}</td>
            <td class="org-unit">${esc(r.unit_department?.name || '—')}</td>
            <td>${selectHtml(data.unitHeads, r.unit_head_user_id, '— ไม่กำหนด —', 'org-unit-head')}</td>
            <td>${selectHtml(data.groupHeads, r.group_head_user_id, '— ไม่กำหนด —', 'org-group-head')}</td>
            <td>${selectHtml(data.headNurses, r.head_nurse_user_id, '— ไม่กำหนด —', 'org-head-nurse')}</td>
            <td class="org-save"><button class="org-btn primary org-save-row"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button><span class="org-status"></span></td>
          </tr>`).join('')}
        </tbody></table></div>`;

      content.querySelectorAll('.org-save-row').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tr = btn.closest('tr');
          const status = tr.querySelector('.org-status');
          btn.disabled = true; status.textContent = 'กำลังบันทึก...'; status.className = 'org-status';
          try {
            await orgApi('save', {
              unit_department_id: tr.dataset.unit,
              unit_head_user_id: tr.querySelector('.org-unit-head').value || null,
              group_head_user_id: tr.querySelector('.org-group-head').value || null,
              head_nurse_user_id: tr.querySelector('.org-head-nurse').value || null,
            });
            status.textContent = 'บันทึกแล้ว'; status.className = 'org-status ok';
            // Refresh the table so group/global propagation is immediately visible.
            setTimeout(() => renderStructure(), 350);
          } catch (err) {
            console.error(err); status.textContent = `บันทึกไม่สำเร็จ: ${err.message}`; status.className = 'org-status err'; btn.disabled = false;
          }
        });
      });
    } catch (err) {
      console.error(err);
      modal.querySelector('#org-content').innerHTML = `<div class="org-empty" style="color:#b42318">ไม่สามารถโหลดโครงสร้างได้: ${esc(err.message)}</div>`;
    }
  }

  function injectAdminButton() {
    if (document.getElementById('org-structure-admin-button')) return;
    const candidates = Array.from(document.querySelectorAll('button')).filter(b => (b.textContent || '').includes('จัดการบุคลากร'));
    if (!candidates.length) return;
    const source = candidates[0];
    const btn = source.cloneNode(true);
    btn.id = 'org-structure-admin-button';
    btn.innerHTML = '<i class="fa-solid fa-sitemap"></i> โครงสร้างบังคับบัญชา';
    btn.classList.remove('outline');
    btn.addEventListener('click', renderStructure);
    source.parentElement?.appendChild(btn);
  }

  function boot() {
    const observer = new MutationObserver(() => injectAdminButton());
    observer.observe(document.body, { childList: true, subtree: true });
    injectAdminButton();
    window.renderEthicsOrgStructure = renderStructure;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
