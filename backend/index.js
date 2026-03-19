const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

const app = express()

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origin.endsWith('.vercel.app') || origin.includes('localhost') || origin === process.env.FRONTEND_URL) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}))
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── HEALTH ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// ── PROFILES ──────────────────────────────────────────────────────
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

app.delete('/api/profiles/:id', async (req, res) => {
  // remove from all groups first
  await supabase.from('group_members').delete().eq('user_id', req.params.id)
  // delete profile
  const { error } = await supabase.from('profiles').delete().eq('id', req.params.id)
  if (error) return res.status(400).json({ error })
  res.json({ success: true })
})

// ── GROUPS ────────────────────────────────────────────────────────
app.post('/api/groups', async (req, res) => {
  const { name, created_by } = req.body
  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, created_by })
    .select().single()
  if (error) return res.status(400).json({ error })
  await supabase.from('group_members').insert({ group_id: group.id, user_id: created_by })
  res.json(group)
})

app.get('/api/groups/user/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, groups(*)')
    .eq('user_id', req.params.userId)
  if (error) return res.status(400).json({ error })
  res.json(data.map(d => d.groups).filter(Boolean))
})

app.post('/api/groups/join', async (req, res) => {
  const { invite_code, user_id } = req.body
  const { data: group, error: ge } = await supabase
    .from('groups').select('id').eq('invite_code', invite_code).single()
  if (ge || !group) return res.status(404).json({ error: 'Invalid invite code' })
  // check already member
  const { data: existing } = await supabase
    .from('group_members').select('id').eq('group_id', group.id).eq('user_id', user_id).single()
  if (existing) return res.status(400).json({ error: 'Already a member of this group' })
  const { error } = await supabase
    .from('group_members').insert({ group_id: group.id, user_id })
  if (error) return res.status(400).json({ error })
  res.json({ group_id: group.id })
})

// Rename group
app.patch('/api/groups/:groupId/rename', async (req, res) => {
  const { name } = req.body
  const { data, error } = await supabase
    .from('groups').update({ name }).eq('id', req.params.groupId).select().single()
  if (error) return res.status(400).json({ error })
  res.json(data)
})

// Leave group
app.post('/api/groups/:groupId/leave', async (req, res) => {
  const { user_id } = req.body
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', req.params.groupId)
    .eq('user_id', user_id)
  if (error) return res.status(400).json({ error })
  res.json({ success: true })
})

// Delete group (admin only)
app.delete('/api/groups/:groupId', async (req, res) => {
  // cascade deletes expenses, splits, members via FK
  const { error } = await supabase
    .from('groups').delete().eq('id', req.params.groupId)
  if (error) return res.status(400).json({ error })
  res.json({ success: true })
})

// Clear all expenses in a group
app.delete('/api/groups/:groupId/clear-expenses', async (req, res) => {
  const { error } = await supabase
    .from('expenses').delete().eq('group_id', req.params.groupId)
  if (error) return res.status(400).json({ error })
  res.json({ success: true })
})

// ── MEMBERS ───────────────────────────────────────────────────────
app.get('/api/groups/:groupId/members', async (req, res) => {
  const { data, error } = await supabase
    .from('group_members')
    .select('*, profiles(id, name, email, avatar_url)')
    .eq('group_id', req.params.groupId)
  if (error) return res.status(400).json({ error })
  res.json(data)
})

// ── EXPENSES ──────────────────────────────────────────────────────
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

// ── SETTLEMENTS ───────────────────────────────────────────────────
app.get('/api/settlements/:groupId', async (req, res) => {
  const { data: exps } = await supabase
    .from('expenses')
    .select('id, paid_by, amount, expense_splits(user_id, share)')
    .eq('group_id', req.params.groupId)

  const balances = {}
  ;(exps || []).forEach(e => {
    ;(e.expense_splits || []).forEach(sp => {
      if (sp.user_id === e.paid_by) return
      balances[e.paid_by] = (balances[e.paid_by] || 0) + Number(sp.share)
      balances[sp.user_id] = (balances[sp.user_id] || 0) - Number(sp.share)
    })
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
