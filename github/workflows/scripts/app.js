/* NursePulse — Nursing Survey & Quiz Platform */
const levels = {
  head_of_group: 'หัวหน้ากลุ่มงาน',
  head_of_unit: 'หัวหน้างาน',
  practitioner: 'ผู้ปฏิบัติ'
};

const positions = [
  'พยาบาลวิชาชีพ',
  'พนักงานช่วยเหลือคนไข้',
  'พนักงานประจำตึก',
  'พนักงานธุรการ',
  'ผู้ช่วยพยาบาล',
  'อื่นๆ (ระบุ)'
];

const questionTypeLabels = {
  single_choice: 'ตัวเลือกเดียว (Radio)',
  multiple_choice: 'เลือกได้หลายข้อ (Checkbox)',
  short_text: 'คำตอบสั้น (Short text)',
  long_text: 'คำตอบยาว (Long text)',
  rating: 'ระดับคะแนน 1–5 (Rating)',
  dropdown: 'รายการแบบเลื่อนลง (Dropdown)',
  date: 'วันที่ (Date)',
  number: 'ตัวเลข (Number)'
};

const initialSurveys = [];

let surveys = JSON.parse(localStorage.getItem('np_surveys') || 'null') || initialSurveys;
const saveSurveysToLocal = () => localStorage.setItem('np_surveys', JSON.stringify(surveys));

let users = JSON.parse(localStorage.getItem('np_users') || 'null') || [];

let state = {
  currentPage: detectPage(),
  user: JSON.parse(localStorage.getItem('np_session') || 'null'),
  admin: sessionStorage.getItem('np_admin') === 'yes',
  filter: 'all',
  activeSurvey: null,
  answers: {},
  adminTab: 'surveys',
  lastQuizResult: null,
  reportSurveyId: null,
  // Admin User Management State
  userSortKey: 'name',
  userSortDir: 'asc',
  userFilterLevel: 'all',
  userSearchQuery: '',
  userPage: 1,
  userPageSize: 15,
  usersLoading: false,
  // Builder State
  builder: {
    id: null,
    title: '',
    description: '',
    is_quiz: false,
    passing_score: 80,
    is_anonymous: false,
    status: 'published',
    target_levels: ['head_of_group', 'head_of_unit', 'practitioner'],
    questions: [
      {
        id: 'q1',
        text: '',
        type: 'single_choice',
        required: true,
        points: 1,
        correct_answer: '',
        options: ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2']
      }
    ]
  }
};

let cloudResponses = {};
const app = document.querySelector('#app');
const saveUsers = () => localStorage.setItem('np_users', JSON.stringify(users));
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cloudEnabled = () => Boolean(window.NURSEPULSE_CONFIG?.supabaseUrl && window.NURSEPULSE_CONFIG?.supabaseAnonKey);

function detectPage() {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith('login.html')) return 'login';
  if (path.endsWith('dashboard.html')) return 'dashboard';
  if (path.endsWith('survey.html')) return 'survey';
  if (path.endsWith('admin.html')) return 'admin';
  return 'home';
}

async function api(action, input = {}) {
  const c = window.NURSEPULSE_CONFIG;
  const token = sessionStorage.getItem('np_admin_token') || '';
  const headers = {
    'Content-Type': 'application/json',
    'apikey': c.supabaseAnonKey,
    'Authorization': `Bearer ${c.supabaseAnonKey}`
  };
  if (token) headers['x-admin-token'] = token;

  const res = await fetch(`${c.supabaseUrl}/functions/v1/survey-api`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...input })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'api_error');
  }
  return res.json();
}

async function loadCloudData() {
  if (!cloudEnabled() || !state.user?.id) return;
  try {
    const [remoteSurveys, responses] = await Promise.all([
      api('list_surveys', { profile_id: state.user.id }),
      api('get_responses', { profile_id: state.user.id })
    ]);

    if (remoteSurveys && remoteSurveys.length) {
      surveys.length = 0;
      remoteSurveys.forEach(s =>
        surveys.push({
          id: s.id,
          title: s.title,
          description: s.description || '',
          anonymous: s.is_anonymous,
          is_quiz: Boolean(s.is_quiz),
          passing_score: s.passing_score,
          levels: [state.user.level],
          created: new Date(s.created_at).toLocaleDateString('th-TH'),
          status: s.status,
          questions: (s.survey_questions || [])
            .sort((a, b) => a.order_index - b.order_index)
            .map(q => ({
              id: q.id,
              text: q.question_text,
              type: q.question_type === 'rating_scale' ? 'rating' : q.question_type,
              required: q.is_required,
              points: Number(q.points) || 1,
              correct_answer: q.correct_answer || '',
              options: (q.question_options || []).sort((a, b) => a.order_index - b.order_index).map(o => o.option_text)
            }))
        })
      );
      saveSurveysToLocal();
    }

    cloudResponses = {};
    responses.forEach(r => {
      const answers = {};
      (r.response_answers || []).forEach(a => {
        try {
          answers[a.question_id] = JSON.parse(a.answer_text);
        } catch {
          answers[a.question_id] = a.answer_text;
        }
      });
      cloudResponses[r.survey_id] = {
        answers,
        completed: r.status === 'completed',
        score: r.score,
        total_points: r.total_points,
        submittedAt: r.submitted_at
      };
    });
  } catch (e) {
    console.error('Supabase load error', e);
  }
}

async function fetchAdminUsers() {
  if (!cloudEnabled()) return;
  showSkeletonLoading('กำลังโหลดรายชื่อบุคลากร...');
  try {
    const list = await api('admin_list_users');
    if (Array.isArray(list)) {
      users = list;
      saveUsers();
    }
  } catch (e) {
    console.warn('Could not fetch remote users, using cached list:', e);
  } finally {
    hideSkeletonLoading();
    if (state.currentPage === 'admin' && state.adminTab === 'users') render();
  }
}

async function fetchAdminSurveys() {
  if (!cloudEnabled()) return;
  showSkeletonLoading('กำลังโหลดแบบสอบถาม...');
  try {
    const list = await api('admin_list_surveys');
    if (Array.isArray(list) && list.length) {
      surveys = list.map(s => ({
        id: s.id,
        title: s.title,
        description: s.description || '',
        anonymous: Boolean(s.is_anonymous),
        is_quiz: Boolean(s.is_quiz),
        passing_score: s.passing_score,
        levels: (s.survey_target_levels || []).map(t => t.level),
        created: new Date(s.created_at).toLocaleDateString('th-TH'),
        status: s.status,
        response_count: s.response_count || 0,
        questions: (s.survey_questions || [])
          .sort((a, b) => a.order_index - b.order_index)
          .map(q => ({
            id: q.id,
            text: q.question_text,
            type: q.question_type === 'rating_scale' ? 'rating' : q.question_type,
            required: q.is_required,
            points: Number(q.points) || 1,
            correct_answer: q.correct_answer || '',
            options: (q.question_options || []).sort((a, b) => a.order_index - b.order_index).map(o => o.option_text)
          }))
      }));
      saveSurveysToLocal();
      if (state.currentPage === 'admin') render();
    }
  } catch (e) {
    console.warn('Could not fetch admin surveys:', e);
  } finally {
    hideSkeletonLoading();
  }
}

function navTo(url) {
  window.location.href = url;
}

function shell(content) {
  const isUser = Boolean(state.user);
  const isAdmin = Boolean(state.admin);

  return `<div class="shell">
    <header class="topbar">
      <a href="index.html" class="brand" style="text-decoration:none">
        <img class="brand-logo" src="nurse-logo.png" alt="โลโก้ภารกิจด้านการพยาบาล">
        <span>
          <small>ภารกิจด้านการพยาบาล · โรงพยาบาลสมเด็จพระยุพราชสว่างแดนดิน</small>
          ระบบแบบสอบถามและแบบประเมินกลาง
        </span>
      </a>
      <div class="top-actions">
        ${isUser ? `
          <a href="dashboard.html" class="btn outline small" style="text-decoration:none">
            <i class="fa-solid fa-clipboard-user"></i> ${esc(state.user.name.split(' ')[0])}
          </a>
          <button class="btn ghost small" onclick="logout()">
            <i class="fa-solid fa-right-from-bracket"></i> ออกจากระบบ
          </button>
        ` : `
          <a href="login.html" class="btn outline" style="text-decoration:none">
            <i class="fa-solid fa-user"></i> สำหรับบุคลากร
          </a>
        `}
        ${isAdmin ? `
          <a href="admin.html" class="btn ghost small" style="text-decoration:none">
            <i class="fa-solid fa-shield-halved"></i> หน้าแอดมิน
          </a>
        ` : `
          <button class="btn ghost" onclick="adminLogin()">
            <i class="fa-solid fa-user-shield"></i> ผู้ดูแลระบบ
          </button>
        `}
      </div>
    </header>
    ${content}
    <footer class="site-footer">
      <span>&copy; 2026 Developed by <strong>Natnarinthorn</strong> &nbsp;&bull;&nbsp; Nursing Informatics System</span>
    </footer>
  </div>`;
}

// ----------------------------------------------------
// 1. HOME PAGE (index.html)
// ----------------------------------------------------

function renderHome() {
  app.innerHTML = shell(`
    <div class="container hero">
      <section>
        <div class="eyebrow"><i class="fa-solid fa-hospital"></i> ภารกิจด้านการพยาบาล · โรงพยาบาลสมเด็จพระยุพราชสว่างแดนดิน</div>
        <h1>ระบบแบบสอบถาม<br>และแบบประเมินกลาง</h1>
        <p class="lead">ศูนย์รวมแบบสอบถาม แบบประเมิน และแบบทดสอบความรู้สำหรับบุคลากรพยาบาล ใช้งานสะดวก ปลอดภัย คำนวณคะแนนอัตโนมัติ และรองรับทุกอุปกรณ์</p>
        <div class="inline-actions">
          <a href="login.html" class="btn" style="text-decoration:none"><i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบสำหรับบุคลากร</a>
          <a href="admin.html" class="btn outline" style="text-decoration:none"><i class="fa-solid fa-user-shield"></i> เข้าสู่ระบบผู้ดูแล</a>
        </div>
      </section>
      <aside class="hero-card">
        <h2>ครบถ้วนในระบบเดียว</h2>
        <div class="feature">
          <div class="feature-icon"><i class="fa-solid fa-bullseye"></i></div>
          <div>
            <strong>รองรับแบบสอบถาม & แบบทดสอบ</strong><br>
            <span class="muted">สร้างข้อสอบ กำหนดคะแนนรายข้อ และตรวจผลคะแนนได้ทันที</span>
          </div>
        </div>
        <div class="feature">
          <div class="feature-icon"><i class="fa-solid fa-users"></i></div>
          <div>
            <strong>ฐานข้อมูลบุคลากรเชื่อมโยง</strong><br>
            <span class="muted">จัดการรายชื่อ ค้นหา และจัดเรียงข้อมูลได้อย่างสะดวก</span>
          </div>
        </div>
        <div class="feature">
          <div class="feature-icon"><i class="fa-solid fa-shield-halved"></i></div>
          <div>
            <strong>คุ้มครองข้อมูลผู้ตอบ</strong><br>
            <span class="muted">เลือกได้ทั้งแบบระบุชื่อและแบบไม่เปิดเผยตัวตนตามมาตรฐาน</span>
          </div>
        </div>
      </aside>
    </div>
  `);
}

// ----------------------------------------------------
// 2. LOGIN PAGE (login.html)
// ----------------------------------------------------

function renderLogin() {
  app.innerHTML = shell(`
    <div class="container">
      <section class="card login">
        <div class="eyebrow"><i class="fa-solid fa-user"></i> สำหรับบุคลากร</div>
        <h2>ค้นหาชื่อเพื่อเข้าสู่ระบบ</h2>
        <p class="muted">เลือกชื่อของคุณจากฐานข้อมูลบุคลากรพยาบาล</p>
        <div class="field">
          <label>ชื่อ-นามสกุล</label>
          <div style="position:relative">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input id="userSearch" oninput="findUsers()" placeholder="พิมพ์ชื่อเพื่อค้นหา เช่น สมชาย, อรทัย..." autocomplete="off" style="padding-left:34px;width:100%" />
          </div>
        </div>
        <div id="searchResults" class="survey-grid"></div>
        <div class="notice"><i class="fa-solid fa-circle-info"></i> ค้นหาชื่อไม่พบ? คุณสามารถเพิ่มข้อมูลตนเองได้ทันที โดยข้อมูลจะถูกส่งให้ผู้ดูแลระบบตรวจสอบ</div>
        <div class="footer-actions">
          <a href="index.html" class="btn outline" style="text-decoration:none"><i class="fa-solid fa-arrow-left"></i> กลับหน้าแรก</a>
          <button class="btn" onclick="showRegister()"><i class="fa-solid fa-user-plus"></i> เพิ่มชื่อของฉัน</button>
        </div>
      </section>
    </div>
  `);
}

async function findUsers() {
  let q = document.querySelector('#userSearch').value.toLowerCase().trim();
  let result = [];
  if (q.length >= 2) {
    try {
      if (cloudEnabled()) {
        const cloudData = await api('search_profiles', { query: q });
        result = cloudData.map(u => ({
          id: u.id,
          name: u.full_name,
          position: u.position,
          level: u.level,
          department: u.departments?.name || ''
        }));
        result.forEach(u => {
          if (!users.some(x => x.id === u.id)) users.push(u);
        });
        saveUsers();
      } else {
        result = users.filter(u => u.name.toLowerCase().includes(q));
      }
    } catch {
      result = users.filter(u => u.name.toLowerCase().includes(q));
    }
  }

  const container = document.querySelector('#searchResults');
  if (!container) return;
  container.innerHTML =
    result
      .map(
        u => `
      <div class="survey-card">
        <div class="survey-main">
          <strong>${esc(u.name)}</strong>
          <div class="survey-meta">
            <span class="badge-level">${esc(levels[u.level] || u.level)}</span>
            <span><i class="fa-solid fa-user-doctor"></i> ${esc(u.position)}</span>
            <span><i class="fa-solid fa-hospital-user"></i> ${esc(u.department)}</span>
          </div>
        </div>
        <button class="btn small" onclick="enterUser('${u.id}')"><i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ</button>
      </div>`
      )
      .join('') || (q.length >= 2 ? '<p class="muted" style="text-align:center;padding:12px">ไม่พบรายชื่อที่ค้นหา</p>' : '');
}

async function enterUser(id) {
  state.user = users.find(x => x.id === id) || state.user;
  if (!state.user && cloudEnabled()) {
    try {
      const found = await api('search_profiles', { query: '' });
      state.user = found.find(x => x.id === id);
    } catch (e) {}
  }
  localStorage.setItem('np_session', JSON.stringify(state.user));
  const redirect = sessionStorage.getItem('np_redirect');
  if (redirect) {
    sessionStorage.removeItem('np_redirect');
    navTo(redirect);
  } else {
    navTo('dashboard.html');
  }
}

function showRegister() {
  modal(
    'เพิ่มข้อมูลบุคลากร',
    `
    <div class="field"><label>ชื่อ-นามสกุล *</label><input id="newName" placeholder="เช่น นางสาวใจดี มีสุข"/></div>
    <div class="field"><label>ตำแหน่ง *</label><select id="newPos">${positions.map(x => `<option>${x}</option>`).join('')}</select></div>
    <div class="field"><label>ระดับ *</label><select id="newLevel">${Object.entries(levels).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field"><label>หน่วยงาน / หอผู้ป่วย *</label><input id="newDept" placeholder="เช่น หอผู้ป่วยอายุรกรรม"/></div>
  `,
    `<button class="btn" onclick="registerUser()"><i class="fa-solid fa-check"></i> บันทึกและเข้าสู่ระบบ</button>`
  );
}

async function registerUser() {
  let name = document.querySelector('#newName').value.trim();
  let department = document.querySelector('#newDept').value.trim();
  if (!name || !department) return toast('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');

  let u = {
    id: 'u_' + Date.now(),
    name,
    position: document.querySelector('#newPos').value,
    level: document.querySelector('#newLevel').value,
    department,
    is_self_registered: true
  };

  try {
    if (cloudEnabled()) {
      const r = await api('register_profile', {
        full_name: name,
        position: u.position,
        level: u.level,
        department
      });
      u = {
        id: r.id,
        name: r.full_name,
        position: r.position,
        level: r.level,
        department: r.departments?.name || department,
        is_self_registered: true
      };
    }
    users.unshift(u);
    saveUsers();
    closeModal();
    state.user = u;
    localStorage.setItem('np_session', JSON.stringify(u));
    toast('ลงทะเบียนและเข้าสู่ระบบสำเร็จ');
    const redirect = sessionStorage.getItem('np_redirect');
    if (redirect) {
      sessionStorage.removeItem('np_redirect');
      navTo(redirect);
    } else {
      navTo('dashboard.html');
    }
  } catch (e) {
    toast('ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่');
  }
}

// ----------------------------------------------------
// 3. DASHBOARD PAGE (dashboard.html)
// ----------------------------------------------------

function surveyStatus(s) {
  let d = cloudResponses[s.id] || JSON.parse(localStorage.getItem(`np_response_${state.user?.id}_${s.id}`) || 'null');
  return d?.completed ? 'done' : d?.answers && Object.keys(d.answers).length ? 'progressing' : 'pending';
}

function targetSurveys() {
  if (cloudEnabled()) return surveys;
  return surveys.filter(s => s.status === 'published' && (!s.levels || s.levels.includes(state.user?.level)));
}

function renderDashboard() {
  if (!state.user) {
    navTo('login.html');
    return;
  }

  let all = targetSurveys();
  let ss = all.filter(s => state.filter === 'all' || surveyStatus(s) === state.filter);
  let labels = {
    all: 'แบบสอบถามและแบบทดสอบทั้งหมด',
    done: 'รายการที่ทำสำเร็จแล้ว',
    progressing: 'รายการที่กำลังทำอยู่',
    pending: 'รายการที่รอดำเนินการ',
    settings: 'ตั้งค่าบัญชี'
  };

  let content = state.filter === 'settings' ? settingsView() : `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-hospital-user"></i> ${esc(state.user.department || 'ภารกิจด้านการพยาบาล')}</div>
        <h2>${labels[state.filter]}</h2>
        <p class="muted">มี ${ss.length} รายการสำหรับระดับ ${esc(levels[state.user.level] || state.user.level)}</p>
      </div>
    </div>
    <div class="survey-grid">
      ${ss.map(s => surveyCard(s)).join('') || '<div class="empty"><i class="fa-regular fa-folder-open" style="font-size:32px;display:block;margin-bottom:8px"></i>ไม่มีรายการในหมวดนี้</div>'}
    </div>
  `;

  app.innerHTML = shell(`
    <div class="container dashboard">
      <!-- Fixed / Sticky Left Sidebar -->
      <aside class="sidebar">
        <div class="user-chip">
          <div class="avatar">${state.user.name.slice(0, 1)}</div>
          <strong>${esc(state.user.name)}</strong><br>
          <small class="muted">${esc(levels[state.user.level] || state.user.level)}</small>
          <div style="clear:both"></div>
        </div>
        ${Object.entries(labels).map(([k, v]) => `
          <button class="nav-button ${state.filter === k ? 'active' : ''}" onclick="setFilter('${k}')">${v}</button>
        `).join('')}
        <button class="nav-button signout" onclick="logout()"><i class="fa-solid fa-right-from-bracket"></i> ออกจากระบบ</button>
      </aside>
      <section>${content}</section>
    </div>
  `);
}

function surveyCard(s) {
  let st = surveyStatus(s);
  let statusBadge = {
    pending: ['ยังไม่ตอบ', 'pending'],
    progressing: ['ตอบยังไม่เสร็จ', 'progressing'],
    done: ['ตอบแล้ว', 'done']
  }[st];

  let savedData = cloudResponses[s.id] || JSON.parse(localStorage.getItem(`np_response_${state.user?.id}_${s.id}`) || 'null');
  let scoreBadge = '';
  if (s.is_quiz && savedData?.completed && savedData?.score !== undefined && savedData?.score !== null) {
    let total = savedData.total_points || s.questions.reduce((acc, q) => acc + (Number(q.points) || 1), 0);
    let pct = total > 0 ? Math.round((savedData.score / total) * 100) : 0;
    let isPass = s.passing_score ? pct >= s.passing_score : true;
    scoreBadge = `<span class="badge ${isPass ? 'done' : 'closed'}" style="margin-left:6px"><i class="fa-solid ${isPass ? 'fa-check' : 'fa-xmark'}"></i> คะแนน: ${savedData.score}/${total} (${pct}%) ${isPass ? 'ผ่าน' : 'ไม่ผ่าน'}</span>`;
  }

  return `
    <article class="survey-card">
      <div class="survey-main">
        <h3 style="margin:0 0 8px">${esc(s.title)}</h3>
        <div class="survey-meta">
          <span><i class="fa-solid fa-users"></i> ${s.levels && s.levels.length ? s.levels.map(x => levels[x] || x).join(', ') : 'ทุกคน'}</span>
          <span><i class="fa-solid fa-check-to-slot"></i> ผู้ตอบ ${s.response_count || 0} คน</span>
        </div>
      </div>
      ${st !== 'done'
        ? `<a href="survey.html?id=${s.id}" class="btn small" style="text-decoration:none"><i class="fa-solid ${st === 'progressing' ? 'fa-pen' : 'fa-play'}"></i> ${st === 'progressing' ? 'ทำต่อ' : s.is_quiz ? 'เริ่มแบบทดสอบ' : 'ตอบแบบสอบถาม'}</a>`
        : `<a href="survey.html?id=${s.id}" class="btn small outline" style="text-decoration:none"><i class="fa-solid fa-eye"></i> ดูผล</a>`}
    </article>
  `;
}

function settingsView() {
  return `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-gear"></i> บัญชีของฉัน</div>
        <h2>ตั้งค่าบัญชี</h2>
      </div>
    </div>
    <div class="card">
      <div class="field"><label>ชื่อ-นามสกุล</label><input id="editName" value="${esc(state.user.name)}"></div>
      <div class="field"><label>ตำแหน่ง</label><select id="editPos">${positions.map(x => `<option ${x === state.user.position ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>ระดับ</label><select id="editLevel">${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${k === state.user.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>หน่วยงาน / หอผู้ป่วย</label><input id="editDept" value="${esc(state.user.department)}"></div>
      <button class="btn" onclick="saveProfile()"><i class="fa-solid fa-floppy-disk"></i> บันทึกการเปลี่ยนแปลง</button>
    </div>
  `;
}

// ----------------------------------------------------
// 4. SURVEY / QUIZ PAGE (survey.html)
// ----------------------------------------------------

function renderSurveyPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const surveyId = urlParams.get('id');
  state.activeSurvey = surveys.find(s => s.id === surveyId) || surveys[0];

  if (!state.activeSurvey) {
    navTo('dashboard.html');
    return;
  }

  if (!state.user) {
    sessionStorage.setItem('np_redirect', window.location.href);
    navTo('login.html');
    return;
  }

  let saved = cloudResponses[state.activeSurvey.id] || JSON.parse(localStorage.getItem(`np_response_${state.user?.id}_${state.activeSurvey.id}`) || '{}');
  state.answers = saved.answers || {};

  let s = state.activeSurvey;
  let done = surveyStatus(s) === 'done';
  let totalPoints = s.questions.reduce((acc, q) => acc + (Number(q.points) || 1), 0);
  let savedData = cloudResponses[s.id] || JSON.parse(localStorage.getItem(`np_response_${state.user?.id}_${s.id}`) || 'null');

  let resultBanner = '';
  if (s.is_quiz && done && savedData?.score !== undefined && savedData?.score !== null) {
    let score = savedData.score;
    let total = savedData.total_points || totalPoints;
    let pct = total > 0 ? Math.round((score / total) * 100) : 0;
    let pass = s.passing_score ? pct >= s.passing_score : true;

    resultBanner = `
      <div class="quiz-result-banner">
        <span class="quiz-status-pill ${pass ? 'pass' : 'fail'}">
          <i class="fa-solid ${pass ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${pass ? 'ผ่านเกณฑ์การทดสอบ' : 'ยังไม่ผ่านเกณฑ์การทดสอบ'}
        </span>
        <div class="quiz-score-circle">
          <span class="score-val">${score}</span>
          <span class="score-sub">/ ${total} คะแนน</span>
        </div>
        <p style="margin:0;font-size:16px">คิดเป็น <strong>${pct}%</strong> (เกณฑ์ผ่าน: ${s.passing_score || 0}%)</p>
      </div>
    `;
  }

  app.innerHTML = shell(`
    <div class="container survey-form">
      <a href="dashboard.html" class="btn ghost small" style="text-decoration:none"><i class="fa-solid fa-arrow-left"></i> กลับรายการแบบสอบถาม</a>
      <div class="form-top" style="margin-top:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div class="eyebrow"><i class="fa-solid ${s.anonymous ? 'fa-lock' : 'fa-user'}"></i> ${s.anonymous ? 'ไม่ระบุชื่อผู้ตอบ' : 'ระบุชื่อผู้ตอบ'}</div>
          ${s.is_quiz ? `<span class="quiz-badge"><i class="fa-solid fa-bullseye"></i> แบบทดสอบ (${totalPoints} คะแนน)</span>` : ''}
        </div>
        <h2>${esc(s.title)}</h2>
        <div class="muted rte-content" style="margin-top:8px">${s.description || ''}</div>
        <div class="progress-line"><span style="width:${(Object.keys(state.answers).length / (s.questions.length || 1)) * 100}%"></span></div>
      </div>
      ${resultBanner}
      ${s.questions.map((q, i) => questionHTML(q, i, done, s.is_quiz)).join('')}
      <div class="footer-actions">
        ${!done ? `
          <button class="btn outline" onclick="saveProgress()"><i class="fa-solid fa-floppy-disk"></i> บันทึกร่าง</button>
          <button class="btn" onclick="submitSurvey()"><i class="fa-solid fa-paper-plane"></i> ${s.is_quiz ? 'ส่งคำตอบแบบทดสอบ' : 'ส่งคำตอบ'}</button>
        ` : `
          <a href="dashboard.html" class="btn outline" style="text-decoration:none"><i class="fa-solid fa-house"></i> กลับหน้าหลัก</a>
          <span class="badge done"><i class="fa-solid fa-circle-check"></i> ส่งคำตอบเรียบร้อยแล้ว</span>
        `}
      </div>
    </div>
  `);
}

function questionHTML(q, i, done, isQuiz) {
  let v = state.answers[q.id] || '';
  let dis = done ? 'disabled' : '';
  let qPoints = Number(q.points) || 1;

  let field = '';
  if (q.type === 'long_text') {
    field = `<textarea ${dis} oninput="answer('${q.id}',this.value)" placeholder="พิมพ์คำตอบของคุณ">${esc(v)}</textarea>`;
  } else if (q.type === 'short_text' || q.type === 'number') {
    field = `<input ${dis} type="${q.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" oninput="answer('${q.id}',this.value)" placeholder="พิมพ์คำตอบของคุณ">`;
  } else if (q.type === 'rating') {
    field = `
      <div class="scale">${[1, 2, 3, 4, 5].map(n => `<button ${dis} class="${+v === n ? 'selected' : ''}" onclick="answer('${q.id}',${n})">${n}</button>`).join('')}</div>
      <small class="muted">1 = น้อยที่สุด &nbsp; 5 = มากที่สุด</small>
    `;
  } else if (q.type === 'multiple_choice') {
    field = (q.options || []).map(o => `
      <label class="choice">
        <input ${dis} type="checkbox" ${Array.isArray(v) && v.includes(o) ? 'checked' : ''} onchange="toggleAnswer('${q.id}','${esc(o)}',this.checked)">
        <span>${esc(o)}</span>
      </label>
    `).join('');
  } else if (q.type === 'dropdown') {
    field = `
      <select ${dis} onchange="answer('${q.id}',this.value)">
        <option value="">-- กรุณาเลือกคำตอบ --</option>
        ${(q.options || []).map(o => `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    `;
  } else {
    // single_choice
    field = (q.options || []).map(o => `
      <label class="choice">
        <input ${dis} type="radio" name="${q.id}" ${v === o ? 'checked' : ''} onchange="answer('${q.id}','${esc(o)}')">
        <span>${esc(o)}</span>
      </label>
    `).join('');
  }

  // If already done and it was a quiz with correct answer, show check review
  let answerReview = '';
  if (done && isQuiz && q.correct_answer) {
    let isCorrect = String(v).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
    answerReview = `
      <div style="margin-top:12px;padding:10px 14px;border-radius:8px;font-size:13px;background:${isCorrect ? '#def7ec' : '#fde8e8'};color:${isCorrect ? '#03543f' : '#9b1c1c'}">
        <strong><i class="fa-solid ${isCorrect ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isCorrect ? `ถูกต้อง (+${qPoints} คะแนน)` : `ไม่ถูกต้อง (0 คะแนน)`}</strong>
        ${!isCorrect ? `<div style="margin-top:4px">เฉลยคำตอบที่ถูกต้อง: <b>${esc(q.correct_answer)}</b></div>` : ''}
      </div>
    `;
  }

  return `
    <section class="card question">
      <div class="question-title" style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div>
          ${i + 1}. ${esc(q.text)} ${q.required ? '<span class="required">*</span>' : ''}
        </div>
        ${isQuiz ? `<span class="q-points-badge"><i class="fa-solid fa-star"></i> ${qPoints} คะแนน</span>` : ''}
      </div>
      ${field}
      ${answerReview}
    </section>
  `;
}

function answer(id, val) {
  state.answers[id] = val;
  renderSurveyPage();
}

function toggleAnswer(id, val, on) {
  let a = Array.isArray(state.answers[id]) ? state.answers[id] : [];
  state.answers[id] = on ? [...a, val] : a.filter(x => x !== val);
  renderSurveyPage();
}

async function saveProgress() {
  try {
    if (cloudEnabled() && state.user?.id) {
      await api('save_response', {
        profile_id: state.user.id,
        survey_id: state.activeSurvey.id,
        answers: state.answers,
        completed: false
      });
      cloudResponses[state.activeSurvey.id] = { answers: state.answers, completed: false };
    } else {
      localStorage.setItem(
        `np_response_${state.user?.id}_${state.activeSurvey.id}`,
        JSON.stringify({ answers: state.answers, completed: false, updatedAt: new Date().toISOString() })
      );
    }
    toast('บันทึกร่างคำตอบแล้ว');
  } catch {
    toast('บันทึกร่างไม่สำเร็จ');
  }
}

async function submitSurvey() {
  let s = state.activeSurvey;
  let missing = s.questions.filter(q => q.required && (!state.answers[q.id] || (Array.isArray(state.answers[q.id]) && !state.answers[q.id].length)));
  if (missing.length) return toast('กรุณาตอบคำถามที่มีเครื่องหมาย * ให้ครบ');

  showSkeletonLoading('กำลังส่งคำตอบ...');
  let earnedScore = 0;
  let totalScore = s.questions.reduce((acc, q) => acc + (Number(q.points) || 1), 0);

  if (s.is_quiz) {
    s.questions.forEach(q => {
      let qPts = Number(q.points) || 1;
      let userAns = state.answers[q.id];
      if (q.correct_answer && userAns !== undefined && userAns !== null && userAns !== '') {
        if (String(userAns).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) {
          earnedScore += qPts;
        }
      }
    });
  }

  try {
    if (cloudEnabled() && state.user?.id) {
      const res = await api('save_response', {
        profile_id: state.user.id,
        survey_id: s.id,
        answers: state.answers,
        completed: true
      });
      cloudResponses[s.id] = {
        answers: state.answers,
        completed: true,
        score: res.score ?? earnedScore,
        total_points: res.total_points ?? totalScore,
        submittedAt: new Date().toISOString()
      };
    } else {
      cloudResponses[s.id] = {
        answers: state.answers,
        completed: true,
        score: earnedScore,
        total_points: totalScore,
        submittedAt: new Date().toISOString()
      };
      localStorage.setItem(
        `np_response_${state.user?.id}_${s.id}`,
        JSON.stringify(cloudResponses[s.id])
      );
    }

    if (s.is_quiz) {
      let pct = totalScore > 0 ? Math.round((earnedScore / totalScore) * 100) : 0;
      toast(`ส่งแบบทดสอบเรียบร้อย คุณได้ ${earnedScore}/${totalScore} คะแนน (${pct}%)`);
    } else {
      toast('ส่งคำตอบเรียบร้อย ขอขอบคุณสำหรับข้อมูลครับ');
    }
    renderSurveyPage();
  } catch (e) {
    toast('ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  } finally {
    hideSkeletonLoading();
  }
}

// ----------------------------------------------------
// 5. ADMIN MANAGEMENT HUB (admin.html)
// ----------------------------------------------------

function renderAdmin() {
  if (!state.admin) {
    adminLogin();
    return;
  }

  // Handle URL hash tab
  if (window.location.hash) {
    const hash = window.location.hash.replace('#', '');
    if (['surveys', 'builder', 'users', 'reports'].includes(hash)) {
      state.adminTab = hash;
    }
  }

  let main = '';
  if (state.adminTab === 'builder') main = adminBuilder();
  else if (state.adminTab === 'reports') main = adminReports();
  else if (state.adminTab === 'users') main = adminUsers();
  else main = adminSurveys();

  app.innerHTML = shell(`
    <div class="container dashboard admin-layout">
      <!-- Fixed / Sticky Left Sidebar -->
      <aside class="sidebar">
        <div class="user-chip">
          <div class="avatar"><i class="fa-solid fa-user-shield"></i></div>
          <strong>ผู้ดูแลระบบ</strong><br>
          <small class="muted">ภารกิจด้านการพยาบาล</small>
          <div style="clear:both"></div>
        </div>
        <div class="nav-label">การจัดการ</div>
        <button class="nav-button ${state.adminTab === 'surveys' ? 'active' : ''}" onclick="switchAdminTab('surveys')">
          <i class="fa-solid fa-clipboard-list" style="margin-right:8px;width:16px"></i> แบบสอบถาม / แบบทดสอบ
        </button>
        <button class="nav-button ${state.adminTab === 'builder' ? 'active' : ''}" onclick="switchAdminTab('builder')">
          <i class="fa-solid fa-circle-plus" style="margin-right:8px;width:16px"></i> สร้างรายการใหม่
        </button>
        <button class="nav-button ${state.adminTab === 'users' ? 'active' : ''}" onclick="switchAdminTab('users')">
          <i class="fa-solid fa-users-gear" style="margin-right:8px;width:16px"></i> จัดการผู้ใช้งาน (บุคลากร)
        </button>
        <div class="nav-label">รายงาน</div>
        <button class="nav-button ${state.adminTab === 'reports' ? 'active' : ''}" onclick="switchAdminTab('reports')">
          <i class="fa-solid fa-chart-pie" style="margin-right:8px;width:16px"></i> สรุปผลและคะแนน
        </button>
        <button class="nav-button signout" onclick="adminLogout()">
          <i class="fa-solid fa-right-from-bracket" style="margin-right:8px;width:16px"></i> ออกจากระบบ
        </button>
      </aside>
      <section class="admin-content">${main}</section>
    </div>
  `);
}

function switchAdminTab(tab) {
  state.adminTab = tab;
  window.location.hash = tab;
  renderAdmin();
  if (tab === 'users') fetchAdminUsers();
  if (tab === 'surveys' || tab === 'reports') fetchAdminSurveys();
}

function adminSurveys() {
  return `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-list-check"></i> จัดการแบบสอบถามและแบบทดสอบ</div>
        <h2>รายการแบบสอบถาม / แบบทดสอบกลาง</h2>
        <p class="muted">สร้าง เผยแพร่ และติดตามแบบประเมินและแบบทดสอบความรู้</p>
      </div>
      <div class="inline-actions">
        <button class="btn outline" onclick="fetchAdminSurveys()"><i class="fa-solid fa-arrows-rotate"></i> รีเฟรช</button>
        <button class="btn outline" onclick="downloadTemplate()"><i class="fa-solid fa-file-arrow-down"></i> ดาวน์โหลดเทมเพลต CSV</button>
        <button class="btn" onclick="startNewSurvey()"><i class="fa-solid fa-plus"></i> สร้างรายการใหม่</button>
      </div>
    </div>

    <div class="upload-guide card">
      <div>
        <h3><i class="fa-solid fa-file-import"></i> นำเข้าคำถามด้วย CSV</h3>
        <p class="muted">เลือกไฟล์ CSV ที่เตรียมตามเทมเพลต แล้วตรวจสอบรายการก่อนบันทึก</p>
      </div>
      <div class="guide-steps">
        <span><b>1</b> ดาวน์โหลดเทมเพลต</span>
        <span><b>2</b> กรอกคำถาม</span>
        <span><b>3</b> อัปโหลด CSV</span>
      </div>
      <div class="field">
        <label>เลือกไฟล์ CSV</label>
        <input type="file" accept=".csv" onchange="importCSV(this)">
      </div>
      <details>
        <summary><i class="fa-solid fa-circle-question"></i> ดูคู่มือรูปแบบไฟล์ CSV</summary>
        <div class="csv-help">
          <p>หนึ่งแถวต่อหนึ่งคำถาม โดยใช้คอลัมน์ <code>order</code>, <code>question_text</code>, <code>question_type</code>, <code>options</code>, <code>is_required</code>, <code>points</code>, <code>correct_answer</code></p>
          <ul>
            <li><b>question_type:</b> single_choice, multiple_choice, short_text, long_text, rating_scale, dropdown, date, number</li>
            <li><b>options:</b> ใส่ตัวเลือกคั่นด้วยเครื่องหมาย <code>;</code> เช่น ตัวเลือก A;ตัวเลือก B;ตัวเลือก C</li>
            <li><b>points:</b> คะแนนสำหรับข้อนั้น (สำหรับแบบทดสอบ)</li>
            <li><b>correct_answer:</b> เฉลยคำตอบที่ถูกต้อง</li>
          </ul>
        </div>
      </details>
    </div>

    <div class="survey-grid" style="margin-top:18px">
      ${surveys.map(s => `
        <article class="survey-card">
          <div class="survey-main">
            <h3 style="margin:0 0 8px">${esc(s.title)}</h3>
            <div class="survey-meta">
              <span><i class="fa-solid fa-users"></i> ${s.levels ? s.levels.map(x => levels[x] || x).join(', ') : 'ทุกคน'}</span>
              <span><i class="fa-solid fa-check-to-slot"></i> ผู้ตอบ ${s.response_count || 0} คน</span>
            </div>
          </div>
          <div class="inline-actions">
            <button class="btn small" onclick="shareSurvey('${s.id}')"><i class="fa-solid fa-share-nodes"></i> เผยแพร่</button>
            <button class="btn small outline" onclick="editSurveyInBuilder('${s.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
            <button class="btn small outline" onclick="viewSurveyReport('${s.id}')"><i class="fa-solid fa-chart-column"></i> รายงาน</button>
            <button class="btn small danger" onclick="deleteSurvey('${s.id}')"><i class="fa-solid fa-trash-can"></i> ลบ</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

// ----------------------------------------------------
// USER MANAGEMENT WITH SORTING & DB SYNC
// ----------------------------------------------------

function adminUsers() {
  let list = [...users];

  // 1. Filter by Level
  if (state.userFilterLevel !== 'all') {
    list = list.filter(u => u.level === state.userFilterLevel);
  }

  // 2. Filter by Search Query
  if (state.userSearchQuery.trim()) {
    let q = state.userSearchQuery.toLowerCase().trim();
    list = list.filter(u =>
      [u.name, u.position, u.department, levels[u.level] || '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }

  // 3. Sort Users List
  const key = state.userSortKey;
  const dir = state.userSortDir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    let valA = a[key] || '';
    let valB = b[key] || '';

    if (key === 'level') {
      const rank = { head_of_group: 1, head_of_unit: 2, practitioner: 3 };
      valA = rank[a.level] || 99;
      valB = rank[b.level] || 99;
      return (valA - valB) * dir;
    }

    if (key === 'is_self_registered') {
      return (Boolean(a.is_self_registered) === Boolean(b.is_self_registered) ? 0 : a.is_self_registered ? 1 : -1) * dir;
    }

    if (typeof valA === 'string') {
      return valA.localeCompare(valB, 'th') * dir;
    }
    return (valA > valB ? 1 : valA < valB ? -1 : 0) * dir;
  });

  // 4. Pagination
  const totalCount = list.length;
  const pageSize = state.userPageSize === 'all' ? totalCount || 1 : Number(state.userPageSize);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  if (state.userPage > totalPages) state.userPage = totalPages;
  const startIdx = (state.userPage - 1) * pageSize;
  const pageItems = state.userPageSize === 'all' ? list : list.slice(startIdx, startIdx + pageSize);

  const getSortIcon = colKey => {
    if (state.userSortKey !== colKey) return '<i class="fa-solid fa-sort sort-indicator inactive"></i>';
    return state.userSortDir === 'asc'
      ? '<i class="fa-solid fa-sort-up sort-indicator"></i>'
      : '<i class="fa-solid fa-sort-down sort-indicator"></i>';
  };

  return `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-users"></i> ข้อมูลบุคลากรพยาบาล</div>
        <h2>จัดการผู้ใช้งาน (บุคลากร)</h2>
        <p class="muted">ดึงข้อมูลและเชื่อมโยงกับฐานข้อมูล Supabase สามารถค้นหา จัดเรียง และแก้ไขข้อมูลได้</p>
      </div>
      <div class="inline-actions">
        <button class="btn outline" onclick="fetchAdminUsers()"><i class="fa-solid fa-arrows-rotate"></i> ดึงข้อมูลจากฐานข้อมูล</button>
        <button class="btn" onclick="showAdminUserForm()"><i class="fa-solid fa-user-plus"></i> เพิ่มผู้ใช้งานใหม่</button>
      </div>
    </div>

    <div class="card users-card">
      <div class="user-toolbar">
        <div class="user-toolbar-left">
          <div class="search-box">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input
              id="adminUserSearch"
              value="${esc(state.userSearchQuery)}"
              oninput="handleUserSearch(this.value)"
              placeholder="ค้นหาชื่อ, ตำแหน่ง, หน่วยงาน..."
            />
          </div>

          <select class="select-sm" onchange="handleUserLevelFilter(this.value)">
            <option value="all" ${state.userFilterLevel === 'all' ? 'selected' : ''}>ระดับทั้งหมด</option>
            ${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${state.userFilterLevel === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>

          <div style="display:inline-flex;align-items:center;gap:6px">
            <span class="muted" style="font-size:13px">จัดเรียง:</span>
            <select class="select-sm" onchange="handleUserSortChange(this.value)">
              <option value="name" ${state.userSortKey === 'name' ? 'selected' : ''}>ชื่อ-นามสกุล</option>
              <option value="position" ${state.userSortKey === 'position' ? 'selected' : ''}>ตำแหน่ง</option>
              <option value="level" ${state.userSortKey === 'level' ? 'selected' : ''}>ระดับ (กลุ่มงาน > งาน > ผู้ปฏิบัติ)</option>
              <option value="department" ${state.userSortKey === 'department' ? 'selected' : ''}>หน่วยงาน / หอผู้ป่วย</option>
              <option value="is_self_registered" ${state.userSortKey === 'is_self_registered' ? 'selected' : ''}>สถานะการลงทะเบียน</option>
            </select>

            <button class="sort-btn" onclick="toggleUserSortDir()" title="สลับ ก-ฮ / ฮ-ก">
              ${state.userSortDir === 'asc' ? '<i class="fa-solid fa-arrow-up-a-z"></i> น้อย→มาก (ก-ฮ)' : '<i class="fa-solid fa-arrow-down-z-a"></i> มาก→น้อย (ฮ-ก)'}
            </button>
          </div>
        </div>

        <div class="user-toolbar-right">
          <span class="badge pending" style="font-size:13px"><i class="fa-solid fa-users"></i> ทั้งหมด ${totalCount} คน</span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="sortable" onclick="setAdminUserSort('name')">
                <div class="th-content">ชื่อ-นามสกุล ${getSortIcon('name')}</div>
              </th>
              <th class="sortable" onclick="setAdminUserSort('position')">
                <div class="th-content">ตำแหน่ง ${getSortIcon('position')}</div>
              </th>
              <th class="sortable" onclick="setAdminUserSort('level')">
                <div class="th-content">ระดับ ${getSortIcon('level')}</div>
              </th>
              <th class="sortable" onclick="setAdminUserSort('department')">
                <div class="th-content">หน่วยงาน / หอผู้ป่วย ${getSortIcon('department')}</div>
              </th>
              <th class="sortable" onclick="setAdminUserSort('is_self_registered')">
                <div class="th-content">ที่มาข้อมูล ${getSortIcon('is_self_registered')}</div>
              </th>
              <th style="text-align:right">จัดการ</th>
            </tr>
          </thead>
          <tbody id="adminUsersTable">
            ${state.usersLoading
              ? `<tr><td colspan="6" style="text-align:center;padding:36px" class="muted"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดข้อมูลจากฐานข้อมูล Supabase...</td></tr>`
              : adminUserRows(pageItems)}
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <div>
          แสดง <strong>${totalCount > 0 ? startIdx + 1 : 0} - ${Math.min(startIdx + pageSize, totalCount)}</strong> จากทั้งหมด <strong>${totalCount}</strong> คน
        </div>
        <div class="pagination-nav">
          <span style="margin-right:8px">แถวต่อหน้า:</span>
          <select class="select-sm" onchange="handleUserPageSize(this.value)" style="margin-right:12px">
            <option value="15" ${state.userPageSize === 15 || state.userPageSize === '15' ? 'selected' : ''}>15</option>
            <option value="30" ${state.userPageSize === 30 || state.userPageSize === '30' ? 'selected' : ''}>30</option>
            <option value="50" ${state.userPageSize === 50 || state.userPageSize === '50' ? 'selected' : ''}>50</option>
            <option value="all" ${state.userPageSize === 'all' ? 'selected' : ''}>ทั้งหมด</option>
          </select>

          <button class="page-num" ${state.userPage <= 1 ? 'disabled' : ''} onclick="goToUserPage(${state.userPage - 1})"><i class="fa-solid fa-chevron-left"></i> ก่อนหน้า</button>
          <span style="font-weight:600;padding:0 8px">${state.userPage} / ${totalPages}</span>
          <button class="page-num" ${state.userPage >= totalPages ? 'disabled' : ''} onclick="goToUserPage(${state.userPage + 1})">ถัดไป <i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>
    </div>
  `;
}

function adminUserRows(list) {
  if (!list.length) {
    return '<tr><td colspan="6" style="text-align:center;padding:30px" class="muted"><i class="fa-regular fa-folder-open" style="display:block;font-size:24px;margin-bottom:6px"></i>ไม่พบข้อมูลบุคลากรตามเงื่อนไขที่ค้นหา</td></tr>';
  }
  return list
    .map(
      u => `
    <tr>
      <td><strong>${esc(u.name)}</strong></td>
      <td>${esc(u.position)}</td>
      <td><span class="badge-level">${esc(levels[u.level] || u.level)}</span></td>
      <td>${esc(u.department || 'ไม่ระบุ')}</td>
      <td>
        ${u.is_self_registered ? `<span class="badge-self"><i class="fa-solid fa-user-pen"></i> ลงทะเบียนเอง</span>` : `<span class="badge-system"><i class="fa-solid fa-database"></i> นำเข้าจากระบบ</span>`}
      </td>
      <td style="text-align:right">
        <div class="inline-actions" style="justify-content:flex-end">
          <button class="btn small outline" onclick="showAdminUserForm('${u.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>
          <button class="btn small danger" onclick="deleteAdminUser('${u.id}')"><i class="fa-solid fa-trash-can"></i> ลบ</button>
        </div>
      </td>
    </tr>
  `
    )
    .join('');
}

function handleUserSearch(val) {
  state.userSearchQuery = val;
  state.userPage = 1;
  render();
  const input = document.querySelector('#adminUserSearch');
  if (input) {
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function handleUserLevelFilter(lvl) {
  state.userFilterLevel = lvl;
  state.userPage = 1;
  render();
}

function handleUserSortChange(key) {
  state.userSortKey = key;
  state.userPage = 1;
  render();
}

function toggleUserSortDir() {
  state.userSortDir = state.userSortDir === 'asc' ? 'desc' : 'asc';
  render();
}

function setAdminUserSort(key) {
  if (state.userSortKey === key) {
    state.userSortDir = state.userSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.userSortKey = key;
    state.userSortDir = 'asc';
  }
  state.userPage = 1;
  render();
}

function handleUserPageSize(size) {
  state.userPageSize = size === 'all' ? 'all' : Number(size);
  state.userPage = 1;
  render();
}

function goToUserPage(p) {
  state.userPage = p;
  render();
}

function showAdminUserForm(id) {
  let u = users.find(x => x.id === id) || {
    id: 'u_' + Date.now(),
    name: '',
    position: positions[0],
    level: 'practitioner',
    department: '',
    is_self_registered: false
  };

  modal(
    id ? 'แก้ไขข้อมูลบุคลากร' : 'เพิ่มผู้ใช้งานใหม่',
    `
    <input type="hidden" id="adminUserId" value="${u.id}">
    <div class="field"><label>ชื่อ-นามสกุล *</label><input id="adminUserName" value="${esc(u.name)}" placeholder="เช่น นางสาววิภาดา เรียนรู้"></div>
    <div class="field"><label>ตำแหน่ง *</label><select id="adminUserPos">${positions.map(x => `<option ${x === u.position ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="field"><label>ระดับ *</label><select id="adminUserLevel">${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${k === u.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>หน่วยงาน / หอผู้ป่วย *</label><input id="adminUserDept" value="${esc(u.department)}" placeholder="เช่น หอผู้ป่วยศัลยกรรม"></div>
  `,
    `<button class="btn" onclick="saveAdminUser()"><i class="fa-solid fa-floppy-disk"></i> บันทึกข้อมูล</button>`
  );
}

async function saveAdminUser() {
  let id = document.querySelector('#adminUserId').value;
  let name = document.querySelector('#adminUserName').value.trim();
  let department = document.querySelector('#adminUserDept').value.trim();
  let position = document.querySelector('#adminUserPos').value;
  let level = document.querySelector('#adminUserLevel').value;

  if (!name || !department) return toast('กรุณากรอกชื่อและหน่วยงานให้ครบถ้วน');

  let u = { id, name, position, level, department, is_self_registered: false };

  try {
    if (cloudEnabled()) {
      const res = await api('admin_save_user', { id, name, position, level, department });
      if (res && res.id) u.id = res.id;
    }
    let idx = users.findIndex(x => x.id === id);
    if (idx < 0) users.unshift(u);
    else users[idx] = u;
    saveUsers();
    closeModal();
    render();
    toast('บันทึกข้อมูลบุคลากรเรียบร้อย');
  } catch (e) {
    toast('ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่');
  }
}

async function deleteAdminUser(id) {
  let u = users.find(x => x.id === id);
  if (!u) return;
  const confirmed = await customConfirm('ยืนยันการลบ', `ต้องการลบ "${u.name}" ออกจากระบบหรือไม่?`);
  if (!confirmed) return;

  try {
    if (cloudEnabled()) {
      await api('admin_delete_user', { id });
    }
    users = users.filter(x => x.id !== id);
    saveUsers();
    render();
    toast('ลบผู้ใช้งานเรียบร้อยแล้ว');
  } catch (e) {
    toast('ลบไม่สำเร็จ กรุณาลองใหม่');
  }
}

// ----------------------------------------------------
// SURVEY & QUIZ BUILDER (WITH PER-QUESTION POINTS)
// ----------------------------------------------------

function startNewSurvey() {
  state.builder = {
    id: null,
    title: '',
    description: '',
    is_quiz: false,
    passing_score: 80,
    is_anonymous: false,
    status: 'published',
    target_levels: ['head_of_group', 'head_of_unit', 'practitioner'],
    questions: [
      {
        id: 'q1',
        text: '',
        type: 'single_choice',
        required: true,
        points: 1,
        correct_answer: '',
        options: ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2']
      }
    ]
  };
  switchAdminTab('builder');
}

function editSurveyInBuilder(id) {
  const s = surveys.find(x => x.id === id);
  if (!s) return;
  state.builder = {
    id: s.id,
    title: s.title,
    description: s.description || '',
    is_quiz: Boolean(s.is_quiz),
    passing_score: s.passing_score || 80,
    is_anonymous: Boolean(s.anonymous),
    status: s.status || 'published',
    target_levels: s.levels && s.levels.length ? [...s.levels] : ['head_of_group', 'head_of_unit', 'practitioner'],
    questions: (s.questions || []).map((q, idx) => ({
      id: q.id || 'q' + (idx + 1),
      text: q.text || '',
      type: q.type || 'single_choice',
      required: Boolean(q.required),
      points: Number(q.points) || 1,
      correct_answer: q.correct_answer || '',
      options: q.options ? [...q.options] : ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2']
    }))
  };
  switchAdminTab('builder');
}

// ----------------------------------------------------
// SHARE SURVEY (เผยแพร่)
// ----------------------------------------------------
function shareSurvey(id) {
  const s = surveys.find(x => x.id === id);
  if (!s) return;
  const link = window.location.origin + window.location.pathname.replace(/admin\.html.*$/, '') + 'survey.html?id=' + s.id;
  
  modal(
    'เผยแพร่แบบสอบถาม',
    `
      <div style="margin-bottom:16px">
        <label>1. คัดลอกลิงก์</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <input type="text" value="${link}" readonly id="shareLinkInput" style="flex:1; padding:8px 12px; border:1px solid var(--line); border-radius:6px;" onclick="this.select()">
          <button class="btn outline" onclick="navigator.clipboard.writeText(document.getElementById('shareLinkInput').value);toast('คัดลอกลิงก์แล้ว')"><i class="fa-regular fa-copy"></i> คัดลอก</button>
        </div>
      </div>
      <div>
        <label>2. การ์ด QR Code</label>
        <div class="qr-card" id="qrCard" style="border:1px solid var(--line); border-radius:12px; padding:24px; text-align:center; background:#fff; margin-top:8px">
          <img src="nurse-logo.png" style="height:40px; margin-bottom:12px">
          <h3 style="margin:0 0 16px; color:var(--navy); font-size:18px">${esc(s.title)}</h3>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}&margin=10" style="width:200px;height:200px;margin-bottom:16px;border-radius:8px">
          <div style="color:var(--text); font-size:14px; font-weight:600">กลุ่มเป้าหมาย: ${s.levels ? s.levels.map(x => levels[x] || x).join(', ') : 'ทุกคน'}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:8px">แสกนเพื่อทำแบบสอบถามผ่านระบบ NursePulse</div>
        </div>
        <button class="btn outline" style="width:100%; margin-top:12px" onclick="printQR()"><i class="fa-solid fa-print"></i> พิมพ์ / บันทึกรูปภาพ (Print)</button>
      </div>
    `,
    `<button class="btn ghost" onclick="closeModal()">ปิด</button>`
  );
}

function printQR() {
  const content = document.getElementById('qrCard').innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>QR Code - NursePulse</title>
        <style>
          body { font-family: sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; background:#f4f4f5; }
          .card { border:1px solid #e4e4e7; border-radius:12px; padding:32px; text-align:center; background:#fff; max-width:400px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); }
          h3 { margin:0 0 20px; color:#1e1b4b; font-size:22px; }
          img { max-width: 100%; }
          @media print {
            body { background: #fff; display:block; height:auto; }
            .card { border: none; box-shadow: none; max-width: 100%; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="card">${content}</div>
        <script>setTimeout(() => { window.print(); }, 500);</script>
      </body>
    </html>
  `);
  win.document.close();
}

function adminBuilder() {
  const b = state.builder;
  const totalPoints = b.questions.reduce((sum, q) => sum + (Number(q.points) || 1), 0);

  return `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-pen-ruler"></i> Form & Quiz Builder</div>
        <h2>${b.id ? 'แก้ไขแบบสอบถาม / แบบทดสอบ' : 'สร้างแบบสอบถาม / แบบทดสอบใหม่'}</h2>
        <p class="muted">ออกแบบชุดคำถาม กำหนดตัวเลือก และตั้งค่าเป็นแบบทดสอบพร้อมเฉลยและคะแนนรายข้อได้</p>
      </div>
      <div class="inline-actions">
        <button class="btn outline" onclick="switchAdminTab('surveys')"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>
        <button class="btn" onclick="saveSurveyFromBuilder()"><i class="fa-solid fa-floppy-disk"></i> บันทึกแบบสอบถาม / แบบทดสอบ</button>
      </div>
    </div>

    <!-- Quiz Toggle Banner -->
    <div class="quiz-toggle-card">
      <div class="quiz-toggle-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:24px;color:var(--brand)"><i class="fa-solid fa-bullseye"></i></div>
          <div>
            <strong>ตั้งค่าเป็นแบบทดสอบ (Quiz / แบบทดสอบความรู้)</strong>
            <div class="muted" style="font-size:13px">เมื่อเปิดโหมดนี้ จะสามารถกำหนดคะแนนรายข้อ เฉลยคำตอบ และคำนวณผลคะแนนอัตโนมัติ</div>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700;color:var(--navy);font-size:15px">
          <input
            type="checkbox"
            id="builderQuizToggle"
            style="width:20px;height:20px;accent-color:var(--brand);cursor:pointer"
            ${b.is_quiz ? 'checked' : ''}
            onchange="toggleBuilderQuiz(this.checked)"
          >
          <span>เปิดโหมดแบบทดสอบ</span>
        </label>
      </div>

      ${b.is_quiz ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #c8d8f9;display:flex;flex-wrap:wrap;gap:18px;align-items:center">
          <div class="quiz-total-badge">
            <i class="fa-solid fa-star"></i>
            <span>คะแนนเต็มรวมทั้งหมด:</span>
            <strong style="font-size:16px;color:var(--navy)">${totalPoints} คะแนน</strong>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-weight:600;font-size:13px"><i class="fa-solid fa-percent"></i> เกณฑ์คะแนนผ่าน (%):</label>
            <input
              type="number"
              min="0"
              max="100"
              value="${b.passing_score || 80}"
              onchange="setBuilderPassingScore(this.value)"
              style="width:70px;padding:5px 8px;border-radius:8px;border:1px solid var(--line);text-align:center;font-weight:700"
            >
            <span class="muted" style="font-size:13px">%</span>
          </div>
        </div>
      ` : ''}
    </div>

    <div class="builder-grid">
      <div>
        <div class="card">
          <div class="field">
            <label>ชื่อ${b.is_quiz ? 'แบบทดสอบ' : 'แบบสอบถาม'} *</label>
            <input id="builderTitle" value="${esc(b.title)}" oninput="state.builder.title=this.value" placeholder="เช่น แบบทดสอบความรู้การพยาบาลผู้ป่วยวิกฤต">
          </div>
          <div class="field">
            <label>คำชี้แจง / วัตถุประสงค์</label>
            <div class="rte-toolbar">
              <button type="button" onclick="document.execCommand('bold', false, null)" title="ตัวหนา"><i class="fa-solid fa-bold"></i></button>
              <button type="button" onclick="document.execCommand('italic', false, null)" title="ตัวเอียง"><i class="fa-solid fa-italic"></i></button>
              <button type="button" onclick="document.execCommand('underline', false, null)" title="ขีดเส้นใต้"><i class="fa-solid fa-underline"></i></button>
            </div>
            <div id="builderDesc" class="rte-editor rte-content" contenteditable="true" onblur="state.builder.description=this.innerHTML" placeholder="อธิบายวัตถุประสงค์ คำแนะนำในการทำ และเกณฑ์การประเมิน">${b.description || ''}</div>
          </div>
        </div>

        <div style="margin-top:18px">
          <h3 style="margin-bottom:12px"><i class="fa-solid fa-list-ol"></i> รายการข้อคำถาม (${b.questions.length} ข้อ)</h3>
          ${b.questions.map((q, qIdx) => builderQuestionCard(q, qIdx, b.is_quiz)).join('')}
        </div>

        <button class="btn outline full" style="margin-top:14px;padding:12px" onclick="addBuilderQuestion()">
          <i class="fa-solid fa-plus"></i> เพิ่มคำถามข้อใหม่
        </button>
      </div>

      <aside>
        <div class="card">
          <h3><i class="fa-solid fa-sliders"></i> ตั้งค่าการเผยแพร่</h3>
          <div class="field">
            <label>กลุ่มเป้าหมาย (สิทธิ์การเข้าถึง)</label>
            <div class="target-list">
              ${Object.entries(levels).map(([k, v]) => `
                <label>
                  <input
                    type="checkbox"
                    value="${k}"
                    ${b.target_levels.includes(k) ? 'checked' : ''}
                    onchange="toggleBuilderTargetLevel('${k}', this.checked)"
                  >
                  <span>${v}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="toggle-row" style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px">
            <div>
              <strong><i class="fa-solid fa-user-secret"></i> ไม่ระบุชื่อผู้ตอบ (Anonymous)</strong><br>
              <small class="muted">ไม่เชื่อมโยงคำตอบกับตัวบุคคล</small>
            </div>
            <input
              type="checkbox"
              ${b.is_anonymous ? 'checked' : ''}
              onchange="state.builder.is_anonymous=this.checked"
              ${b.is_quiz ? 'disabled' : ''}
            >
          </div>
          ${b.is_quiz && b.is_anonymous ? '<small class="muted" style="color:var(--warn)"><i class="fa-solid fa-triangle-exclamation"></i> แบบทดสอบแนะนำให้ระบุชื่อเพื่อบันทึกคะแนนรายบุคคล</small>' : ''}

          <div class="field" style="margin-top:14px">
            <label>สถานะ</label>
            <select onchange="state.builder.status=this.value">
              <option value="published" ${b.status === 'published' ? 'selected' : ''}>เผยแพร่ทันที (Published)</option>
              <option value="draft" ${b.status === 'draft' ? 'selected' : ''}>บันทึกเป็นฉบับร่าง (Draft)</option>
            </select>
          </div>

          <button class="btn full" style="margin-top:18px" onclick="saveSurveyFromBuilder()">
            <i class="fa-solid fa-floppy-disk"></i> บันทึก${b.is_quiz ? 'แบบทดสอบ' : 'แบบสอบถาม'}
          </button>
        </div>
      </aside>
    </div>
  `;
}

function builderQuestionCard(q, idx, isQuiz) {
  let hasOptions = ['single_choice', 'multiple_choice', 'dropdown'].includes(q.type);

  return `
    <div class="card question-editor" style="margin-bottom:14px">
      <div class="editor-head">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge-level">ข้อที่ ${idx + 1}</span>
          <span class="q-type-badge">${questionTypeLabels[q.type] || q.type}</span>
          ${isQuiz ? `<span class="q-points-badge"><i class="fa-solid fa-star"></i> ${Number(q.points) || 1} คะแนน</span>` : ''}
        </div>
        <div class="inline-actions">
          <button class="icon-btn" title="เลื่อนขึ้น" onclick="moveBuilderQuestion(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="icon-btn" title="เลื่อนลง" onclick="moveBuilderQuestion(${idx}, 1)" ${idx === state.builder.questions.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
          <button class="icon-btn" title="คัดลอกข้อนี้" onclick="duplicateBuilderQuestion(${idx})"><i class="fa-regular fa-copy"></i></button>
          <button class="icon-btn" style="color:var(--danger)" title="ลบข้อนี้" onclick="deleteBuilderQuestion(${idx})" ${state.builder.questions.length <= 1 ? 'disabled' : ''}><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </div>

      <div class="editor-row" style="margin-top:12px">
        <div class="field" style="margin:0">
          <label>หัวข้อคำถาม *</label>
          <input
            value="${esc(q.text)}"
            oninput="updateBuilderQuestion(${idx}, 'text', this.value)"
            placeholder="พิมพ์โจทย์คำถาม เช่น อัตราความลึกในการกดหน้าอกคือเท่าใด"
          >
        </div>
        <div class="field" style="margin:0">
          <label>ประเภทคำตอบ</label>
          <select onchange="updateBuilderQuestion(${idx}, 'type', this.value)">
            ${Object.entries(questionTypeLabels).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Quiz Per-Question Points & Answer Key -->
      ${isQuiz ? `
        <div style="margin-top:14px;padding:12px 14px;background:#f4f7ff;border:1px solid #cfddfc;border-radius:10px">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
            <div class="quiz-points-input">
              <label style="font-weight:700;color:var(--navy);font-size:13px"><i class="fa-solid fa-star" style="color:#d97706"></i> กำหนดคะแนนสำหรับข้อนี้:</label>
              <input
                type="number"
                min="1"
                max="100"
                value="${Number(q.points) || 1}"
                onchange="updateBuilderQuestion(${idx}, 'points', Number(this.value) || 1)"
              >
              <span style="font-weight:600;font-size:13px;color:var(--navy)">คะแนน</span>
            </div>

            ${!hasOptions && (q.type === 'short_text' || q.type === 'number') ? `
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:240px">
                <label style="font-weight:700;color:var(--navy);font-size:13px;white-space:nowrap"><i class="fa-solid fa-key"></i> เฉลยคำตอบ:</label>
                <input
                  type="${q.type === 'number' ? 'number' : 'text'}"
                  value="${esc(q.correct_answer)}"
                  oninput="updateBuilderQuestion(${idx}, 'correct_answer', this.value)"
                  placeholder="พิมพ์คำตอบที่ถูกต้องสำหรับตรวจข้อนี้"
                  style="padding:6px 10px;border-radius:8px;border:1px solid var(--line);flex:1"
                >
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      <!-- Options Editor (for choice / dropdown) -->
      ${hasOptions ? `
        <div style="margin-top:14px">
          <label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">
            <i class="fa-solid fa-list-check"></i> ตัวเลือกคำตอบ ${isQuiz ? '(ติ๊กเลือก "เฉลย" ข้อที่ถูกต้อง)' : ''}
          </label>
          ${(q.options || []).map((opt, optIdx) => `
            <div class="builder-option-row">
              ${isQuiz ? `
                <button
                  type="button"
                  class="correct-indicator ${q.correct_answer === opt ? 'active' : 'inactive'}"
                  onclick="setBuilderQuestionCorrectAnswer(${idx}, '${esc(opt)}')"
                  title="ตั้งเป็นคำตอบที่ถูกต้อง"
                >
                  <i class="fa-solid ${q.correct_answer === opt ? 'fa-check' : 'fa-circle'}"></i> ${q.correct_answer === opt ? 'เฉลยข้อถูก' : 'เฉลย'}
                </button>
              ` : ''}
              <input
                type="text"
                value="${esc(opt)}"
                oninput="updateBuilderOption(${idx}, ${optIdx}, this.value)"
                placeholder="ตัวเลือกที่ ${optIdx + 1}"
              >
              <button
                class="icon-btn"
                style="color:var(--danger);font-size:16px"
                title="ลบตัวเลือกนี้"
                onclick="deleteBuilderOption(${idx}, ${optIdx})"
                ${q.options.length <= 2 ? 'disabled' : ''}
              ><i class="fa-solid fa-xmark"></i></button>
            </div>
          `).join('')}

          <button class="btn ghost small" style="margin-top:6px" onclick="addBuilderOption(${idx})">
            <i class="fa-solid fa-plus"></i> เพิ่มตัวเลือก
          </button>
        </div>
      ` : ''}

      <div class="toggle-row" style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
        <span>จำเป็นต้องตอบข้อนี้</span>
        <input
          type="checkbox"
          ${q.required ? 'checked' : ''}
          onchange="updateBuilderQuestion(${idx}, 'required', this.checked)"
        >
      </div>
    </div>
  `;
}

function toggleBuilderQuiz(isQuiz) {
  state.builder.is_quiz = isQuiz;
  if (isQuiz && state.builder.is_anonymous) {
    state.builder.is_anonymous = false;
  }
  render();
}

function setBuilderPassingScore(val) {
  state.builder.passing_score = Number(val) || 80;
}

function toggleBuilderTargetLevel(lvl, checked) {
  let set = new Set(state.builder.target_levels || []);
  if (checked) set.add(lvl);
  else set.delete(lvl);
  state.builder.target_levels = Array.from(set);
  render();
}

function addBuilderQuestion() {
  const newIdx = state.builder.questions.length + 1;
  state.builder.questions.push({
    id: 'q' + Date.now(),
    text: '',
    type: 'single_choice',
    required: true,
    points: 1,
    correct_answer: '',
    options: ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2']
  });
  render();
}

function duplicateBuilderQuestion(idx) {
  const src = state.builder.questions[idx];
  state.builder.questions.splice(idx + 1, 0, {
    id: 'q' + Date.now(),
    text: src.text ? src.text + ' (สำเนา)' : '',
    type: src.type,
    required: src.required,
    points: src.points || 1,
    correct_answer: src.correct_answer || '',
    options: src.options ? [...src.options] : []
  });
  render();
}

function moveBuilderQuestion(idx, delta) {
  const target = idx + delta;
  if (target < 0 || target >= state.builder.questions.length) return;
  const temp = state.builder.questions[idx];
  state.builder.questions[idx] = state.builder.questions[target];
  state.builder.questions[target] = temp;
  render();
}

function deleteBuilderQuestion(idx) {
  if (state.builder.questions.length <= 1) return toast('ต้องมีคำถามอย่างน้อย 1 ข้อ');
  state.builder.questions.splice(idx, 1);
  render();
}

function updateBuilderQuestion(idx, field, val) {
  state.builder.questions[idx][field] = val;
  if (field === 'type') {
    let hasOptions = ['single_choice', 'multiple_choice', 'dropdown'].includes(val);
    if (hasOptions && (!state.builder.questions[idx].options || !state.builder.questions[idx].options.length)) {
      state.builder.questions[idx].options = ['ตัวเลือกที่ 1', 'ตัวเลือกที่ 2'];
    }
  }
  render();
}

function setBuilderQuestionCorrectAnswer(qIdx, opt) {
  state.builder.questions[qIdx].correct_answer = opt;
  render();
}

function addBuilderOption(qIdx) {
  const q = state.builder.questions[qIdx];
  if (!q.options) q.options = [];
  q.options.push(`ตัวเลือกที่ ${q.options.length + 1}`);
  render();
}

function updateBuilderOption(qIdx, optIdx, val) {
  state.builder.questions[qIdx].options[optIdx] = val;
}

function deleteBuilderOption(qIdx, optIdx) {
  const q = state.builder.questions[qIdx];
  if (!q.options || q.options.length <= 2) return toast('ต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก');
  const removed = q.options.splice(optIdx, 1)[0];
  if (q.correct_answer === removed) q.correct_answer = '';
  render();
}

async function saveSurveyFromBuilder() {
  const b = state.builder;
  const titleInput = document.querySelector('#builderTitle');
  if (titleInput) b.title = titleInput.value.trim();
  const descInput = document.querySelector('#builderDesc');
  if (descInput) b.description = descInput.innerHTML.trim();

  if (!b.title) return toast('กรุณากรอกชื่อแบบสอบถาม / แบบทดสอบ');
  if (!b.questions.length) return toast('กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ');

  for (let i = 0; i < b.questions.length; i++) {
    if (!b.questions[i].text.trim()) {
      return toast(`กรุณากรอกข้อความคำถามในข้อที่ ${i + 1}`);
    }
  }

  let surveyObj = {
    id: b.id || 's_' + Date.now(),
    title: b.title,
    description: b.description || '',
    anonymous: Boolean(b.is_anonymous),
    is_quiz: Boolean(b.is_quiz),
    passing_score: b.is_quiz ? Number(b.passing_score) || 80 : null,
    levels: b.target_levels && b.target_levels.length ? b.target_levels : ['head_of_group', 'head_of_unit', 'practitioner'],
    created: new Date().toLocaleDateString('th-TH'),
    status: b.status || 'published',
    questions: b.questions.map((q, idx) => ({
      id: q.id || 'q' + (idx + 1),
      text: q.text,
      type: q.type,
      required: Boolean(q.required),
      points: b.is_quiz ? Number(q.points) || 1 : 1,
      correct_answer: q.correct_answer || '',
      options: q.options ? [...q.options] : []
    }))
  };

  try {
    showSkeletonLoading('กำลังบันทึกแบบสอบถาม...');
    if (cloudEnabled()) {
      const res = await api('admin_save_survey', {
        id: b.id,
        title: surveyObj.title,
        description: surveyObj.description,
        is_anonymous: surveyObj.anonymous,
        is_quiz: surveyObj.is_quiz,
        passing_score: surveyObj.passing_score,
        status: surveyObj.status,
        target_levels: surveyObj.levels,
        questions: surveyObj.questions
      });
      if (res && res.id) surveyObj.id = res.id;
    }

    let existingIdx = surveys.findIndex(x => x.id === surveyObj.id);
    if (existingIdx >= 0) surveys[existingIdx] = surveyObj;
    else surveys.unshift(surveyObj);

    saveSurveysToLocal();
    toast(`บันทึก${surveyObj.is_quiz ? 'แบบทดสอบ' : 'แบบสอบถาม'}สำเร็จ`);
    switchAdminTab('surveys');
    setTimeout(() => {
      shareSurvey(surveyObj.id);
    }, 100);
  } catch (e) {
    console.error(e);
    toast('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
}

async function deleteSurvey(id) {
  const s = surveys.find(x => x.id === id);
  if (!s) return;
  const confirmed = await customConfirm('ยืนยันการลบแบบสอบถาม', `ต้องการลบ "${s.title}" ออกจากระบบหรือไม่?`);
  if (!confirmed) return;

  try {
    if (cloudEnabled()) {
      await api('admin_delete_survey', { id });
    }
    surveys = surveys.filter(x => x.id !== id);
    saveSurveysToLocal();
    render();
    toast('ลบแบบสอบถามเรียบร้อยแล้ว');
  } catch (e) {
    toast('ลบไม่สำเร็จ กรุณาลองใหม่');
  }
}

// ----------------------------------------------------
// ADMIN REPORTS & QUIZ SCORE SUMMARY
// ----------------------------------------------------

function viewSurveyReport(id) {
  state.reportSurveyId = id;
  switchAdminTab('reports');
}

function adminReports() {
  let s = surveys.find(x => x.id === state.reportSurveyId) || surveys[0];
  if (!s) return '<div class="empty"><i class="fa-regular fa-folder-open" style="font-size:32px;display:block;margin-bottom:8px"></i>ยังไม่มีข้อมูลแบบสอบถามในระบบ</div>';

  // Gather responses
  let responses = [];
  users.forEach(u => {
    let r = cloudResponses[s.id] || JSON.parse(localStorage.getItem(`np_response_${u.id}_${s.id}`) || 'null');
    if (r) {
      responses.push({
        user: u,
        completed: Boolean(r.completed),
        score: r.score,
        total_points: r.total_points || s.questions.reduce((a, q) => a + (Number(q.points) || 1), 0),
        submittedAt: r.submittedAt || r.updatedAt,
        answers: r.answers || {}
      });
    }
  });

  let doneList = responses.filter(x => x.completed);
  let doneCount = doneList.length;
  let targetCount = users.filter(u => !s.levels || s.levels.includes(u.level)).length;
  let responseRate = targetCount ? Math.round((doneCount / targetCount) * 100) : 0;

  // Quiz statistics
  let quizStatsHTML = '';
  if (s.is_quiz) {
    let scores = doneList.map(r => r.score).filter(sc => sc !== undefined && sc !== null);
    let totalPts = s.questions.reduce((a, q) => a + (Number(q.points) || 1), 0);
    let avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
    let maxScore = scores.length ? Math.max(...scores) : 0;
    let minScore = scores.length ? Math.min(...scores) : 0;
    let passCount = doneList.filter(r => {
      let pct = totalPts > 0 ? (r.score / totalPts) * 100 : 0;
      return s.passing_score ? pct >= s.passing_score : true;
    }).length;
    let passRate = doneCount ? Math.round((passCount / doneCount) * 100) : 0;

    quizStatsHTML = `
      <div class="quiz-stat-card" style="margin:18px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <span class="quiz-badge"><i class="fa-solid fa-award"></i> สถิติผลคะแนนแบบทดสอบ</span>
            <h3 style="margin:6px 0 2px">สรุปผลการทดสอบ (คะแนนเต็ม ${totalPts} คะแนน)</h3>
            <small class="muted">เกณฑ์ผ่าน: ${s.passing_score || 80}%</small>
          </div>
          <button class="btn outline small" onclick="exportReport('${s.id}')"><i class="fa-solid fa-file-excel"></i> ส่งออกรายงาน CSV</button>
        </div>

        <div class="quiz-stat-grid">
          <div class="stat-mini">
            <small><i class="fa-solid fa-calculator"></i> คะแนนเฉลี่ย</small>
            <strong>${avgScore} <span style="font-size:14px;font-weight:normal">/ ${totalPts}</span></strong>
          </div>
          <div class="stat-mini">
            <small><i class="fa-solid fa-chart-line"></i> อัตราการผ่านเกณฑ์</small>
            <strong style="color:${passRate >= 70 ? 'var(--good)' : 'var(--warn)'}">${passRate}%</strong>
          </div>
          <div class="stat-mini">
            <small><i class="fa-solid fa-arrow-trend-up"></i> คะแนนสูงสุด</small>
            <strong style="color:var(--good)">${maxScore} คะแนน</strong>
          </div>
          <div class="stat-mini">
            <small><i class="fa-solid fa-arrow-trend-down"></i> คะแนนต่ำสุด</small>
            <strong style="color:var(--danger)">${minScore} คะแนน</strong>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="page-header">
      <div>
        <div class="eyebrow"><i class="fa-solid fa-chart-pie"></i> รายงานผลและสถิติ</div>
        <h2>สรุปผลแบบสอบถาม & แบบทดสอบ</h2>
      </div>
      <div class="inline-actions">
        <button class="btn outline" onclick="exportReport('${s.id}')"><i class="fa-solid fa-file-excel"></i> ดาวน์โหลด Excel (CSV)</button>
      </div>
    </div>

    <div class="field" style="max-width:500px">
      <label>เลือกแบบสอบถาม / แบบทดสอบเพื่อดูรายงาน</label>
      <select onchange="viewSurveyReport(this.value)">
        ${surveys.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${x.is_quiz ? '[แบบทดสอบ] ' : '[แบบสอบถาม] '}${esc(x.title)}</option>`).join('')}
      </select>
    </div>

    <div class="admin-stat">
      <div class="stat">
        <small class="muted"><i class="fa-solid fa-users"></i> กลุ่มเป้าหมาย</small>
        <strong>${targetCount}</strong>คน
      </div>
      <div class="stat">
        <small class="muted"><i class="fa-solid fa-circle-check"></i> ตอบเสร็จสิ้นแล้ว</small>
        <strong>${doneCount}</strong>คน
      </div>
      <div class="stat">
        <small class="muted"><i class="fa-solid fa-percent"></i> อัตราการตอบ</small>
        <strong>${responseRate}%</strong>
      </div>
    </div>

    ${quizStatsHTML}

    <div class="card" style="margin-top:14px">
      <h3><i class="fa-solid fa-table-list"></i> รายการผู้ตอบและคะแนนล่าสุด</h3>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ผู้ตอบ</th>
              <th>หน่วยงาน</th>
              <th>สถานะ</th>
              ${s.is_quiz ? `<th>คะแนนที่ได้</th><th>ผลการทดสอบ</th>` : `<th>คำตอบข้อแรก</th>`}
              <th>ส่งเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            ${responses.length ? responses.map(r => {
              let totalPts = s.questions.reduce((a, q) => a + (Number(q.points) || 1), 0);
              let pct = totalPts > 0 && r.score !== undefined ? Math.round((r.score / totalPts) * 100) : 0;
              let isPass = s.passing_score ? pct >= s.passing_score : true;

              return `
                <tr>
                  <td><strong>${s.anonymous ? '<i class="fa-solid fa-lock"></i> ไม่เปิดเผยชื่อ' : esc(r.user.name)}</strong></td>
                  <td>${esc(r.user.department || '-')}</td>
                  <td><span class="badge ${r.completed ? 'done' : 'progressing'}">${r.completed ? 'เสร็จสิ้น' : 'ร่าง'}</span></td>
                  ${s.is_quiz ? `
                    <td><strong>${r.score !== undefined && r.score !== null ? `${r.score}/${totalPts} (${pct}%)` : '-'}</strong></td>
                    <td>${r.completed ? (isPass ? `<span class="badge done"><i class="fa-solid fa-check"></i> ผ่านเกณฑ์</span>` : `<span class="badge closed"><i class="fa-solid fa-xmark"></i> ไม่ผ่าน</span>`) : '-'}</td>
                  ` : `
                    <td>${esc(r.answers[s.questions[0]?.id] || '—')}</td>
                  `}
                  <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString('th-TH') : '—'}</td>
                </tr>
              `;
            }).join('') : `<tr><td colspan="${s.is_quiz ? 6 : 5}" class="muted" style="text-align:center;padding:24px"><i class="fa-regular fa-folder-open" style="display:block;font-size:24px;margin-bottom:6px"></i>ยังไม่มีข้อมูลคำตอบสำหรับรายการนี้</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function exportReport(surveyId) {
  let s = surveys.find(x => x.id === surveyId) || surveys[0];
  if (!s) return;

  let headers = ['ลำดับ', 'ชื่อผู้ตอบ', 'ตำแหน่ง', 'ระดับ', 'หน่วยงาน', 'สถานะ', 'ส่งเมื่อ'];
  if (s.is_quiz) {
    headers.push('คะแนนที่ได้', 'คะแนนเต็ม', 'คิดเป็นร้อยละ', 'ผลการทดสอบ');
  }
  s.questions.forEach((q, i) => {
    headers.push(`ข้อ ${i + 1}: ${q.text.replace(/,/g, ' ')}`);
  });

  let csvRows = [headers.join(',')];

  users.forEach((u, uIdx) => {
    let r = cloudResponses[s.id] || JSON.parse(localStorage.getItem(`np_response_${u.id}_${s.id}`) || 'null');
    if (r) {
      let row = [
        uIdx + 1,
        s.anonymous ? 'ไม่ระบุชื่อ' : `"${u.name}"`,
        `"${u.position}"`,
        `"${levels[u.level] || u.level}"`,
        `"${u.department}"`,
        r.completed ? 'เสร็จสิ้น' : 'ร่าง',
        r.submittedAt ? `"${new Date(r.submittedAt).toLocaleString('th-TH')}"` : ''
      ];

      if (s.is_quiz) {
        let totalPts = s.questions.reduce((a, q) => a + (Number(q.points) || 1), 0);
        let score = r.score ?? 0;
        let pct = totalPts > 0 ? Math.round((score / totalPts) * 100) : 0;
        let pass = s.passing_score ? pct >= s.passing_score : true;
        row.push(score, totalPts, `${pct}%`, pass ? 'ผ่าน' : 'ไม่ผ่าน');
      }

      s.questions.forEach(q => {
        let ans = r.answers[q.id];
        let ansText = Array.isArray(ans) ? ans.join('; ') : String(ans || '');
        row.push(`"${ansText.replace(/"/g, '""')}"`);
      });

      csvRows.push(row.join(','));
    }
  });

  download(`${s.title}-report.csv`, csvRows.join('\n'), 'text/csv;charset=utf-8');
}

// ----------------------------------------------------
// AUTH, UTILS, MODAL, TOAST
// ----------------------------------------------------

function adminLogin() {
  modal(
    'เข้าสู่ระบบผู้ดูแล',
    `
    <p class="muted">กรอกรหัสผ่านผู้ดูแลเพื่อจัดการแบบสอบถาม แบบทดสอบ และบุคลากร</p>
    <div class="field">
      <label>รหัสผ่าน</label>
      <input id="adminPass" type="password" autocomplete="current-password" placeholder="กรอกรหัสผ่าน">
    </div>
  `,
    `<button class="btn" onclick="verifyAdmin()"><i class="fa-solid fa-key"></i> เข้าสู่ระบบ</button>`
  );
}

async function verifyAdmin() {
  const password = document.querySelector('#adminPass').value;
  if (!password) return toast('กรุณากรอกรหัสผ่าน');
  const cfg = window.NURSEPULSE_CONFIG;

  if (cfg?.supabaseUrl && cfg?.supabaseAnonKey) {
    try {
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${cfg.adminFunction || 'verify-admin'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabaseAnonKey,
          'Authorization': `Bearer ${cfg.supabaseAnonKey}`
        },
        body: JSON.stringify({ password })
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error('invalid');
      state.admin = true;
      sessionStorage.setItem('np_admin', 'yes');
      if (payload.token) sessionStorage.setItem('np_admin_token', payload.token);
      closeModal();
      if (state.currentPage === 'admin') {
        render();
        fetchAdminUsers();
        fetchAdminSurveys();
      } else {
        navTo('admin.html');
      }
      return;
    } catch {
      toast('รหัสผ่านไม่ถูกต้อง หรือไม่สามารถเชื่อมต่อระบบได้');
      return;
    }
  }


  toast('รหัสผ่านไม่ถูกต้อง');
}

function downloadTemplate() {
  let csv = 'order,question_text,question_type,options,is_required,points,correct_answer\n' +
    '1,ตัวอย่างคำถามที่ 1 (ตัวเลือกเดียว),single_choice,ตัวเลือก A;ตัวเลือก B;ตัวเลือก C,true,2,ตัวเลือก A\n' +
    '2,ตัวอย่างคำถามที่ 2 (คำตอบสั้น),short_text,,false,1,100\n';
  download('nurse-survey-quiz-template.csv', csv, 'text/csv;charset=utf-8');
}

function importCSV(input) {
  let f = input.files[0];
  if (!f) return;
  let r = new FileReader();
  r.onload = (e) => {
    let text = e.target.result;
    let lines = text.trim().split('\n');
    if (lines.length <= 1) {
      toast('ไฟล์ CSV ไม่มีข้อมูล หรือรูปแบบไม่ถูกต้อง');
      return;
    }
    
    let parsedQuestions = [];
    let isQuizDetected = false;
    
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      
      let cols = parseCSVRow(line);
      if (cols.length < 3) continue;

      let qType = cols[2] || 'single_choice';
      let optionsStr = cols[3] || '';
      let options = optionsStr ? optionsStr.split(';').map(o => o.trim()).filter(Boolean) : ['ตัวเลือก 1', 'ตัวเลือก 2'];
      let points = parseInt(cols[5]) || 1;
      let correct_answer = cols[6] || '';
      
      if (points > 1 || correct_answer !== '') {
          isQuizDetected = true;
      }
      
      parsedQuestions.push({
        id: 'q_' + Date.now() + '_' + i,
        text: cols[1] || 'คำถามใหม่',
        type: qType,
        options: options,
        required: String(cols[4]).toLowerCase() === 'true',
        points: points,
        correct_answer: correct_answer
      });
    }
    
    if (parsedQuestions.length > 0) {
      state.builder = {
        id: null,
        title: f.name.replace(/\.csv$/i, ''),
        description: 'สร้างจากไฟล์นำเข้า CSV',
        is_quiz: isQuizDetected,
        passing_score: 80,
        is_anonymous: false,
        status: 'published',
        target_levels: ['head_of_group', 'head_of_unit', 'practitioner'],
        questions: parsedQuestions
      };
      
      switchAdminTab('builder');
      toast('นำเข้าคำถามสำเร็จ กรุณาตรวจสอบก่อนบันทึก');
    } else {
      toast('ไม่พบคำถามที่สามารถนำเข้าได้');
    }
    input.value = '';
  };
  r.readAsText(f);
}

function parseCSVRow(str) {
    let result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < str.length; i++) {
        let char = str[i];
        if (char === '"' && str[i+1] === '"') {
            cur += '"';
            i++;
        } else if (char === '"') {
            inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
            result.push(cur);
            cur = '';
        } else {
            cur += char;
        }
    }
    result.push(cur);
    return result;
}

function download(name, data, type) {
  let a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function modal(title, body, footer) {
  closeModal();
  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div class="modal-bg" id="modal">
      <div class="modal">
        <div class="modal-head">
          <h2>${title}</h2>
          <button class="icon-btn" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${body}
        <div class="footer-actions">${footer}</div>
      </div>
    </div>`
  );
}

function closeModal() {
  document.querySelector('#modal')?.remove();
}

function toast(t) {
  document.querySelector('.toast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="toast"><i class="fa-solid fa-circle-info" style="margin-right:6px"></i> ${t}</div>`);
  setTimeout(() => document.querySelector('.toast')?.remove(), 2800);
}

function setFilter(x) {
  state.filter = x;
  render();
}

function logout() {
  localStorage.removeItem('np_session');
  state.user = null;
  navTo('index.html');
}

function adminLogout() {
  sessionStorage.removeItem('np_admin');
  sessionStorage.removeItem('np_admin_token');
  state.admin = false;
  navTo('index.html');
}

function customConfirm(title, message) {
  return new Promise(resolve => {
    closeModal();
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="modal-bg" id="modal">
        <div class="modal" style="max-width: 400px; padding: 24px;">
          <h2 style="margin: 0; color: var(--navy); font-size: 20px;">${title}</h2>
          <div class="confirm-modal-body">${message}</div>
          <div class="confirm-actions">
            <button class="btn outline" id="confirm-btn-cancel">ยกเลิก</button>
            <button class="btn" style="background: var(--danger);" id="confirm-btn-ok">ยืนยัน</button>
          </div>
        </div>
      </div>`
    );
    
    document.getElementById('confirm-btn-cancel').onclick = () => {
      closeModal();
      resolve(false);
    };
    
    document.getElementById('confirm-btn-ok').onclick = () => {
      closeModal();
      resolve(true);
    };
  });
}

function showSkeletonLoading(text = 'กำลังโหลดข้อมูล...') {
  hideSkeletonLoading();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="skeleton-loading" class="skeleton-overlay">
      <div class="skeleton-spinner"></div>
      <div style="font-weight: 600; color: var(--navy); font-size: 16px;">${text}</div>
    </div>
  `);
}

function hideSkeletonLoading() {
  document.querySelector('#skeleton-loading')?.remove();
}

function saveProfile() {
  Object.assign(state.user, {
    name: document.querySelector('#editName').value,
    position: document.querySelector('#editPos').value,
    level: document.querySelector('#editLevel').value,
    department: document.querySelector('#editDept').value
  });
  users = users.map(u => (u.id === state.user.id ? state.user : u));
  saveUsers();
  localStorage.setItem('np_session', JSON.stringify(state.user));
  toast('บันทึกข้อมูลบัญชีแล้ว');
}

// ----------------------------------------------------
// MAIN ROUTER & INITIALIZATION
// ----------------------------------------------------

function render() {
  const page = state.currentPage;
  if (page === 'login') return renderLogin();
  if (page === 'dashboard') return renderDashboard();
  if (page === 'survey') return renderSurveyPage();
  if (page === 'admin') return renderAdmin();
  return renderHome();
}

// Init
render();

if (state.currentPage === 'dashboard' || state.currentPage === 'survey') {
  loadCloudData().then(() => render());
}

if (state.currentPage === 'admin' && state.admin) {
  fetchAdminUsers();
  fetchAdminSurveys();
}
