const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

const app = express()

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Health check — keeps Render awake
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// ── PROFILES ──────────────────────────────────────────
app.post('/api/profiles', async (req, res) => {
  const { id, name, email, avatar_url } = req.body
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id, name, email, avatar_url })
    .select().single()
  if (error) return res.status(400).json({ error })
  res.json(data)
})

app.get('/api/profiles/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', req.params.id).single()
  if (error) return res.status(400).json({ error })
  res.json(data)
})

// ── GROUPS ────────────────────────────────────────────
app.post('/api/groups', async (req, res) => {
  const { name, created_by } = req.body
  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, created_by })
    .select().single()
  if (error) return res.status(400).json({ error })
  // auto-add creator as member
  await supabase.from('group_members').insert({ group_id: group.id, user_id: created_by })
  res.json(group)
})

app.get('/api/groups/user/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, groups(*)')
    .eq('user_id', req.params.userId)
  if (error) return res.status(400).json({ error })
  res.json(data.map(d => d.groups))
})

app.post('/api/groups/join', async (req, res) => {
  const { invite_code, user_id } = req.body
  const { data: group, error: ge } = await supabase
    .from('groups').select('id').eq('invite_code', invite_code).single()
  if (ge || !group) return res.status(404).json({ error: 'Invalid invite code' })
  const { error } = await supabase
    .from('group_members').insert({ group_id: group.id, user_id })
  if (error) return res.status(400).json({ error })
  res.json({ group_id: group.id })
})

// ── MEMBERS ───────────────────────────────────────────
app.get('/api/groups/:groupId/members', async (req, res) => {
  const { data, error } = await supabase
    .from('group_members')
    .select('*, profiles(id, name, email, avatar_url)')
    .eq('group_id', req.params.groupId)
  if (error) return res.status(400).json({ error })
  res.json(data)
})

// ── EXPENSES ──────────────────────────────────────────
app.get('/api/expenses/:groupId', async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, expense_splits(*), profiles(id, name, email)')
    .eq('group_id', req.params.groupId)
    .order('date', { ascending: false })
  if (error) return res.status(400).json({ error })
  res.json(data)
})

app.post('/api/expenses', async (req, res) => {
  const { group_id, description, amount, category, paid_by, date, splits } = req.body
  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({ group_id, description, amount, category, paid_by, date })
    .select().single()
  if (error) return res.status(400).json({ error })
  if (splits && splits.length > 0) {
    const rows = splits.map(s => ({
      expense_id: expense.id,
      user_id: s.user_id,
      share: s.share
    }))
    await supabase.from('expense_splits').insert(rows)
  }
  res.json(expense)
})

app.delete('/api/expenses/:id', async (req, res) => {
  const { error } = await supabase
    .from('expenses').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error })
  res.json({ success: true })
})

// ── SETTLEMENTS (computed) ────────────────────────────
app.get('/api/settlements/:groupId', async (req, res) => {
  const { data: splits } = await supabase
    .from('expense_splits')
    .select('user_id, share, expenses(paid_by, group_id)')
    .eq('expenses.group_id', req.params.groupId)

  const balances = {}
  ;(splits || []).forEach(s => {
    if (!s.expenses) return
    const payer = s.expenses.paid_by
    const debtor = s.user_id
    if (payer === debtor) return
    balances[payer] = (balances[payer] || 0) + Number(s.share)
    balances[debtor] = (balances[debtor] || 0) - Number(s.share)
  })

  const debtors = [], creditors = []
  Object.entries(balances).forEach(([id, bal]) => {
    if (bal < -0.01) debtors.push({ id, amt: -bal })
    else if (bal > 0.01) creditors.push({ id, amt: bal })
  })
  debtors.sort((a, b) => b.amt - a.amt)
  creditors.sort((a, b) => b.amt - a.amt)

  const txns = []
  let di = 0, ci = 0
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di], c = creditors[ci]
    const amt = Math.min(d.amt, c.amt)
    txns.push({ from: d.id, to: c.id, amount: Math.round(amt * 100) / 100 })
    d.amt -= amt; c.amt -= amt
    if (d.amt < 0.01) di++
    if (c.amt < 0.01) ci++
  }
  res.json(txns)
})

app.listen(process.env.PORT || 3001, () =>
  console.log('✅ SplitMate API running on port', process.env.PORT || 3001)
)
