import sqlite3
import os
from datetime import datetime, date

DB_PATH = os.environ.get('SQLITE_DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'student_budget.db'))

def get_db():
    """Establish and return a database connection with row factory configured."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """Initialize SQLite database tables for Students, Budgets, and Expenses."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Table 1: Students
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Table 2: Budgets
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                title TEXT DEFAULT 'Budget Period',
                num_days INTEGER NOT NULL,
                total_allowance REAL NOT NULL,
                desired_savings REAL NOT NULL,
                recommended_daily REAL NOT NULL,
                start_date TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            )
        ''')
        
        # Table 3: Expenses
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                expense_date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
            )
        ''')
        
        conn.commit()

def get_or_create_student(name):
    """Retrieve existing student by name or create a new student record."""
    name = name.strip()
    if not name:
        raise ValueError("Student name cannot be empty.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM students WHERE LOWER(name) = LOWER(?) ORDER BY id DESC LIMIT 1", (name,))
        student = cursor.fetchone()
        
        if student:
            return dict(student)
            
        cursor.execute("INSERT INTO students (name) VALUES (?)", (name,))
        conn.commit()
        student_id = cursor.lastrowid
        
        cursor.execute("SELECT * FROM students WHERE id = ?", (student_id,))
        return dict(cursor.fetchone())

def create_budget(student_id, num_days, total_allowance, desired_savings, start_date=None, title=None):
    """
    Create a new budget period for a student.
    Formula: Recommended Daily Spending = (Total Allowance - Desired Savings) / Number of Days
    """
    # Validations
    if num_days < 1 or num_days > 31:
        raise ValueError("Budget period must be between 1 and 31 days.")
    if total_allowance <= 0:
        raise ValueError("Total allowance must be greater than ₱0.00.")
    if desired_savings < 0:
        raise ValueError("Desired savings cannot be negative.")
    if desired_savings > total_allowance:
        raise ValueError("Desired savings cannot exceed total allowance.")
        
    recommended_daily = round((total_allowance - desired_savings) / num_days, 2)
    
    if not start_date:
        start_date = date.today().isoformat()
        
    if not title:
        title = f"{num_days}-Day Budget"

    with get_db() as conn:
        cursor = conn.cursor()
        
        # Deactivate previous active budgets for this student
        cursor.execute("UPDATE budgets SET is_active = 0 WHERE student_id = ?", (student_id,))
        
        # Insert new budget
        cursor.execute('''
            INSERT INTO budgets 
            (student_id, title, num_days, total_allowance, desired_savings, recommended_daily, start_date, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ''', (student_id, title, num_days, total_allowance, desired_savings, recommended_daily, start_date))
        
        budget_id = cursor.lastrowid
        conn.commit()
        return get_budget_by_id(budget_id)

def get_budget_by_id(budget_id):
    """Fetch budget details along with calculated summary metrics and warnings."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM budgets WHERE id = ?", (budget_id,))
        budget_row = cursor.fetchone()
        
        if not budget_row:
            return None
            
        budget = dict(budget_row)
        
        # Fetch expenses for this budget
        cursor.execute("SELECT * FROM expenses WHERE budget_id = ? ORDER BY expense_date DESC, id DESC", (budget_id,))
        expenses = [dict(r) for r in cursor.fetchall()]
        
        # Calculation: Total Expenses & Remaining Budget
        total_expenses = round(sum(e['amount'] for e in expenses), 2)
        
        # Remaining budget is Total Allowance - Total Expenses (or available spending pool before savings)
        # Spending Pool = Total Allowance - Desired Savings
        spendable_pool = budget['total_allowance'] - budget['desired_savings']
        remaining_spendable = round(spendable_pool - total_expenses, 2)
        remaining_total_budget = round(budget['total_allowance'] - total_expenses, 2)
        
        # Calculate days elapsed since start_date
        try:
            start_d = datetime.strptime(budget['start_date'], '%Y-%m-%d').date()
            today = date.today()
            days_elapsed = (today - start_d).days + 1
            if days_elapsed < 1:
                days_elapsed = 1
        except Exception:
            days_elapsed = 1
            
        days_remaining = max(budget['num_days'] - days_elapsed + 1, 1)
        
        # Today's total spending
        today_str = date.today().isoformat()
        today_expenses = round(sum(e['amount'] for e in expenses if e['expense_date'] == today_str), 2)
        
        # Average daily spending so far
        avg_daily_spending = round(total_expenses / days_elapsed, 2) if days_elapsed > 0 else total_expenses
        
        # Warnings calculation
        warnings = []
        
        # Warning 1: Daily spending exceeds recommended daily budget
        if today_expenses > budget['recommended_daily']:
            warnings.append({
                "type": "daily_exceeded",
                "level": "warning",
                "message": f"⚠️ Today's spending (₱{today_expenses:,.2f}) has exceeded your recommended daily budget of ₱{budget['recommended_daily']:,.2f}/day!"
            })
        elif avg_daily_spending > budget['recommended_daily'] and total_expenses > 0:
            warnings.append({
                "type": "avg_exceeded",
                "level": "warning",
                "message": f"⚠️ Your average daily spending (₱{avg_daily_spending:,.2f}/day) is higher than your recommended ₱{budget['recommended_daily']:,.2f}/day."
            })
            
        # Warning 2: Remaining spendable budget insufficient for remaining days
        if remaining_spendable < 0 and remaining_total_budget > 0:
            savings_affected = abs(remaining_spendable)
            warnings.append({
                "type": "savings_eating",
                "level": "danger",
                "message": f"⚠️ You have used up your spendable allowance and are now eating into your Desired Savings by ₱{savings_affected:,.2f}!"
            })
        elif remaining_total_budget <= 0:
            warnings.append({
                "type": "budget_depleted",
                "level": "danger",
                "message": "🚨 You have completely exhausted your total allowance and savings for this budget period!"
            })
        elif days_remaining > 0 and remaining_spendable > 0:
            projected_daily_allowed = round(remaining_spendable / days_remaining, 2)
            if projected_daily_allowed < (budget['recommended_daily'] * 0.5):
                warnings.append({
                    "type": "tight_budget",
                    "level": "warning",
                    "message": f"⚠️ Caution: You only have ₱{projected_daily_allowed:,.2f}/day remaining for the next {days_remaining} days."
                })

        return {
            **budget,
            "total_expenses": total_expenses,
            "remaining_budget": remaining_total_budget, # Total allowance - expenses
            "remaining_spendable": remaining_spendable, # (Allowance - Savings) - expenses
            "spendable_pool": spendable_pool,
            "today_expenses": today_expenses,
            "avg_daily_spending": avg_daily_spending,
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "expenses": expenses,
            "warnings": warnings
        }

def get_active_budget(student_id):
    """Retrieve current active budget for student."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM budgets WHERE student_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1", (student_id,))
        row = cursor.fetchone()
        if row:
            return get_budget_by_id(row['id'])
            
        # If no active budget, return the latest one if any
        cursor.execute("SELECT id FROM budgets WHERE student_id = ? ORDER BY id DESC LIMIT 1", (student_id,))
        row = cursor.fetchone()
        if row:
            return get_budget_by_id(row['id'])
        return None

def set_active_budget(student_id, budget_id):
    """Set a specific budget as the active one."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE budgets SET is_active = 0 WHERE student_id = ?", (student_id,))
        cursor.execute("UPDATE budgets SET is_active = 1 WHERE id = ? AND student_id = ?", (budget_id, student_id))
        conn.commit()
        return get_budget_by_id(budget_id)

def get_all_budgets(student_id):
    """Retrieve all budget periods for a student with summary info."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM budgets WHERE student_id = ? ORDER BY created_at DESC", (student_id,))
        rows = cursor.fetchall()
        return [get_budget_by_id(r['id']) for r in rows if r]

def delete_budget(budget_id):
    """Delete a budget period and all associated expenses."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
        conn.commit()
        return True

def add_expense(budget_id, description, amount, expense_date=None):
    """Record a new expense for a budget period."""
    description = description.strip()
    if not description:
        raise ValueError("Expense description cannot be empty.")
    if amount <= 0:
        raise ValueError("Expense amount must be greater than ₱0.00.")
    if not expense_date:
        expense_date = date.today().isoformat()
        
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify budget exists
        cursor.execute("SELECT id FROM budgets WHERE id = ?", (budget_id,))
        if not cursor.fetchone():
            raise ValueError("Target budget period does not exist.")
            
        cursor.execute('''
            INSERT INTO expenses (budget_id, description, amount, expense_date)
            VALUES (?, ?, ?, ?)
        ''', (budget_id, description, round(amount, 2), expense_date))
        
        expense_id = cursor.lastrowid
        conn.commit()
        
        cursor.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,))
        return dict(cursor.fetchone())

def delete_expense(expense_id):
    """Delete an expense by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
        conn.commit()
        return True
