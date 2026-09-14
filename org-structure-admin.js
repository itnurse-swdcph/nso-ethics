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

  function selectHtml(list, selected, placeholder, cls) {
    return `<select class="org-select ${cls}">
      <option value="">${esc(placeholder)}</option>
      ${list.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.position ? ` — ${esc(p.position)}` : ''}</option>`).join('')}
    </select>`;
  }

  function ensureStyles() {
    if (document.getElementById('org-structure-admin-style')) return;
    const style = document.createElement('style');
    style.id = 'org-structure-admin-style';
    style.textContent = `
      /* Full-page editor: no popup/card overlay */
      .org-structure-page{position:fixed;inset:0;z-index:10000;background:#f6fafb;display:flex;flex-direction:column;box-sizing:border-box}
      .org-structure-head{padding:18px 24px;background:#fff;border-bottom:1px solid #e1ebef;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.04)}
      .org-structure-head h2{margin:0;font-size:21px;color:#12364a}.org-structure-head p{margin:5px 0 0;color:#6a7d88;font-size:13px}
      .org-structure-body{padding:18px 22px;overflow:auto;flex:1;min-height:0}.org-structure-table-wrap{overflow:auto;background:#fff;border:1px solid #dfeaec;border-radius:12px}
      .org-structure-table{width:100%;border-collapse:separate;border-spacing:0;min-width:1050px}
      .org-structure-table th{position:sticky;top:0;background:#edf7fa;color:#18485d;text-align:left;padding:11px 10px;border-bottom:2px solid #cfe5eb;font-size:13px;z-index:2}
      .org-structure-table td{padding:9px 10px;border-bottom:1px solid #e7eef1;vertical-align:middle;font-size:13px}.org-structure-table tbody tr:last-child td{border-bottom:0}.org-structure-table tr:hover td{background:#fbfdfe}
      .org-group{font-weight:700;color:#17485c;min-width:240px}.org-unit{min-width:230px}.org-select{width:100%;min-width:230px;border:1px solid #cbd9df;border-radius:9px;background:#fff;padding:9px 10px;font-family:inherit;font-size:13px;color:#173746}
      .org-status{font-size:12px;display:block;margin-top:4px}.org-status.ok{color:#087a4b}.org-status.err{color:#b42318}
      .org-toolbar{display:flex;gap:8px;align-items:center}.org-btn{border:0;border-radius:9px;padding:9px 14px;cursor:pointer;font-family:inherit;font-weight:600}.org-btn.primary{background:#0d7892;color:#fff}.org-btn.secondary{background:#edf4f6;color:#234858}.org-btn:disabled{opacity:.55;cursor:wait}
      .org-empty{text-align:center;padding:40px;color:#71838c}.org-note{background:#f7fbfc;border:1px solid #dcecef;border-radius:10px;padding:10px 12px;margin-bottom:12px;color:#526c78;font-size:12px}
      .org-dirty{background:#fff7df;border:1px solid #f1d38a;color:#73520a;border-radius:9px;padding:7px 10px;font-size:12px;display:none}
      .org-dirty.show{display:inline-flex;align-items:center;gap:6px}
      .org-sidebar-nav-item{width:100%;display:flex;align-items:center;gap:10px;text-align:left;background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;padding:10px 14px;border-radius:10px;margin-top:4px}
      .org-sidebar-nav-item:hover{background:rgba(13,120,146,.10)}.org-sidebar-nav-item .nav-btn-icon{width:20px;text-align:center;flex:0 0 20px}.org-sidebar-nav-item .nav-btn-text{white-space:nowrap}
      @media(max-width:700px){.org-structure-head{padding:14px}.org-structure-body{padding:10px}.org-structure-table{min-width:980px}}
    `;
    document.head.appendChild(style);
  }

  function closePage() {
    document.getElementById('org-structure-page')?.remove();
  }

  function markDirty(page) {
    page.querySelector('#org-dirty').classList.add('show');
    page.querySelector('#org-save-all').disabled = false;
  }

  async function saveAll(page) {
    const rows = Array.from(page.querySelectorAll('tbody tr[data-unit]'));
    const dirty = rows.filter(tr => tr.dataset.original !== JSON.stringify({
      unit_head_user_id: tr.querySelector('.org-unit-head').value || null,
      group_head_user_id: tr.querySelector('.org-group-head').value || null,
      head_nurse_user_id: tr.querySelector('.org-head-nurse').value || null,
    }));
    const button = page.querySelector('#org-save-all');
    const result = page.querySelector('#org-save-result');
    if (!dirty.length) {
      result.textContent = 'ไม่มีรายการที่เปลี่ยนแปลง'; result.className = 'org-status';
      return;
    }
    button.disabled = true;
    result.textContent = `กำลังบันทึก ${dirty.length} หน่วยงาน...`; result.className = 'org-status';
    try {
      let success = 0;
      const errors = [];
      for (const tr of dirty) {
        try {
          await orgApi('save', {
            unit_department_id: tr.dataset.unit,
            unit_head_user_id: tr.querySelector('.org-unit-head').value || null,
            group_head_user_id: tr.querySelector('.org-group-head').value || null,
            head_nurse_user_id: tr.querySelector('.org-head-nurse').value || null,
          });
          tr.dataset.original = JSON.stringify({
            unit_head_user_id: tr.querySelector('.org-unit-head').value || null,
            group_head_user_id: tr.querySelector('.org-group-head').value || null,
            head_nurse_user_id: tr.querySelector('.org-head-nurse').value || null,
          });
          tr.querySelector('.org-status').textContent = 'บันทึกแล้ว';
          tr.querySelector('.org-status').className = 'org-status ok';
          success++;
        } catch (err) {
          errors.push(`${tr.querySelector('.org-unit').textContent.trim()}: ${err.message}`);
          tr.querySelector('.org-status').textContent = `บันทึกไม่สำเร็จ: ${err.message}`;
          tr.querySelector('.org-status').className = 'org-status err';
        }
      }
      if (errors.length) {
        result.textContent = `บันทึกสำเร็จ ${success} รายการ / ไม่สำเร็จ ${errors.length} รายการ`;
        result.className = 'org-status err';
      } else {
        result.textContent = `บันทึกสำเร็จ ${success} หน่วยงาน`;
        result.className = 'org-status ok';
        page.querySelector('#org-dirty').classList.remove('show');
      }
      if (success) setTimeout(() => renderStructure(), 500);
    } finally {
      button.disabled = false;
    }
  }

  async function renderStructure() {
    ensureStyles();
    closePage();
    const page = document.createElement('div');
    page.id = 'org-structure-page';
    page.className = 'org-structure-page';
    page.innerHTML = `<div class="org-structure-head">
      <div><h2><i class="fa-solid fa-sitemap"></i> โครงสร้างสายบังคับบัญชา</h2><p>กำหนดหัวหน้างาน หัวหน้ากลุ่มงาน และหัวหน้าพยาบาล ซึ่งจะมีผลต่อ Flow การประเมินและการติดตามบุคลากร</p></div>
      <div class="org-toolbar">
        <span id="org-dirty" class="org-dirty"><i class="fa-solid fa-pen"></i> มีการแก้ไขที่ยังไม่ได้บันทึก</span>
        <span id="org-save-result" class="org-status"></span>
        <button class="org-btn primary" id="org-save-all"><i class="fa-solid fa-floppy-disk"></i> บันทึกทั้งหมด</button>
        <button class="org-btn secondary" id="org-close"><i class="fa-solid fa-arrow-left"></i> กลับ</button>
      </div>
    </div><div class="org-structure-body"><div id="org-content">กำลังโหลด...</div></div>`;
    document.body.appendChild(page);
    page.querySelector('#org-close').onclick = closePage;
    page.querySelector('#org-save-all').onclick = () => saveAll(page);
    page.querySelector('#org-save-all').disabled = true;

    try {
      const data = await orgApi('get');
      const rows = data.rows || [];
      const content = page.querySelector('#org-content');
      if (!rows.length) { content.innerHTML = '<div class="org-empty">ยังไม่มีข้อมูลโครงสร้าง</div>'; return; }
      content.innerHTML = `<div class="org-note"><i class="fa-solid fa-circle-info"></i> แก้ไขได้หลายหน่วยงานก่อนกด <b>บันทึกทั้งหมด</b> โดยการเปลี่ยน <b>หัวหน้ากลุ่มงาน</b> จะมีผลกับทุกหน่วยงานภายในกลุ่มงานนั้น และการเปลี่ยน <b>หัวหน้าพยาบาล</b> จะมีผลกับทั้งโครงสร้าง ส่วน <b>หัวหน้างาน</b> มีผลเฉพาะหน่วยงานในแถวนั้น</div>
        <div class="org-structure-table-wrap"><table class="org-structure-table"><thead><tr>
          <th>กลุ่มงาน</th><th>ชื่อหน่วยงาน</th><th>หัวหน้างาน</th><th>หัวหน้ากลุ่มงาน</th><th>หัวหน้าพยาบาล</th>
        </tr></thead><tbody>
          ${rows.map((r, i) => `<tr data-unit="${esc(r.unit_department_id)}" data-index="${i}">
            <td class="org-group">${esc(r.group_department?.name || '—')}</td>
            <td class="org-unit">${esc(r.unit_department?.name || '—')}</td>
            <td>${selectHtml(data.unitHeads, r.unit_head_user_id, '— ไม่กำหนด —', 'org-unit-head')}</td>
            <td>${selectHtml(data.groupHeads, r.group_head_user_id, '— ไม่กำหนด —', 'org-group-head')}</td>
            <td>${selectHtml(data.headNurses, r.head_nurse_user_id, '— ไม่กำหนด —', 'org-head-nurse')}</td>
            <td style="display:none"><span class="org-status"></span></td>
          </tr>`).join('')}
        </tbody></table></div>`;

      content.querySelectorAll('select').forEach(select => select.addEventListener('change', () => markDirty(page)));
      content.querySelectorAll('tbody tr[data-unit]').forEach(tr => {
        tr.dataset.original = JSON.stringify({
          unit_head_user_id: tr.querySelector('.org-unit-head').value || null,
          group_head_user_id: tr.querySelector('.org-group-head').value || null,
          head_nurse_user_id: tr.querySelector('.org-head-nurse').value || null,
        });
      });
    } catch (err) {
      console.error(err);
      page.querySelector('#org-content').innerHTML = `<div class="org-empty" style="color:#b42318">ไม่สามารถโหลดโครงสร้างได้: ${esc(err.message)}</div>`;
    }
  }

  function injectAdminSidebarItem() {
    if (document.getElementById('org-structure-sidebar-item')) return;
    const sidebar = document.querySelector('.app-sidebar');
    if (!sidebar) return;
    const labels = Array.from(sidebar.querySelectorAll('.sidebar-nav-label'));
    const adminLabel = labels.find(el => (el.textContent || '').includes('ระบบบริหารจัดการ'));
    if (!adminLabel) return;
    const item = document.createElement('button');
    item.id = 'org-structure-sidebar-item'; item.type = 'button'; item.className = 'nav-btn org-sidebar-nav-item';
    item.innerHTML = '<i class="fa-solid fa-sitemap nav-btn-icon"></i><span class="nav-btn-text">5. โครงสร้างบังคับบัญชา</span>';
    item.title = 'โครงสร้างบังคับบัญชา';
    item.addEventListener('click', () => { closeMobileSidebar(); renderStructure(); });
    let anchor = adminLabel.nextElementSibling;
    while (anchor && !anchor.classList.contains('sidebar-nav-label')) anchor = anchor.nextElementSibling;
    if (anchor) anchor.parentNode.insertBefore(item, anchor); else adminLabel.parentNode.appendChild(item);
  }

  function boot() {
    ensureStyles();
    const observer = new MutationObserver(() => injectAdminSidebarItem());
    observer.observe(document.body, { childList: true, subtree: true });
    injectAdminSidebarItem();
    window.renderEthicsOrgStructure = renderStructure;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
