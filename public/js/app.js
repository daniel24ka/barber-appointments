// === Barber Appointment System - Frontend ===

const App = {
  token: localStorage.getItem('barber_token'),
  user: JSON.parse(localStorage.getItem('barber_user') || 'null'),
  currentPage: 'dashboard',
  data: { barbers: [], services: [], clients: [] },
  calendar: { view: 'weekly', date: new Date(), barberFilter: '' },
};

// === API Helper ===
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (App.token) headers['Authorization'] = `Bearer ${App.token}`;
  const res = await fetch(`/api${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

// === Toast ===
function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${escHtml(message)}`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

// === Modal ===
function openModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

// === Util ===
const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const STATUS_HE = { pending: 'ממתין', confirmed: 'מאושר', completed: 'הושלם', cancelled: 'בוטל', no_show: 'לא הגיע' };
const TIER_HE = { gold: { name: 'זהב', icon: 'crown', color: '#F59E0B' }, silver: { name: 'כסף', icon: 'medal', color: '#9CA3AF' }, bronze: { name: 'ארד', icon: 'award', color: '#CD7F32' }, new: { name: 'חדש', icon: 'user', color: '#6B7280' } };
function tierBadge(loyalty) { if (!loyalty) return ''; const t = loyalty; return `<span class="badge" style="background:${t.color};color:#fff"><i class="fas fa-${t.icon}"></i> ${t.name}</span>`; }

function formatDate(d) { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()}`; }
function dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function getInitials(name) { return name.split(' ').map(w => w[0]).join('').substring(0, 2); }
function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function escAttr(str) { return String(str).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// === Auth ===
function login(token, user) {
  App.token = token; App.user = user;
  localStorage.setItem('barber_token', token);
  localStorage.setItem('barber_user', JSON.stringify(user));
  showApp();
}
function logout() {
  App.token = null; App.user = null;
  localStorage.removeItem('barber_token'); localStorage.removeItem('barber_user');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('appContainer').classList.add('hidden');
}

async function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  document.getElementById('currentUserName').textContent = App.user.display_name;
  document.getElementById('moreMenuUser').textContent = App.user.display_name;
  document.getElementById('todayDate').textContent = formatDate(new Date());

  if (App.user.role !== 'admin' && App.user.role !== 'super_admin') {
    // Non-admin: show settings as "profile" for password change
    const settingsNav = document.getElementById('settingsNav');
    if (settingsNav) {
      const label = settingsNav.querySelector('span') || settingsNav;
      if (label.textContent === 'הגדרות') label.textContent = 'פרופיל';
    }
    const settingsMore = document.getElementById('settingsMoreNav');
    if (settingsMore) {
      const label = settingsMore.querySelector('span');
      if (label && label.textContent === 'הגדרות') label.textContent = 'פרופיל';
    }
  }

  // Super admin: add tenants management nav link
  if (App.user.role === 'super_admin') {
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav && !document.querySelector('[data-page="tenants"]')) {
      const tenantsLink = document.createElement('a');
      tenantsLink.href = '#';
      tenantsLink.className = 'nav-item';
      tenantsLink.dataset.page = 'tenants';
      tenantsLink.innerHTML = '<i class="fas fa-building"></i><span>ניהול עסקים</span>';
      tenantsLink.addEventListener('click', (e) => { e.preventDefault(); navigate('tenants'); });
      // Insert before settings
      const settingsNav = document.getElementById('settingsNav');
      if (settingsNav) sidebarNav.insertBefore(tenantsLink, settingsNav);
      else sidebarNav.appendChild(tenantsLink);
    }
  }

  try {
    const [barbers, services, settings] = await Promise.all([
      api('/barbers'), api('/services'), api('/settings')
    ]);
    App.data.barbers = barbers;
    App.data.services = services;
    App.data.settings = settings;
    if (settings.shop_name) document.getElementById('shopName').textContent = settings.shop_name;
  } catch(e) { console.error(e); }

  // Check if user accepted terms of use
  try {
    const consent = await api('/consents/check');
    if (!consent.accepted) {
      showTermsAgreement();
      return;
    }
  } catch(e) { /* if check fails, proceed normally */ }

  navigate('dashboard');
}

function showTermsAgreement() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div style="max-width:650px;margin:2rem auto">
      <div class="card" style="border:2px solid var(--primary)">
        <div style="text-align:center;margin-bottom:1.5rem">
          <i class="fas fa-shield-alt" style="font-size:3rem;color:var(--primary)"></i>
          <h2 style="font-size:1.4rem;font-weight:700;margin-top:0.5rem">תנאי שימוש והסכמה לעיבוד מידע</h2>
          <p style="color:var(--text-secondary)">לפני השימוש הראשון במערכת, נא לקרוא ולאשר</p>
        </div>
        <div style="background:var(--bg);border-radius:var(--radius-sm);padding:1.25rem;max-height:350px;overflow-y:auto;font-size:0.9rem;line-height:1.8;margin-bottom:1.25rem;border:1px solid var(--border)">
          <h3 style="color:var(--primary-dark);margin-bottom:0.5rem">1. אחריות על המידע</h3>
          <p>כמשתמש מורשה במערכת, אני מתחייב/ת לשמור על סודיות המידע האישי של הלקוחות הנשמר במערכת, ולא להעבירו לצדדים שלישיים שלא לצורך.</p>

          <h3 style="color:var(--primary-dark);margin:1rem 0 0.5rem">2. שימוש ראוי</h3>
          <p>אני מתחייב/ת להשתמש במערכת אך ורק למטרות ניהול תורים ולקוחות של בית העסק, בהתאם לחוק הגנת הפרטיות, התשמ"א-1981.</p>

          <h3 style="color:var(--primary-dark);margin:1rem 0 0.5rem">3. אבטחת מידע</h3>
          <p>אני מתחייב/ת לשמור על סיסמה חזקה, לא לשתף את פרטי הגישה שלי, ולדווח מיידית על כל חשד לפריצה או שימוש לא מורשה.</p>

          <h3 style="color:var(--primary-dark);margin:1rem 0 0.5rem">4. מחיקת מידע</h3>
          <p>אני מבין/ה שלקוח רשאי לבקש מחיקת המידע שלו בכל עת, ואני מתחייב/ת לכבד בקשות כאלה ולפעול בהתאם.</p>

          <h3 style="color:var(--primary-dark);margin:1rem 0 0.5rem">5. תיעוד</h3>
          <p>אני מבין/ה שכל פעולה במערכת מתועדת, וכי הסכמה זו נשמרת עם חותמת זמן וכתובת IP לצורך הוכחת ציות לחוק.</p>
        </div>

        <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;margin-bottom:1rem;font-size:0.95rem">
          <input type="checkbox" id="termsAccept" style="margin-top:0.3rem;width:20px;height:20px;flex-shrink:0">
          <span>קראתי את תנאי השימוש ואני מסכים/ה לפעול בהתאם להם ובהתאם ל<a href="/privacy.html" target="_blank" style="color:var(--primary);font-weight:600;text-decoration:underline">מדיניות הפרטיות</a>.</span>
        </label>

        <button class="btn btn-primary btn-block" id="termsSubmitBtn" onclick="acceptTerms()" disabled>
          <i class="fas fa-check-circle"></i> אני מאשר/ת ומסכים/ה
        </button>
        <p id="termsError" style="color:var(--danger);text-align:center;margin-top:0.5rem;display:none"></p>
      </div>
    </div>
  `;
  document.getElementById('termsAccept').addEventListener('change', function() {
    document.getElementById('termsSubmitBtn').disabled = !this.checked;
  });
}

async function acceptTerms() {
  const cb = document.getElementById('termsAccept');
  if (!cb.checked) return;
  const btn = document.getElementById('termsSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';

  try {
    await api('/consents/terms', {
      method: 'POST',
      body: JSON.stringify({
        consent_text: 'קראתי את תנאי השימוש ואני מסכים/ה לפעול בהתאם להם ובהתאם למדיניות הפרטיות. אני מתחייב/ת לשמור על סודיות המידע, להשתמש במערכת למטרות מורשות בלבד, ולפעול בהתאם לחוק הגנת הפרטיות.'
      })
    });
    toast('ההסכמה נשמרה בהצלחה');
    navigate('dashboard');
  } catch(e) {
    const errEl = document.getElementById('termsError');
    errEl.textContent = e.message || 'שגיאה בשמירת ההסכמה';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> אני מאשר/ת ומסכים/ה';
  }
}

// === Navigation ===
function navigate(page) {
  App.currentPage = page;
  // Update desktop sidebar nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  // Update mobile bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(n => {
    if (n.dataset.page !== 'more') n.classList.toggle('active', n.dataset.page === page);
  });

  const titles = {
    dashboard: 'לוח בקרה', calendar: 'יומן תורים', appointments: 'רשימת תורים',
    newAppointment: 'תור חדש', clients: 'לקוחות', barbers: 'ספרים',
    services: 'שירותים', reports: 'דוחות הכנסות', settings: 'הגדרות',
    tenants: 'ניהול עסקים'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '';

  const renderers = {
    dashboard: renderDashboard, calendar: renderCalendar, appointments: renderAppointments,
    newAppointment: renderNewAppointment, clients: renderClients, barbers: renderBarbers,
    services: renderServices, reports: renderReports, settings: renderSettings,
    tenants: renderTenants
  };
  if (renderers[page]) renderers[page]();

  // Close more menu if open
  const moreMenu = document.getElementById('moreMenu');
  if (moreMenu) moreMenu.classList.add('hidden');
  document.body.style.overflow = '';
}

// === Dashboard ===
async function renderDashboard() {
  const area = document.getElementById('contentArea');
  area.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>טוען...</h3></div>';

  try {
    const stats = await api('/dashboard/stats');

    const maxCount = Math.max(...stats.weekStats.map(d => d.count), 1);

    area.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-calendar-day"></i></div><div class="stat-info"><h4>תורים היום</h4><div class="stat-value">${stats.todayAppointments}</div></div></div>
        <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-clock"></i></div><div class="stat-info"><h4>ממתינים לאישור</h4><div class="stat-value">${stats.pendingAppointments}</div></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-users"></i></div><div class="stat-info"><h4>סה"כ לקוחות</h4><div class="stat-value">${stats.totalClients}</div></div></div>
        <div class="stat-card"><div class="stat-icon cyan"><i class="fas fa-user-tie"></i></div><div class="stat-info"><h4>ספרים פעילים</h4><div class="stat-value">${stats.totalBarbers}</div></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-shekel-sign"></i></div><div class="stat-info"><h4>הכנסות היום</h4><div class="stat-value">₪${stats.todayRevenue}</div></div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-chart-line"></i></div><div class="stat-info"><h4>הכנסות החודש</h4><div class="stat-value">₪${stats.monthRevenue}</div></div></div>
      </div>

      <div class="stats-grid" style="margin-top:.5rem">
        <div class="stat-card"><div class="stat-icon" style="background:#FDE68A;color:#92400E"><i class="fas fa-user-plus"></i></div><div class="stat-info"><h4>לקוחות חדשים החודש</h4><div class="stat-value">${stats.newClientsMonth || 0}</div></div></div>
        <div class="stat-card"><div class="stat-icon" style="background:#D1FAE5;color:#065F46"><i class="fas fa-redo"></i></div><div class="stat-info"><h4>אחוז לקוחות חוזרים</h4><div class="stat-value">${stats.returningRate || 0}%</div></div></div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-bell"></i> תזכורות - תורים ממתינים</h3></div>
          ${stats.reminders.length ? stats.reminders.map(r => `
            <div class="reminder-item">
              <i class="fas fa-exclamation-circle"></i>
              <div class="reminder-text"><strong>${escHtml(r.client_name)}</strong> - ${r.start_time} אצל ${escHtml(r.barber_name)}</div>
              <div class="reminder-actions">
                <button class="btn btn-sm btn-success" onclick="updateApptStatus(${r.id},'confirmed')"><i class="fas fa-check"></i></button>
                <button class="btn btn-sm btn-danger" onclick="updateApptStatus(${r.id},'cancelled')"><i class="fas fa-times"></i></button>
              </div>
            </div>
          `).join('') : '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>אין תזכורות</h3></div>'}
        </div>

        <div class="card">
          <div class="card-header"><h3><i class="fas fa-chart-bar"></i> תורים השבוע</h3></div>
          <div class="week-bar">
            ${stats.weekStats.map(d => `
              <div class="week-bar-item">
                <div class="bar ${d.date === dateStr(new Date()) ? 'today' : ''}" style="height:${Math.max((d.count/maxCount)*80, 4)}px"></div>
                <span>${DAYS_HE[d.day]}</span>
                <span style="font-weight:600">${d.count}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="dashboard-grid" style="margin-top:1rem">
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-trophy" style="color:#F59E0B"></i> לקוחות מובילים</h3></div>
          ${stats.topClients?.length ? stats.topClients.map((c, i) => `
            <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border-bottom:1px solid var(--border);cursor:pointer" onclick="viewClient(${c.id})">
              <span style="font-weight:700;color:${i===0?'#F59E0B':i===1?'#9CA3AF':i===2?'#CD7F32':'var(--text-secondary)'};font-size:1.1rem;width:1.5rem">${i+1}</span>
              <div style="flex:1">
                <strong>${escHtml(c.name)}</strong> ${c.vip ? '<span class="badge badge-vip" style="font-size:.65rem">VIP</span>' : ''}
                <div style="font-size:.8rem;color:var(--text-secondary)">${c.total_visits} ביקורים</div>
              </div>
            </div>
          `).join('') : '<div class="empty-state" style="padding:1rem"><small>אין נתונים עדיין</small></div>'}
        </div>

        <div class="card">
          <div class="card-header"><h3><i class="fas fa-user-clock" style="color:#EF4444"></i> לקוחות בסיכון נטישה</h3></div>
          ${stats.atRiskClients?.length ? stats.atRiskClients.map(c => {
            const days = Math.floor((new Date() - new Date(c.last_visit)) / (1000*60*60*24));
            return `
            <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border-bottom:1px solid var(--border);cursor:pointer" onclick="viewClient(${c.id})">
              <i class="fas fa-exclamation-triangle" style="color:${days > 60 ? '#EF4444' : '#F59E0B'}"></i>
              <div style="flex:1">
                <strong>${escHtml(c.name)}</strong>
                <div style="font-size:.8rem;color:var(--text-secondary)">לא ביקר ${days} ימים · ${c.total_visits} ביקורים</div>
              </div>
              <a href="tel:${escAttr(c.phone)}" class="btn btn-sm btn-outline" onclick="event.stopPropagation()" title="התקשר"><i class="fas fa-phone"></i></a>
            </div>`;
          }).join('') : '<div class="empty-state" style="padding:1rem"><i class="fas fa-check-circle" style="color:#10B981"></i><small>אין לקוחות בסיכון</small></div>'}
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3><i class="fas fa-list"></i> תורים קרובים</h3>
          <button class="btn btn-sm btn-primary" onclick="navigate('newAppointment')"><i class="fas fa-plus"></i> תור חדש</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr><th>תאריך</th><th>שעה</th><th>לקוח</th><th>ספר</th><th>שירות</th><th>סטטוס</th><th>פעולות</th></tr></thead>
            <tbody>
              ${stats.upcoming.length ? stats.upcoming.map(a => `
                <tr>
                  <td>${formatDate(a.date)}</td>
                  <td>${a.start_time}</td>
                  <td>${escHtml(a.client_name)}</td>
                  <td><span class="color-dot" style="background:${escAttr(a.barber_color)}"></span> ${escHtml(a.barber_name)}</td>
                  <td>${escHtml(a.service_name)}</td>
                  <td><span class="badge badge-${a.status}">${STATUS_HE[a.status]}</span></td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline" onclick="viewAppointment(${a.id})"><i class="fas fa-eye"></i></button>
                      ${a.status === 'pending' ? `<button class="btn btn-sm btn-success" onclick="updateApptStatus(${a.id},'confirmed')"><i class="fas fa-check"></i></button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('') : '<tr><td colspan="7" class="empty-state">אין תורים קרובים</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) { area.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>${escHtml(e.message)}</h3></div>`; }
}

async function updateApptStatus(id, status) {
  try {
    await api(`/appointments/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    toast(`התור ${STATUS_HE[status]} בהצלחה`);
    if (App.currentPage === 'dashboard') renderDashboard();
    else if (App.currentPage === 'appointments') renderAppointments();
    else if (App.currentPage === 'calendar') renderCalendar();
  } catch(e) { toast(e.message, 'error'); }
}

// === Calendar ===
async function renderCalendar() {
  const area = document.getElementById('contentArea');
  const d = App.calendar.date;
  const view = App.calendar.view;

  // Calculate week range
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const barberOptions = App.data.barbers.map(b => `<option value="${b.id}" ${App.calendar.barberFilter == b.id ? 'selected' : ''}>${b.name}</option>`).join('');

  let headerText = '';
  if (view === 'weekly') {
    headerText = `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
  } else {
    headerText = `${DAYS_HE[d.getDay()]} ${d.getDate()} ${MONTHS_HE[d.getMonth()]} ${d.getFullYear()}`;
  }

  area.innerHTML = `
    <div class="calendar-controls">
      <div class="calendar-nav">
        <button class="btn btn-outline btn-sm" onclick="calendarNav(-1)"><i class="fas fa-chevron-right"></i></button>
        <h3>${headerText}</h3>
        <button class="btn btn-outline btn-sm" onclick="calendarNav(1)"><i class="fas fa-chevron-left"></i></button>
        <button class="btn btn-sm btn-primary" onclick="App.calendar.date=new Date();renderCalendar()">היום</button>
      </div>
      <div class="calendar-filters">
        <select onchange="App.calendar.barberFilter=this.value;renderCalendar()">
          <option value="">כל הספרים</option>${barberOptions}
        </select>
        <div class="view-toggle">
          <button class="${view==='weekly'?'active':''}" onclick="App.calendar.view='weekly';renderCalendar()">שבועי</button>
          <button class="${view==='daily'?'active':''}" onclick="App.calendar.view='daily';renderCalendar()">יומי</button>
        </div>
      </div>
    </div>
    <div id="calendarBody"></div>
  `;

  // Fetch appointments
  let queryParams = '';
  if (view === 'weekly') {
    queryParams = `?start_date=${dateStr(weekStart)}&end_date=${dateStr(weekEnd)}`;
  } else {
    queryParams = `?date=${dateStr(d)}`;
  }
  if (App.calendar.barberFilter) queryParams += `&barber_id=${App.calendar.barberFilter}`;

  try {
    const appts = await api(`/appointments${queryParams}`);
    if (view === 'weekly') renderWeeklyCalendar(appts, weekStart);
    else renderDailyCalendar(appts, d);
  } catch(e) { document.getElementById('calendarBody').innerHTML = `<div class="empty-state"><h3>${escHtml(e.message)}</h3></div>`; }
}

function calendarNav(dir) {
  const d = App.calendar.date;
  if (App.calendar.view === 'weekly') d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  renderCalendar();
}

function renderWeeklyCalendar(appts, weekStart) {
  const body = document.getElementById('calendarBody');
  const today = dateStr(new Date());
  const openH = parseInt((App.data.settings?.open_time || '09:00').split(':')[0]);
  const closeH = parseInt((App.data.settings?.close_time || '20:00').split(':')[0]);
  const hours = [];
  for (let h = openH; h <= closeH; h++) hours.push(`${String(h).padStart(2,'0')}:00`);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(weekStart);
    dd.setDate(weekStart.getDate() + i);
    days.push({ date: dateStr(dd), day: dd.getDay(), label: `${DAYS_HE[dd.getDay()]} ${dd.getDate()}/${dd.getMonth()+1}` });
  }

  let html = `<div class="calendar-grid weekly">`;
  // Header
  html += `<div class="calendar-header-cell"></div>`;
  days.forEach(day => {
    html += `<div class="calendar-header-cell ${day.date === today ? 'today-col' : ''}">${day.label}</div>`;
  });

  // Time rows
  hours.forEach(hour => {
    html += `<div class="time-cell">${hour}</div>`;
    days.forEach(day => {
      const cellAppts = appts.filter(a => a.date === day.date && a.start_time >= hour && a.start_time < `${String(parseInt(hour)+1).padStart(2,'0')}:00`);
      html += `<div class="calendar-cell" onclick="quickBook('${day.date}','${hour}')">`;
      cellAppts.forEach(a => {
        html += `<div class="calendar-appt" style="background:${escAttr(a.barber_color || '#4F46E5')}" onclick="event.stopPropagation();viewAppointment(${a.id})" title="${escAttr(a.client_name)} - ${escAttr(a.service_name)}">${a.start_time} ${escHtml(a.client_name)}</div>`;
      });
      html += `</div>`;
    });
  });

  html += `</div>`;
  body.innerHTML = html;
}

function renderDailyCalendar(appts, d) {
  const body = document.getElementById('calendarBody');
  const openH = parseInt((App.data.settings?.open_time || '09:00').split(':')[0]);
  const closeH = parseInt((App.data.settings?.close_time || '20:00').split(':')[0]);
  const hours = [];
  for (let h = openH; h <= closeH; h++) {
    hours.push(`${String(h).padStart(2,'0')}:00`);
    hours.push(`${String(h).padStart(2,'0')}:30`);
  }

  let html = `<div class="calendar-grid daily">`;
  html += `<div class="calendar-header-cell"></div><div class="calendar-header-cell">${DAYS_HE[d.getDay()]} ${formatDate(d)}</div>`;

  hours.forEach(time => {
    html += `<div class="time-cell">${time}</div>`;
    const [th, tm] = time.split(':').map(Number);
    const slotMin = th * 60 + tm;
    const cellAppts = appts.filter(a => {
      const [ah, am] = a.start_time.split(':').map(Number);
      const aMin = ah * 60 + am;
      return aMin >= slotMin && aMin < slotMin + 30;
    });
    html += `<div class="calendar-cell" onclick="quickBook('${dateStr(d)}','${time}')">`;
    cellAppts.forEach(a => {
      html += `<div class="calendar-appt" style="background:${escAttr(a.barber_color || '#4F46E5')};padding:.4rem .6rem" onclick="event.stopPropagation();viewAppointment(${a.id})">
        <strong>${a.start_time}-${a.end_time}</strong> | ${escHtml(a.client_name)} | ${escHtml(a.barber_name)} | ${escHtml(a.service_name)}
        <span class="badge badge-${a.status}" style="margin-right:.5rem">${STATUS_HE[a.status]}</span>
      </div>`;
    });
    html += `</div>`;
  });

  html += `</div>`;
  body.innerHTML = html;
}

function quickBook(date, time) {
  App.quickBookDate = date;
  App.quickBookTime = time;
  navigate('newAppointment');
}

// === Appointments List ===
async function renderAppointments() {
  const area = document.getElementById('contentArea');
  const today = dateStr(new Date());

  const barberOptions = App.data.barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

  area.innerHTML = `
    <div class="filter-bar">
      <input type="date" id="apptDateFilter" value="${today}" onchange="loadAppointments()">
      <select id="apptBarberFilter" onchange="loadAppointments()"><option value="">כל הספרים</option>${barberOptions}</select>
      <select id="apptStatusFilter" onchange="loadAppointments()">
        <option value="">כל הסטטוסים</option>
        <option value="pending">ממתין</option><option value="confirmed">מאושר</option>
        <option value="completed">הושלם</option><option value="cancelled">בוטל</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="navigate('newAppointment')"><i class="fas fa-plus"></i> תור חדש</button>
    </div>
    <div class="card"><div class="table-container" id="apptTableBody"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div></div>
  `;
  loadAppointments();
}

async function loadAppointments() {
  const date = document.getElementById('apptDateFilter').value;
  const barber = document.getElementById('apptBarberFilter').value;
  const status = document.getElementById('apptStatusFilter').value;

  let q = `?date=${date}`;
  if (barber) q += `&barber_id=${barber}`;
  if (status) q += `&status=${status}`;

  try {
    const appts = await api(`/appointments${q}`);
    const tbody = document.getElementById('apptTableBody');

    if (!appts.length) {
      tbody.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>אין תורים בתאריך זה</h3></div>';
      return;
    }

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      tbody.innerHTML = `<div class="cards-list">${appts.map(a => `
        <div class="info-card">
          <div class="info-card-header">
            <span class="badge badge-${a.status}">${STATUS_HE[a.status]}</span>
            <strong>${a.start_time}-${a.end_time}</strong>
          </div>
          <div class="info-card-body">
            <div class="info-card-row"><span class="info-label">לקוח:</span> ${escHtml(a.client_name)}</div>
            <div class="info-card-row"><span class="info-label">טלפון:</span> <a href="tel:${escAttr(a.client_phone)}">${escHtml(a.client_phone)}</a></div>
            <div class="info-card-row"><span class="info-label">ספר:</span> <span class="color-dot" style="background:${escAttr(a.barber_color)}"></span> ${escHtml(a.barber_name)}</div>
            <div class="info-card-row"><span class="info-label">שירות:</span> ${escHtml(a.service_name)} (${a.duration} דק')</div>
            <div class="info-card-row"><span class="info-label">מחיר:</span> ₪${a.price || 0}</div>
          </div>
          <div class="info-card-actions">
            <button class="btn btn-sm btn-outline" onclick="viewAppointment(${a.id})"><i class="fas fa-eye"></i> צפה</button>
            ${a.status==='pending'?`<button class="btn btn-sm btn-success" onclick="updateApptStatus(${a.id},'confirmed')"><i class="fas fa-check"></i> אשר</button>`:''}
            ${a.status==='confirmed'?`<button class="btn btn-sm btn-primary" onclick="updateApptStatus(${a.id},'completed')"><i class="fas fa-check-double"></i> הושלם</button>`:''}
            ${['pending','confirmed'].includes(a.status)?`<button class="btn btn-sm btn-danger" onclick="updateApptStatus(${a.id},'cancelled')"><i class="fas fa-times"></i> בטל</button>`:''}
          </div>
        </div>
      `).join('')}</div>`;
    } else {
      tbody.innerHTML = `
        <table>
          <thead><tr><th>שעה</th><th>לקוח</th><th>טלפון</th><th>ספר</th><th>שירות</th><th>משך</th><th>מחיר</th><th>סטטוס</th><th>פעולות</th></tr></thead>
          <tbody>${appts.map(a => `
            <tr>
              <td><strong>${a.start_time}-${a.end_time}</strong></td>
              <td>${escHtml(a.client_name)}</td>
              <td><a href="tel:${escAttr(a.client_phone)}">${escHtml(a.client_phone)}</a></td>
              <td><span class="color-dot" style="background:${escAttr(a.barber_color)}"></span> ${escHtml(a.barber_name)}</td>
              <td>${escHtml(a.service_name)}</td>
              <td>${a.duration} דק'</td>
              <td>₪${a.price || 0}</td>
              <td><span class="badge badge-${a.status}">${STATUS_HE[a.status]}</span></td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="viewAppointment(${a.id})" title="צפה"><i class="fas fa-eye"></i></button>
                  ${a.status==='pending'?`<button class="btn btn-sm btn-success" onclick="updateApptStatus(${a.id},'confirmed')" title="אשר"><i class="fas fa-check"></i></button>`:''}
                  ${a.status==='confirmed'?`<button class="btn btn-sm btn-primary" onclick="updateApptStatus(${a.id},'completed')" title="הושלם"><i class="fas fa-check-double"></i></button>`:''}
                  ${['pending','confirmed'].includes(a.status)?`<button class="btn btn-sm btn-danger" onclick="updateApptStatus(${a.id},'cancelled')" title="בטל"><i class="fas fa-times"></i></button>`:''}
                </div>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
      `;
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function viewAppointment(id) {
  try {
    const a = await api(`/appointments/${id}`);
    openModal('פרטי תור', `
      <div style="display:grid;gap:.75rem">
        <div><strong>לקוח:</strong> ${escHtml(a.client_name)}</div>
        <div><strong>טלפון:</strong> <a href="tel:${escAttr(a.client_phone)}">${escHtml(a.client_phone)}</a></div>
        <div><strong>אימייל:</strong> ${escHtml(a.client_email || '-')}</div>
        <div><strong>ספר:</strong> ${escHtml(a.barber_name)}</div>
        <div><strong>שירות:</strong> ${escHtml(a.service_name)}</div>
        <div><strong>תאריך:</strong> ${formatDate(a.date)}</div>
        <div><strong>שעה:</strong> ${a.start_time} - ${a.end_time}</div>
        <div><strong>משך:</strong> ${a.duration} דקות</div>
        <div><strong>מחיר:</strong> ₪${a.price || 0}</div>
        <div><strong>סטטוס:</strong> <span class="badge badge-${a.status}">${STATUS_HE[a.status]}</span></div>
        <div><strong>הערות:</strong> ${escHtml(a.notes || '-')}</div>
      </div>
      <div class="modal-actions">
        ${a.status==='pending'?`<button class="btn btn-success" onclick="updateApptStatus(${a.id},'confirmed');closeModal()"><i class="fas fa-check"></i> אשר</button>`:''}
        ${a.status==='confirmed'?`<button class="btn btn-primary" onclick="updateApptStatus(${a.id},'completed');closeModal()"><i class="fas fa-check-double"></i> הושלם</button>`:''}
        ${['pending','confirmed'].includes(a.status)?`<button class="btn btn-danger" onclick="updateApptStatus(${a.id},'cancelled');closeModal()"><i class="fas fa-times"></i> בטל</button>`:''}
        <button class="btn btn-outline" onclick="closeModal()">סגור</button>
      </div>
    `);
  } catch(e) { toast(e.message, 'error'); }
}

// === New Appointment ===
async function renderNewAppointment() {
  const area = document.getElementById('contentArea');
  const barberOpts = App.data.barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const serviceOpts = App.data.services.map(s => `<option value="${s.id}">${s.name} (${s.duration} דק' - ₪${s.price})</option>`).join('');

  const preDate = App.quickBookDate || dateStr(new Date());
  App.quickBookDate = null;

  area.innerHTML = `
    <div class="card book-form">
      <div class="card-header"><h3><i class="fas fa-plus-circle"></i> קביעת תור חדש</h3></div>

      <div class="form-row">
        <div class="form-group">
          <label>ספר</label>
          <select id="bookBarber" onchange="loadAvailableSlots()">${barberOpts}</select>
        </div>
        <div class="form-group">
          <label>שירות</label>
          <select id="bookService" onchange="loadAvailableSlots()">${serviceOpts}</select>
        </div>
      </div>

      <div class="form-group">
        <label>תאריך</label>
        <input type="date" id="bookDate" value="${preDate}" onchange="loadAvailableSlots()">
      </div>

      <div class="form-group">
        <label>שעה פנויה</label>
        <div id="slotsContainer" class="slot-grid"><div class="empty-state"><small>בחר ספר, שירות ותאריך</small></div></div>
      </div>

      <div class="form-group">
        <label>לקוח</label>
        <div class="search-bar">
          <i class="fas fa-search"></i>
          <input type="text" id="clientSearch" placeholder="חפש לקוח לפי שם או טלפון..." oninput="searchClientsForBooking(this.value)">
        </div>
        <div id="clientResults"></div>
        <input type="hidden" id="bookClientId">
        <div id="selectedClient" class="hidden" style="margin-top:.5rem"></div>
        <button class="btn btn-sm btn-outline" style="margin-top:.5rem" onclick="showNewClientModal()"><i class="fas fa-user-plus"></i> לקוח חדש</button>
      </div>

      <div class="form-group">
        <label>הערות</label>
        <textarea id="bookNotes" placeholder="הערות לתור (לא חובה)"></textarea>
      </div>

      <button class="btn btn-primary btn-block" onclick="submitAppointment()">
        <i class="fas fa-calendar-check"></i> קבע תור
      </button>
    </div>
  `;

  loadAvailableSlots();
}

async function loadAvailableSlots() {
  const barberId = document.getElementById('bookBarber').value;
  const serviceId = document.getElementById('bookService').value;
  const date = document.getElementById('bookDate').value;
  const container = document.getElementById('slotsContainer');

  if (!barberId || !serviceId || !date) return;

  try {
    const data = await api(`/appointments/slots/${barberId}/${date}?service_id=${serviceId}`);
    if (data.reason) {
      container.innerHTML = `<div class="empty-state"><small>${escHtml(data.reason)}</small></div>`;
      return;
    }
    if (!data.slots.length) {
      container.innerHTML = '<div class="empty-state"><small>אין משבצות זמינות</small></div>';
      return;
    }

    container.innerHTML = data.slots.map(s =>
      `<button class="slot-btn ${s.available ? '' : 'unavailable'}" onclick="${s.available ? `selectSlot(this,'${s.start}')` : ''}">${s.start}</button>`
    ).join('');

    // Auto-select quick book time
    if (App.quickBookTime) {
      const btn = container.querySelector(`.slot-btn:not(.unavailable)`);
      if (btn) selectSlot(btn, App.quickBookTime);
      App.quickBookTime = null;
    }
  } catch(e) { container.innerHTML = `<div class="empty-state"><small>${escHtml(e.message)}</small></div>`; }
}

function selectSlot(el, time) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  App.selectedSlot = time;
}

async function searchClientsForBooking(term) {
  const container = document.getElementById('clientResults');
  if (term.length < 2) { container.innerHTML = ''; return; }

  try {
    const clients = await api(`/clients?search=${encodeURIComponent(term)}`);
    container.innerHTML = clients.slice(0, 8).map(c => `
      <div class="client-card" onclick="selectClientForBooking(${c.id}, '${escAttr(c.name)}', '${escAttr(c.phone)}')">
        <div class="client-avatar" style="${c.loyalty ? `background:${c.loyalty.color}` : ''}">${escHtml(getInitials(c.name))}</div>
        <div class="client-details">
          <h4>${escHtml(c.name)} ${c.vip ? '<span class="badge badge-vip">VIP</span>' : ''} ${c.loyalty ? tierBadge(c.loyalty) : ''}</h4>
          <p>${escHtml(c.phone)} ${c.total_visits > 0 ? `· ${c.total_visits} ביקורים` : '· לקוח חדש'}</p>
        </div>
      </div>
    `).join('');
  } catch(e) { container.innerHTML = ''; }
}

function selectClientForBooking(id, name, phone) {
  document.getElementById('bookClientId').value = id;
  document.getElementById('clientSearch').value = '';
  document.getElementById('clientResults').innerHTML = '';
  const sel = document.getElementById('selectedClient');
  sel.classList.remove('hidden');
  sel.innerHTML = `<div class="client-card"><div class="client-avatar">${escHtml(getInitials(name))}</div><div class="client-details"><h4>${escHtml(name)}</h4><p>${escHtml(phone)}</p></div><button class="btn btn-sm btn-outline" onclick="clearSelectedClient()"><i class="fas fa-times"></i></button></div>`;
}

function clearSelectedClient() {
  document.getElementById('bookClientId').value = '';
  document.getElementById('selectedClient').classList.add('hidden');
}

function showNewClientModal() {
  openModal('לקוח חדש', `
    <div class="form-group"><label>שם</label><input type="text" id="newClientName" required></div>
    <div class="form-group"><label>טלפון</label><input type="text" id="newClientPhone"></div>
    <div class="form-group"><label>אימייל</label><input type="email" id="newClientEmail"></div>
    <div class="form-group"><label>הערות</label><textarea id="newClientNotes"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="createClientFromModal()"><i class="fas fa-save"></i> שמור</button>
      <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function createClientFromModal() {
  try {
    const client = await api('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('newClientName').value,
        phone: document.getElementById('newClientPhone').value,
        email: document.getElementById('newClientEmail').value,
        notes: document.getElementById('newClientNotes').value,
      })
    });
    selectClientForBooking(client.id, client.name, client.phone);
    closeModal();
    toast('הלקוח נוצר בהצלחה');
  } catch(e) { toast(e.message, 'error'); }
}

async function submitAppointment() {
  const clientId = document.getElementById('bookClientId').value;
  const barberId = document.getElementById('bookBarber').value;
  const serviceId = document.getElementById('bookService').value;
  const date = document.getElementById('bookDate').value;
  const notes = document.getElementById('bookNotes').value;

  if (!clientId) return toast('נא לבחור לקוח', 'warning');
  if (!App.selectedSlot) return toast('נא לבחור שעה', 'warning');

  try {
    await api('/appointments', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, barber_id: barberId, service_id: serviceId, date, start_time: App.selectedSlot, notes })
    });
    toast('התור נקבע בהצלחה!');
    App.selectedSlot = null;
    navigate('appointments');
  } catch(e) { toast(e.message, 'error'); }
}

// === Clients ===
async function renderClients() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="clientSearchMain" placeholder="חפש לקוח..." oninput="loadClients(this.value)"></div>
    <div class="client-filters" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem">
      <button class="btn btn-sm btn-outline filter-active" onclick="filterClients('all',this)">הכל</button>
      <button class="btn btn-sm btn-outline" onclick="filterClients('gold',this)" style="border-color:#F59E0B;color:#F59E0B"><i class="fas fa-crown"></i> זהב</button>
      <button class="btn btn-sm btn-outline" onclick="filterClients('silver',this)" style="border-color:#9CA3AF;color:#9CA3AF"><i class="fas fa-medal"></i> כסף</button>
      <button class="btn btn-sm btn-outline" onclick="filterClients('bronze',this)" style="border-color:#CD7F32;color:#CD7F32"><i class="fas fa-award"></i> ארד</button>
      <button class="btn btn-sm btn-outline" onclick="filterClients('risk',this)"><i class="fas fa-exclamation-triangle" style="color:#EF4444"></i> בסיכון</button>
      <select id="clientSort" onchange="loadClients(document.getElementById('clientSearchMain').value)" style="margin-right:auto;padding:.35rem;border-radius:6px;border:1px solid var(--border)">
        <option value="name">מיין לפי שם</option>
        <option value="visits">מיין לפי ביקורים</option>
        <option value="recent">מיין לפי ביקור אחרון</option>
      </select>
    </div>
    <div class="card">
      <div class="card-header"><h3>רשימת לקוחות</h3><button class="btn btn-primary btn-sm" onclick="showNewClientPage()"><i class="fas fa-user-plus"></i> לקוח חדש</button></div>
      <div id="clientsList"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div>
    </div>
  `;
  App._clientFilter = 'all';
  loadClients('');
}

function filterClients(filter, el) {
  App._clientFilter = filter;
  document.querySelectorAll('.client-filters .btn').forEach(b => b.classList.remove('filter-active'));
  el.classList.add('filter-active');
  loadClients(document.getElementById('clientSearchMain').value);
}

async function loadClients(search) {
  try {
    const sort = document.getElementById('clientSort')?.value || 'name';
    const filter = App._clientFilter || 'all';
    let url = `/clients?sort=${sort}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (filter !== 'all' && filter !== 'risk') url += `&tier=${filter}`;

    let clients = await api(url);
    const container = document.getElementById('clientsList');

    // Client-side filter for "at risk" (30+ days since last visit)
    if (filter === 'risk') {
      clients = clients.filter(c => c.churn_risk === 'high' || c.churn_risk === 'medium');
    }

    if (!clients.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>לא נמצאו לקוחות</h3></div>'; return; }

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      container.innerHTML = `<div class="cards-list">${clients.map(c => {
        const riskIcon = c.churn_risk === 'high' ? '<i class="fas fa-exclamation-circle" style="color:#EF4444" title="לא ביקר מעל 60 יום"></i> ' : c.churn_risk === 'medium' ? '<i class="fas fa-exclamation-triangle" style="color:#F59E0B" title="לא ביקר מעל 30 יום"></i> ' : '';
        return `
        <div class="info-card">
          <div class="info-card-header">
            ${riskIcon}<strong>${escHtml(c.name)}</strong>
            ${tierBadge(c.loyalty)}
            ${c.vip ? '<span class="badge badge-vip">VIP</span>' : ''}
          </div>
          <div class="info-card-body">
            <div class="info-card-row"><span class="info-label">טלפון:</span> <a href="tel:${escAttr(c.phone)}">${escHtml(c.phone)}</a></div>
            <div class="info-card-row"><span class="info-label">ביקורים:</span> ${c.total_visits}</div>
            ${c.days_since_visit !== null ? `<div class="info-card-row"><span class="info-label">ביקור אחרון:</span> לפני ${c.days_since_visit} ימים</div>` : ''}
          </div>
          <div class="info-card-actions">
            <button class="btn btn-sm btn-outline" onclick="viewClient(${c.id})"><i class="fas fa-eye"></i> צפה</button>
            <button class="btn btn-sm btn-outline" onclick="editClient(${c.id})"><i class="fas fa-edit"></i> עריכה</button>
            <button class="btn btn-sm btn-danger" onclick="deleteClient(${c.id}, '${escAttr(c.name)}')"><i class="fas fa-trash"></i> מחק</button>
          </div>
        </div>`;
      }).join('')}</div>`;
    } else {
      container.innerHTML = `
        <div class="table-container"><table>
          <thead><tr><th>שם</th><th>דרגה</th><th>טלפון</th><th>ביקורים</th><th>ביקור אחרון</th><th>סטטוס</th><th>פעולות</th></tr></thead>
          <tbody>${clients.map(c => {
            const riskIcon = c.churn_risk === 'high' ? '<i class="fas fa-exclamation-circle" style="color:#EF4444" title="בסיכון גבוה"></i>' : c.churn_risk === 'medium' ? '<i class="fas fa-exclamation-triangle" style="color:#F59E0B" title="בסיכון"></i>' : '<i class="fas fa-check-circle" style="color:#10B981"></i>';
            return `
            <tr>
              <td><strong>${escHtml(c.name)}</strong></td>
              <td>${tierBadge(c.loyalty)}</td>
              <td><a href="tel:${escAttr(c.phone)}">${escHtml(c.phone)}</a></td>
              <td>${c.total_visits}</td>
              <td>${c.days_since_visit !== null ? `לפני ${c.days_since_visit} ימים` : '-'}</td>
              <td>${riskIcon} ${c.vip ? '<span class="badge badge-vip">VIP</span>' : ''}</td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="viewClient(${c.id})"><i class="fas fa-eye"></i></button>
                  <button class="btn btn-sm btn-outline" onclick="editClient(${c.id})"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-sm btn-danger" onclick="deleteClient(${c.id}, '${escAttr(c.name)}')"><i class="fas fa-trash"></i></button>
                </div>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      `;
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function viewClient(id) {
  try {
    const c = await api(`/clients/${id}`);
    const riskLabel = c.days_since_visit !== null && c.days_since_visit > 60 ? '<span class="badge" style="background:#EF4444;color:#fff">בסיכון נטישה</span>' : c.days_since_visit !== null && c.days_since_visit > 30 ? '<span class="badge" style="background:#F59E0B;color:#fff">לא ביקר זמן רב</span>' : '';

    openModal(`פרטי לקוח - ${escHtml(c.name)}`, `
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap">
        ${tierBadge(c.loyalty)}
        ${c.vip ? '<span class="badge badge-vip">VIP</span>' : ''}
        ${riskLabel}
      </div>

      <div class="client-stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;margin-bottom:1rem">
        <div style="background:var(--bg);padding:.6rem;border-radius:8px;text-align:center;border:1px solid var(--border)">
          <div style="font-size:1.3rem;font-weight:700;color:var(--primary)">${c.total_visits}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">ביקורים</div>
        </div>
        <div style="background:var(--bg);padding:.6rem;border-radius:8px;text-align:center;border:1px solid var(--border)">
          <div style="font-size:1.3rem;font-weight:700;color:#10B981">₪${c.total_spent || 0}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">סה"כ הוצאה</div>
        </div>
        <div style="background:var(--bg);padding:.6rem;border-radius:8px;text-align:center;border:1px solid var(--border)">
          <div style="font-size:1.3rem;font-weight:700;color:var(--primary)">${c.days_since_visit !== null ? c.days_since_visit : '-'}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">ימים מביקור אחרון</div>
        </div>
        <div style="background:var(--bg);padding:.6rem;border-radius:8px;text-align:center;border:1px solid var(--border)">
          <div style="font-size:1.3rem;font-weight:700;color:${c.stats?.no_show_rate > 20 ? '#EF4444' : 'var(--primary)'}">${c.stats?.no_show_rate || 0}%</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">אי הגעה</div>
        </div>
      </div>

      <div style="display:grid;gap:.4rem;margin-bottom:1rem">
        <div><strong>טלפון:</strong> <a href="tel:${escAttr(c.phone)}">${escHtml(c.phone)}</a></div>
        <div><strong>אימייל:</strong> ${escHtml(c.email || '-')}</div>
        ${c.preferred_barber ? `<div><strong>ספר מועדף:</strong> ${escHtml(c.preferred_barber.name)} (${c.preferred_barber.visit_count} ביקורים)</div>` : ''}
        ${c.preferred_service ? `<div><strong>שירות מועדף:</strong> ${escHtml(c.preferred_service.name)} (${c.preferred_service.book_count} פעמים)</div>` : ''}
        ${c.avg_visit_interval ? `<div><strong>תדירות ביקורים:</strong> כל ${c.avg_visit_interval} ימים בממוצע</div>` : ''}
        <div><strong>הערות:</strong> ${escHtml(c.notes || '-')}</div>
      </div>

      <h4 style="margin-bottom:.5rem">היסטוריית תורים (${c.history.length})</h4>
      <div class="table-container"><table>
        <thead><tr><th>תאריך</th><th>שעה</th><th>ספר</th><th>שירות</th><th>סטטוס</th></tr></thead>
        <tbody>${c.history.length ? c.history.map(h => `
          <tr>
            <td>${formatDate(h.date)}</td><td>${h.start_time}</td>
            <td>${escHtml(h.barber_name)}</td><td>${escHtml(h.service_name)}</td>
            <td><span class="badge badge-${h.status}">${STATUS_HE[h.status]}</span></td>
          </tr>
        `).join('') : '<tr><td colspan="5">אין היסטוריה</td></tr>'}</tbody>
      </table></div>
    `);
  } catch(e) { toast(e.message, 'error'); }
}

function showNewClientPage() {
  openModal('לקוח חדש', `
    <div class="form-group"><label>שם *</label><input type="text" id="ncName" required></div>
    <div class="form-row">
      <div class="form-group"><label>טלפון</label><input type="text" id="ncPhone"></div>
      <div class="form-group"><label>אימייל</label><input type="email" id="ncEmail"></div>
    </div>
    <div class="form-group"><label>הערות</label><textarea id="ncNotes"></textarea></div>
    <div class="form-group"><label><input type="checkbox" id="ncVip"> לקוח VIP</label></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveNewClient()"><i class="fas fa-save"></i> שמור</button>
      <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveNewClient() {
  try {
    await api('/clients', { method: 'POST', body: JSON.stringify({
      name: document.getElementById('ncName').value,
      phone: document.getElementById('ncPhone').value,
      email: document.getElementById('ncEmail').value,
      notes: document.getElementById('ncNotes').value,
      vip: document.getElementById('ncVip').checked
    })});
    closeModal();
    toast('הלקוח נוצר בהצלחה');
    loadClients('');
  } catch(e) { toast(e.message, 'error'); }
}

async function editClient(id) {
  try {
    const c = await api(`/clients/${id}`);
    openModal('עריכת לקוח', `
      <div class="form-group"><label>שם</label><input type="text" id="ecName" value="${escAttr(c.name)}"></div>
      <div class="form-row">
        <div class="form-group"><label>טלפון</label><input type="text" id="ecPhone" value="${escAttr(c.phone || '')}"></div>
        <div class="form-group"><label>אימייל</label><input type="email" id="ecEmail" value="${escAttr(c.email || '')}"></div>
      </div>
      <div class="form-group"><label>הערות</label><textarea id="ecNotes">${escHtml(c.notes || '')}</textarea></div>
      <div class="form-group"><label><input type="checkbox" id="ecVip" ${c.vip?'checked':''}> לקוח VIP</label></div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="saveEditClient(${id})"><i class="fas fa-save"></i> שמור</button>
        <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
      </div>
    `);
  } catch(e) { toast(e.message, 'error'); }
}

async function saveEditClient(id) {
  try {
    await api(`/clients/${id}`, { method: 'PUT', body: JSON.stringify({
      name: document.getElementById('ecName').value,
      phone: document.getElementById('ecPhone').value,
      email: document.getElementById('ecEmail').value,
      notes: document.getElementById('ecNotes').value,
      vip: document.getElementById('ecVip').checked
    })});
    closeModal();
    toast('הלקוח עודכן');
    loadClients('');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteClient(id, name) {
  if (!confirm(`למחוק את הלקוח "${name}"?`)) return;
  try {
    await api(`/clients/${id}`, { method: 'DELETE' });
    toast('הלקוח נמחק בהצלחה');
    loadClients('');
  } catch(e) { toast(e.message, 'error'); }
}

// === Barbers ===
async function renderBarbers() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>ניהול ספרים</h3>
        ${App.user.role==='admin'?'<button class="btn btn-primary btn-sm" onclick="showNewBarberModal()"><i class="fas fa-plus"></i> ספר חדש</button>':''}
      </div>
      <div id="barbersList"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div>
    </div>
  `;

  try {
    const barbers = await api('/barbers');
    const container = document.getElementById('barbersList');

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      container.innerHTML = `<div class="cards-list">${barbers.map(b => `
        <div class="info-card">
          <div class="info-card-header">
            <span class="color-dot" style="background:${b.color};width:14px;height:14px"></span>
            <strong>${b.name}</strong>
          </div>
          <div class="info-card-body">
            <div class="info-card-row"><span class="info-label">טלפון:</span> ${b.phone || '-'}</div>
            <div class="info-card-row"><span class="info-label">התמחות:</span> ${b.specialty || '-'}</div>
            <div class="info-card-row"><span class="info-label">שעות:</span> ${b.work_start_time}-${b.work_end_time}</div>
            <div class="info-card-row"><span class="info-label">ימי עבודה:</span> ${b.work_days.split(',').map(d=>DAYS_HE[d]).join(', ')}</div>
          </div>
          <div class="info-card-actions">
            <button class="btn btn-sm btn-outline" onclick="editBarber(${b.id})"><i class="fas fa-edit"></i> עריכה</button>
            <button class="btn btn-sm btn-outline" onclick="manageDaysOff(${b.id},'${escAttr(b.name)}')"><i class="fas fa-calendar-minus"></i> ימי חופש</button>
            ${App.user.role==='admin'?`<button class="btn btn-sm btn-danger" onclick="deleteBarber(${b.id}, '${escAttr(b.name)}')"><i class="fas fa-trash"></i> הסר</button>`:''}
          </div>
        </div>
      `).join('')}</div>`;
    } else {
      container.innerHTML = `<div class="table-container"><table>
        <thead><tr><th>צבע</th><th>שם</th><th>טלפון</th><th>התמחות</th><th>שעות</th><th>ימי עבודה</th><th>פעולות</th></tr></thead>
        <tbody>${barbers.map(b => `
          <tr>
            <td><span class="color-dot" style="background:${b.color};width:14px;height:14px"></span></td>
            <td><strong>${b.name}</strong></td>
            <td>${b.phone || '-'}</td>
            <td>${b.specialty || '-'}</td>
            <td>${b.work_start_time}-${b.work_end_time}</td>
            <td>${b.work_days.split(',').map(d=>DAYS_HE[d]).join(', ')}</td>
            <td>
              <div class="btn-group">
                <button class="btn btn-sm btn-outline" onclick="editBarber(${b.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-outline" onclick="manageDaysOff(${b.id},'${escAttr(b.name)}')"><i class="fas fa-calendar-minus"></i></button>
                ${App.user.role==='admin'?`<button class="btn btn-sm btn-danger" onclick="deleteBarber(${b.id}, '${escAttr(b.name)}')"><i class="fas fa-trash"></i></button>`:''}
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table></div>`;
    }
  } catch(e) { toast(e.message, 'error'); }
}

function showNewBarberModal() {
  openModal('ספר חדש', `
    <div class="form-group"><label>שם *</label><input type="text" id="nbName" required></div>
    <div class="form-row">
      <div class="form-group"><label>טלפון</label><input type="text" id="nbPhone"></div>
      <div class="form-group"><label>אימייל</label><input type="email" id="nbEmail"></div>
    </div>
    <div class="form-group"><label>התמחות</label><input type="text" id="nbSpecialty"></div>
    <div class="form-row">
      <div class="form-group"><label>שעת התחלה</label><input type="time" id="nbStartTime" value="09:00"></div>
      <div class="form-group"><label>שעת סיום</label><input type="time" id="nbEndTime" value="18:00"></div>
    </div>
    <div class="form-group"><label>צבע</label><input type="color" id="nbColor" value="#4F46E5"></div>
    <div class="form-row">
      <div class="form-group"><label>שם משתמש</label><input type="text" id="nbUsername"></div>
      <div class="form-group"><label>סיסמה</label><input type="password" id="nbPassword"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveNewBarber()"><i class="fas fa-save"></i> שמור</button>
      <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveNewBarber() {
  try {
    await api('/barbers', { method: 'POST', body: JSON.stringify({
      name: document.getElementById('nbName').value,
      phone: document.getElementById('nbPhone').value,
      email: document.getElementById('nbEmail').value,
      specialty: document.getElementById('nbSpecialty').value,
      work_start_time: document.getElementById('nbStartTime').value,
      work_end_time: document.getElementById('nbEndTime').value,
      color: document.getElementById('nbColor').value,
      username: document.getElementById('nbUsername').value,
      password: document.getElementById('nbPassword').value,
    })});
    closeModal();
    toast('הספר נוצר בהצלחה');
    renderBarbers();
    App.data.barbers = await api('/barbers');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteBarber(id, name) {
  if (!confirm(`להסיר את הספר "${name}"?`)) return;
  try {
    await api(`/barbers/${id}`, { method: 'DELETE' });
    toast('הספר הוסר בהצלחה');
    renderBarbers();
  } catch(e) { toast(e.message, 'error'); }
}

async function editBarber(id) {
  try {
    const b = await api(`/barbers/${id}`);
    openModal('עריכת ספר', `
      <div class="form-group"><label>שם</label><input type="text" id="ebName" value="${escAttr(b.name)}"></div>
      <div class="form-row">
        <div class="form-group"><label>טלפון</label><input type="text" id="ebPhone" value="${escAttr(b.phone || '')}"></div>
        <div class="form-group"><label>אימייל</label><input type="email" id="ebEmail" value="${escAttr(b.email || '')}"></div>
      </div>
      <div class="form-group"><label>התמחות</label><input type="text" id="ebSpecialty" value="${escAttr(b.specialty || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>שעת התחלה</label><input type="time" id="ebStartTime" value="${b.work_start_time}"></div>
        <div class="form-group"><label>שעת סיום</label><input type="time" id="ebEndTime" value="${b.work_end_time}"></div>
      </div>
      <div class="form-group"><label>ימי עבודה (מספרים מופרדים בפסיקים: 0=ראשון...6=שבת)</label><input type="text" id="ebWorkDays" value="${b.work_days}"></div>
      <div class="form-group"><label>צבע</label><input type="color" id="ebColor" value="${b.color}"></div>
      <div class="form-group"><label>הערות</label><textarea id="ebNotes">${escHtml(b.notes || '')}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="saveEditBarber(${id})"><i class="fas fa-save"></i> שמור</button>
        <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
      </div>
    `);
  } catch(e) { toast(e.message, 'error'); }
}

async function saveEditBarber(id) {
  try {
    await api(`/barbers/${id}`, { method: 'PUT', body: JSON.stringify({
      name: document.getElementById('ebName').value,
      phone: document.getElementById('ebPhone').value,
      email: document.getElementById('ebEmail').value,
      specialty: document.getElementById('ebSpecialty').value,
      work_start_time: document.getElementById('ebStartTime').value,
      work_end_time: document.getElementById('ebEndTime').value,
      work_days: document.getElementById('ebWorkDays').value,
      color: document.getElementById('ebColor').value,
      notes: document.getElementById('ebNotes').value,
    })});
    closeModal();
    toast('הספר עודכן');
    renderBarbers();
    App.data.barbers = await api('/barbers');
  } catch(e) { toast(e.message, 'error'); }
}

async function manageDaysOff(barberId, barberName) {
  try {
    const daysOff = await api(`/barbers/${barberId}/days-off`);
    openModal(`ימי חופש - ${barberName}`, `
      <div class="form-row" style="margin-bottom:1rem">
        <div class="form-group"><label>תאריך</label><input type="date" id="newDayOffDate"></div>
        <div class="form-group"><label>סיבה</label><input type="text" id="newDayOffReason" placeholder="חופשה, חג..."></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="addDayOff(${barberId},'${escAttr(barberName)}')"><i class="fas fa-plus"></i> הוסף יום חופש</button>
      <div id="daysOffList" style="margin-top:1rem">
        ${daysOff.length ? `<table><thead><tr><th>תאריך</th><th>סיבה</th><th>פעולה</th></tr></thead><tbody>
          ${daysOff.map(d => `<tr><td>${formatDate(d.date)}</td><td>${escHtml(d.reason || '-')}</td>
            <td><button class="btn btn-sm btn-danger" onclick="removeDayOff(${barberId},${d.id},'${escAttr(barberName)}')"><i class="fas fa-trash"></i></button></td></tr>`).join('')}
        </tbody></table>` : '<p style="color:var(--text-light)">אין ימי חופש מתוכננים</p>'}
      </div>
    `);
  } catch(e) { toast(e.message, 'error'); }
}

async function addDayOff(barberId, barberName) {
  const date = document.getElementById('newDayOffDate').value;
  const reason = document.getElementById('newDayOffReason').value;
  if (!date) return toast('נא לבחור תאריך', 'warning');
  try {
    await api(`/barbers/${barberId}/days-off`, { method: 'POST', body: JSON.stringify({ date, reason }) });
    toast('יום חופש נוסף');
    manageDaysOff(barberId, barberName);
  } catch(e) { toast(e.message, 'error'); }
}

async function removeDayOff(barberId, dayOffId, barberName) {
  try {
    await api(`/barbers/${barberId}/days-off/${dayOffId}`, { method: 'DELETE' });
    toast('יום החופש הוסר');
    manageDaysOff(barberId, barberName);
  } catch(e) { toast(e.message, 'error'); }
}

// === Services ===
async function renderServices() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>ניהול שירותים</h3>
        ${App.user.role==='admin'?'<button class="btn btn-primary btn-sm" onclick="showNewServiceModal()"><i class="fas fa-plus"></i> שירות חדש</button>':''}
      </div>
      <div id="servicesList"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div>
    </div>
  `;

  try {
    const services = await api('/services');
    const isMobile = window.innerWidth <= 768;
    const container = document.getElementById('servicesList');
    if (isMobile) {
      container.innerHTML = `<div class="cards-list">${services.map(s => `
        <div class="info-card">
          <div class="info-card-header">
            <span class="color-dot" style="background:${s.color};width:14px;height:14px"></span>
            <strong>${escHtml(s.name)}</strong>
          </div>
          <div class="info-card-body">
            ${s.description ? `<div class="info-card-row">${escHtml(s.description)}</div>` : ''}
            <div class="info-card-row"><span class="info-label">משך:</span> ${s.duration} דק'</div>
            <div class="info-card-row"><span class="info-label">מחיר:</span> ₪${s.price}</div>
          </div>
          ${App.user.role==='admin'?`<div class="info-card-actions">
            <button class="btn btn-sm btn-outline" onclick="editService(${s.id})"><i class="fas fa-edit"></i> עריכה</button>
            <button class="btn btn-sm btn-danger" onclick="deleteService(${s.id})"><i class="fas fa-trash"></i> מחיקה</button>
          </div>`:''}
        </div>
      `).join('')}</div>`;
    } else {
      container.innerHTML = `
        <div class="table-container"><table>
          <thead><tr><th>צבע</th><th>שם</th><th>תיאור</th><th>משך</th><th>מחיר</th><th>פעולות</th></tr></thead>
          <tbody>${services.map(s => `
            <tr>
              <td><span class="color-dot" style="background:${s.color};width:14px;height:14px"></span></td>
              <td><strong>${escHtml(s.name)}</strong></td>
              <td>${escHtml(s.description || '-')}</td>
              <td>${s.duration} דק'</td>
              <td>₪${s.price}</td>
              <td>
                ${App.user.role==='admin'?`<div class="btn-group">
                  <button class="btn btn-sm btn-outline" onclick="editService(${s.id})"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-sm btn-danger" onclick="deleteService(${s.id})"><i class="fas fa-trash"></i></button>
                </div>`:''}
              </td>
            </tr>
          `).join('')}</tbody>
        </table></div>
      `;
    }
  } catch(e) { toast(e.message, 'error'); }
}

function showNewServiceModal() {
  openModal('שירות חדש', `
    <div class="form-group"><label>שם *</label><input type="text" id="nsName" required></div>
    <div class="form-group"><label>תיאור</label><input type="text" id="nsDesc"></div>
    <div class="form-row">
      <div class="form-group"><label>משך (דקות)</label><input type="number" id="nsDuration" value="30" min="5"></div>
      <div class="form-group"><label>מחיר (₪)</label><input type="number" id="nsPrice" value="0" min="0"></div>
    </div>
    <div class="form-group"><label>צבע</label><input type="color" id="nsColor" value="#10B981"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveNewService()"><i class="fas fa-save"></i> שמור</button>
      <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveNewService() {
  try {
    await api('/services', { method: 'POST', body: JSON.stringify({
      name: document.getElementById('nsName').value,
      description: document.getElementById('nsDesc').value,
      duration: parseInt(document.getElementById('nsDuration').value),
      price: parseFloat(document.getElementById('nsPrice').value),
      color: document.getElementById('nsColor').value,
    })});
    closeModal();
    toast('השירות נוצר');
    renderServices();
    App.data.services = await api('/services');
  } catch(e) { toast(e.message, 'error'); }
}

async function editService(id) {
  const services = await api('/services');
  const s = services.find(x => x.id === id);
  if (!s) return;

  openModal('עריכת שירות', `
    <div class="form-group"><label>שם</label><input type="text" id="esName" value="${escAttr(s.name)}"></div>
    <div class="form-group"><label>תיאור</label><input type="text" id="esDesc" value="${escAttr(s.description || '')}"></div>
    <div class="form-row">
      <div class="form-group"><label>משך (דקות)</label><input type="number" id="esDuration" value="${s.duration}"></div>
      <div class="form-group"><label>מחיר (₪)</label><input type="number" id="esPrice" value="${s.price}"></div>
    </div>
    <div class="form-group"><label>צבע</label><input type="color" id="esColor" value="${s.color}"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveEditService(${id})"><i class="fas fa-save"></i> שמור</button>
      <button class="btn btn-outline" onclick="closeModal()">ביטול</button>
    </div>
  `);
}

async function saveEditService(id) {
  try {
    await api(`/services/${id}`, { method: 'PUT', body: JSON.stringify({
      name: document.getElementById('esName').value,
      description: document.getElementById('esDesc').value,
      duration: parseInt(document.getElementById('esDuration').value),
      price: parseFloat(document.getElementById('esPrice').value),
      color: document.getElementById('esColor').value,
    })});
    closeModal();
    toast('השירות עודכן');
    renderServices();
    App.data.services = await api('/services');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteService(id) {
  if (!confirm('האם למחוק שירות זה?')) return;
  try {
    await api(`/services/${id}`, { method: 'DELETE' });
    toast('השירות הוסר');
    renderServices();
    App.data.services = await api('/services');
  } catch(e) { toast(e.message, 'error'); }
}

// === Reports ===
async function renderReports() {
  const area = document.getElementById('contentArea');
  area.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>טוען דוחות...</h3></div>';

  try {
    const data = await api('/dashboard/revenue');

    const maxMonthly = Math.max(...data.monthlyRevenue.map(m => m.revenue), 1);
    const maxWeekly = Math.max(...data.weeklyRevenue.map(w => w.revenue), 1);

    area.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-shekel-sign"></i></div><div class="stat-info"><h4>הכנסות (${data.monthlyRevenue.length} חודשים)</h4><div class="stat-value">₪${data.summary.totalRevenue.toLocaleString()}</div></div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-calendar-check"></i></div><div class="stat-info"><h4>תורים שהושלמו</h4><div class="stat-value">${data.summary.totalAppointments}</div></div></div>
        <div class="stat-card"><div class="stat-icon cyan"><i class="fas fa-receipt"></i></div><div class="stat-info"><h4>ממוצע לתור</h4><div class="stat-value">₪${data.summary.avgPerAppointment}</div></div></div>
      </div>

      <!-- Monthly Trend -->
      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3><i class="fas fa-chart-line"></i> מגמת הכנסות חודשית</h3></div>
        <div class="revenue-chart" style="display:flex;align-items:flex-end;gap:4px;height:180px;padding:1rem 0.5rem 0">
          ${data.monthlyRevenue.map(m => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
              <span style="font-size:.7rem;font-weight:600;color:var(--primary)">₪${m.revenue.toLocaleString()}</span>
              <div style="width:100%;background:linear-gradient(to top,var(--primary),var(--primary-light));border-radius:6px 6px 0 0;height:${Math.max((m.revenue/maxMonthly)*130, 4)}px;transition:height .3s"></div>
              <span style="font-size:.7rem;color:var(--text-secondary)">${m.label}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Weekly Trend -->
      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3><i class="fas fa-chart-bar"></i> הכנסות שבועיות (4 שבועות אחרונים)</h3></div>
        <div class="revenue-chart" style="display:flex;align-items:flex-end;gap:8px;height:160px;padding:1rem 0.5rem 0">
          ${data.weeklyRevenue.map(w => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
              <span style="font-size:.75rem;font-weight:600;color:#10B981">₪${w.revenue.toLocaleString()}</span>
              <div style="width:100%;background:linear-gradient(to top,#10B981,#6EE7B7);border-radius:6px 6px 0 0;height:${Math.max((w.revenue/maxWeekly)*110, 4)}px;transition:height .3s"></div>
              <span style="font-size:.7rem;color:var(--text-secondary);text-align:center">${w.label}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="dashboard-grid" style="margin-top:1rem">
        <!-- Revenue by Barber -->
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-user-tie"></i> הכנסות לפי ספר (חודש נוכחי)</h3></div>
          ${data.revenueByBarber.length ? data.revenueByBarber.map(b => {
            const maxB = Math.max(...data.revenueByBarber.map(x => x.revenue), 1);
            return `
            <div style="padding:.6rem .75rem;border-bottom:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span><span class="color-dot" style="background:${escAttr(b.color)}"></span> <strong>${escHtml(b.name)}</strong></span>
                <span style="font-weight:600;color:var(--primary)">₪${b.revenue.toLocaleString()} <small style="color:var(--text-secondary)">(${b.count} תורים)</small></span>
              </div>
              <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${(b.revenue/maxB)*100}%;background:${b.color};border-radius:3px;transition:width .3s"></div>
              </div>
            </div>`;
          }).join('') : '<div class="empty-state" style="padding:1rem"><small>אין נתונים החודש</small></div>'}
        </div>

        <!-- Revenue by Service -->
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-concierge-bell"></i> הכנסות לפי שירות (חודש נוכחי)</h3></div>
          ${data.revenueByService.length ? data.revenueByService.map(s => {
            const maxS = Math.max(...data.revenueByService.map(x => x.revenue), 1);
            return `
            <div style="padding:.6rem .75rem;border-bottom:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span><span class="color-dot" style="background:${escAttr(s.color)}"></span> <strong>${escHtml(s.name)}</strong></span>
                <span style="font-weight:600;color:#10B981">₪${s.revenue.toLocaleString()} <small style="color:var(--text-secondary)">(${s.count} תורים)</small></span>
              </div>
              <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${(s.revenue/maxS)*100}%;background:${s.color};border-radius:3px;transition:width .3s"></div>
              </div>
            </div>`;
          }).join('') : '<div class="empty-state" style="padding:1rem"><small>אין נתונים החודש</small></div>'}
        </div>
      </div>

      <!-- CSV Export -->
      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3><i class="fas fa-file-csv"></i> ייצוא נתונים</h3></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem;padding:.5rem 0">
          <button class="btn btn-outline" onclick="exportCsv('clients')"><i class="fas fa-users"></i> ייצוא לקוחות CSV</button>
          <button class="btn btn-outline" onclick="exportCsv('appointments')"><i class="fas fa-calendar"></i> ייצוא תורים CSV</button>
          <button class="btn btn-outline" onclick="exportCsv('revenue')"><i class="fas fa-shekel-sign"></i> ייצוא הכנסות CSV</button>
        </div>
      </div>
    `;
  } catch(e) { area.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>${escHtml(e.message)}</h3></div>`; }
}

function exportCsv(type) {
  const token = App.token;
  fetch(`/api/export/${type}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(res => {
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`הקובץ ${type}.csv יוצא בהצלחה`);
  }).catch(e => toast('שגיאה בייצוא: ' + e.message, 'error'));
}

// === Settings ===
async function renderSettings() {
  const area = document.getElementById('contentArea');
  const isAdmin = App.user.role === 'admin';

  try {
    let settingsHtml = '';

    if (isAdmin) {
      const settings = await api('/settings');
      settingsHtml = `
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-cog"></i> הגדרות מערכת</h3></div>
          <div class="settings-section">
            <h3>פרטי המספרה</h3>
            <div class="form-group"><label>שם המספרה</label><input type="text" id="setShopName" value="${escAttr(settings.shop_name || '')}"></div>
            <div class="form-row">
              <div class="form-group"><label>טלפון</label><input type="text" id="setShopPhone" value="${escAttr(settings.shop_phone || '')}"></div>
              <div class="form-group"><label>כתובת</label><input type="text" id="setShopAddress" value="${escAttr(settings.shop_address || '')}"></div>
            </div>
          </div>
          <div class="settings-section">
            <h3>שעות פעילות</h3>
            <div class="form-row">
              <div class="form-group"><label>שעת פתיחה</label><input type="time" id="setOpenTime" value="${settings.open_time || '09:00'}"></div>
              <div class="form-group"><label>שעת סגירה</label><input type="time" id="setCloseTime" value="${settings.close_time || '20:00'}"></div>
            </div>
            <div class="form-group"><label>מרווח משבצות (דקות)</label><input type="number" id="setSlotInterval" value="${settings.slot_interval || 15}" min="5" max="60"></div>
          </div>
          <button class="btn btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> שמור הגדרות</button>
        </div>
      `;
    }

    // Consent log - admin only
    let consentHtml = '';
    if (isAdmin) {
      consentHtml = `
        <div class="card" style="margin-top:1rem">
          <div class="card-header">
            <h3><i class="fas fa-shield-alt"></i> יומן הסכמות פרטיות</h3>
            <div class="btn-group">
              <button class="btn btn-sm btn-outline filter-active" onclick="loadConsentLog('')" id="cfAll">הכל</button>
              <button class="btn btn-sm btn-outline" onclick="loadConsentLog('booking_privacy')" id="cfBooking">הזמנות</button>
              <button class="btn btn-sm btn-outline" onclick="loadConsentLog('terms_of_use')" id="cfTerms">תנאי שימוש</button>
            </div>
          </div>
          <div id="consentLogContainer"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div>
        </div>
      `;
    }

    // Password change - available to all users
    area.innerHTML = `
      ${settingsHtml}
      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3><i class="fas fa-key"></i> שינוי סיסמה</h3></div>
        <div class="form-group"><label>סיסמה נוכחית</label><input type="password" id="cpCurrent"></div>
        <div class="form-group"><label>סיסמה חדשה</label><input type="password" id="cpNew" minlength="6"></div>
        <div class="form-group"><label>אימות סיסמה חדשה</label><input type="password" id="cpConfirm" minlength="6"></div>
        <button class="btn btn-primary" onclick="changePassword()"><i class="fas fa-save"></i> שנה סיסמה</button>
      </div>
      ${consentHtml}
    `;
    if (isAdmin) loadConsentLog('');
  } catch(e) { toast(e.message, 'error'); }
}

async function changePassword() {
  const current = document.getElementById('cpCurrent').value;
  const newPass = document.getElementById('cpNew').value;
  const confirm = document.getElementById('cpConfirm').value;

  if (!current || !newPass) return toast('נא למלא את כל השדות', 'error');
  if (newPass.length < 6) return toast('סיסמה חדשה חייבת להכיל לפחות 6 תווים', 'error');
  if (newPass !== confirm) return toast('הסיסמאות לא תואמות', 'error');

  try {
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: newPass }) });
    toast('הסיסמה שונתה בהצלחה');
    document.getElementById('cpCurrent').value = '';
    document.getElementById('cpNew').value = '';
    document.getElementById('cpConfirm').value = '';
  } catch(e) { toast(e.message, 'error'); }
}

async function saveSettings() {
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify({
      shop_name: document.getElementById('setShopName').value,
      shop_phone: document.getElementById('setShopPhone').value,
      shop_address: document.getElementById('setShopAddress').value,
      open_time: document.getElementById('setOpenTime').value,
      close_time: document.getElementById('setCloseTime').value,
      slot_interval: document.getElementById('setSlotInterval').value,
    })});
    toast('ההגדרות נשמרו');
    document.getElementById('shopName').textContent = document.getElementById('setShopName').value;
  } catch(e) { toast(e.message, 'error'); }
}

// === Consent Log ===
async function loadConsentLog(type) {
  const container = document.getElementById('consentLogContainer');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';

  // Update filter buttons
  document.querySelectorAll('[id^="cf"]').forEach(b => b.classList.remove('filter-active'));
  if (type === 'booking_privacy') document.getElementById('cfBooking').classList.add('filter-active');
  else if (type === 'terms_of_use') document.getElementById('cfTerms').classList.add('filter-active');
  else document.getElementById('cfAll').classList.add('filter-active');

  try {
    const query = type ? `?type=${type}` : '';
    const data = await api(`/consents/log${query}`);

    const TYPE_HE = { booking_privacy: 'הסכמת הזמנה', terms_of_use: 'תנאי שימוש', data_processing: 'עיבוד מידע' };

    if (!data.consents.length) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem"><i class="fas fa-clipboard-check"></i><h3>אין רשומות הסכמה</h3></div>';
      return;
    }

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      container.innerHTML = `<div class="cards-list">${data.consents.map(c => `
        <div class="info-card">
          <div class="info-card-header">
            <span class="badge badge-${c.consent_type === 'terms_of_use' ? 'confirmed' : 'completed'}">${escHtml(TYPE_HE[c.consent_type] || c.consent_type)}</span>
            <small style="color:var(--text-light)">${new Date(c.created_at).toLocaleString('he-IL')}</small>
          </div>
          <div class="info-card-body">
            <div class="info-card-row"><span class="info-label">שם:</span> ${escHtml(c.entity_name || '-')}</div>
            ${c.entity_phone ? `<div class="info-card-row"><span class="info-label">טלפון:</span> ${escHtml(c.entity_phone)}</div>` : ''}
            <div class="info-card-row"><span class="info-label">סוג:</span> ${c.entity_type === 'user' ? 'משתמש מערכת' : 'לקוח'}</div>
            <div class="info-card-row"><span class="info-label">IP:</span> ${escHtml(c.ip_address || '-')}</div>
          </div>
        </div>
      `).join('')}</div>
      <div style="text-align:center;padding:0.5rem;color:var(--text-secondary);font-size:0.85rem">
        סה"כ ${data.total} רשומות
      </div>`;
    } else {
      container.innerHTML = `
        <div class="table-container"><table>
          <thead><tr><th>תאריך</th><th>סוג</th><th>שם</th><th>טלפון</th><th>גורם</th><th>IP</th></tr></thead>
          <tbody>${data.consents.map(c => `
            <tr>
              <td>${new Date(c.created_at).toLocaleString('he-IL')}</td>
              <td><span class="badge badge-${c.consent_type === 'terms_of_use' ? 'confirmed' : 'completed'}">${escHtml(TYPE_HE[c.consent_type] || c.consent_type)}</span></td>
              <td>${escHtml(c.entity_name || '-')}</td>
              <td>${escHtml(c.entity_phone || '-')}</td>
              <td>${c.entity_type === 'user' ? 'משתמש' : 'לקוח'}</td>
              <td style="font-size:.8rem;direction:ltr">${escHtml(c.ip_address || '-')}</td>
            </tr>
          `).join('')}</tbody>
        </table></div>
        <div style="text-align:center;padding:0.5rem;color:var(--text-secondary);font-size:0.85rem">
          סה"כ ${data.total} רשומות (עמוד ${data.page} מתוך ${data.pages})
        </div>
      `;
    }
  } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>${escHtml(e.message)}</h3></div>`; }
}

// === Accessibility ===
let a11yFontLevel = parseInt(localStorage.getItem('a11y_font') || '0');

function a11yFontSize(dir) {
  if (dir === 0) { a11yFontLevel = 0; }
  else { a11yFontLevel = Math.max(-2, Math.min(4, a11yFontLevel + dir)); }
  document.documentElement.style.fontSize = (15 + a11yFontLevel * 2) + 'px';
  localStorage.setItem('a11y_font', a11yFontLevel);
}

function a11yContrast() {
  document.body.classList.toggle('high-contrast');
  localStorage.setItem('a11y_contrast', document.body.classList.contains('high-contrast') ? '1' : '0');
}

function a11yLinks() {
  document.body.classList.toggle('highlight-links');
  localStorage.setItem('a11y_links', document.body.classList.contains('highlight-links') ? '1' : '0');
}

function initA11y() {
  // Restore saved preferences
  if (a11yFontLevel !== 0) document.documentElement.style.fontSize = (15 + a11yFontLevel * 2) + 'px';
  if (localStorage.getItem('a11y_contrast') === '1') document.body.classList.add('high-contrast');
  if (localStorage.getItem('a11y_links') === '1') document.body.classList.add('highlight-links');

  // Toggle panel
  const toggle = document.getElementById('a11yToggle');
  const panel = document.getElementById('a11yPanel');
  if (toggle && panel) {
    toggle.addEventListener('click', () => panel.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.a11y-widget')) panel.classList.add('hidden');
    });
  }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  initA11y();

  // Login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');
    try {
      const data = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('loginUsername').value,
          password: document.getElementById('loginPassword').value
        })
      }).then(r => r.json());

      if (data.token) { login(data.token, data.user); }
      else { errEl.textContent = data.error || 'שגיאה'; errEl.classList.remove('hidden'); }
    } catch(err) { errEl.textContent = 'שגיאת חיבור'; errEl.classList.remove('hidden'); }
  });

  // Navigation clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); navigate(item.dataset.page); });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // Modal close
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.dataset.page;
      if (page === 'more') {
        document.getElementById('moreMenu').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      } else {
        navigate(page);
      }
    });
  });

  // More menu items
  document.querySelectorAll('.more-menu-item[data-page]').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      navigate(this.dataset.page);
    });
  });

  // More menu close
  function closeMoreMenu() {
    document.getElementById('moreMenu').classList.add('hidden');
    document.body.style.overflow = '';
  }
  document.getElementById('moreMenuClose').addEventListener('click', closeMoreMenu);
  document.getElementById('moreMenuOverlay').addEventListener('click', closeMoreMenu);

  // More menu logout
  document.getElementById('moreLogoutBtn').addEventListener('click', function() {
    closeMoreMenu();
    logout();
  });

  // Keyboard: Escape closes modal / more menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modalOverlay');
      if (modal && !modal.classList.contains('hidden')) { closeModal(); return; }
      const moreMenu = document.getElementById('moreMenu');
      if (moreMenu && !moreMenu.classList.contains('hidden')) {
        moreMenu.classList.add('hidden');
        document.body.style.overflow = '';
      }
    }
  });

  // Auto-login if token exists
  if (App.token && App.user) { showApp(); }
});

// === Tenant Management (Super Admin) ===
async function renderTenants() {
  if (App.user.role !== 'super_admin') { navigate('dashboard'); return; }
  const area = document.getElementById('contentArea');
  area.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>טוען...</h3></div>';

  try {
    const tenants = await api('/tenants');

    const PLAN_HE = { trial: 'ניסיון', basic: 'בסיסי', premium: 'פרימיום' };

    area.innerHTML = `
      <div class="page-actions" style="margin-bottom:1rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary btn-sm" onclick="showCreateTenantModal()"><i class="fas fa-plus"></i> עסק חדש</button>
        <span style="color:var(--text-secondary);font-size:0.9rem">${tenants.length} עסקים</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th>שם העסק</th><th>Slug</th><th>תוכנית</th><th>לקוחות</th><th>תורים</th><th>סטטוס</th><th>פעולות</th>
          </tr></thead>
          <tbody>
            ${tenants.map(t => `<tr>
              <td><strong>${escHtml(t.name)}</strong><br><small style="color:var(--text-secondary)">${escHtml(t.owner_name || '')}</small></td>
              <td><code>${escHtml(t.slug)}</code></td>
              <td><span class="badge" style="background:${t.plan === 'premium' ? '#F59E0B' : t.plan === 'basic' ? '#10B981' : '#6B7280'};color:#fff">${PLAN_HE[t.plan] || t.plan}</span></td>
              <td>${t.stats.clients}</td>
              <td>${t.stats.appointments}</td>
              <td>${t.active ? '<span style="color:#10B981"><i class="fas fa-check-circle"></i> פעיל</span>' : '<span style="color:#EF4444"><i class="fas fa-times-circle"></i> מושבת</span>'}</td>
              <td>
                <button class="btn btn-sm" onclick="editTenant(${t.id})" title="עריכה"><i class="fas fa-edit"></i></button>
                <a href="/book/${escAttr(t.slug)}" target="_blank" class="btn btn-sm" title="דף הזמנה"><i class="fas fa-external-link-alt"></i></a>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    area.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>שגיאה בטעינת עסקים</h3><p>${escHtml(err.message)}</p></div>`;
  }
}

function showCreateTenantModal() {
  openModal('עסק חדש', `
    <div class="form-group"><label>שם העסק</label><input type="text" id="tenantName" placeholder="שם המספרה"></div>
    <div class="form-group"><label>Slug (באנגלית, ללא רווחים)</label><input type="text" id="tenantSlug" placeholder="my-barber" dir="ltr" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9-]/g,'')"></div>
    <div class="form-group"><label>שם בעל העסק</label><input type="text" id="tenantOwner" placeholder="שם מלא"></div>
    <div class="form-group"><label>אימייל</label><input type="email" id="tenantEmail" placeholder="email@example.com" dir="ltr"></div>
    <div class="form-group"><label>טלפון</label><input type="tel" id="tenantPhone" placeholder="050-1234567" dir="ltr"></div>
    <hr style="margin:1rem 0">
    <h4 style="margin-bottom:0.75rem;color:var(--primary-dark)">משתמש מנהל לעסק</h4>
    <div class="form-group"><label>שם משתמש</label><input type="text" id="tenantAdminUser" placeholder="שם משתמש" dir="ltr"></div>
    <div class="form-group"><label>סיסמה</label><input type="password" id="tenantAdminPass" placeholder="סיסמה"></div>
    <button class="btn btn-primary" onclick="createTenant()"><i class="fas fa-plus"></i> צור עסק</button>
  `);
}

async function createTenant() {
  try {
    const data = {
      name: document.getElementById('tenantName').value.trim(),
      slug: document.getElementById('tenantSlug').value.trim(),
      owner_name: document.getElementById('tenantOwner').value.trim(),
      owner_email: document.getElementById('tenantEmail').value.trim(),
      owner_phone: document.getElementById('tenantPhone').value.trim(),
      admin_username: document.getElementById('tenantAdminUser').value.trim(),
      admin_password: document.getElementById('tenantAdminPass').value
    };
    if (!data.name || !data.slug || !data.admin_username || !data.admin_password) {
      toast('נא למלא את כל שדות החובה', 'error'); return;
    }
    const result = await api('/tenants', { method: 'POST', body: JSON.stringify(data) });
    toast(`העסק "${data.name}" נוצר בהצלחה! קישור הזמנה: ${result.bookingUrl}`);
    closeModal();
    renderTenants();
  } catch (err) { toast(err.message, 'error'); }
}

async function editTenant(id) {
  try {
    const tenant = await api(`/tenants/${id}`);
    const PLAN_HE = { trial: 'ניסיון', basic: 'בסיסי', premium: 'פרימיום' };

    openModal(`עריכת עסק - ${escHtml(tenant.name)}`, `
      <div class="form-group"><label>שם העסק</label><input type="text" id="editTenantName" value="${escAttr(tenant.name)}"></div>
      <div class="form-group"><label>בעל העסק</label><input type="text" id="editTenantOwner" value="${escAttr(tenant.owner_name || '')}"></div>
      <div class="form-group"><label>אימייל</label><input type="email" id="editTenantEmail" value="${escAttr(tenant.owner_email || '')}" dir="ltr"></div>
      <div class="form-group"><label>טלפון</label><input type="tel" id="editTenantPhone" value="${escAttr(tenant.owner_phone || '')}" dir="ltr"></div>
      <div class="form-group"><label>צבע ראשי</label><input type="color" id="editTenantColor" value="${tenant.primary_color || '#4F46E5'}"></div>
      <div class="form-group"><label>תוכנית</label>
        <select id="editTenantPlan" class="form-control" style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-family:var(--font)">
          <option value="trial" ${tenant.plan==='trial'?'selected':''}>ניסיון</option>
          <option value="basic" ${tenant.plan==='basic'?'selected':''}>בסיסי</option>
          <option value="premium" ${tenant.plan==='premium'?'selected':''}>פרימיום</option>
        </select>
      </div>
      <div class="form-group"><label>
        <input type="checkbox" id="editTenantActive" ${tenant.active ? 'checked' : ''}> עסק פעיל
      </label></div>
      <div style="margin:1rem 0;padding:0.75rem;background:var(--bg);border-radius:var(--radius-sm)">
        <strong>סטטיסטיקות:</strong> ${tenant.stats.clients} לקוחות | ${tenant.stats.appointments} תורים | ₪${tenant.stats.monthRevenue} הכנסות החודש
      </div>
      <div style="margin-bottom:0.75rem">
        <strong>קישור הזמנה:</strong> <a href="/book/${escAttr(tenant.slug)}" target="_blank">/book/${escHtml(tenant.slug)}</a>
      </div>
      <button class="btn btn-primary" onclick="saveTenant(${id})"><i class="fas fa-save"></i> שמור</button>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

async function saveTenant(id) {
  try {
    const data = {
      name: document.getElementById('editTenantName').value.trim(),
      owner_name: document.getElementById('editTenantOwner').value.trim(),
      owner_email: document.getElementById('editTenantEmail').value.trim(),
      owner_phone: document.getElementById('editTenantPhone').value.trim(),
      primary_color: document.getElementById('editTenantColor').value,
      plan: document.getElementById('editTenantPlan').value,
      active: document.getElementById('editTenantActive').checked ? 1 : 0
    };
    await api(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    toast('העסק עודכן בהצלחה');
    closeModal();
    renderTenants();
  } catch (err) { toast(err.message, 'error'); }
}
