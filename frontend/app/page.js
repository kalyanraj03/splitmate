'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
const API = process.env.NEXT_PUBLIC_API_URL

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [settlements, setSettlements] = useState([])
  const [showAddExp, setShowAddExp] = useState(false)
  const [showJoinCreate, setShowJoinCreate] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [groupName, setGroupName] = useState('')
  const [form, setForm] = useState({ description:'', amount:'', category:'food', date: new Date().toISOString().split('T')[0] })
  const [toast, setToast] = useState('')

  const CATS = [
    { id:'rent', label:'Rent', emoji:'🏠' },
    { id:'food', label:'Food', emoji:'🍜' },
    { id:'groceries', label:'Groceries', emoji:'🛒' },
    { id:'travel', label:'Travel', emoji:'🚗' },
    { id:'utilities', label:'Utilities', emoji:'⚡' },
    { id:'party', label:'Party', emoji:'🎉' },
  ]

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) initUser(session.user)
      else setLoading(false)
    })
    supabase.auth.onAuthStateChange((_e, session) => {
      if (session) initUser(session.user)
      else { setUser(null); setLoading(false) }
    })
  }, [])

  async function initUser(u) {
  setLoading(true)
  try {
    // Wake up Render backend first (it may be sleeping)
    const healthCheck = await Promise.race([
      fetch(`${API}/health`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
    ])

    // Create/update profile
    const profileRes = await fetch(`${API}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: u.id,
        name: u.user_metadata?.full_name || u.email,
        email: u.email,
        avatar_url: u.user_metadata?.avatar_url
      })
    })

    if (!profileRes.ok) {
      console.error('Profile API failed:', await profileRes.text())
    }

    setUser(u)

    const groupRes = await fetch(`${API}/api/groups/user/${u.id}`)
    if (groupRes.ok) {
      const groups = await groupRes.json()
      if (groups && groups.length > 0) {
        loadGroup(groups[0], u.id)
      } else {
        setShowJoinCreate(true)
      }
    } else {
      setShowJoinCreate(true)
    }
  } catch (err) {
    console.error('Init failed:', err)
    // Still show the user even if API fails
    setUser(u)
    setShowJoinCreate(true)
    showToast('Backend is waking up, please wait 30 seconds and refresh ⏳')
  } finally {
    setLoading(false)
  }
}

  async function loadGroup(g, userId) {
    setGroup(g)
    setShowJoinCreate(false)
    const [mRes, eRes, sRes] = await Promise.all([
      fetch(`${API}/api/groups/${g.id}/members`),
      fetch(`${API}/api/expenses/${g.id}`),
      fetch(`${API}/api/settlements/${g.id}`)
    ])
    setMembers(await mRes.json())
    setExpenses(await eRes.json())
    setSettlements(await sRes.json())
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null); setGroup(null); setMembers([]); setExpenses([])
  }

  async function createGroup() {
    if (!groupName.trim()) return
    const res = await fetch(`${API}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, created_by: user.id })
    })
    const g = await res.json()
    loadGroup(g, user.id)
    showToast('Group created! Share the invite code with friends 🎉')
  }

  async function joinGroup() {
    if (!inviteCode.trim()) return
    const res = await fetch(`${API}/api/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_code: inviteCode.trim(), user_id: user.id })
    })
    const data = await res.json()
    if (data.error) { showToast('Invalid invite code ❌'); return }
    const gRes = await fetch(`${API}/api/groups/user/${user.id}`)
    const groups = await gRes.json()
    loadGroup(groups[0], user.id)
    showToast('Joined group successfully! 🏠')
  }

  async function addExpense() {
    if (!form.description || !form.amount) return
    const amt = parseFloat(form.amount)
    const share = amt / members.length
    const splits = members.map(m => ({ user_id: m.profiles.id, share: Math.round(share * 100) / 100 }))
    await fetch(`${API}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: group.id, description: form.description, amount: amt, category: form.category, paid_by: user.id, date: form.date, splits })
    })
    setForm({ description:'', amount:'', category:'food', date: new Date().toISOString().split('T')[0] })
    setShowAddExp(false)
    loadGroup(group, user.id)
    showToast('Expense added! ✅')
  }

  async function deleteExpense(id) {
    await fetch(`${API}/api/expenses/${id}`, { method: 'DELETE' })
    loadGroup(group, user.id)
    showToast('Expense deleted')
  }

  function exportCSV() {
    const rows = [['Date','Description','Category','Amount','Paid By']]
    expenses.forEach(e => rows.push([e.date, e.description, e.category, e.amount, e.profiles?.name || '']))
    const csv = rows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = 'splitmate-expenses.csv'
    a.click()
  }

  function getMember(id) { return members.find(m => m.profiles?.id === id)?.profiles }

  const totalThisMonth = expenses
    .filter(e => e.date?.startsWith(new Date().toISOString().slice(0,7)))
    .reduce((s, e) => s + Number(e.amount), 0)

  const myShare = expenses.reduce((s, e) => {
    const split = e.expense_splits?.find(sp => sp.user_id === user?.id)
    return s + (split ? Number(split.share) : 0)
  }, 0)

  const iOwe = settlements
    .filter(s => s.from === user?.id)
    .reduce((s, t) => s + t.amount, 0)

  iif (loading) return (
  <div style={styles.center}>
    <div style={styles.spinner}></div>
    <p style={{ color:'#f5a623', marginTop:16, fontWeight:700 }}>Loading SplitMate...</p>
    <p style={{ color:'#9b97a0', marginTop:8, fontSize:13 }}>Waking up server, please wait up to 30 seconds...</p>
    <p style={{ color:'#5e5b66', marginTop:4, fontSize:12 }}>This only happens on first load</p>
  </div>
)

  if (!user) return (
    <div style={styles.authPage}>
      <div style={styles.authCard}>
        <div style={styles.logoBox}>
          <div style={styles.logoIcon}>S</div>
          <div>
            <div style={styles.logoText}>SplitMate</div>
            <div style={styles.logoSub}>Bachelor Expense Manager</div>
          </div>
        </div>
        <h2 style={styles.authTitle}>Welcome 👋</h2>
        <p style={styles.authSub}>Sign in to manage expenses with your flatmates.</p>
        <button style={styles.googleBtn} onClick={signInWithGoogle}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
      </div>
    </div>
  )

  if (showJoinCreate) return (
    <div style={styles.authPage}>
      <div style={styles.authCard}>
        <div style={styles.logoBox}>
          <div style={styles.logoIcon}>S</div>
          <div><div style={styles.logoText}>SplitMate</div></div>
        </div>
        <h2 style={styles.authTitle}>Set up your flat 🏠</h2>
        <p style={styles.authSub}>Create a new group or join an existing one.</p>
        <div style={styles.formGroup}>
          <label style={styles.label}>Create new group</label>
          <input style={styles.input} placeholder="e.g. Koramangala Flat" value={groupName} onChange={e => setGroupName(e.target.value)} />
          <button style={{...styles.btn, ...styles.btnPrimary, width:'100%', marginTop:8}} onClick={createGroup}>Create Group →</button>
        </div>
        <div style={{textAlign:'center', color:'#5e5b66', margin:'16px 0'}}>— or —</div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Join with invite code</label>
          <input style={styles.input} placeholder="Enter 8-letter code" value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
          <button style={{...styles.btn, ...styles.btnGhost, width:'100%', marginTop:8}} onClick={joinGroup}>Join Group →</button>
        </div>
        <button style={{...styles.btn, color:'#9b97a0', marginTop:16, background:'none', border:'none', width:'100%'}} onClick={signOut}>Sign out</button>
      </div>
    </div>
  )

  return (
    <div style={styles.app}>
      {/* Sidebar */}
      <nav style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <div style={styles.logoIcon}>S</div>
          <div>
            <div style={styles.logoText}>SplitMate</div>
            <div style={styles.logoSub}>Bachelor Expense Manager</div>
          </div>
        </div>
        {group && (
          <div style={styles.groupBadge}>
            <div style={{fontWeight:700, color:'#f5a623'}}>🏠 {group.name}</div>
            <div style={{fontSize:12, color:'#9b97a0', marginTop:4}}>{members.length} members · Code: <b style={{color:'#f5a623'}}>{group.invite_code}</b></div>
          </div>
        )}
        <div style={{padding:'8px 10px', flex:1}}>
          {[['dashboard','◉','Dashboard'],['expenses','₹','Expenses'],['settlements','⇄','Settlements'],['members','◎','Members']].map(([id,icon,label]) => (
            <div key={id} style={{...styles.navItem, ...(page===id ? styles.navActive : {})}} onClick={() => setPage(id)}>
              <span style={{width:20, textAlign:'center'}}>{icon}</span>{label}
            </div>
          ))}
        </div>
        <div style={styles.sidebarBottom}>
          <img src={user.user_metadata?.avatar_url} style={{width:32,height:32,borderRadius:'50%',objectFit:'cover'}} onError={e => e.target.style.display='none'} />
          <div style={{flex:1}}>
            <div style={{fontSize:13, fontWeight:600}}>{user.user_metadata?.full_name || user.email}</div>
            <div style={{fontSize:11, color:'#5e5b66'}}>{user.email}</div>
          </div>
          <span style={{cursor:'pointer', color:'#5e5b66'}} onClick={signOut} title="Sign out">⏻</span>
        </div>
      </nav>

      {/* Main */}
      <div style={styles.main}>
        {/* Dashboard */}
        {page === 'dashboard' && (
          <div style={styles.page}>
            <div style={styles.pageHeader}>
              <div>
                <div style={styles.pageTitle}>Dashboard</div>
                <div style={{fontSize:13, color:'#9b97a0'}}>
                  {new Date().toLocaleString('default',{month:'long',year:'numeric'})} · {group?.name}
                </div>
              </div>
              <button style={{...styles.btn,...styles.btnPrimary}} onClick={() => setShowAddExp(true)}>+ Add Expense</button>
            </div>
            <div style={styles.statGrid}>
              {[
                { label:'Total This Month', value:`₹${Math.round(totalThisMonth).toLocaleString('en-IN')}`, color:'#f5a623' },
                { label:'Your Share', value:`₹${Math.round(myShare).toLocaleString('en-IN')}`, color:'#4ade80' },
                { label:'You Owe', value:`₹${Math.round(iOwe).toLocaleString('en-IN')}`, color:'#f87171' },
                { label:'Transactions', value:expenses.length, color:'#60a5fa' },
              ].map(s => (
                <div key={s.label} style={styles.statCard}>
                  <div style={styles.statLabel}>{s.label}</div>
                  <div style={{...styles.statValue, color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
            <div style={styles.card}>
              <div style={styles.sectionHead}>
                <div style={styles.sectionTitle}>Recent Expenses</div>
                <button style={{...styles.btn,...styles.btnGhost,...styles.btnSm}} onClick={exportCSV}>↓ CSV</button>
              </div>
              {expenses.slice(0,8).map(e => {
                const cat = CATS.find(c => c.id === e.category) || CATS[0]
                const myS = e.expense_splits?.find(s => s.user_id === user.id)
                return (
                  <div key={e.id} style={styles.expRow}>
                    <div style={{fontSize:24}}>{cat.emoji}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14, fontWeight:600}}>{e.description}</div>
                      <div style={{fontSize:12, color:'#9b97a0'}}>{e.profiles?.name} paid · {e.date}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:700, color:'#f5a623'}}>₹{Number(e.amount).toLocaleString('en-IN')}</div>
                      <div style={{fontSize:11, color:'#5e5b66'}}>Your: ₹{myS ? Math.round(myS.share) : 0}</div>
                    </div>
                  </div>
                )
              })}
              {expenses.length === 0 && <div style={{textAlign:'center', padding:32, color:'#5e5b66'}}>No expenses yet. Add one! 👆</div>}
            </div>
          </div>
        )}

        {/* Expenses */}
        {page === 'expenses' && (
          <div style={styles.page}>
            <div style={styles.pageHeader}>
              <div>
                <div style={styles.pageTitle}>All Expenses</div>
                <div style={{fontSize:13, color:'#9b97a0'}}>{expenses.length} total</div>
              </div>
              <div style={{display:'flex', gap:10}}>
                <button style={{...styles.btn,...styles.btnGhost,...styles.btnSm}} onClick={exportCSV}>↓ Export CSV</button>
                <button style={{...styles.btn,...styles.btnPrimary}} onClick={() => setShowAddExp(true)}>+ Add</button>
              </div>
            </div>
            <div style={styles.card}>
              {expenses.map(e => {
                const cat = CATS.find(c => c.id === e.category) || CATS[0]
                const myS = e.expense_splits?.find(s => s.user_id === user.id)
                return (
                  <div key={e.id} style={styles.expRow}>
                    <div style={{fontSize:24}}>{cat.emoji}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14, fontWeight:600}}>{e.description}</div>
                      <div style={{fontSize:12, color:'#9b97a0'}}>{e.profiles?.name} paid · {e.date} · {cat.label}</div>
                    </div>
                    <div style={{textAlign:'right', marginRight:12}}>
                      <div style={{fontWeight:700, color:'#f5a623'}}>₹{Number(e.amount).toLocaleString('en-IN')}</div>
                      <div style={{fontSize:11, color:'#5e5b66'}}>Your: ₹{myS ? Math.round(myS.share) : 0}</div>
                    </div>
                    {e.paid_by === user.id && (
                      <button style={{...styles.btn, background:'rgba(248,113,113,0.1)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)', padding:'6px 12px', fontSize:12}} onClick={() => deleteExpense(e.id)}>✕</button>
                    )}
                  </div>
                )
              })}
              {expenses.length === 0 && <div style={{textAlign:'center', padding:32, color:'#5e5b66'}}>No expenses yet!</div>}
            </div>
          </div>
        )}

        {/* Settlements */}
        {page === 'settlements' && (
          <div style={styles.page}>
            <div style={styles.pageHeader}>
              <div style={styles.pageTitle}>Settlements</div>
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Who pays whom</div>
              <div style={{marginTop:16}}>
                {settlements.map((s, i) => {
                  const from = getMember(s.from)
                  const to = getMember(s.to)
                  return (
                    <div key={i} style={{display:'flex', alignItems:'center', gap:12, padding:'14px', background:'#1e1e24', borderRadius:12, marginBottom:10}}>
                      <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(245,166,35,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12,color:'#f5a623'}}>{from?.name?.slice(0,2).toUpperCase()}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:600}}>{from?.name} <span style={{color:'#5e5b66'}}>pays</span> {to?.name}</div>
                      </div>
                      <div style={{fontWeight:800,fontSize:16,color:'#f5a623'}}>₹{s.amount.toLocaleString('en-IN')}</div>
                      {s.from === user.id && (
                        <button style={{...styles.btn, background:'rgba(74,222,128,0.1)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.2)', padding:'6px 14px', fontSize:12}} onClick={() => showToast('Marked as settled! 🎉')}>Settled ✓</button>
                      )}
                    </div>
                  )
                })}
                {settlements.length === 0 && <div style={{textAlign:'center', padding:32, color:'#5e5b66'}}>🎉 All settled up! No pending payments.</div>}
              </div>
            </div>
          </div>
        )}

        {/* Members */}
        {page === 'members' && (
          <div style={styles.page}>
            <div style={styles.pageHeader}>
              <div style={styles.pageTitle}>Members</div>
            </div>
            <div style={{...styles.card, marginBottom:20}}>
              <div style={styles.sectionTitle}>Invite your friends</div>
              <div style={{marginTop:12, padding:16, background:'#1e1e24', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div>
                  <div style={{fontSize:12, color:'#9b97a0'}}>Share this invite code</div>
                  <div style={{fontSize:28, fontWeight:800, color:'#f5a623', letterSpacing:4, marginTop:4}}>{group?.invite_code}</div>
                </div>
                <button style={{...styles.btn,...styles.btnPrimary}} onClick={() => { navigator.clipboard.writeText(group?.invite_code); showToast('Invite code copied! 📋') }}>Copy Code</button>
              </div>
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Group Members ({members.length})</div>
              {members.map(m => (
                <div key={m.id} style={styles.expRow}>
                  <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(245,166,35,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#f5a623'}}>
                    {m.profiles?.name?.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14, fontWeight:600}}>{m.profiles?.name} {m.profiles?.id === user.id ? '(You)' : ''}</div>
                    <div style={{fontSize:12, color:'#9b97a0'}}>{m.profiles?.email}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {showAddExp && (
        <div style={styles.overlay} onClick={e => e.target === e.currentTarget && setShowAddExp(false)}>
          <div style={styles.modal}>
            <div style={styles.modalTitle}>Add Expense</div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <input style={styles.input} placeholder="e.g. Swiggy Order" value={form.description} onChange={e => setForm({...form, description:e.target.value})} />
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Amount (₹)</label>
                <input style={styles.input} type="number" placeholder="0" value={form.amount} onChange={e => setForm({...form, amount:e.target.value})} />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Date</label>
                <input style={styles.input} type="date" value={form.date} onChange={e => setForm({...form, date:e.target.value})} />
              </div>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Category</label>
              <select style={styles.input} value={form.category} onChange={e => setForm({...form, category:e.target.value})}>
                {CATS.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
              </select>
            </div>
            <div style={{fontSize:12, color:'#9b97a0', marginBottom:16}}>Split equally among {members.length} members (₹{form.amount ? Math.round(parseFloat(form.amount)/members.length) : 0} each)</div>
            <div style={{display:'flex', gap:10}}>
              <button style={{...styles.btn,...styles.btnGhost, flex:1, justifyContent:'center'}} onClick={() => setShowAddExp(false)}>Cancel</button>
              <button style={{...styles.btn,...styles.btnPrimary, flex:1, justifyContent:'center'}} onClick={addExpense}>Add Expense →</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={styles.toast}>{toast}</div>
      )}
    </div>
  )
}

const styles = {
  app: { display:'flex', minHeight:'100vh', background:'#0e0e10', color:'#f0ede8', fontFamily:'system-ui,sans-serif' },
  center: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#0e0e10' },
  spinner: { width:40, height:40, border:'3px solid #26262e', borderTop:'3px solid #f5a623', borderRadius:'50%', animation:'spin 0.8s linear infinite' },
  authPage: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0e0e10', padding:20 },
  authCard: { width:400, maxWidth:'100%', background:'#16161a', border:'1px solid rgba(255,255,255,0.07)', borderRadius:20, padding:32 },
  logoBox: { display:'flex', alignItems:'center', gap:10, marginBottom:24 },
  logoIcon: { width:36, height:36, background:'#f5a623', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:16, color:'#0e0e10' },
  logoText: { fontWeight:800, fontSize:18 },
  logoSub: { fontSize:11, color:'#5e5b66', textTransform:'uppercase', letterSpacing:'0.05em' },
  authTitle: { fontSize:22, fontWeight:800, marginBottom:6 },
  authSub: { fontSize:14, color:'#9b97a0', marginBottom:24 },
  googleBtn: { width:'100%', padding:13, background:'#1e1e24', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, color:'#f0ede8', fontSize:14, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10 },
  sidebar: { width:240, background:'#16161a', borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh' },
  sidebarLogo: { display:'flex', alignItems:'center', gap:10, padding:'24px 20px 20px', borderBottom:'1px solid rgba(255,255,255,0.07)' },
  groupBadge: { margin:16, background:'rgba(245,166,35,0.12)', border:'1px solid rgba(245,166,35,0.25)', borderRadius:12, padding:12 },
  navItem: { display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, cursor:'pointer', color:'#9b97a0', fontSize:14, fontWeight:500, marginBottom:2, transition:'all 0.2s' },
  navActive: { background:'rgba(245,166,35,0.2)', color:'#f5a623', border:'1px solid rgba(245,166,35,0.2)' },
  sidebarBottom: { padding:16, borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', gap:10 },
  main: { flex:1, overflow:'auto' },
  page: { padding:28, maxWidth:900 },
  pageHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:12 },
  pageTitle: { fontSize:26, fontWeight:800 },
  statGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16, marginBottom:24 },
  statCard: { background:'#16161a', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'18px 20px' },
  statLabel: { fontSize:12, color:'#5e5b66', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 },
  statValue: { fontSize:26, fontWeight:800, marginTop:6 },
  card: { background:'#16161a', border:'1px solid rgba(255,255,255,0.07)', borderRadius:16, padding:20, marginBottom:20 },
  sectionHead: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 },
  sectionTitle: { fontSize:15, fontWeight:700 },
  expRow: { display:'flex', alignItems:'center', gap:14, padding:'12px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' },
  btn: { display:'inline-flex', alignItems:'center', gap:8, padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontSize:14, fontWeight:600, transition:'all 0.2s' },
  btnPrimary: { background:'#f5a623', color:'#0e0e10' },
  btnGhost: { background:'#1e1e24', color:'#f0ede8', border:'1px solid rgba(255,255,255,0.12)' },
  btnSm: { padding:'7px 14px', fontSize:13 },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 },
  modal: { background:'#16161a', border:'1px solid rgba(255,255,255,0.12)', borderRadius:20, padding:28, width:460, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' },
  modalTitle: { fontSize:20, fontWeight:800, marginBottom:20 },
  formGroup: { marginBottom:16 },
  label: { fontSize:12, fontWeight:600, color:'#9b97a0', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6, display:'block' },
  input: { width:'100%', background:'#1e1e24', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'11px 14px', color:'#f0ede8', fontSize:14, outline:'none', boxSizing:'border-box' },
  toast: { position:'fixed', bottom:24, right:24, background:'#1e1e24', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, padding:'14px 20px', fontSize:14, fontWeight:500, zIndex:2000, boxShadow:'0 4px 24px rgba(0,0,0,0.4)' },
}
