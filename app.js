const SUPABASE_URL = 'https://hprowfrhkzvpzdwxzpxo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwcm93ZnJoa3p2cHpkd3h6cHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNTQ0NDEsImV4cCI6MjEwNjkzMDQ0MX0.wzyxn8NZCIOz1rF-crcK9Uf1gkD3SiV_lqkvHBxc7aU';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserProfile = null;
let state = {
    locations: [],
    drugs: [],
    batches: [],
    balances: [],
    ledger: [],
    users: []
};

const ROLE_LABELS = {
    'MANAGEMENT': 'الإدارة العليا (صلاحية كاملة)',
    'PHARMACY_MANAGER': 'مدير الصيدلية (المخزن الرئيسي)',
    'DEPARTMENT_STAFF': 'مشرف / تمريض قسم فرعي'
};

// إدارة الجلسة عند فتح الصفحة
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
        errBox.textContent = 'هذا الحساب غير مُفعّل في قائمة مستخدمي المنظومة. يرجى مراجعة الإدارة.';
        errBox.classList.remove('hidden');
        return;
    }

    currentUserProfile = userRec;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    document.getElementById('current-user-name').textContent = `👤 ${userRec.full_name}`;
    document.getElementById('user-role-banner').textContent = `الصلاحية: ${ROLE_LABELS[userRec.role_code]}`;

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

    if (firstVisibleTab) {
        firstVisibleTab.click();
    }
}

async function logoutUser() {
    await db.auth.signOut();
    location.reload();
}

// تغيير كلمة المرور
function openPasswordModal() { document.getElementById('password-modal').classList.remove('hidden'); }
function closePasswordModal() { document.getElementById('password-modal').classList.add('hidden'); }

document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;
    const { error } = await db.auth.updateUser({ password: newPassword });
    if (error) {
        showAlert('فشل تحديث كلمة المرور: ' + error.message, 'error');
    } else {
        showAlert('✅ تم تغيير كلمة المرور بنجاح');
        closePasswordModal();
        e.target.reset();
    }
});

// التبديل بين التبويبات
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
    setTimeout(() => box.classList.add('hidden'), 5000);
}

// تحميل البيانات
async function loadAllData() {
    try {
        const [locRes, drugRes, batchRes, balRes, ledRes] = await Promise.all([
            db.from('locations').select('*').eq('is_active', true).order('code'),
            db.from('drugs').select('*').eq('is_active', true).order('trade_name'),
            db.from('batches').select('*').eq('is_active', true),
            db.from('stock_balance').select('*'),
            db.from('stock_ledger').select('*').order('transaction_date', { ascending: false }).limit(400)
        ]);

        state.locations = locRes.data || [];
        state.drugs = drugRes.data || [];
        state.batches = batchRes.data || [];
        state.balances = balRes.data || [];
        state.ledger = ledRes.data || [];

        if (currentUserProfile.role_code === 'MANAGEMENT') {
            const usrRes = await db.from('app_users').select('*').order('created_at');
            state.users = usrRes.data || [];
            renderUsers();
        }

        populateDropdowns();
        renderDashboard();
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

    // المواقع المتاحة للمستخدم
    const visibleLocations = isDeptStaff
        ? state.locations.filter(l => l.id === userDeptId)
        : state.locations;

    const locOptions = visibleLocations.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');
    document.getElementById('filter-balance-location').innerHTML = isDeptStaff
        ? locOptions
        : `<option value="ALL">جميع مخازن وأقسام المستشفى</option>` + locOptions;

    document.getElementById('filter-ledger-location').innerHTML = isDeptStaff
        ? locOptions
        : `<option value="ALL">كل المخازن والأقسام</option>` + locOptions;

    // قائمة الأقسام في تبويب صرف المرضى
    const deptLocations = state.locations.filter(l => l.location_type === 'DEPARTMENT' && (!isDeptStaff || l.id === userDeptId));
    document.getElementById('disp-location').innerHTML = deptLocations.map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    // قائمة الأقسام في نموذج إضافة مستخدم
    document.getElementById('usr-dept').innerHTML = `<option value="">-- بدون قسم (للإدارة / الصيدلية) --</option>` +
        state.locations.filter(l => l.location_type === 'DEPARTMENT').map(l => `<option value="${l.id}">${l.name_ar}</option>`).join('');

    // الأدوية
    const drugOptions = state.drugs.map(d => `<option value="${d.id}">${d.drug_code} - ${d.trade_name} (${d.strength || ''})</option>`).join('');
    document.getElementById('mov-drug').innerHTML = drugOptions || `<option value="">-- لا توجد أصناف --</option>`;
    document.getElementById('filter-ledger-drug').innerHTML = `<option value="ALL">كل الأصناف الدوائية</option>` + drugOptions;

    // أنواع الحركات المسموحة في تبويب التحويلات
    const movTypeSelect = document.getElementById('mov-type');
    if (isDeptStaff) {
        movTypeSelect.innerHTML = `<option value="RETURN">مرتجع دواء (من القسم إلى المخزن الرئيسي)</option>`;
    } else {
        movTypeSelect.innerHTML = `
            <option value="RECEIPT">1. وارد شراء / رصيد افتتاحي (للمخزن الرئيسي)</option>
            <option value="TRANSFER">2. تحويل / صرف من المخزن الرئيسي إلى قسم فرعي</option>
            <option value="RETURN">3. مرتجع دواء (من قسم فرعي إلى المخزن الرئيسي)</option>
            <option value="ADJUSTMENT">4. تسوية جردية أو هالك (+ زيادة / - عجز)</option>
        `;
    }

    updateMovementFormUI();
    updateDispenseDrugOptions();
}

// تحديث الأدوية المتاحة في عهدة القسم المختار للصرف على المريض
function updateDispenseDrugOptions() {
    const deptId = document.getElementById('disp-location').value;
    const stockSelect = document.getElementById('disp-stock-item');
    const availableInDept = state.balances.filter(b => b.location_id === deptId && Number(b.quantity_on_hand) > 0);

    if (availableInDept.length === 0) {
        stockSelect.innerHTML = `<option value="">-- لا يوجد رصيد أدوية متاح في هذا القسم حالياً --</option>`;
        return;
    }

    stockSelect.innerHTML = availableInDept.map(b =>
        `<option value='${JSON.stringify({ drug_id: b.drug_id, batch_number: b.batch_number, max_qty: b.quantity_on_hand })}'>
            ${b.trade_name} (${b.strength || ''}) | تشغيلة: ${b.batch_number} | المتاح: ${b.quantity_on_hand} ${b.stock_unit}
        </option>`
    ).join('');
}

document.getElementById('disp-location').addEventListener('change', updateDispenseDrugOptions);

// تنفيذ صرف دواء لمريض
document.getElementById('patient-dispense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawItem = document.getElementById('disp-stock-item').value;
    if (!rawItem) return showAlert('يرجى اختيار دواء متاح في عهدة القسم', 'error');

    const item = JSON.parse(rawItem);
    const deptId = document.getElementById('disp-location').value;
    const patientName = document.getElementById('disp-patient-name').value.trim();
    const patientId = document.getElementById('disp-patient-id').value.trim();
    const qty = Number(document.getElementById('disp-qty').value);
    const notes = document.getElementById('disp-notes').value.trim();

    if (qty > Number(item.max_qty)) {
        return showAlert(`الكمية المطلوبة (${qty}) أكبر من الرصيد المتاح في القسم (${item.max_qty})`, 'error');
    }

    const btn = document.getElementById('btn-submit-dispense');
    btn.disabled = true;

    const { data, error } = await db.rpc('record_pharmacy_movement', {
        p_movement_type: 'PATIENT_USAGE',
        p_from_location_id: deptId,
        p_to_location_id: null,
        p_drug_id: item.drug_id,
        p_batch_number: item.batch_number,
        p_expiry_date: null,
        p_quantity: qty,
        p_unit_cost: 0,
        p_reference_no: patientId,
        p_patient_name: `${patientName} (ملف: ${patientId})`,
        p_notes: `${notes} [بواسطة: ${currentUserProfile.full_name}]`
    });

    btn.disabled = false;

    if (error) {
        showAlert('⚠️ تعذر تسجيل الصرف: ' + error.message, 'error');
    } else {
        showAlert(`✅ تم صرف العلاج للمريض (${patientName}) وخصمه من عهدة القسم`);
        document.getElementById('disp-qty').value = '';
        document.getElementById('disp-notes').value = '';
        await loadAllData();
    }
});

function renderPatientDispenseTab() {
    const isDeptStaff = currentUserProfile.role_code === 'DEPARTMENT_STAFF';
    const userDeptId = currentUserProfile.department_id;
    const locMap = Object.fromEntries(state.locations.map(l => [l.id, l.name_ar]));
    const drugMap = Object.fromEntries(state.drugs.map(d => [d.id, d.trade_name]));
    const batchMap = Object.fromEntries(state.batches.map(b => [b.id, b.batch_number]));

    const usageRows = state.ledger.filter(r =>
        r.movement_type === 'PATIENT_USAGE' && (!isDeptStaff || r.location_id === userDeptId)
    );

    document.getElementById('patient-usage-tbody').innerHTML = usageRows.map(r => `
        <tr>
            <td>${new Date(r.transaction_date).toLocaleString('ar-EG')}</td>
            <td><strong>${locMap[r.location_id] || '-'}</strong></td>
            <td>${drugMap[r.drug_id] || '-'}</td>
            <td>${batchMap[r.batch_id] || '-'}</td>
            <td><span class="badge badge-out">${Math.abs(Number(r.quantity))}</span></td>
            <td>${r.notes || '-'}</td>
        </tr>
    `).join('') || `<tr><td colspan="6">لا توجد صرفيات مرضى مسجلة حتى الآن</td></tr>`;
}

// تحديث واجهة الحركات المخزنية
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
        p_notes: `${notesRaw} [بواسطة: ${currentUserProfile.full_name}]`
    });

    btn.disabled = false;
    if (error) {
        showAlert('⚠️ لم يتم الترحيل: ' + error.message, 'error');
    } else {
        showAlert(`✅ تم ترحيل الحركة بنجاح (مرجع: ${data.reference_no})`);
        document.getElementById('mov-qty').value = '';
        document.getElementById('mov-notes').value = '';
        await loadAllData();
    }
});

// تكويد صنف دوائي
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

// لوحة الرقابة
function renderDashboard() {
    document.getElementById('kpi-total-drugs').textContent = state.drugs.length;
    const positiveBalances = state.balances.filter(b => Number(b.quantity_on_hand) > 0);
    document.getElementById('kpi-active-stock').textContent = new Set(positiveBalances.map(b => b.drug_id)).size;

    const lowStockList = [];
    state.drugs.forEach(drug => {
        const totalQty = positiveBalances.filter(b => b.drug_id === drug.id).reduce((s, b) => s + Number(b.quantity_on_hand), 0);
        if (totalQty <= Number(drug.reorder_point || 0)) lowStockList.push({ ...drug, totalQty });
    });
    document.getElementById('kpi-low-stock').textContent = lowStockList.length;
    document.getElementById('low-stock-tbody').innerHTML = lowStockList.slice(0, 15).map(d => `
        <tr><td>${d.drug_code}</td><td><strong>${d.trade_name}</strong></td><td><span class="badge badge-out">${d.totalQty} ${d.stock_unit}</span></td><td>${d.reorder_point}</td></tr>
    `).join('') || `<tr><td colspan="4">لا توجد نواقص حالياً</td></tr>`;

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + 90);
    const expiringList = positiveBalances.filter(b => b.expiry_date && new Date(b.expiry_date) <= limitDate);
    document.getElementById('kpi-expiring').textContent = expiringList.length;
    document.getElementById('expiring-tbody').innerHTML = expiringList.map(b => `
        <tr><td>${b.location_name_ar}</td><td><strong>${b.trade_name}</strong></td><td>${b.batch_number}</td><td><span class="badge badge-warn">${b.expiry_date}</span></td><td>${b.quantity_on_hand}</td></tr>
    `).join('') || `<tr><td colspan="5">لا توجد أصناف قريبة انتهاء الصلاحية</td></tr>`;
}

// الأرصدة
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
            <td><strong>${b.location_name_ar}</strong></td>
            <td>${b.drug_code}</td>
            <td>${b.trade_name}</td>
            <td>${b.generic_name || '-'}</td>
            <td>${b.strength || '-'}</td>
            <td>${b.batch_number}</td>
            <td>${b.expiry_date || '-'}</td>
            <td><span class="badge badge-in">${b.quantity_on_hand}</span></td>
            <td>${b.stock_unit}</td>
        </tr>
    `).join('') || `<tr><td colspan="9">لا توجد أرصدة مطابقة</td></tr>`;
}
document.getElementById('filter-balance-location').addEventListener('change', renderBalances);
document.getElementById('search-balance-drug').addEventListener('input', renderBalances);

// دليل الأدوية
function renderDrugs() {
    const search = document.getElementById('search-drugs-list').value.toLowerCase();
    const filtered = state.drugs.filter(d => `${d.drug_code} ${d.trade_name} ${d.generic_name}`.toLowerCase().includes(search));
    document.getElementById('drugs-tbody').innerHTML = filtered.map(d => `
        <tr>
            <td>${d.drug_code}</td><td><strong>${d.trade_name}</strong></td><td>${d.generic_name || '-'}</td>
            <td>${d.strength || '-'}</td><td>${d.dosage_form || '-'}</td><td>${d.stock_unit}</td>
            <td>${d.reorder_point}</td><td>${d.is_controlled ? '<span class="badge badge-out">جدول / مراقب</span>' : 'عادي'}</td>
        </tr>
    `).join('') || `<tr><td colspan="8">لا توجد أصناف مسجلة</td></tr>`;
}
document.getElementById('search-drugs-list').addEventListener('input', renderDrugs);

// سجل الحركات
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
                <td>${new Date(r.transaction_date).toLocaleString('ar-EG')}</td>
                <td>${locMap[r.location_id] || '-'}</td>
                <td><strong>${drugMap[r.drug_id] || '-'}</strong></td>
                <td>${batchMap[r.batch_id] || '-'}</td>
                <td>${r.movement_type}</td>
                <td><span class="badge ${qty > 0 ? 'badge-in' : 'badge-out'}">${qty > 0 ? '+' + qty : qty}</span></td>
                <td>${r.reference_no || '-'}</td>
                <td>${r.notes || '-'}</td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="8">لا توجد حركات مسجلة</td></tr>`;
}
document.getElementById('filter-ledger-location').addEventListener('change', renderLedger);
document.getElementById('filter-ledger-drug').addEventListener('change', renderLedger);

// إدارة المستخدمين (للإدارة فقط)
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