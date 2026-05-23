import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'https://tripmap1.onrender.com';
const socket = io(SERVER);

const App = () => {
    // --- AUTH STATE ---
    const [user, setUser] = useState(null);
    const [authMode, setAuthMode] = useState('login'); // 'login' sau 'register'
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [loginError, setLoginError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // --- TRIPS STATE ---
    const [view, setView] = useState('login'); // 'login', 'dashboard_main', 'trip_planner', 'admin_panel'
    const [trips, setTrips] = useState([]);
    const [stats, setStats] = useState(null);
    const [isOnline, setIsOnline] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ dest: '', price: '', days: '', desc: '' });
    const [selectedTrip, setSelectedTrip] = useState(null);
    const [filter, setFilter] = useState({ city: '', minPrice: '', maxPrice: '' });
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const loaderRef = useRef(null);

    // --- CHAT STATE ---
    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatRoom] = useState('general');
    const chatEndRef = useRef(null);

    // --- GOLD CHALLENGE STATE ---
    const [suspiciousUsers, setSuspiciousUsers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [activeAdminTab, setActiveAdminTab] = useState('logs'); // 'logs' sau 'suspicious'

    // --- HELPERS ---
    const hasPermission = (perm) => {
        if (user?.role?.includes('admin')) return true;
        return user?.permissions?.includes(perm);
    };

    const gqlFetch = useCallback(async (query) => {
        const res = await fetch(`${SERVER}/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        return res.json();
    }, []);

    // --- GOLD CHALLENGE FETCHERS ---
    const fetchGoldAdminData = useCallback(async () => {
        if (!user?.role?.includes('admin')) return;
        try {
            // 1. Fetch Suspicious Users (Lista de Observație)
            const resSuspicious = await fetch(`${SERVER}/api/admin/suspicious`);
            if (resSuspicious.ok) {
                const dataSuspicious = await resSuspicious.json();
                setSuspiciousUsers(dataSuspicious);
            }

            // 2. Fetch Raw Audit Logs (Infrastructura de Jurnalizare)
            const resLogs = await fetch(`${SERVER}/api/admin/audit-logs`);
            if (resLogs.ok) {
                const dataLogs = await resLogs.json();
                setAuditLogs(dataLogs);
            }
        } catch (err) {
            console.error('Error fetching Gold challenge metrics:', err);
        }
    }, [user]);

    // --- LOGIN ---
    const handleLogin = async () => {
        setLoginError('');
        setSuccessMessage('');
        try {
            const result = await gqlFetch(`mutation { login(username: "${loginForm.username}", password: "${loginForm.password}") { id username role permissions } }`);
            if (result.errors) { setLoginError('Invalid username or password'); return; }
            const loggedUser = result.data.login;
            setUser(loggedUser);
            setView('dashboard_main');

            // Join chat room
            socket.emit('joinRoom', { username: loggedUser.username, room: chatRoom });
        } catch {
            setLoginError('Connection error');
        }
    };

    // --- REGISTER ---
    const handleRegister = async () => {
        setLoginError('');
        setSuccessMessage('');

        if (loginForm.username.trim().length < 3) {
            setLoginError('Username must be at least 3 characters');
            return;
        }
        if (loginForm.password.length < 4) {
            setLoginError('Password must be at least 4 characters');
            return;
        }

        try {
            const res = await fetch(`${SERVER}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: loginForm.username.trim(),
                    password: loginForm.password
                })
            });

            const data = await res.json();

            if (!res.ok) {
                setLoginError(data.error || 'Registration failed');
                return;
            }

            setSuccessMessage('Account created successfully! Logging in...');

            // Auto login după înregistrare reușită
            setTimeout(() => {
                handleLogin();
            }, 1500);

        } catch {
            setLoginError('Server connection error during registration');
        }
    };

    // --- CHAT ---
    const loadChatHistory = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER}/api/chat/${chatRoom}`);
            if (res.ok) {
                const msgs = await res.json();
                setChatMessages(msgs);
            }
        } catch { }
    }, [chatRoom]);

    const sendMessage = () => {
        if (!chatInput.trim() || !user) return;

        const msgPayload = {
            userId: user.id, // Trimitem corect ID-ul utilizatorului pentru sistemul de logging
            username: user.username,
            role: user.role,
            text: chatInput.trim(),
            room: chatRoom,
        };

        socket.emit('sendMessage', msgPayload);
        setChatInput('');
    };

    useEffect(() => {
        socket.on('chatMessage', (msg) => {
            setChatMessages(prev => [...prev, msg]);
            // Re-interogăm datele de audit dacă suntem pe panoul admin când s-a trimis un mesaj
            if (view === 'admin_panel') fetchGoldAdminData();
        });
        return () => {
            socket.off('chatMessage');
        };
    }, [view, fetchGoldAdminData]);

    useEffect(() => {
        if (showChat) {
            loadChatHistory();
            if (user) socket.emit('joinRoom', { username: user.username, room: chatRoom });
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    }, [showChat, loadChatHistory, user, chatRoom]);

    useEffect(() => {
        if (chatMessages.length > 0) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages]);

    // --- TRIPS ---
    const fetchTrips = useCallback(async (isNextPage = false, targetPageManual = null, filterOverride = null) => {
        const targetPage = targetPageManual || (isNextPage ? page + 1 : page);
        const activeFilter = filterOverride !== null ? filterOverride : filter;
        const cityArg = activeFilter.city ? `, city: "${activeFilter.city}"` : '';
        const minArg = activeFilter.minPrice !== '' ? `, minPrice: ${Number(activeFilter.minPrice)}` : '';
        const maxArg = activeFilter.maxPrice !== '' ? `, maxPrice: ${Number(activeFilter.maxPrice)}` : '';

        try {
            if (isNextPage) setIsLoadingMore(true);
            const result = await gqlFetch(`query { getTrips(page: ${targetPage}${cityArg}${minArg}${maxArg}) { total totalPages data { id dest price days desc } } }`);
            if (result.data) {
                const newData = result.data.getTrips.data;
                setTrips(prev => isNextPage ? [...prev, ...newData] : newData);
                setPage(targetPage);
                setTotalPages(result.data.getTrips.totalPages);
                setIsOnline(true);
            }
        } catch { setIsOnline(false); }
        finally { setIsLoadingMore(false); }
    }, [page, filter, gqlFetch]);

    const fetchStats = useCallback(async () => {
        try {
            const result = await gqlFetch(`query { getStats { avgPrice totalTrips maxPrice } }`);
            if (result.data) setStats(result.data.getStats);
        } catch { }
    }, [gqlFetch]);

    useEffect(() => {
        const heartbeat = setInterval(async () => {
            try {
                const res = await gqlFetch('{ ping }');
                if (res.data && !isOnline) setIsOnline(true);
            } catch { setIsOnline(false); }
        }, 3000);
        socket.on('tripsUpdated', () => { fetchTrips(false, 1); fetchStats(); });
        if (view === 'trip_planner') { fetchTrips(); fetchStats(); }
        if (view === 'admin_panel') { fetchGoldAdminData(); }
        return () => { clearInterval(heartbeat); socket.off('tripsUpdated'); };
    }, [view, fetchTrips, fetchStats, isOnline, gqlFetch, fetchGoldAdminData]);

    useEffect(() => {
        if (view !== 'trip_planner') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoadingMore && page < totalPages && isOnline) fetchTrips(true);
        }, { threshold: 0.1 });
        if (loaderRef.current) observer.observe(loaderRef.current);
        return () => observer.disconnect();
    }, [isLoadingMore, page, totalPages, isOnline, view, fetchTrips]);

    const handleAction = async (method, data) => {
        let gqlMutation = '';
        if (method === 'DELETE') {
            if (!hasPermission('delete_trip')) return alert('No permission to delete trips!');
            gqlMutation = `mutation { deleteTrip(id: "${data.id}") }`;
        } else {
            if (editingId && !hasPermission('edit_trip')) return alert('No permission to edit trips!');
            if (!editingId && !hasPermission('create_trip')) return alert('No permission to create trips!');
            if (!data.dest || data.price <= 0) return alert('Invalid data!');
            gqlMutation = editingId
                ? `mutation { updateTrip(id: "${editingId}", dest: "${data.dest}", price: ${data.price}, days: ${data.days}, desc: "${data.desc}") { id } }`
                : `mutation { addTrip(dest: "${data.dest}", price: ${data.price}, days: ${data.days}, desc: "${data.desc}") { id } }`;
        }
        try {
            const result = await gqlFetch(gqlMutation);
            if (result.errors) return alert(result.errors[0].message);
            setShowModal(false);
            fetchTrips(false, 1);
            fetchStats();
        } catch { setIsOnline(false); }
    };

    // --- VIEWS ---

    // LOGIN & REGISTER VIEW
    if (view === 'login') return (
        <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0a0a12' }}>
            <div style={{ background: '#161625', padding: '40px', borderRadius: '12px', border: '1px solid cyan', textAlign: 'center', width: '360px' }}>
                <h2 style={{ color: 'cyan', marginBottom: '8px' }}>Trip Planner Engine</h2>
                <p style={{ color: '#555', marginBottom: '24px', fontSize: '0.85rem' }}>
                    v3.0 Gold – {authMode === 'login' ? 'Login Required' : 'Create New Account'}
                </p>

                <input
                    value={loginForm.username}
                    onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                    placeholder="Username"
                    style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }}
                />
                <input
                    type="password"
                    value={loginForm.password}
                    onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())}
                    placeholder="Password"
                    style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }}
                />

                {loginError && <p style={{ color: '#ff4d4d', marginBottom: '10px', fontSize: '0.85rem' }}>{loginError}</p>}
                {successMessage && <p style={{ color: '#00ff88', marginBottom: '10px', fontSize: '0.85rem' }}>{successMessage}</p>}

                {authMode === 'login' ? (
                    <button onClick={handleLogin} style={{ width: '100%', padding: '12px', background: 'cyan', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', color: 'black' }}>
                        LOGIN
                    </button>
                ) : (
                    <button onClick={handleRegister} style={{ width: '100%', padding: '12px', background: '#00ff88', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', color: 'black' }}>
                        REGISTER NEW ACCOUNT
                    </button>
                )}

                <div style={{ marginTop: '15px' }}>
                    <span
                        onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setLoginError(''); setSuccessMessage(''); }}
                        style={{ color: 'cyan', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                        {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
                    </span>
                </div>

                {authMode === 'login' && (
                    <div style={{ marginTop: '20px', padding: '12px', background: '#0a0a12', borderRadius: '8px', textAlign: 'left' }}>
                        <p style={{ color: '#555', fontSize: '0.75rem', margin: '0 0 6px 0' }}>Test accounts:</p>
                        <p style={{ color: '#00ff88', fontSize: '0.75rem', margin: '2px 0' }}>admin / admin123 → Full access + Admin Panel</p>
                        <p style={{ color: '#aaa', fontSize: '0.75rem', margin: '2px 0' }}>user1 / user123 → View only</p>
                    </div>
                )}
            </div>
        </div>
    );

    // DASHBOARD MAIN SWITCHBOARD VIEW
    if (view === 'dashboard_main') return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', color: 'white', gap: '20px' }}>
            <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                <p style={{ color: '#555' }}>Logged in as <span style={{ color: 'cyan' }}>{user?.username}</span> — Role: <span style={{ color: user?.role?.includes('admin') ? '#ff4d4d' : '#00ff88' }}>{user?.role}</span></p>
            </div>

            <div style={{ display: 'flex', gap: '20px' }}>
                <div onClick={() => setView('trip_planner')} style={{ padding: '40px 60px', background: '#161625', border: '2px solid cyan', borderRadius: '20px', cursor: 'pointer', textAlign: 'center', width: '250px' }}>
                    <h2 style={{ color: 'cyan', margin: 0, fontSize: '1.4rem' }}>TRIP MANAGER</h2>
                    <p style={{ color: '#aaa', marginTop: '10px', fontSize: '0.85rem' }}>Console & Planning Engine</p>
                </div>

                {/* GOLD CHALLENGE COMPLIANT: Link către panoul de securitate dedicat adminilor */}
                {user?.role?.includes('admin') && (
                    <div onClick={() => { setView('admin_panel'); fetchGoldAdminData(); }} style={{ padding: '40px 60px', background: '#25161c', border: '2px solid #ff4d4d', borderRadius: '20px', cursor: 'pointer', textAlign: 'center', width: '250px' }}>
                        <h2 style={{ color: '#ff4d4d', margin: 0, fontSize: '1.4rem' }}>🛡️ SECURITY PANEL</h2>
                        <p style={{ color: '#aaa', marginTop: '10px', fontSize: '0.85rem' }}>Audit Logs & Intrusion Monitor</p>
                    </div>
                )}
            </div>

            <button onClick={() => { setUser(null); setView('login'); setAuthMode('login'); }} style={{ background: '#333', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginTop: '20px' }}>
                LOGOUT
            </button>
        </div>
    );

    // GOLD COMPLIANT: VISUAL ADMIN CONTROL SECURITY CENTER PANEL VIEW
    if (view === 'admin_panel') return (
        <div style={{ padding: '20px', background: '#0a0a12', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif' }}>
            {/* Admin Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ff4d4d', paddingBottom: '15px', marginBottom: '20px' }}>
                <h1 style={{ margin: 0, color: '#ff4d4d' }}>🛡️ Security & Audit <span style={{ color: 'white', fontSize: '1.2rem' }}>Console</span></h1>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 15px', cursor: 'pointer', borderRadius: '4px' }}>🔙 BACK TO MENU</button>
                </div>
            </div>

            {/* Quick Metrics Cards */}
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                <div style={{ background: '#1c1618', padding: '15px 20px', borderRadius: '8px', border: '1px solid #ff4d4d', flex: 1, textAlign: 'center' }}>
                    <div style={{ color: '#ff4d4d', fontSize: '2rem', fontWeight: 'bold' }}>{suspiciousUsers.length}</div>
                    <div style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '4px' }}>🔴 Flagged Suspicious Accounts (Be Stealth)</div>
                </div>
                <div style={{ background: '#161c18', padding: '15px 20px', borderRadius: '8px', border: '1px solid #00ff88', flex: 1, textAlign: 'center' }}>
                    <div style={{ color: '#00ff88', fontSize: '2rem', fontWeight: 'bold' }}>{auditLogs.length}</div>
                    <div style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '4px' }}>📑 Total Indexed Audit Entries (Be Alert)</div>
                </div>
            </div>

            {/* Sub-Navigation Tabs */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button onClick={() => setActiveAdminTab('logs')} style={{ padding: '10px 20px', background: activeAdminTab === 'logs' ? '#ff4d4d' : '#161625', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    📑 LIVE AUDIT TRAILS
                </button>
                <button onClick={() => setActiveAdminTab('suspicious')} style={{ padding: '10px 20px', background: activeAdminTab === 'suspicious' ? '#ff4d4d' : '#161625', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    🚨 INTERCEPTION LIST ({suspiciousUsers.length})
                </button>
                <button onClick={fetchGoldAdminData} style={{ padding: '10px 15px', background: '#222', color: '#aaa', border: 'none', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto' }}>
                    🔄 REFRESH
                </button>
            </div>

            {/* Content Display Grid */}
            <div style={{ background: '#161625', padding: '20px', borderRadius: '12px', border: '1px solid #333', minHeight: '400px' }}>
                {activeAdminTab === 'logs' ? (
                    <div>
                        <h3 style={{ marginTop: 0, color: '#ff4d4d', borderBottom: '1px solid #222', paddingBottom: '10px' }}>Infrastructura de Audit Log (Database Trails)</h3>
                        <div style={{ overflowY: 'auto', maxHeight: '500px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ color: '#ff4d4d', borderBottom: '1px solid #333', height: '35px' }}>
                                        <th style={{ padding: '8px' }}>USER / ID</th>
                                        <th>ROLE</th>
                                        <th>ACTION DESCRIPTION</th>
                                        <th>TIMESTAMP</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.length === 0 ? (
                                        <tr><td colSpan="4" style={{ padding: '20px', color: '#555', textAlign: 'center' }}>No audit trails populated inside database yet.</td></tr>
                                    ) : (
                                        auditLogs.map(log => (
                                            <tr key={log.id} style={{ borderBottom: '1px solid #222', height: '40px', fontSize: '0.9rem' }}>
                                                <td style={{ padding: '8px', color: 'cyan', fontWeight: 'bold' }}>{log.userId}</td>
                                                <td><span style={{ color: log.role === 'admin' ? '#ff4d4d' : '#00ff88', fontSize: '0.8rem', background: '#0a0a12', padding: '2px 6px', borderRadius: '4px' }}>{log.role}</span></td>
                                                <td style={{ color: '#ddd' }}>{log.action}</td>
                                                <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(log.timestamp).toLocaleString()}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div>
                        <h3 style={{ marginTop: 0, color: '#ff4d4d', borderBottom: '1px solid #222', paddingBottom: '10px' }}>Mecanism Detectare Inundare Chat (Be Stealth Observation List)</h3>
                        {suspiciousUsers.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                                🟢 No suspicious behavior detected. The networks are currently secure and stealth monitoring is active.
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
                                {suspiciousUsers.map(sus => (
                                    <div key={sus.id} style={{ background: '#1c1618', border: '1px solid #ff4d4d', padding: '15px', borderRadius: '8px', position: 'relative' }}>
                                        <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#ff4d4d', color: 'black', fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px' }}>SUSPICIOUS POOL</span>
                                        <div style={{ fontSize: '0.8rem', color: '#666' }}>DATABASE ID: {sus.id}</div>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'white', margin: '5px 0' }}>👤 {sus.username}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '10px' }}>⚡ Incriminated at:<br /> {new Date(sus.updatedAt).toLocaleString()}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // MAIN APP TRIP PLANNING ENGINE VIEW
    return (
        <div style={{ padding: '20px', background: '#0a0a12', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px' }}>
                <h1 style={{ margin: 0 }}>Trip<span style={{ color: 'cyan' }}>Planner</span></h1>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <span style={{ color: '#555', fontSize: '0.85rem' }}>
                        👤 <span style={{ color: 'cyan' }}>{user?.username}</span>
                        {' '}[<span style={{ color: user?.role?.includes('admin') ? '#ff4d4d' : '#00ff88' }}>{user?.role}</span>]
                    </span>
                    <div style={{ color: isOnline ? '#00ff88' : '#ff4d4d', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        {isOnline ? '● ONLINE' : '● OFFLINE'}
                    </div>
                    <button onClick={() => setShowChat(!showChat)} style={{ background: '#161625', color: 'cyan', border: '1px solid cyan', padding: '6px 14px', cursor: 'pointer', borderRadius: '4px' }}>
                        💬 Chat
                    </button>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 15px', cursor: 'pointer', borderRadius: '4px' }}>CONSOLE DASHBOARD</button>
                </div>
            </div>

            {/* Stats */}
            {stats && (
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                    {[
                        { label: 'Total Trips', value: stats.totalTrips },
                        { label: 'Avg Price', value: `$${Math.round(stats.avgPrice)}` },
                        { label: 'Max Price', value: `$${stats.maxPrice}` },
                    ].map(s => (
                        <div key={s.label} style={{ background: '#161625', padding: '10px 20px', borderRadius: '8px', border: '1px solid #333', textAlign: 'center', flex: 1 }}>
                            <div style={{ color: 'cyan', fontSize: '1.4rem', fontWeight: 'bold' }}>{s.value}</div>
                            <div style={{ color: '#555', fontSize: '0.75rem' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Generator - admin only */}
            {hasPermission('create_trip') && (
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <button onClick={async () => {
                        const action = isGenerating ? 'stop' : 'start';
                        await gqlFetch(`mutation { toggleGenerator(action: "${action}") }`);
                        setIsGenerating(!isGenerating);
                    }} style={{ background: isGenerating ? '#ff4d4d' : '#00ff88', border: 'none', padding: '10px 25px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer' }}>
                        {isGenerating ? '⏹ STOP GENERATOR' : '▶ START LIVE DATA GENERATOR'}
                    </button>
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', background: '#161625', padding: '12px', borderRadius: '8px' }}>
                <input value={filter.city} onChange={e => setFilter({ ...filter, city: e.target.value })} placeholder="Filter by city..." style={{ flex: 2, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <input type="number" value={filter.minPrice} onChange={e => setFilter({ ...filter, minPrice: e.target.value })} placeholder="Min price" style={{ flex: 1, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <input type="number" value={filter.maxPrice} onChange={e => setFilter({ ...filter, maxPrice: e.target.value })} placeholder="Max price" style={{ flex: 1, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <button onClick={() => fetchTrips(false, 1, filter)} style={{ padding: '8px 20px', background: 'cyan', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>FILTER</button>
                <button onClick={() => { const c = { city: '', minPrice: '', maxPrice: '' }; setFilter(c); fetchTrips(false, 1, c); }} style={{ padding: '8px 15px', background: '#333', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>CLEAR</button>
            </div>

            <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 340px)' }}>
                {/* Trips Table */}
                <div style={{ flex: 2, background: '#161625', padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0 }}>Destinations (Page {page}/{totalPages})</h3>
                        {hasPermission('create_trip') && (
                            <button onClick={() => { setEditingId(null); setFormData({ dest: '', price: '', days: '', desc: '' }); setShowModal(true); }} style={{ background: 'cyan', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>+ NEW TRIP</button>
                        )}
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #222' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#1c1c2e', zIndex: 1 }}>
                                <tr style={{ color: 'cyan', textAlign: 'left', borderBottom: '1px solid #333' }}>
                                    <th style={{ padding: '12px' }}>City</th>
                                    <th>Days</th>
                                    <th>Price</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trips.map(t => (
                                    <tr key={t.id} onClick={() => setSelectedTrip(t)} style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: selectedTrip?.id === t.id ? '#1a1a2e' : 'transparent' }}>
                                        <td style={{ padding: '12px' }}>{t.dest}</td>
                                        <td>{t.days}</td>
                                        <td style={{ color: '#00ff88' }}>${t.price}</td>
                                        <td>
                                            {hasPermission('edit_trip') && (
                                                <button onClick={e => { e.stopPropagation(); setEditingId(t.id); setFormData(t); setShowModal(true); }} style={{ background: 'none', border: 'none', color: 'orange', cursor: 'pointer', marginRight: '10px' }}>Edit</button>
                                            )}
                                            {hasPermission('delete_trip') && (
                                                <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete trip to ${t.dest}?`)) handleAction('DELETE', { id: t.id }); }} style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer' }}>Del</button>
                                            )}
                                            {!hasPermission('edit_trip') && !hasPermission('delete_trip') && (
                                                <span style={{ color: '#444', fontSize: '0.75rem' }}>view only</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div ref={loaderRef} style={{ padding: '15px', textAlign: 'center', color: '#555' }}>
                            {isLoadingMore ? '⏳ Loading more...' : (page >= totalPages ? '— End of list —' : '↓ Scroll for more')}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', paddingTop: '10px' }}>
                        <button disabled={page === 1} onClick={() => fetchTrips(false, page - 1)} style={{ padding: '5px 10px', background: '#333', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>Prev</button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
                            <button key={i} onClick={() => fetchTrips(false, i + 1)} style={{ padding: '5px 10px', background: page === i + 1 ? 'cyan' : '#333', color: page === i + 1 ? 'black' : 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>{i + 1}</button>
                        ))}
                        <button disabled={page === totalPages} onClick={() => fetchTrips(false, page + 1)} style={{ padding: '5px 10px', background: '#333', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>Next</button>
                    </div>
                </div>

                {/* Sidebar */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ background: '#161625', padding: '20px', borderRadius: '12px', height: '180px' }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Cost Overview</h4>
                        <ResponsiveContainer width="100%" height="85%">
                            <BarChart data={trips.slice(-10)}>
                                <XAxis dataKey="dest" hide />
                                <YAxis hide />
                                <Tooltip contentStyle={{ background: '#161625', border: '1px solid cyan' }} />
                                <Bar dataKey="price" fill="cyan" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{ background: '#161625', padding: '20px', borderRadius: '12px', border: '1px solid cyan', flex: 1 }}>
                        <h3 style={{ color: 'cyan', marginTop: 0 }}>Trip Details</h3>
                        {selectedTrip ? (
                            <div>
                                <h2 style={{ margin: '10px 0' }}>{selectedTrip.dest}</h2>
                                <p style={{ color: '#aaa', lineHeight: '1.5' }}>{selectedTrip.desc || 'No details.'}</p>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#00ff88', marginTop: '20px' }}>Price: ${selectedTrip.price}</div>
                                <div style={{ color: '#888' }}>Duration: {selectedTrip.days} days</div>
                            </div>
                        ) : <p style={{ color: '#444' }}>Select a destination.</p>}
                    </div>
                </div>
            </div>

            {/* CHAT PANEL */}
            {showChat && (
                <div style={{ position: 'fixed', bottom: '20px', right: '20px', width: '360px', height: '480px', background: '#161625', border: '1px solid cyan', borderRadius: '12px', display: 'flex', flexDirection: 'column', zIndex: 200 }}>
                    <div style={{ padding: '15px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, color: 'cyan' }}>💬 Live Chat — #{chatRoom}</h4>
                        <button onClick={() => setShowChat(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {chatMessages.map((msg, i) => (
                            <div key={i} style={{ alignSelf: msg.username === user?.username ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                                {msg.username !== user?.username && (
                                    <div style={{ fontSize: '0.7rem', color: msg.role?.includes('admin') ? '#ff4d4d' : '#00ff88', marginBottom: '2px' }}>
                                        {msg.username} [{msg.role || 'user'}]
                                    </div>
                                )}
                                <div style={{
                                    background: msg.username === 'System' ? '#1a1a2e' : msg.username === user?.username ? 'cyan' : '#222',
                                    color: msg.username === user?.username ? 'black' : msg.username === 'System' ? '#555' : 'white',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    fontSize: '0.85rem',
                                    fontStyle: msg.username === 'System' ? 'italic' : 'normal',
                                }}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>

                    <div style={{ padding: '10px', borderTop: '1px solid #333', display: 'flex', gap: '8px' }}>
                        <input
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && sendMessage()}
                            placeholder="Type a message..."
                            style={{ flex: 1, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }}
                        />
                        <button onClick={sendMessage} style={{ background: 'cyan', border: 'none', padding: '8px 15px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Send</button>
                    </div>
                </div>
            )}

            {/* MODAL */}
            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                    <div style={{ background: '#161625', padding: '30px', borderRadius: '12px', width: '400px', border: '1px solid cyan' }}>
                        <h3 style={{ color: 'cyan', marginTop: 0 }}>{editingId ? 'Modify' : 'Create'} Trip Record</h3>
                        <input value={formData.dest} onChange={e => setFormData({ ...formData, dest: e.target.value })} placeholder="Destination City" style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) })} placeholder="Price ($)" style={{ width: '50%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                            <input type="number" value={formData.days} onChange={e => setFormData({ ...formData, days: parseInt(e.target.value) })} placeholder="Days" style={{ width: '50%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                        </div>
                        <textarea value={formData.desc} onChange={e => setFormData({ ...formData, desc: e.target.value })} placeholder="Description..." style={{ width: '100%', padding: '12px', marginBottom: '20px', background: '#0a0a12', border: '1px solid #333', color: 'white', height: '80px', boxSizing: 'border-box', borderRadius: '4px' }} />
                        <button onClick={() => handleAction('SAVE', formData)} style={{ width: '100%', padding: '12px', background: 'cyan', border: 'none', fontWeight: 'bold', cursor: 'pointer', color: 'black', borderRadius: '4px' }}>CONFIRM</button>
                        <button onClick={() => setShowModal(false)} style={{ width: '100%', marginTop: '10px', background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>Discard</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;