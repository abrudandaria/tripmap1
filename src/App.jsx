import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'https://tripmap1-production.up.railway.app';
const socket = io(SERVER, { transports: ['websocket'] });

let authToken = null;

const App = () => {
    const [user, setUser] = useState(null);
    const [authMode, setAuthMode] = useState('login');
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [loginError, setLoginError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const [view, setView] = useState('login');
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

    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatRoom] = useState('general');
    const chatEndRef = useRef(null);

    const [suspiciousUsers, setSuspiciousUsers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [activeAdminTab, setActiveAdminTab] = useState('logs');

    const sessionTimerRef = useRef(null);

    const handleLogout = useCallback(() => {
        authToken = null;
        setUser(null);
        setView('login');
        setAuthMode('login');
        setTrips([]);
        setStats(null);
        setChatMessages([]);
        if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
        console.log('Session expired or user logged out');
    }, []);

    const startSessionTimer = useCallback(() => {
        if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = setTimeout(() => {
            alert('Sesiunea a expirat. Te rugam sa te autentifici din nou.');
            handleLogout();
        }, 2 * 60 * 60 * 1000);
    }, [handleLogout]);

    const hasPermission = (perm) => {
        if (user?.role === 'admin') return true;
        return user?.permissions?.includes(perm);
    };

    const gqlFetch = useCallback(async (query, variables = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${SERVER}/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
        });
        const data = await res.json();
        if (data.errors && data.errors[0]?.message?.includes('jwt')) {
            handleLogout();
        }
        return data;
    }, [handleLogout]);

    const handleLogin = async () => {
        setLoginError('');
        setSuccessMessage('');
        try {
            const result = await fetch(`${SERVER}/graphql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `
                        mutation Login($username: String!, $password: String!) {
                            login(username: $username, password: $password) {
                                id username role permissions token isSuspicious
                            }
                        }
                    `,
                    variables: {
                        username: loginForm.username,
                        password: loginForm.password,
                    },
                }),
            });
            const data = await result.json();
            if (data.errors) { setLoginError('Invalid username or password'); return; }

            const loggedUser = data.data.login;
            authToken = loggedUser.token;
            setUser(loggedUser);
            setView('dashboard_main');
            startSessionTimer();
            socket.emit('joinRoom', { username: loggedUser.username, room: chatRoom });
        } catch {
            setLoginError('Connection error');
        }
    };

    const handleRegister = async () => {
        setLoginError('');
        setSuccessMessage('');
        if (loginForm.username.trim().length < 3) { setLoginError('Username must be at least 3 characters'); return; }
        if (loginForm.password.length < 4) { setLoginError('Password must be at least 4 characters'); return; }

        try {
            const res = await fetch(`${SERVER}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginForm.username.trim(), password: loginForm.password })
            });
            const data = await res.json();
            if (!res.ok) { setLoginError(data.error || 'Registration failed'); return; }

            authToken = data.token;
            setSuccessMessage('Account created! Logging in...');

            setTimeout(() => {
                setUser({ id: data.id, username: data.username, role: data.role, permissions: data.permissions || ['view_trips'] });
                setView('dashboard_main');
                startSessionTimer();
                socket.emit('joinRoom', { username: data.username, room: chatRoom });
            }, 1000);
        } catch {
            setLoginError('Server connection error');
        }
    };

    const loadChatHistory = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER}/api/chat/${chatRoom}`);
            if (res.ok) setChatMessages(await res.json());
        } catch { }
    }, [chatRoom]);

    const sendMessage = () => {
        if (!chatInput.trim() || !user) return;
        socket.emit('sendMessage', {
            username: user.username,
            role: user.role,
            text: chatInput.trim(),
            room: chatRoom,
        });
        setChatInput('');
    };

    useEffect(() => {
        socket.on('chatMessage', (msg) => setChatMessages(prev => [...prev, msg]));
        return () => socket.off('chatMessage');
    }, []);

    useEffect(() => {
        if (showChat) {
            loadChatHistory();
            if (user) socket.emit('joinRoom', { username: user.username, room: chatRoom });
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    }, [showChat, loadChatHistory, user, chatRoom]);

    useEffect(() => {
        if (chatMessages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const fetchGoldAdminData = useCallback(async () => {
        if (user?.role !== 'admin') return;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const [suspRes, logsRes] = await Promise.all([
                fetch(`${SERVER}/api/admin/suspicious`, { headers }),
                fetch(`${SERVER}/api/admin/audit-logs`, { headers })
            ]);
            if (suspRes.ok) setSuspiciousUsers(await suspRes.json());
            if (logsRes.ok) setAuditLogs(await logsRes.json());
        } catch { }
    }, [user]);

    const clearSuspicious = async (userId) => {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        await fetch(`${SERVER}/api/admin/suspicious/${userId}`, { method: 'DELETE', headers });
        setSuspiciousUsers(prev => prev.filter(u => u.id !== userId));
    };

    const fetchTrips = useCallback(async (isNextPage = false, targetPageManual = null, filterOverride = null) => {
        const targetPage = targetPageManual || (isNextPage ? page + 1 : page);
        const activeFilter = filterOverride !== null ? filterOverride : filter;

        const query = `
            query GetTrips($page: Int, $city: String, $minPrice: Float, $maxPrice: Float) {
                getTrips(page: $page, city: $city, minPrice: $minPrice, maxPrice: $maxPrice) {
                    total totalPages
                    data { id dest price days desc }
                }
            }
        `;
        const variables = {
            page: targetPage,
            city: activeFilter.city || null,
            minPrice: activeFilter.minPrice !== '' ? Number(activeFilter.minPrice) : null,
            maxPrice: activeFilter.maxPrice !== '' ? Number(activeFilter.maxPrice) : null,
        };

        try {
            if (isNextPage) setIsLoadingMore(true);
            const result = await gqlFetch(query, variables);
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
        if (method === 'DELETE') {
            if (!hasPermission('delete_trip')) return alert('No permission!');
            try {
                const result = await gqlFetch(
                    `mutation DeleteTrip($id: ID!) { deleteTrip(id: $id) }`,
                    { id: data.id }
                );
                if (result.errors) return alert(result.errors[0].message);
                setShowModal(false);
                fetchTrips(false, 1);
                fetchStats();
            } catch { setIsOnline(false); }
            return;
        }

        if (editingId && !hasPermission('edit_trip')) return alert('No permission!');
        if (!editingId && !hasPermission('create_trip')) return alert('No permission!');
        if (!data.dest || data.price <= 0) return alert('Invalid data!');

        try {
            let result;
            if (editingId) {
                result = await gqlFetch(
                    `mutation UpdateTrip($id: ID!, $dest: String!, $price: Float!, $days: Int!, $desc: String) {
                        updateTrip(id: $id, dest: $dest, price: $price, days: $days, desc: $desc) { id }
                    }`,
                    { id: editingId, dest: data.dest, price: Number(data.price), days: Number(data.days), desc: data.desc || '' }
                );
            } else {
                result = await gqlFetch(
                    `mutation AddTrip($dest: String!, $price: Float!, $days: Int!, $desc: String) {
                        addTrip(dest: $dest, price: $price, days: $days, desc: $desc) { id }
                    }`,
                    { dest: data.dest, price: Number(data.price), days: Number(data.days), desc: data.desc || '' }
                );
            }
            if (result.errors) return alert(result.errors[0].message);
            setShowModal(false);
            fetchTrips(false, 1);
            fetchStats();
        } catch { setIsOnline(false); }
    };

    // ─── VIEW: LOGIN ───
    if (view === 'login') return (
        <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', padding: '20px', boxSizing: 'border-box' }}>
            <div style={{ background: '#161625', padding: '30px 20px', borderRadius: '12px', border: '1px solid cyan', textAlign: 'center', width: '100%', maxWidth: '360px', boxSizing: 'border-box' }}>
                <h2 style={{ color: 'cyan', marginBottom: '8px' }}>Trip Planner Engine</h2>
                <p style={{ color: '#555', marginBottom: '24px', fontSize: '0.85rem' }}>
                    v4.0 Bronze — {authMode === 'login' ? 'Secure Login' : 'Create Account'}
                </p>
                <input value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                    placeholder="Username"
                    style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                <input type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())}
                    placeholder="Password"
                    style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                {loginError && <p style={{ color: '#ff4d4d', marginBottom: '10px', fontSize: '0.85rem' }}>{loginError}</p>}
                {successMessage && <p style={{ color: '#00ff88', marginBottom: '10px', fontSize: '0.85rem' }}>{successMessage}</p>}
                {authMode === 'login'
                    ? <button onClick={handleLogin} style={{ width: '100%', padding: '12px', background: 'cyan', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', color: 'black' }}>LOGIN</button>
                    : <button onClick={handleRegister} style={{ width: '100%', padding: '12px', background: '#00ff88', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', color: 'black' }}>REGISTER</button>
                }
                <div style={{ marginTop: '15px' }}>
                    <span onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setLoginError(''); setSuccessMessage(''); }}
                        style={{ color: 'cyan', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}>
                        {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
                    </span>
                </div>
                {authMode === 'login' && (
                    <div style={{ marginTop: '20px', padding: '12px', background: '#0a0a12', borderRadius: '8px', textAlign: 'left' }}>
                        <p style={{ color: '#555', fontSize: '0.75rem', margin: '0 0 6px 0' }}>Test accounts:</p>
                        <p style={{ color: '#00ff88', fontSize: '0.75rem', margin: '2px 0' }}>admin / admin123 → Full access</p>
                        <p style={{ color: '#aaa', fontSize: '0.75rem', margin: '2px 0' }}>user1 / user123 → View only</p>
                    </div>
                )}
            </div>
        </div>
    );

    // ─── VIEW: DASHBOARD ───
    if (view === 'dashboard_main') return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', color: 'white', padding: '20px', boxSizing: 'border-box' }}>
            {/* Injectare stiluri dinamice pentru clasa responsive-container */}
            <style>{`
                .dashboard-cards {
                    display: flex;
                    gap: 20px;
                    width: 100%;
                    max-width: 700px;
                    justify-content: center;
                }
                .dashboard-card {
                    padding: 30px 20px;
                    background: #161625;
                    border-radius: 20px;
                    cursor: pointer;
                    text-align: center;
                    flex: 1;
                    box-sizing: border-box;
                    transition: transform 0.2s;
                }
                .dashboard-card:hover { transform: scale(1.02); }
                .card-manager { border: 2px solid cyan; }
                .card-security { border: 2px solid #ff4d4d; background: #25161c !important; }
                .user-info-text { text-align: center; color: #555; margin-bottom: 20px; line-height: 1.5; }
                
                @media (max-width: 768px) {
                    .dashboard-cards {
                        flex-direction: column;
                        align-items: center;
                    }
                    .dashboard-card {
                        width: 100%;
                        max-width: 340px;
                    }
                }
            `}</style>

            <p className="user-info-text">
                Logged in as <span style={{ color: 'cyan' }}>{user?.username}</span><br />
                Role: <span style={{ color: user?.role === 'admin' ? '#ff4d4d' : '#00ff88' }}>{user?.role}</span><br />
                <span style={{ color: '#444', fontSize: '0.75rem' }}>● Session expires in 2h</span>
            </p>

            <div className="dashboard-cards">
                <div onClick={() => setView('trip_planner')} className="dashboard-card card-manager">
                    <h2 style={{ color: 'cyan', margin: 0, fontSize: '1.3rem' }}>TRIP MANAGER</h2>
                    <p style={{ color: '#aaa', marginTop: '10px', fontSize: '0.85rem' }}>Console & Planning Engine</p>
                </div>
                {user?.role === 'admin' && (
                    <div onClick={() => { setView('admin_panel'); fetchGoldAdminData(); }} className="dashboard-card card-security">
                        <h2 style={{ color: '#ff4d4d', margin: 0, fontSize: '1.3rem' }}>SECURITY PANEL</h2>
                        <p style={{ color: '#aaa', marginTop: '10px', fontSize: '0.85rem' }}>Audit Logs & Monitor</p>
                    </div>
                )}
            </div>

            <button onClick={handleLogout}
                style={{ background: '#222', color: '#ff4d4d', border: '1px solid #333', padding: '12px 30px', borderRadius: '4px', cursor: 'pointer', marginTop: '30px', fontWeight: 'bold' }}>
                LOGOUT
            </button>
        </div>
    );

    // ─── VIEW: ADMIN PANEL ───
    if (view === 'admin_panel') return (
        <div style={{ padding: '20px', background: '#0a0a12', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
            <style>{`
                .admin-header { display: flex; justify-content: space-between; alignItems: center; border-bottom: 1px solid #ff4d4d; padding-bottom: 15px; margin-bottom: 20px; gap: 15px; }
                .admin-stats { display: flex; gap: 15px; margin-bottom: 20px; }
                @media (max-width: 600px) {
                    .admin-header { flex-direction: column; text-align: center; }
                    .admin-stats { flex-direction: column; }
                }
            `}</style>
            <div className="admin-header">
                <h1 style={{ margin: 0, color: '#ff4d4d', fontSize: '1.6rem' }}>Security Console</h1>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={fetchGoldAdminData} style={{ background: '#222', color: '#aaa', border: 'none', padding: '8px 15px', cursor: 'pointer', borderRadius: '4px' }}>REFRESH</button>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 15px', cursor: 'pointer', borderRadius: '4px' }}>BACK</button>
                </div>
            </div>

            <div className="admin-stats">
                <div style={{ background: '#1c1618', padding: '15px 20px', borderRadius: '8px', border: '1px solid #ff4d4d', flex: 1, textAlign: 'center' }}>
                    <div style={{ color: '#ff4d4d', fontSize: '2rem', fontWeight: 'bold' }}>{suspiciousUsers.length}</div>
                    <div style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '4px' }}>Suspicious Accounts</div>
                </div>
                <div style={{ background: '#161c18', padding: '15px 20px', borderRadius: '8px', border: '1px solid #00ff88', flex: 1, textAlign: 'center' }}>
                    <div style={{ color: '#00ff88', fontSize: '2rem', fontWeight: 'bold' }}>{auditLogs.length}</div>
                    <div style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '4px' }}>Audit Log Entries</div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button onClick={() => setActiveAdminTab('logs')} style={{ padding: '10px 15px', background: activeAdminTab === 'logs' ? '#ff4d4d' : '#161625', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>AUDIT LOGS</button>
                <button onClick={() => setActiveAdminTab('suspicious')} style={{ padding: '10px 15px', background: activeAdminTab === 'suspicious' ? '#ff4d4d' : '#161625', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>SUSPICIOUS ({suspiciousUsers.length})</button>
            </div>

            <div style={{ background: '#161625', padding: '15px', borderRadius: '12px', border: '1px solid #333', overflowX: 'auto' }}>
                {activeAdminTab === 'logs' ? (
                    <div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                            <thead>
                                <tr style={{ color: '#ff4d4d', borderBottom: '1px solid #333' }}>
                                    <th style={{ padding: '8px' }}>USER</th>
                                    <th>ROLE</th>
                                    <th>ACTION</th>
                                    <th>TIMESTAMP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditLogs.length === 0 ? (
                                    <tr><td colSpan="4" style={{ padding: '20px', color: '#555', textAlign: 'center' }}>No audit logs yet.</td></tr>
                                ) : auditLogs.map(log => (
                                    <tr key={log.id} style={{ borderBottom: '1px solid #222' }}>
                                        <td style={{ padding: '8px', color: 'cyan', fontWeight: 'bold' }}>{log.userId}</td>
                                        <td><span style={{ color: log.role === 'admin' ? '#ff4d4d' : '#00ff88', fontSize: '0.8rem' }}>{log.role}</span></td>
                                        <td style={{ color: '#ddd' }}>{log.action}</td>
                                        <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(log.timestamp).toLocaleTimeString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div>
                        {suspiciousUsers.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>No suspicious users detected.</div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '15px' }}>
                                {suspiciousUsers.map(sus => (
                                    <div key={sus.id} style={{ background: '#1c1618', border: '1px solid #ff4d4d', padding: '15px', borderRadius: '8px' }}>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white' }}>{sus.username}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#666', margin: '5px 0 10px' }}>Flagged: {new Date(sus.updatedAt).toLocaleDateString()}</div>
                                        <button onClick={() => clearSuspicious(sus.id)} style={{ background: 'none', border: '1px solid #00ff88', color: '#00ff88', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Clear Flag</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // ─── VIEW: TRIP PLANNER ───
    return (
        <div style={{ padding: '15px', background: '#0a0a12', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
            <style>{`
                .planner-nav { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
                .planner-stats-grid { display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; }
                .filter-bar { display: flex; gap: 10px; margin-bottom: 15px; background: #161625; padding: 12px; borderRadius: 8px; flex-wrap: wrap; }
                .filter-bar input { flex: 1; min-width: 120px; padding: 8px; background: #0a0a12; border: 1px solid #333; color: white; border-radius: 4px; }
                .main-layout { display: flex; gap: 20px; min-height: 400px; }
                .chart-container-box { flex: 1; background: #161625; padding: 20px; borderRadius: 12px; display: flex; flex-direction: column; }
                
                @media (max-width: 850px) {
                    .main-layout { flex-direction: column; }
                    .planner-nav { flex-direction: column; text-align: center; }
                    .filter-bar input { width: 100%; flex: none; }
                }
            `}</style>

            <div className="planner-nav">
                <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Trip<span style={{ color: 'cyan' }}>Planner</span></h1>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span style={{ color: '#aaa', fontSize: '0.85rem' }}>
                        👤 <span style={{ color: 'cyan' }}>{user?.username}</span>
                    </span>
                    <button onClick={() => setShowChat(!showChat)} style={{ background: '#161625', color: 'cyan', border: '1px solid cyan', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem' }}>Chat</button>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '6px 12px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem' }}>BACK</button>
                </div>
            </div>

            {stats && (
                <div className="planner-stats-grid">
                    {[{ label: 'Total Trips', value: stats.totalTrips }, { label: 'Avg Price', value: `$${Math.round(stats.avgPrice)}` }, { label: 'Max Price', value: `$${stats.maxPrice}` }].map(s => (
                        <div key={s.label} style={{ background: '#161625', padding: '10px', borderRadius: '8px', border: '1px solid #333', textAlign: 'center', flex: '1 1 100px' }}>
                            <div style={{ color: 'cyan', fontSize: '1.2rem', fontWeight: 'bold' }}>{s.value}</div>
                            <div style={{ color: '#555', fontSize: '0.75rem' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {hasPermission('create_trip') && (
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <button onClick={async () => {
                        const action = isGenerating ? 'stop' : 'start';
                        await gqlFetch(`mutation ToggleGen($action: String!) { toggleGenerator(action: $action) }`, { action });
                        setIsGenerating(!isGenerating);
                    }} style={{ background: isGenerating ? '#ff4d4d' : '#00ff88', border: 'none', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem' }}>
                        {isGenerating ? 'STOP GENERATOR' : 'START LIVE DATA GENERATOR'}
                    </button>
                </div>
            )}

            <div className="filter-bar">
                <input value={filter.city} onChange={e => setFilter({ ...filter, city: e.target.value })} placeholder="City..." />
                <input type="number" value={filter.minPrice} onChange={e => setFilter({ ...filter, minPrice: e.target.value })} placeholder="Min $" />
                <input type="number" value={filter.maxPrice} onChange={e => setFilter({ ...filter, maxPrice: e.target.value })} placeholder="Max $" />
                <div style={{ display: 'flex', gap: '5px', width: '100%', justifyContent: 'flex-end', marginTop: '5px' }}>
                    <button onClick={() => fetchTrips(false, 1, filter)} style={{ padding: '8px 15px', background: 'cyan', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', color: 'black' }}>FILTER</button>
                    <button onClick={() => { const c = { city: '', minPrice: '', maxPrice: '' }; setFilter(c); fetchTrips(false, 1, c); }} style={{ padding: '8px 15px', background: '#333', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>CLEAR</button>
                </div>
            </div>

            <div className="main-layout">
                {/* Partea Stângă: Listă călătorii */}
                <div style={{ flex: 2, background: '#161625', padding: '15px', borderRadius: '12px', overflowY: 'auto', maxHeight: '60vh' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: 'cyan' }}>Available Trips</h3>
                    {trips.length === 0 ? (
                        <p style={{ color: '#555' }}>No trips found.</p>
                    ) : (
                        trips.map(t => (
                            <div key={t.id} style={{ padding: '12px', background: '#0a0a12', borderRadius: '8px', marginBottom: '10px', border: '1px solid #222' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <b style={{ color: 'white' }}>{t.dest}</b>
                                    <span style={{ color: '#00ff88' }}>${t.price}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: '4px' }}>{t.days} Days — {t.desc}</div>
                            </div>
                        ))
                    )}
                    <div ref={loaderRef} style={{ height: '20px', textAlign: 'center', color: '#444', fontSize: '0.8rem' }}>
                        {isLoadingMore ? 'Loading more...' : ''}
                    </div>
                </div>

                {/* Partea Dreaptă: Grafic Recharts */}
                <div className="chart-container-box">
                    <h3 style={{ margin: '0 0 15px 0', color: 'cyan' }}>Analytics</h3>
                    <div style={{ width: '100%', flex: 1, minHeight: '200px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trips.slice(0, 8)}>
                                <XAxis dataKey="dest" stroke="#555" tick={{ fontSize: 10 }} />
                                <YAxis stroke="#555" tick={{ fontSize: 10 }} />
                                <Tooltip contentStyle={{ background: '#161625', border: '1px solid #333' }} />
                                <Bar dataKey="price" fill="cyan" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;