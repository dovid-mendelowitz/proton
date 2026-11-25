const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

function currentDate() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function monthKey(date) { return String(date || '').slice(0, 7) }
function nextMonth(value) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month, 1)
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
}
function monthLabel(value) {
  const [year, month] = value.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}

function IndirectSavingsPanel() {
  const [rows, setRows] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ saving_date: currentDate(), description: '', amount: '', frequency: 'once', end_date: '', notes: '' })
  const [error, setError] = useState('')

  function load() {
    setRows(db.prepare('SELECT * FROM Indirect_Savings ORDER BY saving_date DESC, id DESC').all())
  }
  useEffect(() => { load() }, [])

  function save() {
    const amount = Number(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('יש להזין תיאור וסכום חיובי')
      return
    }
    if (form.frequency === 'monthly' && form.end_date && form.end_date < form.saving_date) {
      setError('תאריך הסיום לא יכול להיות לפני תאריך ההתחלה')
      return
    }
    db.prepare('INSERT INTO Indirect_Savings (saving_date, description, amount, notes, frequency, end_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(form.saving_date || currentDate(), form.description.trim(), amount, form.notes.trim() || null, form.frequency, form.frequency === 'monthly' && form.end_date ? form.end_date : null)
    setForm({ saving_date: currentDate(), description: '', amount: '', frequency: 'once', end_date: '', notes: '' })
    setShowForm(false)
    setError('')
    load()
  }

  const monthly = useMemo(() => {
    const totals = {}
    const currentMonth = monthKey(currentDate())
    for (const row of rows) {
      const startMonth = monthKey(row.saving_date)
      if (!startMonth) continue
      if (row.frequency === 'monthly') {
        const finalMonth = row.end_date ? monthKey(row.end_date) : currentMonth
        if (startMonth > currentMonth) continue
        let month = startMonth
        while (month <= finalMonth && month <= currentMonth) {
          totals[month] = (totals[month] || 0) + Number(row.amount || 0)
          month = nextMonth(month)
        }
      } else if (startMonth <= currentMonth) {
        totals[startMonth] = (totals[startMonth] || 0) + Number(row.amount || 0)
      }
    }
    const months = Object.keys(totals).sort()
    let cumulative = 0
    return months.map(month => {
      cumulative += totals[month]
      return { month, amount: totals[month], cumulative }
    }).reverse()
  }, [rows])

  const currentMonth = monthKey(currentDate())
  const currentTotal = monthly.find(item => item.month === currentMonth)?.amount || 0
  const cumulativeTotal = monthly[0]?.cumulative || 0
  const money = n => '₪' + Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })
  const input = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12, minWidth: 0, width: '100%', boxSizing: 'border-box' }

  return React.createElement('section', { style: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginTop: 18 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14 } },
      React.createElement('div', null,
        React.createElement('h2', { style: { margin: 0, fontSize: 16, color: '#0F172A' } }, 'חיסכון עקיף'),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 11, color: '#64748B' } }, 'חיסכון שנוצר מהפחתת הוצאה, בלי ליצור תנועת בנק או לשנות יתרות'),
      ),
      React.createElement('button', { style: { border: 0, borderRadius: 7, padding: '7px 11px', background: '#ECFDF5', color: '#047857', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }, onClick: () => { setError(''); setShowForm(value => !value) } }, showForm ? 'סגור' : '+ הוסף חיסכון'),
    ),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 14 } },
      React.createElement('div', { style: { background: '#F0FDF4', borderRadius: 9, padding: 12 } },
        React.createElement('p', { style: { margin: 0, color: '#64748B', fontSize: 11 } }, 'נחסך החודש'),
        React.createElement('strong', { style: { display: 'block', color: '#047857', fontSize: 19, marginTop: 3 } }, money(currentTotal)),
      ),
      React.createElement('div', { style: { background: '#F8FAFC', borderRadius: 9, padding: 12 } },
        React.createElement('p', { style: { margin: 0, color: '#64748B', fontSize: 11 } }, 'סך החיסכון המצטבר'),
        React.createElement('strong', { style: { display: 'block', color: '#0F172A', fontSize: 19, marginTop: 3 } }, money(cumulativeTotal)),
      ),
    ),
    showForm && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, padding: 12, background: '#F8FAFC', borderRadius: 9, marginBottom: 14 } },
      React.createElement('label', { style: { fontSize: 11, color: '#475569' } }, 'תאריך התחלה',
        React.createElement('input', { style: input, type: 'date', value: form.saving_date, onChange: e => setForm(value => ({ ...value, saving_date: e.target.value })) })),
      React.createElement('label', { style: { fontSize: 11, color: '#475569' } }, 'סוג חיסכון',
        React.createElement('select', { style: input, value: form.frequency, onChange: e => setForm(value => ({ ...value, frequency: e.target.value, end_date: e.target.value === 'once' ? '' : value.end_date })) },
          React.createElement('option', { value: 'once' }, 'חד-פעמי'),
          React.createElement('option', { value: 'monthly' }, 'קבוע – כל חודש'))),
      React.createElement('label', { style: { fontSize: 11, color: '#475569' } }, 'תיאור',
        React.createElement('input', { style: input, placeholder: 'למשל: ביטול מנוי', value: form.description, onChange: e => setForm(value => ({ ...value, description: e.target.value })) })),
      React.createElement('label', { style: { fontSize: 11, color: '#475569' } }, form.frequency === 'monthly' ? 'סכום חודשי (₪)' : 'סכום שנחסך (₪)',
        React.createElement('input', { style: input, type: 'number', min: '0.01', step: '0.01', placeholder: 'סכום', value: form.amount, onChange: e => setForm(value => ({ ...value, amount: e.target.value })) })),
      form.frequency === 'monthly' && React.createElement('label', { style: { fontSize: 11, color: '#475569', gridColumn: '1 / -1' } }, 'תאריך סיום (לא חובה – ריק פירושו חיסכון מתמשך)',
        React.createElement('input', { style: input, type: 'date', min: form.saving_date, value: form.end_date, onChange: e => setForm(value => ({ ...value, end_date: e.target.value })) })),
      React.createElement('label', { style: { fontSize: 11, color: '#475569', gridColumn: '1 / -1' } }, 'הערות (לא חובה)',
        React.createElement('input', { style: input, placeholder: 'הערות', value: form.notes, onChange: e => setForm(value => ({ ...value, notes: e.target.value })) })),
      React.createElement('button', { style: { border: 0, borderRadius: 7, background: '#047857', color: '#fff', cursor: 'pointer', minHeight: 34, gridColumn: '1 / -1' }, onClick: save }, 'שמור חיסכון'),
      error && React.createElement('p', { style: { gridColumn: '1 / -1', color: '#B91C1C', fontSize: 11, margin: 0 } }, error),
    ),
    monthly.length > 0 && React.createElement('div', { style: { marginBottom: 16 } },
      React.createElement('h3', { style: { fontSize: 13, color: '#334155', margin: '0 0 7px' } }, 'פירוט לפי חודש'),
      React.createElement('div', { style: { overflowX: 'auto' } },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          React.createElement('thead', null,
            React.createElement('tr', { style: { color: '#64748B', textAlign: 'right', borderBottom: '1px solid #E2E8F0' } },
              React.createElement('th', { style: { padding: '7px 5px' } }, 'חודש'),
              React.createElement('th', { style: { padding: '7px 5px' } }, 'נחסך בחודש'),
              React.createElement('th', { style: { padding: '7px 5px' } }, 'מצטבר עד החודש'))),
          React.createElement('tbody', null,
            monthly.map(item => React.createElement('tr', { key: item.month, style: { borderBottom: '1px solid #F1F5F9' } },
              React.createElement('td', { style: { padding: '7px 5px', color: '#334155' } }, monthLabel(item.month)),
              React.createElement('td', { style: { padding: '7px 5px', color: '#047857', fontWeight: 600 } }, money(item.amount)),
              React.createElement('td', { style: { padding: '7px 5px', color: '#334155' } }, money(item.cumulative)))))))),
    React.createElement('div', { style: { borderTop: '1px solid #E2E8F0', paddingTop: 10 } },
      React.createElement('h3', { style: { fontSize: 13, color: '#334155', margin: '0 0 7px' } }, 'רשומות חיסכון'),
      rows.length === 0
        ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 12, margin: 0 } }, 'אין עדיין רשומות חיסכון עקיף')
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            rows.map(row => React.createElement('div', { key: row.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', padding: '7px 0', gap: 10 } },
              React.createElement('div', null,
                React.createElement('strong', { style: { fontSize: 12, color: '#334155' } }, row.description),
                React.createElement('p', { style: { fontSize: 10, color: '#94A3B8', margin: '2px 0 0' } },
                  (row.frequency === 'monthly' ? 'חודשי · ' : 'חד-פעמי · ') + row.saving_date + (row.end_date ? ' עד ' + row.end_date : '') + (row.notes ? ' · ' + row.notes : ''))),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                React.createElement('strong', { style: { fontSize: 12, color: '#047857' } }, money(row.amount) + (row.frequency === 'monthly' ? ' / חודש' : '')),
                React.createElement('button', { style: { border: 0, background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 14 }, title: 'מחק רשומה', onClick: () => {
                  if (!confirm('למחוק את רשומת החיסכון העקיף?')) return
                  db.prepare('DELETE FROM Indirect_Savings WHERE id=?').run(row.id)
                  load()
                } }, '×')))),
          ),
    ),
  )
}

module.exports = IndirectSavingsPanel
