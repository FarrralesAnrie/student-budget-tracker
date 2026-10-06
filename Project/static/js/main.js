/* ==========================================================================
   STUDENT BUDGET & ALLOWANCE TRACKER - FRONTEND INTERACTIVE CONTROLLER
   ========================================================================== */

// STATE STORE
let appState = {
    student: null,
    activeBudget: null,
    allBudgets: []
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupDefaultExpenseDate();
    initTheme();
});

function initTheme() {
    const savedTheme = localStorage.getItem('pocketpal_theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
        document.getElementById('themeToggleBtn').innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
}

function toggleTheme() {
    const isDark = document.body.classList.contains('theme-dark');
    const toggleBtn = document.getElementById('themeToggleBtn');
    
    if (isDark) {
        document.body.classList.remove('theme-dark');
        document.body.classList.add('theme-light');
        toggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        localStorage.setItem('pocketpal_theme', 'light');
    } else {
        document.body.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
        toggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        localStorage.setItem('pocketpal_theme', 'dark');
    }
}

function setupDefaultExpenseDate() {
    const dateInput = document.getElementById('expenseDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
}

// APP ENTRY & DATA FETCHING
async function initApp() {
    const savedStudentName = localStorage.getItem('pocketpal_student_name');
    if (savedStudentName) {
        await loginStudent(savedStudentName);
    } else {
        showWelcomeSection();
    }
}

async function loginStudent(name) {
    try {
        const response = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            showError('welcomeError', data.error || 'Failed to initialize student profile.');
            return;
        }

        appState.student = data.student;
        localStorage.setItem('pocketpal_student_name', data.student.name);

        updateHeaderProfile(data.student.name);
        
        if (data.active_budget) {
            appState.activeBudget = data.active_budget;
            renderDashboard(data.active_budget);
        } else {
            // Student exists but has no active budget yet, open setup modal
            openBudgetSetupModal();
        }

        await fetchAllBudgets();
    } catch (err) {
        console.error('Initialization error:', err);
    }
}

async function handleStudentWelcome(e) {
    e.preventDefault();
    const nameInput = document.getElementById('welcomeStudentName');
    const name = nameInput.value.trim();
    
    if (!name) {
        showError('welcomeError', 'Please enter your student name.');
        return;
    }

    await loginStudent(name);
}

function updateHeaderProfile(name) {
    document.getElementById('currentStudentNameDisplay').textContent = name;
    document.getElementById('studentProfileBadge').classList.remove('hidden');
    document.getElementById('btnSwitchBudget').classList.remove('hidden');
    document.getElementById('btnNewBudget').classList.remove('hidden');
}

function showWelcomeSection() {
    document.getElementById('studentWelcomeSection').classList.remove('hidden');
    document.getElementById('dashboardSection').classList.add('hidden');
}

// SLIDER & LIVE CALCULATOR PREVIEW
function updateSliderDisplay(val) {
    document.getElementById('sliderValueBadge').textContent = `${val} days`;
    triggerLiveCalculation();
}

function setSliderPreset(days) {
    const slider = document.getElementById('setupDaysSlider');
    slider.value = days;
    updateSliderDisplay(days);
}

function triggerLiveCalculation() {
    const numDays = parseInt(document.getElementById('setupDaysSlider').value) || 7;
    const totalAllowance = parseFloat(document.getElementById('setupTotalAllowance').value) || 0;
    const desiredSavings = parseFloat(document.getElementById('setupDesiredSavings').value) || 0;

    const breakdownEl = document.getElementById('calcBreakdownText');
    const resultEl = document.getElementById('calcResultDisplay');
    const setupErrorEl = document.getElementById('setupFormError');

    setupErrorEl.classList.add('hidden');

    if (desiredSavings > totalAllowance && totalAllowance > 0) {
        showError('setupFormError', 'Desired savings cannot be greater than total allowance.');
        resultEl.textContent = 'Invalid Savings Amount';
        return;
    }

    const spendable = totalAllowance - desiredSavings;
    const dailySpending = numDays > 0 ? (spendable / numDays) : 0;

    breakdownEl.innerHTML = `(${formatMoney(totalAllowance)} − ${formatMoney(desiredSavings)}) ÷ ${numDays} days = <strong>${formatMoney(dailySpending)} / day</strong>`;
    resultEl.textContent = `Recommended Daily Spending: ${formatMoney(dailySpending)} / day`;
}

// BUDGET CREATION
async function handleCreateBudget(e) {
    e.preventDefault();

    if (!appState.student) {
        showError('setupFormError', 'Please enter your student name first.');
        return;
    }

    const studentNameInput = document.getElementById('setupStudentName').value.trim();
    const titleInput = document.getElementById('setupBudgetTitle').value.trim();
    const numDays = parseInt(document.getElementById('setupDaysSlider').value);
    const totalAllowance = parseFloat(document.getElementById('setupTotalAllowance').value);
    const desiredSavings = parseFloat(document.getElementById('setupDesiredSavings').value);

    // Validation
    if (!studentNameInput) {
        showError('setupFormError', 'Student name cannot be empty.');
        return;
    }
    if (isNaN(numDays) || numDays < 1 || numDays > 31) {
        showError('setupFormError', 'Budget period must be between 1 and 31 days.');
        return;
    }
    if (isNaN(totalAllowance) || totalAllowance <= 0) {
        showError('setupFormError', 'Total allowance must be greater than ₱0.00.');
        return;
    }
    if (isNaN(desiredSavings) || desiredSavings < 0) {
        showError('setupFormError', 'Desired savings cannot be negative.');
        return;
    }
    if (desiredSavings > totalAllowance) {
        showError('setupFormError', 'Desired savings cannot be greater than total allowance.');
        return;
    }

    try {
        // Update student name if changed
        if (studentNameInput !== appState.student.name) {
            await loginStudent(studentNameInput);
        }

        const payload = {
            student_id: appState.student.id,
            num_days: numDays,
            total_allowance: totalAllowance,
            desired_savings: desiredSavings,
            title: titleInput || `${numDays}-Day Budget`
        };

        const response = await fetch('/api/budgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            showError('setupFormError', data.error || 'Failed to create budget.');
            return;
        }

        appState.activeBudget = data.budget;
        closeBudgetSetupModal();
        renderDashboard(data.budget);
        await fetchAllBudgets();

    } catch (err) {
        console.error('Error creating budget:', err);
        showError('setupFormError', 'An unexpected network error occurred.');
    }
}

// DASHBOARD RENDERING
function renderDashboard(budget) {
    document.getElementById('studentWelcomeSection').classList.add('hidden');
    document.getElementById('dashboardSection').classList.remove('hidden');

    document.getElementById('dashStudentName').textContent = appState.student ? appState.student.name : 'Student';
    document.getElementById('dashBudgetTitle').textContent = budget.title || `${budget.num_days}-Day Budget`;
    document.getElementById('dashRecommendedDaily').textContent = `${formatMoney(budget.recommended_daily)}/day`;

    document.getElementById('dashTotalAllowance').textContent = formatMoney(budget.total_allowance);
    document.getElementById('dashDesiredSavings').textContent = formatMoney(budget.desired_savings);
    document.getElementById('dashTotalExpenses').textContent = formatMoney(budget.total_expenses);
    
    // Remaining Budget (Total Allowance - Total Expenses)
    document.getElementById('dashRemainingBudget').textContent = formatMoney(budget.remaining_budget);
    
    // Spendable Subtext ((Allowance - Savings) - Expenses)
    const spendableVal = budget.remaining_spendable;
    document.getElementById('dashSpendableSub').textContent = `Spendable left: ${formatMoney(spendableVal)}`;

    document.getElementById('dashExpenseCount').textContent = `${budget.expenses.length} expense(s) recorded`;

    // Render Warnings
    renderWarnings(budget.warnings);

    // Render Savings Progress Health
    renderSavingsHealth(budget);

    // Render Expenses Table
    renderExpensesTable(budget.expenses, budget.total_expenses);
}

function renderWarnings(warnings) {
    const container = document.getElementById('warningContainer');
    container.innerHTML = '';

    if (!warnings || warnings.length === 0) {
        return;
    }

    warnings.forEach(w => {
        const alertDiv = document.createElement('div');
        const alertClass = w.level === 'danger' ? 'alert-danger' : 'alert-warning';
        alertDiv.className = `alert ${alertClass}`;
        alertDiv.innerHTML = `<div>${w.message}</div>`;
        container.appendChild(alertDiv);
    });
}

function renderSavingsHealth(budget) {
    const progressBar = document.getElementById('savingsProgressBar');
    const badge = document.getElementById('savingsStatusBadge');
    
    document.getElementById('progressTargetSavings').textContent = formatMoney(budget.desired_savings);
    document.getElementById('progressRemainingDays').textContent = `Period: ${budget.num_days} days (${budget.days_remaining} remaining)`;

    const totalAllowance = budget.total_allowance;
    const totalExpenses = budget.total_expenses;
    const desiredSavings = budget.desired_savings;
    const spendablePool = budget.spendable_pool; // Allowance - Savings

    if (totalExpenses <= spendablePool) {
        // Savings 100% Intact
        progressBar.style.width = '100%';
        progressBar.className = 'progress-bar-fill progress-emerald';
        badge.className = 'progress-status-badge';
        badge.innerHTML = '<i class="fa-solid fa-shield-check"></i> Savings Safe (100%)';
    } else if (totalExpenses < totalAllowance) {
        // Eating into savings
        const savingsRemaining = totalAllowance - totalExpenses;
        const percent = Math.max(Math.round((savingsRemaining / desiredSavings) * 100), 0);
        progressBar.style.width = `${percent}%`;
        progressBar.className = 'progress-bar-fill progress-amber';
        badge.className = 'progress-status-badge style-amber';
        badge.style.backgroundColor = 'var(--amber-100)';
        badge.style.color = 'var(--amber-700)';
        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Savings Compromised (${percent}%)`;
    } else {
        // Savings completely depleted
        progressBar.style.width = '0%';
        progressBar.className = 'progress-bar-fill progress-rose';
        badge.className = 'progress-status-badge style-rose';
        badge.style.backgroundColor = 'var(--rose-100)';
        badge.style.color = 'var(--rose-700)';
        badge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Budget & Savings Depleted';
    }
}

function renderExpensesTable(expenses, totalExpenses) {
    const tbody = document.getElementById('expensesTableBody');
    const tableBadge = document.getElementById('expenseListBadge');
    const totalFooter = document.getElementById('tableTotalExpenses');

    tableBadge.textContent = `${expenses.length} Item(s)`;
    totalFooter.textContent = formatMoney(totalExpenses);

    if (!expenses || expenses.length === 0) {
        tbody.innerHTML = `
            <tr id="noExpensesRow">
                <td colspan="4" class="empty-state">
                    <i class="fa-solid fa-receipt empty-icon"></i>
                    <p>No expenses recorded for this budget period yet.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = expenses.map(item => `
        <tr>
            <td>${formatDate(item.expense_date)}</td>
            <td><strong>${escapeHtml(item.description)}</strong></td>
            <td class="text-right text-amber"><strong>${formatMoney(item.amount)}</strong></td>
            <td class="text-center">
                <button class="btn-danger-icon" onclick="handleDeleteExpense(${item.id})" title="Delete Expense">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// ADD EXPENSE ACTION
async function handleAddExpense(e) {
    e.preventDefault();

    if (!appState.activeBudget) {
        showError('addExpenseError', 'No active budget period found. Please create one first.');
        return;
    }

    const descInput = document.getElementById('expenseDescription');
    const amountInput = document.getElementById('expenseAmount');
    const dateInput = document.getElementById('expenseDate');
    const errorEl = document.getElementById('addExpenseError');

    errorEl.classList.add('hidden');

    const description = descInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const expenseDate = dateInput.value;

    if (!description) {
        showError('addExpenseError', 'Expense description cannot be empty.');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        showError('addExpenseError', 'Expense amount must be greater than ₱0.00.');
        return;
    }
    if (!expenseDate) {
        showError('addExpenseError', 'Please select a valid date.');
        return;
    }

    try {
        const response = await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                budget_id: appState.activeBudget.id,
                description,
                amount,
                expense_date: expenseDate
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showError('addExpenseError', data.error || 'Failed to record expense.');
            return;
        }

        // Reset inputs
        descInput.value = '';
        amountInput.value = '';
        setupDefaultExpenseDate();

        // Update Dashboard State
        appState.activeBudget = data.budget;
        renderDashboard(data.budget);

    } catch (err) {
        console.error('Error adding expense:', err);
        showError('addExpenseError', 'Network error while adding expense.');
    }
}

// DELETE EXPENSE ACTION
async function handleDeleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this expense entry?')) {
        return;
    }

    try {
        const budgetId = appState.activeBudget ? appState.activeBudget.id : null;
        const response = await fetch(`/api/expenses/${expenseId}?budget_id=${budgetId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.budget) {
            appState.activeBudget = data.budget;
            renderDashboard(data.budget);
        }
    } catch (err) {
        console.error('Error deleting expense:', err);
    }
}

// BUDGET HISTORY & SWITCHING
async function fetchAllBudgets() {
    if (!appState.student) return;

    try {
        const response = await fetch(`/api/budgets?student_id=${appState.student.id}`);
        const data = await response.json();
        
        if (response.ok) {
            appState.allBudgets = data.budgets || [];
        }
    } catch (err) {
        console.error('Error fetching budget history:', err);
    }
}

async function openBudgetHistoryModal() {
    await fetchAllBudgets();
    renderBudgetHistoryGrid();
    document.getElementById('budgetHistoryModal').classList.remove('hidden');
}

function closeBudgetHistoryModal() {
    document.getElementById('budgetHistoryModal').classList.add('hidden');
}

function renderBudgetHistoryGrid() {
    const grid = document.getElementById('budgetHistoryList');
    
    if (!appState.allBudgets || appState.allBudgets.length === 0) {
        grid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No previous budget periods recorded.</p>';
        return;
    }

    grid.innerHTML = appState.allBudgets.map(b => {
        const isActive = appState.activeBudget && appState.activeBudget.id === b.id;
        const activeClass = isActive ? 'active-budget-card' : '';
        const activeBadge = isActive ? '<span class="badge badge-primary">ACTIVE</span>' : '';

        return `
            <div class="budget-history-card ${activeClass}">
                <div class="history-card-header">
                    <div>
                        <div class="history-title">${escapeHtml(b.title)}</div>
                        <div class="history-meta">${b.num_days} Days • Created ${formatDate(b.start_date)}</div>
                    </div>
                    ${activeBadge}
                </div>

                <div class="history-stats">
                    <div class="history-stat-row">
                        <span>Total Allowance:</span>
                        <strong>${formatMoney(b.total_allowance)}</strong>
                    </div>
                    <div class="history-stat-row">
                        <span>Desired Savings:</span>
                        <strong>${formatMoney(b.desired_savings)}</strong>
                    </div>
                    <div class="history-stat-row">
                        <span>Daily Budget:</span>
                        <strong class="text-emerald">${formatMoney(b.recommended_daily)}/day</strong>
                    </div>
                    <div class="history-stat-row">
                        <span>Total Expenses:</span>
                        <strong class="text-amber">${formatMoney(b.total_expenses)}</strong>
                    </div>
                    <div class="history-stat-row">
                        <span>Remaining Budget:</span>
                        <strong>${formatMoney(b.remaining_budget)}</strong>
                    </div>
                </div>

                <div class="flex-between">
                    ${!isActive ? `
                        <button class="btn btn-secondary btn-sm" onclick="switchActiveBudget(${b.id})">
                            <i class="fa-solid fa-check"></i> Select / View
                        </button>
                    ` : `
                        <button class="btn btn-outline btn-sm" disabled>
                            Currently Active
                        </button>
                    `}
                    <button class="btn-danger-icon" onclick="handleDeleteBudget(${b.id})" title="Delete Period">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function switchActiveBudget(budgetId) {
    if (!appState.student) return;

    try {
        const response = await fetch(`/api/budgets/${budgetId}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: appState.student.id })
        });

        const data = await response.json();
        if (response.ok && data.budget) {
            appState.activeBudget = data.budget;
            closeBudgetHistoryModal();
            renderDashboard(data.budget);
            await fetchAllBudgets();
        }
    } catch (err) {
        console.error('Error switching budget:', err);
    }
}

async function handleDeleteBudget(budgetId) {
    if (!confirm('Are you sure you want to delete this budget period and all its expenses?')) {
        return;
    }

    try {
        const response = await fetch(`/api/budgets/${budgetId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await fetchAllBudgets();
            if (appState.activeBudget && appState.activeBudget.id === budgetId) {
                if (appState.allBudgets.length > 0) {
                    await switchActiveBudget(appState.allBudgets[0].id);
                } else {
                    appState.activeBudget = null;
                    closeBudgetHistoryModal();
                    openBudgetSetupModal();
                }
            } else {
                renderBudgetHistoryGrid();
            }
        }
    } catch (err) {
        console.error('Error deleting budget period:', err);
    }
}

// MODAL CONTROLLERS
function openBudgetSetupModal() {
    if (appState.student) {
        document.getElementById('setupStudentName').value = appState.student.name;
    }
    
    // Set default slider to 7
    document.getElementById('setupDaysSlider').value = 7;
    updateSliderDisplay(7);
    
    document.getElementById('setupFormError').classList.add('hidden');
    document.getElementById('budgetSetupModal').classList.remove('hidden');
}

function closeBudgetSetupModal() {
    document.getElementById('budgetSetupModal').classList.add('hidden');
}

// HELPER UTILITIES
function formatMoney(amount) {
    const val = parseFloat(amount) || 0;
    return '₱' + val.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch (e) {
        return dateStr;
    }
}

function showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.classList.remove('hidden');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}
