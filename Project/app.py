from flask import Flask, render_template, request, jsonify
from database import (
    init_db, get_or_create_student, create_budget, 
    get_budget_by_id, get_active_budget, set_active_budget, 
    get_all_budgets, delete_budget, add_expense, delete_expense
)
import os
from datetime import date

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = 'student_budget_tracker_secret_key'

# Initialize database on start
init_db()

@app.route('/')
def index():
    """Serve the single page web application interface."""
    return render_template('index.html')

@app.route('/api/calculate-preview', methods=['GET'])
def calculate_preview():
    """Live preview endpoint for recommended daily spending calculation."""
    try:
        num_days = int(request.args.get('num_days', 7))
        total_allowance = float(request.args.get('total_allowance', 0))
        desired_savings = float(request.args.get('desired_savings', 0))

        if num_days < 1 or num_days > 31:
            return jsonify({'error': 'Budget period must be between 1 and 31 days.'}), 400
        if total_allowance < 0:
            return jsonify({'error': 'Allowance cannot be negative.'}), 400
        if desired_savings < 0:
            return jsonify({'error': 'Savings cannot be negative.'}), 400
        if desired_savings > total_allowance:
            return jsonify({'error': 'Savings cannot be greater than allowance.'}), 400

        spendable = total_allowance - desired_savings
        recommended_daily = round(spendable / num_days, 2) if num_days > 0 else 0

        return jsonify({
            'num_days': num_days,
            'total_allowance': total_allowance,
            'desired_savings': desired_savings,
            'spendable_allowance': spendable,
            'recommended_daily': recommended_daily
        })
    except ValueError as e:
        return jsonify({'error': 'Invalid numeric inputs.'}), 400

@app.route('/api/students', methods=['POST'])
def handle_student():
    """Set or register student by name."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    
    if not name:
        return jsonify({'error': 'Please enter your name.'}), 400
        
    try:
        student = get_or_create_student(name)
        active_budget = get_active_budget(student['id'])
        return jsonify({
            'student': student,
            'active_budget': active_budget
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/budgets', methods=['GET', 'POST'])
def handle_budgets():
    """Retrieve all budget periods or create a new budget period."""
    if request.method == 'GET':
        student_id = request.args.get('student_id', type=int)
        if not student_id:
            return jsonify({'error': 'Student ID is required.'}), 400
        budgets = get_all_budgets(student_id)
        active_budget = get_active_budget(student_id)
        return jsonify({'budgets': budgets, 'active_budget': active_budget})

    elif request.method == 'POST':
        data = request.get_json() or {}
        student_id = data.get('student_id')
        num_days = data.get('num_days')
        total_allowance = data.get('total_allowance')
        desired_savings = data.get('desired_savings')
        title = data.get('title')
        start_date = data.get('start_date') or date.today().isoformat()

        if not student_id:
            return jsonify({'error': 'Student ID is required.'}), 400
            
        try:
            num_days = int(num_days)
            total_allowance = float(total_allowance)
            desired_savings = float(desired_savings)
            
            new_budget = create_budget(
                student_id=student_id,
                num_days=num_days,
                total_allowance=total_allowance,
                desired_savings=desired_savings,
                start_date=start_date,
                title=title
            )
            return jsonify({'success': True, 'budget': new_budget})
        except (ValueError, TypeError) as e:
            return jsonify({'error': str(e)}), 400

@app.route('/api/budgets/<int:budget_id>', methods=['GET', 'DELETE'])
def handle_single_budget(budget_id):
    """Retrieve or delete a specific budget period."""
    if request.method == 'GET':
        budget = get_budget_by_id(budget_id)
        if not budget:
            return jsonify({'error': 'Budget period not found.'}), 404
        return jsonify({'budget': budget})
        
    elif request.method == 'DELETE':
        success = delete_budget(budget_id)
        return jsonify({'success': success})

@app.route('/api/budgets/<int:budget_id>/activate', methods=['POST'])
def activate_budget(budget_id):
    """Switch active budget to the selected budget ID."""
    data = request.get_json() or {}
    student_id = data.get('student_id')
    if not student_id:
        return jsonify({'error': 'Student ID is required.'}), 400
        
    updated_budget = set_active_budget(student_id, budget_id)
    return jsonify({'success': True, 'budget': updated_budget})

@app.route('/api/expenses', methods=['POST'])
def handle_expenses():
    """Add a new expense record to a budget period."""
    data = request.get_json() or {}
    budget_id = data.get('budget_id')
    description = data.get('description', '').strip()
    amount = data.get('amount')
    expense_date = data.get('expense_date') or date.today().isoformat()

    if not budget_id:
        return jsonify({'error': 'Budget ID is required.'}), 400
    if not description:
        return jsonify({'error': 'Expense description is required.'}), 400

    try:
        amount = float(amount)
        new_expense = add_expense(
            budget_id=budget_id,
            description=description,
            amount=amount,
            expense_date=expense_date
        )
        updated_budget = get_budget_by_id(budget_id)
        return jsonify({'success': True, 'expense': new_expense, 'budget': updated_budget})
    except (ValueError, TypeError) as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/expenses/<int:expense_id>', methods=['DELETE'])
def remove_expense(expense_id):
    """Delete an expense item and return updated budget details."""
    budget_id = request.args.get('budget_id', type=int)
    delete_expense(expense_id)
    
    updated_budget = None
    if budget_id:
        updated_budget = get_budget_by_id(budget_id)
        
    return jsonify({'success': True, 'budget': updated_budget})

if __name__ == '__main__':
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() in ["true", "1"]
    print(f"Starting Student Budget & Allowance Tracker app on http://{host}:{port} ...")
    app.run(host=host, port=port, debug=debug)
