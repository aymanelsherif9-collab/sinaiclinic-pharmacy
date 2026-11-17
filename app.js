const SUPABASE_URL = 'https://hprowfrhkzvpzdwxzpxo.supabase.co';
const SUPABASE_ANON_KEY = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwcm93ZnJoa3p2cHpkd3h6cHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNTQ0NDEsImV4cCI6MjEwNjkzMDQ0MX0',
    'wzyxn8NZCIOz1rF-crcK9Uf1gkD3SiV_lqkvHBxc7aU'
].join('.');

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserProfile = null;
let state = {
    locations: [],
    drugs: [],
    batches: [],
    balances: [],
    ledger: [],
    users: [],
    requisitions: [],
    reqItems: []
};

const ROLE_LABELS = {
    'MANAGEMENT': 'الإدارة العليا (صلاحية كاملة)',
    'PHARMACY_MANAGER': 'مدير الصيدلية (المخزن الرئيسي)',
    'HEAD_NURSE': 'رئيس التمريض (اعتماد الطلبيات)',
    'MEDICAL_DIRECTOR': 'المدير الطبي (الاعتماد الطبي النهائي)',
    'DEPARTMENT_STAFF': 'مشرف / تمريض قسم فرعي'
};

const REQ_STATUS_LABELS = {
    'PENDING_HEAD_NURSE': { text: 'بانتظار رئيس التمريض', badge: 'badge-warn' },
    'PENDING_MEDICAL_DIR': { text: 'بانتظار المدير الطبي', badge: 'badge-info' },
    'APPROVED_FOR_ISSUE': { text: 'معتمدة وجاهزة للصرف', badge: 'badge-in' },
    'ISSUED': { text: 'تم الصرف والاستلام', badge: 'badge-in' },
    'REJECTED': { text: 'مرفوضة', badge: 'badge-out' }
};

const DISPENSE_UNITS_HTML = `
    <option value="قرص (Tablet)">قرص (Tablet)</option>
    <option value="شريط (Strip)">شريط (Strip)</option>
    <option value="أمبول (Ampoule)">أمبول (Ampoule)</option>
    <option value="فيال (Vial)">فيال (Vial)</option>
    <option value="علبة (Box)">علبة (Box)</option>
    <option value="زجاجة (Bottle)">زجاجة (Bottle)</option>
    <option value="كيس/محلول (Bag)">كيس/محلول (Bag)</option>
    <option value="قطعة (Piece)">قطعة (Piece)</option>
`;

const todayISO = () => new Date().toISOString().slice(0, 10);

async function checkSession() {
    const { data: { session } } = await db.auth.getSession();
    if (session && session.user) {
        await initUserSession(session.user.email);
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'جاري التحقق...';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = '🔐 تسجيل الدخول';

    if (error) {
        errBox.textContent = 'خطأ في البريد الإلكتروني أو كلمة المرور: ' + error.message;
        errBox.classList.remove('hidden');
    } else if (data.user) {
        await initUserSession(data.user.email);
    }
});

async function initUserSession(email) {
    const { data: userRec, error } = await db
        .from('app_users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .single();

    if (error || !userRec) {
        await db.auth.signOut();
        const errBox = document.getElementById('login-error');
        errBox.textContent = 'هذا الحساب غير مُفعّل في قائمة مستخدمي المنظومة.';
        errBox.classList.remove('hidden');
        return;
    }

    currentUserProfile = userRec;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    document.getElementById('current-user-name').textContent = `👤 ${userRec.full_name}`;
    document.getElementById('user-role-banner').textContent = `الصلاحية: ${ROLE_LABELS[userRec.role_code] || userRec.role_code}`;

    document.getElementById('req-date').value = todayISO();
    document.getElementById('disp-date').value = todayISO();
    document.getElementById('mov-date').value = todayISO();

    applyRolePermissions();
    await loadAllData();
}

function applyRolePermissions() {
    const role = currentUserProfile.role_code;
    let firstVisibleTab = null;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        const allowed = btn.dataset.roles.split(',');
        if (allowed.includes(role)) {
            btn.classList.remove('hidden');
            if (!firstVisibleTab) firstVisibleTab = btn;
        } else {
            btn.classList.add('hidden');
        }
    });

    if (firstVisibleTab) firstVisibleTab.click();
}

async function logoutUser() {
    await db.auth.signOut();
    location.reload();
}

function openPasswordModal() { document.getElementById('password-modal').classList.remove('hidden'); }
function closePasswordModal() { document.getElementById('password-modal').classList.add('hidden'); }

document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;
    const { error } = await db.auth.updateUser({ password: newPassword });
    if (error) showAlert('فشل تحديث كلمة المرور: ' + error.message, 'error');
    else {
        showAlert('✅ تم تغيير كلمة المرور بنجاح');
        closePasswordModal();
        e.target.reset();
    }
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

function showAlert(msg, type = 'success') {
    const box = document.getElementById('alert-box');
    box.textContent = msg;
    box.className = `alert-box ${type}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => box.classList.add('hidden'), 6000);
}

async function loadAllData() {
    try {
        const [locRes, drugRes, batchRes, balRes, ledRes, reqRes, reqItemsRes] = await Promise.all([
            db.from('locations').select('*').eq('is_active', true).order('code'),
            db.from('drugs').select('*').eq('is_active', true).order('trade_name'),
            db.from('batches').select('*').eq('is_active', true),
            db.from('stock_balance').select('*'),
            db.from('stock_ledger').select('*').order('transaction_date', { ascending: false }).limit(500),
            db.from('department_requisitions').select('*').order('created_at', { ascending: false }),
            db.from('requisition_items').select('*')
        ]);

        state.locations = locRes.data || [];
        state.drugs = drugRes.data || [];
        state.batches = batchRes.data || [];
        state.balances = balRes.data || [];
        state.ledger = ledRes.data || [];
        state.requisitions = reqRes.data || [];
        state.reqItems = reqItemsRes.data || [];

        if (currentUserProfile.role_code === 'MANAGEMENT') {
            const usrRes = await db.from('app_users').select('*').order('created_at');
            state.users = usrRes.data || [];
            renderUsers();
        }

        populateDropdowns();
        renderDashboard();
        renderRequisitions();
        renderBalances();
        renderPatientDispenseTab();
        renderDrugs();
        renderLedger();
    } catch (err) {
        showAlert('خطأ في تحميل البيانات: ' + err.message, 'error');
    }
}

function populateDropdowns() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;

    const visibleLocations = isDeptStaff ? state.locations.filter(l => l.id === userDeptId) : state.locations;
    const locOptions = visibleLocations.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    document.getElementById('filter-balance-location').innerHTML = isDeptStaff ? locOptions : `<option value="ALL">جميع مخازن وأقسام المستشفى</option>` + locOptions;
    document.getElementById('filter-ledger-location').innerHTML = isDeptStaff ? locOptions : `<option value="ALL">كل المخازن والأقسام</option>` + locOptions;

    const deptLocations = state.locations.filter(l => l.location_type === 'DEPARTMENT' && (!isDeptStaff || l.id === userDeptId));
    document.getElementById('req-department').innerHTML = deptLocations.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    document.getElementById('usr-dept').innerHTML = `<option value="">-- بدون قسم (للإدارة / الصيدلية / التمريض / الطبي) --</option>` +
        state.locations.filter(l => l.location_type === 'DEPARTMENT').map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    const drugOptions = state.drugs.map(d => `<option value="${d.id}">${d.drug_code} - ${d.trade_name} (${d.strength || ''})</option>`).join('');
    document.getElementById('mov-drug').innerHTML = drugOptions || `<option value="">-- لا توجد أصناف --</option>`;
    document.getElementById('filter-ledger-drug').innerHTML = `<option value="ALL">كل الأصناف الدوائية</option>` + drugOptions;

    if (document.getElementById('req-items-container').children.length === 0) {
        addReqItemRow();
    }

    const dispModeSelect = document.getElementById('disp-mode');
    if (isDeptStaff) {
        dispModeSelect.innerHTML = `<option value="PATIENT_USAGE">1. صرف علاج لمريض (من عهدة القسم الفرعي)</option>`;
    } else {
        dispModeSelect.innerHTML = `
            <option value="PATIENT_USAGE">1. صرف علاج لمريض (من عهدة القسم الفرعي)</option>
            <option value="STAFF_USAGE">2. صرف علاج لعامل / موظف بالمستشفى (من المخزن الرئيسي مباشرة)</option>
        `;
    }
    updateDispenseModeUI();

    const movTypeSelect = document.getElementById('mov-type');
    if (isDeptStaff) {
        movTypeSelect.innerHTML = `<option value="RETURN">مرتجع دواء (من القسم إلى المخزن الرئيسي)</option>`;
    } else {
        movTypeSelect.innerHTML = `
            <option value="RECEIPT">1. وارد شراء / رصيد افتتاحي (للمخزن الرئيسي)</option>
            <option value="TRANSFER">2. تحويل مباشر من المخزن الرئيسي إلى قسم فرعي</option>
            <option value="RETURN">3. مرتجع دواء (من قسم فرعي إلى المخزن الرئيسي)</option>
            <option value="ADJUSTMENT">4. تسوية جردية أو هالك (+ زيادة / - عجز)</option>
        `;
    }
    updateMovementFormUI();
}

function addReqItemRow() {
    const container = document.getElementById('req-items-container');
    const drugOpts = state.drugs.map(d => `<option value="${d.id}">${d.drug_code} - ${d.trade_name} (${d.strength || ''})</option>`).join('');
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
        <select class="req-item-drug" required>${drugOpts}</select>
        <input type="number" class="req-item-qty" min="1" step="0.01" placeholder="الكمية المطلوبة" required>
        <select class="req-item-unit">${DISPENSE_UNITS_HTML}</select>
        <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✖</button>
    `;
    container.appendChild(row);
}

document.getElementById('new-req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = document.querySelectorAll('#req-items-container .item-row');
    if (rows.length === 0) return showAlert('يرجى إضافة صنف واحد على الأقل للطلبية', 'error');

    const btn = document.getElementById('btn-submit-req');
    btn.disabled = true;

    const reqNumber = 'REQ-' + Date.now().toString().slice(-6);
    const deptId = document.getElementById('req-department').value;
    const reqDate = document.getElementById('req-date').value;
    const notes = document.getElementById('req-notes').value.trim();

    const { data: reqData, error: reqErr } = await db.from('department_requisitions').insert([{
        req_number: reqNumber,
        department_id: deptId,
        req_date: reqDate,
        status: 'PENDING_HEAD_NURSE',
        requested_by: currentUserProfile.full_name,
        notes: notes
    }]).select().single();

    if (reqErr) {
        btn.disabled = false;
        return showAlert('خطأ في إنشاء الطلبية: ' + reqErr.message, 'error');
    }

    const itemsPayload = Array.from(rows).map(r => ({
        requisition_id: reqData.id,
        drug_id: r.querySelector('.req-item-drug').value,
        requested_qty: Number(r.querySelector('.req-item-qty').value),
        approved_qty: Number(r.querySelector('.req-item-qty').value),
        unit_name: r.querySelector('.req-item-unit').value
    }));

    const { error: itemsErr } = await db.from('requisition_items').insert(itemsPayload);
    btn.disabled = false;

    if (itemsErr) {
        showAlert('خطأ في حفظ بنود الطلبية: ' + itemsErr.message, 'error');
    } else {
        showAlert(`✅ تم إرسال الطلبية رقم (${reqNumber}) بنجاح إلى رئيس التمريض للاعتماد`);
        document.getElementById('req-items-container').innerHTML = '';
        addReqItemRow();
        document.getElementById('req-notes').value = '';
        await loadAllData();
    }
});

function renderRequisitions() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const statusFilter = document.getElementById('filter-req-status').value;
    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));

    const filtered = state.requisitions.filter(r => {
        if (isDeptStaff && r.department_id !== userDeptId) return false;
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        return true;
    });

    document.getElementById('requisitions-tbody').innerHTML = filtered.map(r => {
        const st = REQ_STATUS_LABELS[r.status] || { text: r.status, badge: 'badge-info' };
        const trail = [
            r.head_nurse_by ? `تمريض: ${r.head_nurse_by}` : '',
            r.medical_dir_by ? `طبي: ${r.medical_dir_by}` : '',
            r.issued_by ? `صيدلية: ${r.issued_by}` : ''
        ].filter(Boolean).join(' ← ') || 'في بداية الدورة';

        return `
            <tr>
                <td><strong>${r.req_number}</strong></td>
                <td>${r.req_date}</td>
                <td>${locMap[r.department_id] || '-'}</td>
                <td>${r.requested_by || '-'}</td>
                <td><span class="badge ${st.badge}">${st.text}</span></td>
                <td style="font-size:12px; color:#475569;">${trail}</td>
                <td><button class="btn btn-primary btn-sm" onclick="openReqModal('${r.id}')">🔍 فتح ومراجعة / اعتماد</button></td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="7">لا توجد طلبيات مسجلة حالياً</td></tr>`;
}

let activeReqId = null;
function openReqModal(reqId) {
    activeReqId = reqId;
    const req = state.requisitions.find(r => r.id === reqId);
    const items = state.reqItems.filter(i => i.requisition_id === reqId);
    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));
    const drugMap = Object.fromEntries(state.drugs.map(d => [d.id, `${d.drug_code} - ${d.trade_name}`]));
    const mainStore = state.locations.find(l => l.location_type === 'MAIN_STORE');

    const role = currentUserProfile.role_code;
    const canEditQty = (
        (req.status === 'PENDING_HEAD_NURSE' && ['HEAD_NURSE', 'MANAGEMENT'].includes(role)) ||
        (req.status === 'PENDING_MEDICAL_DIR' && ['MEDICAL_DIRECTOR', 'MANAGEMENT'].includes(role)) ||
        (req.status === 'APPROVED_FOR_ISSUE' && ['PHARMACY_MANAGER', 'MANAGEMENT'].includes(role))
    );
    const isPharmacyIssuing = (req.status === 'APPROVED_FOR_ISSUE' && ['PHARMACY_MANAGER', 'MANAGEMENT'].includes(role));

    document.getElementById('req-modal-title').textContent = `تفاصيل الطلبية: ${req.req_number} — ${locMap[req.department_id]}`;
    document.getElementById('req-modal-meta').innerHTML = `
        <strong>التاريخ:</strong> ${req.req_date} | <strong>مقدم الطلب:</strong> ${req.requested_by} | 
        <strong>الحالة:</strong> ${REQ_STATUS_LABELS[req.status]?.text} | <strong>ملاحظات:</strong> ${req.notes || 'لا يوجد'}
    `;

    document.getElementById('req-modal-tbody').innerHTML = items.map(item => {
        const mainBalRows = state.balances.filter(b => mainStore && b.location_id === mainStore.id && b.drug_id === item.drug_id && Number(b.quantity_on_hand) > 0);
        const totalMainAvail = mainBalRows.reduce((s, b) => s + Number(b.quantity_on_hand), 0);

        const batchSelectHtml = mainBalRows.length > 0
            ? `<select class="modal-item-batch">${mainBalRows.map(b => `<option value="${b.batch_number}">${b.batch_number} (متاح: ${b.quantity_on_hand})</option>`).join('')}</select>`
            : `<span class="badge badge-out">غير متوفر بالمخزن</span>`;

        const currentQtyVal = req.status === 'ISSUED' ? item.issued_qty : (item.approved_qty ?? item.requested_qty);

        return `
            <tr data-item-id="${item.id}" data-drug-id="${item.drug_id}" data-unit="${item.unit_name || ''}">
                <td><strong>${drugMap[item.drug_id] || '-'}</strong> (${item.unit_name || ''})</td>
                <td>${item.requested_qty}</td>
                <td><span class="badge ${totalMainAvail > 0 ? 'badge-in' : 'badge-out'}">${totalMainAvail}</span></td>
                <td>
                    ${canEditQty
                        ? `<input type="number" class="modal-item-qty" value="${currentQtyVal}" min="0" step="0.01" style="width:100px;">`
                        : `<strong>${currentQtyVal}</strong>`}
                </td>
                <td>${isPharmacyIssuing ? batchSelectHtml : (item.batch_number || '-')}</td>
            </tr>
        `;
    }).join('');

    const actionsDiv = document.getElementById('req-modal-actions');
    actionsDiv.innerHTML = '';

    if (req.status === 'PENDING_HEAD_NURSE' && ['HEAD_NURSE', 'MANAGEMENT'].includes(role)) {
        actionsDiv.innerHTML = `
            <button class="btn btn-danger" onclick="processReqApproval('REJECTED')">❌ رفض الطلبية</button>
            <button class="btn btn-success" onclick="processReqApproval('PENDING_MEDICAL_DIR')">✅ اعتماد رئيس التمريض وإرسال للمدير الطبي</button>
        `;
    } else if (req.status === 'PENDING_MEDICAL_DIR' && ['MEDICAL_DIRECTOR', 'MANAGEMENT'].includes(role)) {
        actionsDiv.innerHTML = `
            <button class="btn btn-danger" onclick="processReqApproval('REJECTED')">❌ رفض الطلبية</button>
            <button class="btn btn-success" onclick="processReqApproval('APPROVED_FOR_ISSUE')">✅ الاعتماد الطبي النهائي وتحويل للصيدلية</button>
        `;
    } else if (req.status === 'APPROVED_FOR_ISSUE' && ['PHARMACY_MANAGER', 'MANAGEMENT'].includes(role)) {
        actionsDiv.innerHTML = `
            <button class="btn btn-primary" onclick="issueApprovedRequisition()">📦 اعتماد الصرف الفعلي وخصم من المخزن الرئيسي</button>
        `;
    }

    document.getElementById('req-modal').classList.remove('hidden');
}

function closeReqModal() { document.getElementById('req-modal').classList.add('hidden'); }

async function processReqApproval(nextStatus) {
    const rows = document.querySelectorAll('#req-modal-tbody tr');
    for (const tr of rows) {
        const itemId = tr.dataset.itemId;
        const qtyInput = tr.querySelector('.modal-item-qty');
        if (qtyInput) {
            await db.from('requisition_items').update({ approved_qty: Number(qtyInput.value) }).eq('id', itemId);
        }
    }

    const updatePayload = { status: nextStatus };
    if (nextStatus === 'PENDING_MEDICAL_DIR') {
        updatePayload.head_nurse_by = currentUserProfile.full_name;
        updatePayload.head_nurse_at = new Date().toISOString();
    } else if (nextStatus === 'APPROVED_FOR_ISSUE') {
        updatePayload.medical_dir_by = currentUserProfile.full_name;
        updatePayload.medical_dir_at = new Date().toISOString();
    }

    const { error } = await db.from('department_requisitions').update(updatePayload).eq('id', activeReqId);
    if (error) showAlert('حدث خطأ: ' + error.message, 'error');
    else {
        showAlert('✅ تم تحديث حالة الطلبية وحفظ الاعتماد بنجاح');
        closeReqModal();
        await loadAllData();
    }
}

async function issueApprovedRequisition() {
    const req = state.requisitions.find(r => r.id === activeReqId);
    const mainStore = state.locations.find(l => l.location_type === 'MAIN_STORE');
    const rows = document.querySelectorAll('#req-modal-tbody tr');

    for (const tr of rows) {
        const itemId = tr.dataset.itemId;
        const drugId = tr.dataset.drugId;
        const unitName = tr.dataset.unit;
        const qty = Number(tr.querySelector('.modal-item-qty').value);
        const batchSelect = tr.querySelector('.modal-item-batch');

        if (qty > 0) {
            if (!batchSelect) {
                return showAlert('يوجد صنف بكمية منصرفة غير متوفر بالمخزن الرئيسي. يرجى تعديل كميته إلى 0.', 'error');
            }
            const batchNo = batchSelect.value;
            const { error } = await db.rpc('record_pharmacy_movement', {
                p_movement_type: 'TRANSFER',
                p_from_location_id: mainStore.id,
                p_to_location_id: req.department_id,
                p_drug_id: drugId,
                p_batch_number: batchNo,
                p_expiry_date: null,
                p_quantity: qty,
                p_unit_cost: 0,
                p_reference_no: req.req_number,
                p_patient_name: null,
                p_notes: `صرف طلبية معتمدة رقم ${req.req_number} [بواسطة: ${currentUserProfile.full_name}]`,
                p_movement_date: todayISO(),
                p_dispense_unit: unitName
            });
            if (error) return showAlert('⚠️ توقف الصرف: ' + error.message, 'error');

            await db.from('requisition_items').update({ issued_qty: qty, batch_number: batchNo }).eq('id', itemId);
        } else {
            await db.from('requisition_items').update({ issued_qty: 0 }).eq('id', itemId);
        }
    }

    await db.from('department_requisitions').update({
        status: 'ISSUED',
        issued_by: currentUserProfile.full_name,
        issued_at: new Date().toISOString()
    }).eq('id', activeReqId);

    showAlert(`✅ تم صرف الطلبية (${req.req_number}) بنجاح وخصمها من المخزن الرئيسي وإضافتها لعهدة القسم`);
    closeReqModal();
    await loadAllData();
}

function updateDispenseModeUI() {
    const mode = document.getElementById('disp-mode').value;
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const locSelect = document.getElementById('disp-location');

    if (mode === 'STAFF_USAGE') {
        document.getElementById('label-disp-loc').textContent = 'المخزن الصارف (المخزن الرئيسي) *';
        document.getElementById('label-disp-person').textContent = 'اسم الموظف / العامل بالمستشفى *';
        document.getElementById('label-disp-id').textContent = 'الكود الوظيفي / القسم التابع له *';
        const mainStore = state.locations.filter(l => l.location_type === 'MAIN_STORE');
        locSelect.innerHTML = mainStore.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');
    } else {
        document.getElementById('label-disp-loc').textContent = 'القسم الصارف للعلاج *';
        document.getElementById('label-disp-person').textContent = 'اسم المريض بالكامل *';
        document.getElementById('label-disp-id').textContent = 'رقم ملف المريض / التذكرة *';
        const depts = state.locations.filter(l => l.location_type === 'DEPARTMENT' && (!isDeptStaff || l.id === userDeptId));
        locSelect.innerHTML = depts.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');
    }

    document.getElementById('dispense-items-container').innerHTML = '';
    addDispenseItemRow();
}

document.getElementById('disp-mode').addEventListener('change', updateDispenseModeUI);
document.getElementById('disp-location').addEventListener('change', () => {
    document.getElementById('dispense-items-container').innerHTML = '';
    addDispenseItemRow();
});

function addDispenseItemRow() {
    const locId = document.getElementById('disp-location').value;
    const available = state.balances.filter(b => b.location_id === locId && Number(b.quantity_on_hand) > 0);

    const stockOpts = available.length > 0
        ? available.map(b => `<option value='${JSON.stringify({ drug_id: b.drug_id, batch_number: b.batch_number, max_qty: b.quantity_on_hand })}'>${b.trade_name} (${b.strength || ''}) | تشغيلة: ${b.batch_number} | متاح: ${b.quantity_on_hand}</option>`).join('')
        : `<option value="">-- لا يوجد رصيد متاح في هذا المخزن --</option>`;

    const container = document.getElementById('dispense-items-container');
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
        <select class="disp-row-stock" required>${stockOpts}</select>
        <input type="number" class="disp-row-qty" step="0.01" min="0.01" placeholder="الكمية" required>
        <select class="disp-row-unit">${DISPENSE_UNITS_HTML}</select>
        <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✖</button>
    `;
    container.appendChild(row);
}

document.getElementById('patient-dispense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = document.querySelectorAll('#dispense-items-container .item-row');
    if (rows.length === 0) return showAlert('يرجى إضافة دواء واحد على الأقل', 'error');

    const mode = document.getElementById('disp-mode').value;
    const locId = document.getElementById('disp-location').value;
    const movDate = document.getElementById('disp-date').value;
    const personName = document.getElementById('disp-patient-name').value.trim();
    const personId = document.getElementById('disp-patient-id').value.trim();
    const notes = document.getElementById('disp-notes').value.trim();

    const btn = document.getElementById('btn-submit-dispense');
    btn.disabled = true;

    for (const row of rows) {
        const rawStock = row.querySelector('.disp-row-stock').value;
        if (!rawStock) {
            btn.disabled = false;
            return showAlert('يوجد صف لا يحتوي على دواء متاح بالرصيد', 'error');
        }
        const stockObj = JSON.parse(rawStock);
        const qty = Number(row.querySelector('.disp-row-qty').value);
        const unitName = row.querySelector('.disp-row-unit').value;

        if (qty > Number(stockObj.max_qty)) {
            btn.disabled = false;
            return showAlert(`الكمية المطلوبة (${qty}) أكبر من المتاح (${stockObj.max_qty})`, 'error');
        }

        const { error } = await db.rpc('record_pharmacy_movement', {
            p_movement_type: mode,
            p_from_location_id: locId,
            p_to_location_id: null,
            p_drug_id: stockObj.drug_id,
            p_batch_number: stockObj.batch_number,
            p_expiry_date: null,
            p_quantity: qty,
            p_unit_cost: 0,
            p_reference_no: personId,
            p_patient_name: `${personName} (${personId})`,
            p_notes: `${notes} [بواسطة: ${currentUserProfile.full_name}]`,
            p_movement_date: movDate,
            p_dispense_unit: unitName
        });

        if (error) {
            btn.disabled = false;
            return showAlert('⚠️ خطأ أثناء الصرف: ' + error.message, 'error');
        }
    }

    btn.disabled = false;
    showAlert(`✅ تم تسجيل الصرف بنجاح للمستفيد (${personName}) وخصم الكميات من الرصيد`);
    document.getElementById('disp-patient-name').value = '';
    document.getElementById('disp-patient-id').value = '';
    document.getElementById('disp-notes').value = '';
    document.getElementById('dispense-items-container').innerHTML = '';
    await loadAllData();
});

function renderPatientDispenseTab() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const typeFilter = document.getElementById('filter-usage-type').value;

    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));
    const drugMap = Object.fromEntries(state.drugs.map(d => [d.id, d.trade_name]));
    const batchMap = Object.fromEntries(state.batches.map(b => [b.id, b.batch_number]));

    const rows = state.ledger.filter(r => {
        if (!['PATIENT_USAGE', 'STAFF_USAGE'].includes(r.movement_type)) return false;
        if (isDeptStaff && r.location_id !== userDeptId) return false;
        if (typeFilter !== 'ALL' && r.movement_type !== typeFilter) return false;
        return true;
    });

    document.getElementById('patient-usage-tbody').innerHTML = rows.map(r => `
        <tr>
            <td>${r.movement_date || new Date(r.transaction_date).toLocaleDateString('ar-EG')}</td>
            <td><span class="badge ${r.movement_type === 'STAFF_USAGE' ? 'badge-info' : 'badge-warn'}">${r.movement_type === 'STAFF_USAGE' ? 'عامل بالمستشفى' : 'مريض'}</span></td>
            <td><strong>${locMap[r.location_id] || '-'}</strong></td>
            <td>${drugMap[r.drug_id] || '-'}</td>
            <td>${batchMap[r.batch_id] || '-'}</td>
            <td><span class="badge badge-out">${Math.abs(Number(r.quantity))}</span></td>
            <td>${r.dispense_unit || '-'}</td>
            <td>${r.notes || '-'}</td>
        </tr>
    `).join('') || `<tr><td colspan="8">لا توجد صرفيات مسجلة</td></tr>`;
}

function downloadDrugsExcelTemplate() {
    const sample = [
        { drug_code: 'DRG-101', trade_name: 'Augmentin 1g Tab', generic_name: 'Amoxicillin / Clavulanic Acid', strength: '1000 mg', dosage_form: 'Tablet', stock_unit: 'Box', reorder_point: 15, is_controlled: 'NO' },
        { drug_code: 'DRG-102', trade_name: 'Voltaren 75mg Amp', generic_name: 'Diclofenac Sodium', strength: '75 mg/3ml', dosage_form: 'Ampoule', stock_unit: 'Ampoule', reorder_point: 30, is_controlled: 'NO' }
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drugs_Template');
    XLSX.writeFile(wb, 'SinaClinic_Drugs_Template.xlsx');
}

function toggleWebImportBox() {
    document.getElementById('web-import-box').classList.toggle('hidden');
}

async function handleExcelDrugsUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet);
            await bulkInsertDrugsFromObjects(rows);
        } catch (err) {
            showAlert('خطأ في قراءة ملف Excel: ' + err.message, 'error');
        }
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

async function fetchDrugsFromWebUrl() {
    const url = document.getElementById('web-csv-url').value.trim();
    if (!url) return showAlert('يرجى إدخال رابط صفحة أو ملف CSV صالح', 'error');
    try {
        const res = await fetch(url);
        const text = await res.text();
        document.getElementById('web-paste-area').value = text;
        showAlert('تم جلب البيانات من الرابط، اضغط الآن على «استيراد البيانات الملصقة»');
    } catch (err) {
        showAlert('تعذر الجلب المباشر من الرابط (بسبب قيود الموقع)، يمكنك نسخ الجدول ولصقه يدوياً في المربع.', 'error');
    }
}

async function importPastedDrugs() {
    const raw = document.getElementById('web-paste-area').value.trim();
    if (!raw) return showAlert('المربع فارغ، يرجى لصق بيانات الأدوية أولاً', 'error');

    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const objects = lines.map((line, idx) => {
        const cols = line.includes('\t') ? line.split('\t') : line.split(',');
        return {
            drug_code: (cols[0] || `WEB-${Date.now()}-${idx}`).trim(),
            trade_name: (cols[1] || cols[0] || '').trim(),
            generic_name: (cols[2] || '').trim(),
            strength: (cols[3] || '').trim(),
            dosage_form: (cols[4] || 'Tablet').trim(),
            stock_unit: (cols[5] || 'Box').trim(),
            reorder_point: Number(cols[6]) || 10,
            is_controlled: 'NO'
        };
    }).filter(o => o.trade_name && o.trade_name.toLowerCase() !== 'trade_name');

    await bulkInsertDrugsFromObjects(objects);
}

async function bulkInsertDrugsFromObjects(rows) {
    if (!rows || rows.length === 0) return showAlert('لم يتم العثور على صفوف صالحة للاستيراد', 'error');

    const payload = rows.map((r, i) => ({
        drug_code: String(r.drug_code || r['كود الصنف'] || `DRG-${Date.now()}-${i}`).trim(),
        trade_name: String(r.trade_name || r['الاسم التجاري'] || '').trim(),
        generic_name: String(r.generic_name || r['الاسم العلمي'] || '').trim(),
        strength: String(r.strength || r['التركيز'] || '').trim(),
        dosage_form: String(r.dosage_form || r['الشكل'] || 'Tablet').trim(),
        purchase_unit: String(r.stock_unit || r['الوحدة'] || 'Box').trim(),
        stock_unit: String(r.stock_unit || r['الوحدة'] || 'Box').trim(),
        patient_billing_unit: String(r.stock_unit || r['الوحدة'] || 'Box').trim(),
        units_per_pack: 1,
        reorder_point: Number(r.reorder_point || r['حد الطلب'] || 10),
        is_controlled: String(r.is_controlled || '').toUpperCase() === 'YES' || r.is_controlled === true,
        is_active: true
    })).filter(p => p.trade_name);

    const { error } = await db.from('drugs').upsert(payload, { onConflict: 'drug_code' });
    if (error) showAlert('خطأ أثناء الاستيراد الجماعي: ' + error.message, 'error');
    else {
        showAlert(`✅ تم استيراد وتحديث (${payload.length}) صنف دوائي بنجاح!`);
        document.getElementById('web-paste-area').value = '';
        await loadAllData();
    }
}

function updateMovementFormUI() {
    const type = document.getElementById('mov-type').value;
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;

    const fromGroup = document.getElementById('group-from-loc');
    const toGroup = document.getElementById('group-to-loc');
    const expiryGroup = document.getElementById('group-expiry');
    const costGroup = document.getElementById('group-cost');

    const fromSelect = document.getElementById('mov-from-loc');
    const toSelect = document.getElementById('mov-to-loc');

    const mainOpts = state.locations.filter(l => l.location_type === 'MAIN_STORE').map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');
    const deptOpts = state.locations.filter(l => l.location_type === 'DEPARTMENT' && (!isDeptStaff || l.id === userDeptId)).map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');
    const allOpts = state.locations.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    fromGroup.classList.add('hidden');
    toGroup.classList.add('hidden');
    expiryGroup.classList.add('hidden');
    costGroup.classList.add('hidden');

    if (type === 'RECEIPT') {
        toGroup.classList.remove('hidden');
        expiryGroup.classList.remove('hidden');
        costGroup.classList.remove('hidden');
        document.getElementById('label-to-loc').textContent = 'المخزن المستلم (الرئيسي) *';
        toSelect.innerHTML = mainOpts;
    } else if (type === 'TRANSFER') {
        fromGroup.classList.remove('hidden');
        toGroup.classList.remove('hidden');
        document.getElementById('label-from-loc').textContent = 'من المخزن الرئيسي *';
        document.getElementById('label-to-loc').textContent = 'إلى القسم الفرعي *';
        fromSelect.innerHTML = mainOpts;
        toSelect.innerHTML = deptOpts;
    } else if (type === 'RETURN') {
        fromGroup.classList.remove('hidden');
        toGroup.classList.remove('hidden');
        document.getElementById('label-from-loc').textContent = 'من القسم المرتجع منه *';
        document.getElementById('label-to-loc').textContent = 'إلى المخزن الرئيسي *';
        fromSelect.innerHTML = deptOpts;
        toSelect.innerHTML = mainOpts;
    } else if (type === 'ADJUSTMENT') {
        fromGroup.classList.remove('hidden');
        expiryGroup.classList.remove('hidden');
        document.getElementById('label-from-loc').textContent = 'المخزن / القسم محل الجرد *';
        fromSelect.innerHTML = allOpts;
    }
    updateBatchSuggestions();
}

function updateBatchSuggestions() {
    const drugId = document.getElementById('mov-drug').value;
    const batches = state.batches.filter(b => b.drug_id === drugId);
    document.getElementById('existing-batches').innerHTML = batches.map(b => `<option value="${b.batch_number}">صلاحية: ${b.expiry_date || 'غير محدد'}</option>`).join('');
}

document.getElementById('mov-type').addEventListener('change', updateMovementFormUI);
document.getElementById('mov-drug').addEventListener('change', updateBatchSuggestions);

document.getElementById('movement-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-mov');
    btn.disabled = true;

    const notesRaw = document.getElementById('mov-notes').value.trim();
    const { data, error } = await db.rpc('record_pharmacy_movement', {
        p_movement_type: document.getElementById('mov-type').value,
        p_from_location_id: document.getElementById('mov-from-loc').value || null,
        p_to_location_id: document.getElementById('mov-to-loc').value || null,
        p_drug_id: document.getElementById('mov-drug').value,
        p_batch_number: document.getElementById('mov-batch').value.trim(),
        p_expiry_date: document.getElementById('mov-expiry').value || null,
        p_quantity: Number(document.getElementById('mov-qty').value),
        p_unit_cost: Number(document.getElementById('mov-cost').value) || 0,
        p_reference_no: document.getElementById('mov-ref').value.trim() || null,
        p_patient_name: null,
        p_notes: `${notesRaw} [بواسطة: ${currentUserProfile.full_name}]`,
        p_movement_date: document.getElementById('mov-date').value,
        p_dispense_unit: null
    });

    btn.disabled = false;
    if (error) showAlert('⚠️ لم يتم الترحيل: ' + error.message, 'error');
    else {
        showAlert(`✅ تم ترحيل الحركة بنجاح (مرجع: ${data.reference_no})`);
        document.getElementById('mov-qty').value = '';
        document.getElementById('mov-notes').value = '';
        await loadAllData();
    }
});

document.getElementById('drug-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        drug_code: document.getElementById('drug-code').value.trim(),
        trade_name: document.getElementById('drug-trade').value.trim(),
        generic_name: document.getElementById('drug-generic').value.trim(),
        strength: document.getElementById('drug-strength').value.trim(),
        dosage_form: document.getElementById('drug-form-type').value,
        purchase_unit: document.getElementById('drug-unit').value,
        stock_unit: document.getElementById('drug-unit').value,
        patient_billing_unit: document.getElementById('drug-unit').value,
        units_per_pack: 1,
        reorder_point: Number(document.getElementById('drug-reorder').value) || 0,
        is_controlled: document.getElementById('drug-controlled').value === 'true',
        is_active: true
    };
    const { error } = await db.from('drugs').insert([payload]);
    if (error) showAlert('تعذر حفظ الصنف: ' + error.message, 'error');
    else {
        showAlert('✅ تم إضافة الصنف الدوائي بنجاح');
        e.target.reset();
        await loadAllData();
    }
});

function renderDashboard() {
    document.getElementById('kpi-total-drugs').textContent = state.drugs.length;
    const positiveBalances = state.balances.filter(b => Number(b.quantity_on_hand) > 0);
    document.getElementById('kpi-active-stock').textContent = new Set(positiveBalances.map(b => b.drug_id)).size;

    const pendingReqs = state.requisitions.filter(r => !['ISSUED', 'REJECTED'].includes(r.status)).length;
    document.getElementById('kpi-pending-reqs').textContent = pendingReqs;

    const lowStockList = [];
    state.drugs.forEach(drug => {
        const totalQty = positiveBalances.filter(b => b.drug_id === drug.id).reduce((s, b) => s + Number(b.quantity_on_hand), 0);
        if (totalQty <= Number(drug.reorder_point || 0)) lowStockList.push({ ...drug, totalQty });
    });

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + 90);
    const expiringList = positiveBalances.filter(b => b.expiry_date && new Date(b.expiry_date) <= limitDate);

    document.getElementById('kpi-alerts-count').textContent = lowStockList.length + expiringList.length;

    document.getElementById('low-stock-tbody').innerHTML = lowStockList.slice(0, 15).map(d => `
        <tr><td>${d.drug_code}</td><td><strong>${d.trade_name}</strong></td><td><span class="badge badge-out">${d.totalQty} ${d.stock_unit}</span></td><td>${d.reorder_point}</td></tr>
    `).join('') || `<tr><td colspan="4">لا توجد نواقص حالياً</td></tr>`;

    document.getElementById('expiring-tbody').innerHTML = expiringList.map(b => `
        <tr><td>${b.location_name_ar}</td><td><strong>${b.trade_name}</strong></td><td>${b.batch_number}</td><td><span class="badge badge-warn">${b.expiry_date}</span></td><td>${b.quantity_on_hand}</td></tr>
    `).join('') || `<tr><td colspan="5">لا توجد أصناف قريبة انتهاء الصلاحية</td></tr>`;
}

function renderBalances() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const locFilter = document.getElementById('filter-balance-location').value;
    const search = document.getElementById('search-balance-drug').value.toLowerCase();

    const filtered = state.balances.filter(b => {
        if (Number(b.quantity_on_hand) === 0) return false;
        if (isDeptStaff && b.location_id !== userDeptId) return false;
        if (locFilter !== 'ALL' && b.location_id !== locFilter) return false;
        if (search && !`${b.trade_name} ${b.generic_name} ${b.drug_code}`.toLowerCase().includes(search)) return false;
        return true;
    });

    document.getElementById('balances-tbody').innerHTML = filtered.map(b => `
        <tr>
            <td><strong>${b.location_name_ar}</strong></td><td>${b.drug_code}</td><td>${b.trade_name}</td>
            <td>${b.generic_name || '-'}</td><td>${b.strength || '-'}</td><td>${b.batch_number}</td>
            <td>${b.expiry_date || '-'}</td><td><span class="badge badge-in">${b.quantity_on_hand}</span></td><td>${b.stock_unit}</td>
        </tr>
    `).join('') || `<tr><td colspan="9">لا توجد أرصدة مطابقة</td></tr>`;
}
document.getElementById('filter-balance-location').addEventListener('change', renderBalances);
document.getElementById('search-balance-drug').addEventListener('input', renderBalances);

function renderDrugs() {
    const search = document.getElementById('search-drugs-list').value.toLowerCase();
    const filtered = state.drugs.filter(d => `${d.drug_code} ${d.trade_name} ${d.generic_name}`.toLowerCase().includes(search));
    document.getElementById('drugs-total-badge').textContent = filtered.length;
    document.getElementById('drugs-tbody').innerHTML = filtered.map(d => `
        <tr>
            <td>${d.drug_code}</td><td><strong>${d.trade_name}</strong></td><td>${d.generic_name || '-'}</td>
            <td>${d.strength || '-'}</td><td>${d.dosage_form || '-'}</td><td>${d.stock_unit}</td>
            <td>${d.reorder_point}</td><td>${d.is_controlled ? '<span class="badge badge-out">جدول / مراقب</span>' : 'عادي'}</td>
        </tr>
    `).join('') || `<tr><td colspan="8">لا توجد أصناف مسجلة</td></tr>`;
}
document.getElementById('search-drugs-list').addEventListener('input', renderDrugs);

function renderLedger() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const locFilter = document.getElementById('filter-ledger-location').value;
    const drugFilter = document.getElementById('filter-ledger-drug').value;

    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));
    const drugMap = Object.fromEntries(state.drugs.map(d => [d.id, d.trade_name]));
    const batchMap = Object.fromEntries(state.batches.map(b => [b.id, b.batch_number]));

    const filtered = state.ledger.filter(row => {
        if (isDeptStaff && row.location_id !== userDeptId) return false;
        if (locFilter !== 'ALL' && row.location_id !== locFilter) return false;
        if (drugFilter !== 'ALL' && row.drug_id !== drugFilter) return false;
        return true;
    });

    document.getElementById('ledger-tbody').innerHTML = filtered.map(r => {
        const qty = Number(r.quantity);
        return `
            <tr>
                <td>${r.movement_date || new Date(r.transaction_date).toLocaleDateString('ar-EG')}</td>
                <td>${locMap[r.location_id] || '-'}</td>
                <td><strong>${drugMap[r.drug_id] || '-'}</strong></td>
                <td>${batchMap[r.batch_id] || '-'}</td>
                <td>${r.movement_type}</td>
                <td><span class="badge ${qty > 0 ? 'badge-in' : 'badge-out'}">${qty > 0 ? '+' + qty : qty}</span></td>
                <td>${r.dispense_unit || '-'}</td>
                <td>${r.reference_no || '-'}</td>
                <td>${r.notes || '-'}</td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="9">لا توجد حركات مسجلة</td></tr>`;
}
document.getElementById('filter-ledger-location').addEventListener('change', renderLedger);
document.getElementById('filter-ledger-drug').addEventListener('change', renderLedger);

document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = document.getElementById('usr-role').value;
    const dept = document.getElementById('usr-dept').value || null;

    if (role === 'DEPARTMENT_STAFF' && !dept) {
        return showAlert('يجب تحديد القسم التابع له لمشرف / تمريض القسم الفرعي', 'error');
    }

    const payload = {
        full_name: document.getElementById('usr-name').value.trim(),
        email: document.getElementById('usr-email').value.trim(),
        role_code: role,
        department_id: role === 'DEPARTMENT_STAFF' ? dept : null,
        is_active: true
    };

    const { error } = await db.from('app_users').upsert([payload], { onConflict: 'email' });
    if (error) showAlert('خطأ في حفظ المستخدم: ' + error.message, 'error');
    else {
        showAlert('✅ تم حفظ صلاحيات المستخدم بنجاح');
        e.target.reset();
        await loadAllData();
    }
});

function renderUsers() {
    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));
    document.getElementById('users-tbody').innerHTML = state.users.map(u => `
        <tr>
            <td><strong>${u.full_name}</strong></td>
            <td>${u.email}</td>
            <td>${ROLE_LABELS[u.role_code] || u.role_code}</td>
            <td>${u.department_id ? locMap[u.department_id] : 'جميع المخازن والأقسام'}</td>
            <td><span class="badge ${u.is_active ? 'badge-in' : 'badge-out'}">${u.is_active ? 'نشط' : 'موقوف'}</span></td>
            <td>
                ${u.email !== currentUserProfile.email ? `
                    <button class="btn btn-secondary btn-sm" onclick="toggleUserStatus('${u.id}', ${!u.is_active})">
                        ${u.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                    </button>
                ` : '<span style="color:#64748b;font-size:12px;">حسابك الحالي</span>'}
            </td>
        </tr>
    `).join('');
}

async function toggleUserStatus(userId, newStatus) {
    const { error } = await db.from('app_users').update({ is_active: newStatus }).eq('id', userId);
    if (error) showAlert('تعذر تعديل الحالة: ' + error.message, 'error');
    else {
        showAlert('تم تحديث حالة المستخدم');
        await loadAllData();
    }
}

function exportTableToExcel(tableId, fileName) {
    const table = document.getElementById(tableId);
    const wb = XLSX.utils.table_to_book(table, { sheet: "Report" });
    XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

checkSession();
