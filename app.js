/* ==========================================================================
   ระบบประเมินพฤติกรรมจริยธรรมวิชาชีพของพยาบาล
   กลุ่มการพยาบาล โรงพยาบาลสมเด็จพระยุพราชสว่างแดนดิน
   Database: Supabase PostgreSQL
   ========================================================================== */

const ETHICS_QUESTION_BANK = {"nursePairs": [{"order": 1, "pair_code": "QP-NURSE-01", "pair_id": "b1000000-0000-0000-0000-000000000001", "self_q_id": "q-nurse-self-1", "self_text": "ท่านม[...]"}], "unitHeadPairs": []};

// 5 System Roles
const roles = {
  NURSE: 'พยาบาลประจำการ',
  UNIT_HEAD: 'หัวหน้างาน',
  GROUP_HEAD: 'หัวหน้ากลุ่มงาน',
  HEAD_NURSE: 'หัวหน้าพยาบาล',
  ADMIN: 'ผู้ดูแลระบบ'
};

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

const RATING_SCALE = [
  { score: 1, label: 'น้อยที่สุด' },
  { score: 2, label: 'น้อย' },
  { score: 3, label: 'ปานกลาง' },
  { score: 4, label: 'มาก' },
  { score: 5, label: 'มากที่สุด' }
];

// App State
let state = {
  currentPage: detectPage(),
  user: JSON.parse(localStorage.getItem('np_session') || 'null'),
  admin: sessionStorage.getItem('np_admin') === 'yes',
  activePeriod: { id: 'p1', name: 'ประจำปี 2569' },
  dashboardData: null,
  dashboardTab: 'my_assessment',
  selectedDeptFilter: 'all',
  currentAssessment: null,
  answers: {},
  activeReport: null,
  adminTab: 'dashboard',
  adminUsers: [],
  userSortKey: 'name',
  userSortDir: 'asc',
  userFilterRole: 'all',
  userFilterDept: 'all',
  userSearchQuery: '',
  userPage: 1,
  userPageSize: 50,
  adminPeriods: [],
  adminTemplateView: null,
  sidebarCollapsed: localStorage.getItem('np_sidebar_collapsed') === '1',
  executiveData: null,
  execFilterDept: 'all',
  execFilterRole: 'all',
  execSearch: ''
};

let users = JSON.parse(localStorage.getItem('np_users') || 'null') || [];
const saveUsers = () => localStorage.setItem('np_users', JSON.stringify(users));
const app = document.querySelector('#app');
const esc = s => String(s || '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cloudEnabled = () => Boolean(window.NURSEPULSE_CONFIG?.supabaseUrl && window.NURSEPULSE_CONFIG?.supabaseAnonKey);

function detectPage() {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith('login.html')) return 'login';
  if (path.endsWith('dashboard.html')) return 'dashboard';
  if (path.endsWith('survey.html')) return 'survey';
  if (path.endsWith('admin.html')) return 'admin';
  return 'home';
}

function navTo(url) { window.location.href = url; }

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
    method: 'POST', headers, body: JSON.stringify({ action, ...input })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'api_error');
  }
  return res.json();
}

// ... rest of app.js unchanged until assessment functions ...

// ----------------------------------------------------
// 4. ASSESSMENT FORM PAGE
// ----------------------------------------------------
async function startAssessment(assignmentId, targetRole, assessmentType, targetUserId) {
  showSkeletonLoading('กำลังเปิดแบบประเมิน...');
  try {
    let questions = [];
    let targetUser;
    let cloudAnswers = null;

    if (cloudEnabled() && assignmentId && !String(assignmentId).startsWith('new_')) {
      const sheet = await api('get_assessment_sheet', { assignment_id: assignmentId });
      questions = (sheet.questions || [])
        .filter(q => q.active !== false)
        .sort((a, b) => (a.question_order || 0) - (b.question_order || 0))
        .map(q => ({ question_id: q.id, question_text: q.question_text, question_pair_id: q.question_pair_id, question_order: q.question_order }));

      const a = sheet.assignment;
      targetUser = a?.target ? { id: a.target.id, name: a.target.full_name } : (assessmentType === 'SELF' ? { id: state.user.id, name: state.user.name } : { id: targetUserId, name: 'ไม่ระบุชื่อ' });

      const existingResponse = a?.assessment_responses?.[0];
      if (existingResponse?.assessment_answers?.length) {
        cloudAnswers = {};
        existingResponse.assessment_answers.forEach(ans => { cloudAnswers[ans.question_id] = ans.score; });
      }
    } else {
      const pairs = targetRole === 'NURSE' ? ETHICS_QUESTION_BANK.nursePairs : ETHICS_QUESTION_BANK.unitHeadPairs;
      questions = pairs.map(p => ({ question_id: assessmentType === 'SELF' ? p.self_q_id : p.other_q_id, question_text: assessmentType === 'SELF' ? p.self_text : p.other_text, question_pair_id: p.pair_id, question_order: p.order }));
      if (assessmentType === 'SELF') targetUser = { id: state.user.id, name: state.user.name };
      else {
        const task = (state.dashboardData?.evaluateTasks || []).find(t => t.target_user_id === targetUserId);
        targetUser = { id: targetUserId, name: task?.target?.full_name || 'ไม่ระบุชื่อ' };
      }
    }

    if (!questions.length) throw new Error('no_questions');

    state.currentAssessment = { assignment_id: assignmentId, targetRole, assessmentType, questions, targetUser };
    state.answers = cloudAnswers || JSON.parse(localStorage.getItem(`np_ethics_answers_${state.user.id}_${assignmentId}`) || '{}');
    state.currentPage = 'survey';
    hideSkeletonLoading();
    render();
  } catch (e) {
    hideSkeletonLoading();
    toast('ไม่สามารถโหลดแบบประเมินได้');
  }
}

function renderSurveyPage() {
  const curr = state.currentAssessment;
  if (!curr) return navTo('dashboard.html');

  const surveyContent = `
    <div class="assessment-sticky-bar">
      <button class="btn ghost small" onclick="navTo('dashboard.html')"><i class="fa-solid fa-arrow-left"></i> กลับ</button>
      <div style="flex:1;text-align:center"><strong>แบบประเมินพฤติกรรมจริยธรรม</strong></div>
      <button class="btn small" onclick="submitAssessmentAnswers()"><i class="fa-solid fa-paper-plane"></i> ยืนยัน</button>
    </div>

    <div class="container assessment-container">
      <aside id="assessmentNotice" class="card notice notice-sticky">
        <div class="notice-head">
          <strong><i class="fa-solid fa-circle-info"></i> คำชี้แจง</strong>
        </div>
        <div class="notice-body">
          <p style="margin:8px 0 12px">โปรดพิจารณาข้อความแต่ละข้อ แล้วเลือกระดับคะแนนที่ตรงกับพฤติกรรมของผู้ถูกประเมินที่สุด (1 = น้อยที่สุด ... 5 = มากที่สุด)</p>
          <div class="scale-legend">
            <span><b>1</b> น้อยที่สุด</span>
            <span><b>2</b> น้อย</span>
            <span><b>3</b> ปานกลาง</span>
            <span><b>4</b> มาก</span>
            <span><b>5</b> มากที่สุด</span>
          </div>
        </div>
      </aside>

      <div class="questions-list" id="questionsList">
        ${curr.questions.map((q, idx) => `
          <section class="question-card" id="row_q_${q.question_id}" data-qid="${q.question_id}">
            <div class="question-text"><strong>${idx + 1}.</strong> ${esc(q.question_text)}</div>
            <div class="rating-row" role="radiogroup" aria-label="ระดับคะแนนข้อที่ ${idx + 1}">
              ${[1,2,3,4,5].map(s => `
                <button type="button"
                        class="rating-btn ${state.answers[q.question_id] == s ? 'selected' : ''}"
                        onclick="setAnswer('${q.question_id}', ${s})"
                        aria-checked="${state.answers[q.question_id] == s ? 'true' : 'false'}"
                        role="radio"
                        title="ให้คะแนน ${s}">
                  ${s}
                </button>
              `).join('')}
            </div>
          </section>
        `).join('')}
      </div>

      <div class="footer-actions" style="margin-bottom:40px">
        <a href="dashboard.html" class="btn outline" style="text-decoration:none"><i class="fa-solid fa-arrow-left"></i> ยกเลิก / กลับหน้าหลัก</a>
        <button class="btn outline" onclick="saveAssessmentDraft()"><i class="fa-solid fa-floppy-disk"></i> บันทึกร่าง</button>
        <button class="btn" onclick="submitAssessmentAnswers()"><i class="fa-solid fa-paper-plane"></i> ยืนยันส่งผลการประเมิน</button>
      </div>
    </div>
  `;

  app.innerHTML = `<div class="app-layout">${renderAppSidebar(state.dashboardTab || 'my_assessment')}<main class="app-main">${surveyContent}</main></div>`;

  // ensure any dynamic UI states are reflected (e.g., mark unanswered)
  curr.questions.forEach(q => {
    const el = document.querySelector(`#row_q_${q.question_id}`);
    if (el && (state.answers[q.question_id] === undefined || state.answers[q.question_id] === null)) {
      el.classList.add('unanswered');
    } else if (el) {
      el.classList.remove('unanswered');
    }
  });
}

function setAnswer(qId, score) {
  // store
  state.answers[qId] = score;
  const storageKey = `np_ethics_answers_${state.user.id}_${state.currentAssessment.assignment_id}`;
  localStorage.setItem(storageKey, JSON.stringify(state.answers));
  // update UI: clear other selected, mark this selected
  const row = document.querySelector(`#row_q_${qId}`);
  if (!row) return;
  row.classList.remove('unanswered');
  const buttons = row.querySelectorAll('.rating-btn');
  buttons.forEach(b => {
    if (Number(b.textContent.trim()) === Number(score)) {
      b.classList.add('selected');
      b.setAttribute('aria-checked', 'true');
    } else {
      b.classList.remove('selected');
      b.setAttribute('aria-checked', 'false');
    }
  });
}

function saveAssessmentDraft() {
  const storageKey = `np_ethics_answers_${state.user.id}_${state.currentAssessment.assignment_id}`;
  localStorage.setItem(storageKey, JSON.stringify(state.answers));
  toast('บันทึกร่างเรียบร้อยแล้ว');
}

// Validation & Submission
async function submitAssessmentAnswers() {
  const curr = state.currentAssessment;
  if (!curr) return;

  // Check validation
  const missing = [];
  curr.questions.forEach((q, idx) => {
    const val = state.answers[q.question_id];
    if (val === undefined || val === null || val < 1 || val > 5) {
      missing.push(idx + 1);
      document.querySelector(`#row_q_${q.question_id}`)?.classList.add('unanswered');
    }
  });

  if (missing.length > 0) {
    toast(`กรุณาตอบข้อที่ยังไม่ได้ประเมิน (ข้อที่ ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' ...' : ''})`);
    const firstMissingId = curr.questions[missing[0] - 1].question_id;
    document.querySelector(`#row_q_${firstMissingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  modal(
    'ยืนยันการส่งผลการประเมิน',
    `
      <div class="confirm-modal-body">
        <p>ท่านได้ตอบข้อคำถามครบถ้วนทั้ง <strong>${curr.questions.length} ข้อ</strong> แล้ว</p>
        <p class="muted">เมื่อยืนยันส่งผลการประเมิน ข้อมูลจะถูกบันทึกเข้าระบบอย่างถาวร</p>
      </div>
    `,
    `
      <div class="confirm-actions">
        <button class="btn outline" onclick="closeModal()">ยกเลิก</button>
        <button class="btn" onclick="executeSubmit()"><i class="fa-solid fa-check"></i> ยืนยันการส่ง</button>
      </div>
    `
  );
}

async function executeSubmit() {
  closeModal();
  showSkeletonLoading('กำลังบันทึกผลการประเมิน...');
  const curr = state.currentAssessment;

  const payloadAnswers = curr.questions.map(q => ({ question_id: q.question_id, question_pair_id: q.question_pair_id, question_order: q.question_order, score: state.answers[q.question_id] }));

  try {
    if (cloudEnabled() && curr.assignment_id && !curr.assignment_id.startsWith('new_')) {
      await api('submit_ethics_assessment', { assignment_id: curr.assignment_id, evaluator_id: state.user.id, answers: payloadAnswers });
    }

    const localResultKey = `np_ethics_sub_${curr.targetUser.id || curr.targetUser.name}_${curr.assessmentType}`;
    localStorage.setItem(localResultKey, JSON.stringify({ answers: state.answers, submittedAt: new Date().toISOString(), evaluatorName: state.user.name, evaluatorRole: state.user.role }));

    hideSkeletonLoading();
    toast('ส่งผลการประเมินเรียบร้อยแล้ว');
    navTo('dashboard.html');
  } catch (e) {
    hideSkeletonLoading();
    console.error(e);
    toast('เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
  }
}

// ... rest of app.js remains unchanged (reports, admin, utilities, render, init) ...

function render() {
  const page = state.currentPage;
  if (page === 'login') return renderLogin();
  if (page === 'dashboard') return renderDashboard();
  if (page === 'survey') return renderSurveyPage();
  if (page === 'admin') return renderAdmin();
  return renderHome();
}

render();

if (state.currentPage === 'dashboard') { loadDashboardData(); }
if (state.currentPage === 'admin' && state.admin) { fetchAdminUsers(); }
