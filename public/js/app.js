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
  el.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${message}`;
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

  if (App.user.role !== 'admin') {
    document.getElementById('settingsNav').classList.add('hidden');
    const settingsMore = document.getElementById('settingsMoreNav');
    if (settingsMore) settingsMore.style.display = 'none';
  }

  try {
    const [barbers, services, settings] = await Promise.all([
      api('/barbers'), api('/services'), api('/settings')
    ]);
    App.data.barbers = barbers;
    App.data.services = services;
    if (settings.shop_name) document.getElementById('shopName').textContent = settings.shop_name;
  } catch(e) { console.error(e); }

  navigate('dashboard');
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
    services: 'שירותים', settings: 'הגדרות'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '';

  const renderers = {
    dashboard: renderDashboard, calendar: renderCalendar, appointments: renderAppointments,
    newAppointment: renderNewAppointment, clients: renderClients, barbers: renderBarbers,
    services: renderServices, settings: renderSettings
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

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-bell"></i> תזכורות - תורים ממתינים</h3></div>
          ${stats.reminders.length ? stats.reminders.map(r => `
            <div class="reminder-item">
              <i class="fas fa-exclamation-circle"></i>
              <div class="reminder-text"><strong>${r.client_name}</strong> - ${r.start_time} אצל ${r.barber_name}</div>
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
                  <td>${a.client_name}</td>
                  <td><span class="color-dot" style="background:${a.barber_color}"></span> ${a.barber_name}</td>
                  <td>${a.service_name}</td>
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
  } catch(e) { area.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>${e.message}</h3></div>`; }
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
  } catch(e) { document.getElementById('calendarBody').innerHTML = `<div class="empty-state"><h3>${e.message}</h3></div>`; }
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
  const hours = [];
  for (let h = 8; h <= 20; h++) hours.push(`${String(h).padStart(2,'0')}:00`);

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
        html += `<div class="calendar-appt" style="background:${a.barber_color || '#4F46E5'}" onclick="event.stopPropagation();viewAppointment(${a.id})" title="${a.client_name} - ${a.service_name}">${a.start_time} ${a.client_name}</div>`;
      });
      html += `</div>`;
    });
  });

  html += `</div>`;
  body.innerHTML = html;
}

function renderDailyCalendar(appts, d) {
  const body = document.getElementById('calendarBody');
  const hours = [];
  for (let h = 8; h <= 20; h++) {
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
      html += `<div class="calendar-appt" style="background:${a.barber_color || '#4F46E5'};padding:.4rem .6rem" onclick="event.stopPropagation();viewAppointment(${a.id})">
        <strong>${a.start_time}-${a.end_time}</strong> | ${a.client_name} | ${a.barber_name} | ${a.service_name}
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

    tbody.innerHTML = `
      <table>
        <thead><tr><th>שעה</th><th>לקוח</th><th>טלפון</th><th>ספר</th><th>שירות</th><th>משך</th><th>מחיר</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${appts.map(a => `
          <tr>
            <td><strong>${a.start_time}-${a.end_time}</strong></td>
            <td>${a.client_name}</td>
            <td><a href="tel:${a.client_phone}">${a.client_phone}</a></td>
            <td><span class="color-dot" style="background:${a.barber_color}"></span> ${a.barber_name}</td>
            <td>${a.service_name}</td>
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
  } catch(e) { toast(e.message, 'error'); }
}

async function viewAppointment(id) {
  try {
    const a = await api(`/appointments/${id}`);
    openModal('פרטי תור', `
      <div style="display:grid;gap:.75rem">
        <div><strong>לקוח:</strong> ${a.client_name}</div>
        <div><strong>טלפון:</strong> <a href="tel:${a.client_phone}">${a.client_phone}</a></div>
        <div><strong>אימייל:</strong> ${a.client_email || '-'}</div>
        <div><strong>ספר:</strong> ${a.barber_name}</div>
        <div><strong>שירות:</strong> ${a.service_name}</div>
        <div><strong>תאריך:</strong> ${formatDate(a.date)}</div>
        <div><strong>שעה:</strong> ${a.start_time} - ${a.end_time}</div>
        <div><strong>משך:</strong> ${a.duration} דקות</div>
        <div><strong>מחיר:</strong> ₪${a.price || 0}</div>
        <div><strong>סטטוס:</strong> <span class="badge badge-${a.status}">${STATUS_HE[a.status]}</span></div>
        <div><strong>הערות:</strong> ${a.notes || '-'}</div>
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
      container.innerHTML = `<div class="empty-state"><small>${data.reason}</small></div>`;
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
  } catch(e) { container.innerHTML = `<div class="empty-state"><small>${e.message}</small></div>`; }
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
        <div class="client-avatar">${escHtml(getInitials(c.name))}</div>
        <div class="client-details">
          <h4>${escHtml(c.name)} ${c.vip ? '<span class="badge badge-vip">VIP</span>' : ''}</h4>
          <p>${escHtml(c.phone)}</p>
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
    <div class="card">
      <div class="card-header"><h3>רשימת לקוחות</h3><button class="btn btn-primary btn-sm" onclick="showNewClientPage()"><i class="fas fa-user-plus"></i> לקוח חדש</button></div>
      <div id="clientsList"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div></div>
    </div>
  `;
  loadClients('');
}

async function loadClients(search) {
  try {
    const clients = await api(`/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    const container = document.getElementById('clientsList');

    if (!clients.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>לא נמצאו לקוחות</h3></div>'; return; }

    container.innerHTML = `
      <div class="table-container"><table>
        <thead><tr><th>שם</th><th>טלפון</th><th>אימייל</th><th>ביקורים</th><th>ביקור אחרון</th><th>VIP</th><th>פעולות</th></tr></thead>
        <tbody>${clients.map(c => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td><a href="tel:${c.phone}">${c.phone}</a></td>
            <td>${c.email || '-'}</td>
            <td>${c.total_visits}</td>
            <td>${c.last_visit ? formatDate(c.last_visit) : '-'}</td>
            <td>${c.vip ? '<span class="badge badge-vip">VIP</span>' : '-'}</td>
            <td>
              <div class="btn-group">
                <button class="btn btn-sm btn-outline" onclick="viewClient(${c.id})"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-outline" onclick="editClient(${c.id})"><i class="fas fa-edit"></i></button>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table></div>
    `;
  } catch(e) { toast(e.message, 'error'); }
}

async function viewClient(id) {
  try {
    const c = await api(`/clients/${id}`);
    openModal(`פרטי לקוח - ${c.name}`, `
      <div style="display:grid;gap:.5rem;margin-bottom:1rem">
        <div><strong>טלפון:</strong> <a href="tel:${c.phone}">${c.phone}</a></div>
        <div><strong>אימייל:</strong> ${c.email || '-'}</div>
        <div><strong>הערות:</strong> ${c.notes || '-'}</div>
        <div><strong>ביקורים:</strong> ${c.total_visits}</div>
        <div><strong>VIP:</strong> ${c.vip ? 'כן' : 'לא'}</div>
      </div>
      <h4 style="margin-bottom:.5rem">היסטוריית תורים</h4>
      <div class="table-container"><table>
        <thead><tr><th>תאריך</th><th>שעה</th><th>ספר</th><th>שירות</th><th>סטטוס</th></tr></thead>
        <tbody>${c.history.length ? c.history.map(h => `
          <tr>
            <td>${formatDate(h.date)}</td><td>${h.start_time}</td>
            <td>${h.barber_name}</td><td>${h.service_name}</td>
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
            </div>
          </td>
        </tr>
      `).join('')}</tbody>
    </table></div>`;
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
    document.getElementById('servicesList').innerHTML = `
      <div class="table-container"><table>
        <thead><tr><th>צבע</th><th>שם</th><th>תיאור</th><th>משך</th><th>מחיר</th><th>פעולות</th></tr></thead>
        <tbody>${services.map(s => `
          <tr>
            <td><span class="color-dot" style="background:${s.color};width:14px;height:14px"></span></td>
            <td><strong>${s.name}</strong></td>
            <td>${s.description || '-'}</td>
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

// === Settings ===
async function renderSettings() {
  if (App.user.role !== 'admin') { navigate('dashboard'); return; }

  const area = document.getElementById('contentArea');
  try {
    const settings = await api('/settings');
    area.innerHTML = `
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-cog"></i> הגדרות מערכת</h3></div>
        <div class="settings-section">
          <h3>פרטי המספרה</h3>
          <div class="form-group"><label>שם המספרה</label><input type="text" id="setShopName" value="${settings.shop_name || ''}"></div>
          <div class="form-row">
            <div class="form-group"><label>טלפון</label><input type="text" id="setShopPhone" value="${settings.shop_phone || ''}"></div>
            <div class="form-group"><label>כתובת</label><input type="text" id="setShopAddress" value="${settings.shop_address || ''}"></div>
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

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
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

  // Auto-login if token exists
  if (App.token && App.user) { showApp(); }
});
