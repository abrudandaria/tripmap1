import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'https://tripmap1.onrender.com';
const socket = io(SERVER, { transports: ['websocket'] });

let authToken = null;

// ─── RESPONSIVE HOOK ───
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 640);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);
    return isMobile;
};

// ─── GLOBAL STYLES ───
const globalStyle = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080810; font-family: 'Courier New', monospace; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0a0a12; }
    ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
    input, textarea, button { font-family: inherit; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .fade-in { animation: fadeIn 0.3s ease forwards; }
`;

const App = () => {
    const isMobile = useIsMobile();
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
            method: 'POST', headers,
            body: JSON.stringify({ query, variables }),
        });
        const data = await res.json();
        if (data.errors && data.errors[0]?.message?.includes('jwt')) handleLogout();
        return data;
    }, [handleLogout]);

    const handleLogin = async () => {
        setLoginError(''); setSuccessMessage('');
        try {
            const result = await fetch(`${SERVER}/graphql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { id username role permissions token isSuspicious } }`,
                    variables: { username: loginForm.username, password: loginForm.password },
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
        } catch { setLoginError('Connection error'); }
    };

    const handleRegister = async () => {
        setLoginError(''); setSuccessMessage('');
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
        } catch { setLoginError('Server connection error'); }
    };

    const loadChatHistory = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER}/api/chat/${chatRoom}`);
            if (res.ok) setChatMessages(await res.json());
        } catch { }
    }, [chatRoom]);

    const sendMessage = () => {
        if (!chatInput.trim() || !user) return;
        socket.emit('sendMessage', { username: user.username, role: user.role, text: chatInput.trim(), room: chatRoom });
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
        const query = `query GetTrips($page: Int, $city: String, $minPrice: Float, $maxPrice: Float) { getTrips(page: $page, city: $city, minPrice: $minPrice, maxPrice: $maxPrice) { total totalPages data { id dest price days desc } } }`;
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
                const result = await gqlFetch(`mutation DeleteTrip($id: ID!) { deleteTrip(id: $id) }`, { id: data.id });
                if (result.errors) return alert(result.errors[0].message);
                setShowModal(false); fetchTrips(false, 1); fetchStats();
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
                    `mutation UpdateTrip($id: ID!, $dest: String!, $price: Float!, $days: Int!, $desc: String) { updateTrip(id: $id, dest: $dest, price: $price, days: $days, desc: $desc) { id } }`,
                    { id: editingId, dest: data.dest, price: Number(data.price), days: Number(data.days), desc: data.desc || '' }
                );
            } else {
                result = await gqlFetch(
                    `mutation AddTrip($dest: String!, $price: Float!, $days: Int!, $desc: String) { addTrip(dest: $dest, price: $price, days: $days, desc: $desc) { id } }`,
                    { dest: data.dest, price: Number(data.price), days: Number(data.days), desc: data.desc || '' }
                );
            }
            if (result.errors) return alert(result.errors[0].message);
            setShowModal(false); fetchTrips(false, 1); fetchStats();
        } catch { setIsOnline(false); }
    };

    // ─── SHARED STYLES ───
    const inputStyle = {
        width: '100%', padding: '12px 14px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'white', borderRadius: '8px',
        fontSize: '0.9rem', outline: 'none',
        transition: 'border-color 0.2s',
    };

    const btnPrimary = {
        width: '100%', padding: '13px',
        background: 'linear-gradient(135deg, #00e5ff, #00b4d8)',
        border: 'none', borderRadius: '8px',
        fontWeight: '700', cursor: 'pointer',
        color: '#000', fontSize: '0.9rem',
        letterSpacing: '0.05em',
        transition: 'opacity 0.2s',
    };

    // ─── VIEW: LOGIN ───
    if (view === 'login') return (
        <>
            <style>{globalStyle}</style>
            <div style={{
                minHeight: '100vh', display: 'flex',
                justifyContent: 'center', alignItems: 'center',
                background: 'radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #080810 60%)',
                padding: '20px',
            }}>
                {/* Decorative grid lines */}
                <div style={{ position: 'fixed', inset: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.03) 1px, transparent 1px)', backgroundSize: '40px 40px', pointerEvents: 'none' }} />

                <div className="fade-in" style={{
                    background: 'rgba(255,255,255,0.03)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(0,229,255,0.2)',
                    borderRadius: '16px', padding: isMobile ? '28px 20px' : '40px',
                    width: '100%', maxWidth: '400px',
                    boxShadow: '0 0 60px rgba(0,229,255,0.08)',
                }}>
                    {/* Logo */}
                    <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                        <div style={{ fontSize: isMobile ? '1.6rem' : '1.9rem', fontWeight: '900', letterSpacing: '-0.02em', color: 'white' }}>
                            TRIP<span style={{ color: '#00e5ff' }}>PLANNER</span>
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', marginTop: '4px', letterSpacing: '0.15em' }}>
                            v4.0 BRONZE · {authMode === 'login' ? 'SECURE LOGIN' : 'CREATE ACCOUNT'}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                        <input
                            value={loginForm.username}
                            onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                            placeholder="Username"
                            style={inputStyle}
                        />
                        <input
                            type="password"
                            value={loginForm.password}
                            onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())}
                            placeholder="Password"
                            style={inputStyle}
                        />
                    </div>

                    {loginError && (
                        <div style={{ background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)', color: '#ff6b6b', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', marginBottom: '14px' }}>
                            {loginError}
                        </div>
                    )}
                    {successMessage && (
                        <div style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', marginBottom: '14px' }}>
                            {successMessage}
                        </div>
                    )}

                    {authMode === 'login'
                        ? <button onClick={handleLogin} style={btnPrimary}>LOGIN</button>
                        : <button onClick={handleRegister} style={{ ...btnPrimary, background: 'linear-gradient(135deg, #00ff88, #00c96e)' }}>REGISTER</button>
                    }

                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                        <span
                            onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setLoginError(''); setSuccessMessage(''); }}
                            style={{ color: '#00e5ff', fontSize: '0.82rem', cursor: 'pointer', opacity: 0.8 }}
                        >
                            {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
                        </span>
                    </div>

                    {authMode === 'login' && (
                        <div style={{ marginTop: '20px', padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', marginBottom: '6px', letterSpacing: '0.1em' }}>TEST ACCOUNTS</div>
                            <div style={{ color: '#00ff88', fontSize: '0.78rem', marginBottom: '3px' }}>admin / admin123 → Full access</div>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>user1 / user123 → View only</div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    // ─── VIEW: DASHBOARD ───
    if (view === 'dashboard_main') return (
        <>
            <style>{globalStyle}</style>
            <div style={{
                minHeight: '100vh',
                background: 'radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #080810 60%)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '20px',
            }}>
                <div style={{ position: 'fixed', inset: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.03) 1px, transparent 1px)', backgroundSize: '40px 40px', pointerEvents: 'none' }} />

                <div className="fade-in" style={{ width: '100%', maxWidth: '560px' }}>
                    {/* Header */}
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                        <div style={{ fontSize: isMobile ? '1.8rem' : '2.2rem', fontWeight: '900', color: 'white', letterSpacing: '-0.02em' }}>
                            TRIP<span style={{ color: '#00e5ff' }}>PLANNER</span>
                        </div>
                        <div style={{ marginTop: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem' }}>
                            Logged in as{' '}
                            <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>{user?.username}</span>
                            {' '}&mdash; Role:{' '}
                            <span style={{
                                color: user?.role === 'admin' ? '#ff4d4d' : '#00ff88',
                                background: user?.role === 'admin' ? 'rgba(255,77,77,0.1)' : 'rgba(0,255,136,0.1)',
                                padding: '1px 8px', borderRadius: '4px', fontSize: '0.75rem',
                            }}>
                                {user?.role}
                            </span>
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem', marginTop: '4px' }}>
                            ● Session expires in 2h
                        </div>
                    </div>

                    {/* Cards */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: user?.role === 'admin' ? (isMobile ? '1fr' : '1fr 1fr') : '1fr',
                        gap: '14px',
                        marginBottom: '20px',
                    }}>
                        {/* Trip Manager card */}
                        <div
                            onClick={() => setView('trip_planner')}
                            style={{
                                padding: isMobile ? '24px 20px' : '32px 28px',
                                background: 'rgba(0,229,255,0.05)',
                                border: '1px solid rgba(0,229,255,0.25)',
                                borderRadius: '16px', cursor: 'pointer',
                                transition: 'all 0.2s',
                                textAlign: 'center',
                            }}
                        >
                            <div style={{ fontSize: isMobile ? '2rem' : '2.4rem', marginBottom: '10px' }}>✈️</div>
                            <div style={{ color: '#00e5ff', fontWeight: '800', fontSize: isMobile ? '1.1rem' : '1.2rem', letterSpacing: '0.05em' }}>
                                TRIP MANAGER
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', marginTop: '6px' }}>
                                Console & Planning Engine
                            </div>
                        </div>

                        {/* Security Panel card (admin only) */}
                        {user?.role === 'admin' && (
                            <div
                                onClick={() => { setView('admin_panel'); fetchGoldAdminData(); }}
                                style={{
                                    padding: isMobile ? '24px 20px' : '32px 28px',
                                    background: 'rgba(255,77,77,0.05)',
                                    border: '1px solid rgba(255,77,77,0.25)',
                                    borderRadius: '16px', cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    textAlign: 'center',
                                }}
                            >
                                <div style={{ fontSize: isMobile ? '2rem' : '2.4rem', marginBottom: '10px' }}>🛡️</div>
                                <div style={{ color: '#ff4d4d', fontWeight: '800', fontSize: isMobile ? '1.1rem' : '1.2rem', letterSpacing: '0.05em' }}>
                                    SECURITY PANEL
                                </div>
                                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', marginTop: '6px' }}>
                                    Audit Logs & Intrusion Monitor
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleLogout}
                        style={{
                            width: '100%', padding: '12px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'rgba(255,255,255,0.5)', borderRadius: '8px',
                            cursor: 'pointer', fontSize: '0.82rem', letterSpacing: '0.1em',
                        }}
                    >
                        LOGOUT
                    </button>
                </div>
            </div>
        </>
    );

    // ─── VIEW: ADMIN PANEL ───
    if (view === 'admin_panel') return (
        <>
            <style>{globalStyle}</style>
            <div style={{ padding: isMobile ? '14px' : '20px', background: '#080810', color: 'white', minHeight: '100vh' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,77,77,0.3)', paddingBottom: '14px', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
                    <h1 style={{ color: '#ff4d4d', fontSize: isMobile ? '1.1rem' : '1.4rem', fontWeight: '800', letterSpacing: '0.05em' }}>
                        🛡️ Security & Audit Console
                    </h1>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={fetchGoldAdminData} style={{ background: 'rgba(255,255,255,0.06)', color: '#aaa', border: '1px solid rgba(255,255,255,0.1)', padding: isMobile ? '8px 12px' : '8px 16px', cursor: 'pointer', borderRadius: '8px', fontSize: '0.8rem' }}>
                            REFRESH
                        </button>
                        <button onClick={() => setView('dashboard_main')} style={{ background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: isMobile ? '8px 12px' : '8px 16px', cursor: 'pointer', borderRadius: '8px', fontSize: '0.8rem' }}>
                            ← BACK
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
                    <div style={{ background: 'rgba(255,77,77,0.08)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,77,77,0.2)', textAlign: 'center' }}>
                        <div style={{ color: '#ff4d4d', fontSize: '2rem', fontWeight: '800' }}>{suspiciousUsers.length}</div>
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', marginTop: '4px' }}>Suspicious Accounts</div>
                    </div>
                    <div style={{ background: 'rgba(0,255,136,0.08)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(0,255,136,0.2)', textAlign: 'center' }}>
                        <div style={{ color: '#00ff88', fontSize: '2rem', fontWeight: '800' }}>{auditLogs.length}</div>
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', marginTop: '4px' }}>Audit Log Entries</div>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                    {[['logs', 'AUDIT LOGS'], ['suspicious', `SUSPICIOUS (${suspiciousUsers.length})`]].map(([key, label]) => (
                        <button key={key} onClick={() => setActiveAdminTab(key)} style={{
                            padding: isMobile ? '9px 14px' : '10px 20px',
                            background: activeAdminTab === key ? '#ff4d4d' : 'rgba(255,255,255,0.04)',
                            color: 'white', border: `1px solid ${activeAdminTab === key ? '#ff4d4d' : 'rgba(255,255,255,0.1)'}`,
                            borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem', letterSpacing: '0.05em',
                        }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: isMobile ? '14px' : '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', minHeight: '400px' }}>
                    {activeAdminTab === 'logs' ? (
                        <div>
                            <h3 style={{ color: '#ff4d4d', marginBottom: '14px', fontSize: '0.9rem', letterSpacing: '0.05em' }}>LIVE AUDIT TRAILS</h3>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? '0.75rem' : '0.85rem' }}>
                                    <thead>
                                        <tr style={{ color: 'rgba(255,77,77,0.8)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                            <th style={{ padding: '8px', textAlign: 'left', whiteSpace: 'nowrap' }}>USER</th>
                                            <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>ROLE</th>
                                            <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>ACTION</th>
                                            <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>TIME</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditLogs.length === 0
                                            ? <tr><td colSpan="4" style={{ padding: '30px', color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>No audit logs yet.</td></tr>
                                            : auditLogs.map(log => (
                                                <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                    <td style={{ padding: '10px 8px', color: '#00e5ff', fontWeight: 'bold' }}>{log.userId}</td>
                                                    <td><span style={{ color: log.role === 'admin' ? '#ff4d4d' : '#00ff88', fontSize: '0.72rem', background: log.role === 'admin' ? 'rgba(255,77,77,0.1)' : 'rgba(0,255,136,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{log.role}</span></td>
                                                    <td style={{ color: 'rgba(255,255,255,0.8)' }}>{log.action}</td>
                                                    <td style={{ color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleString()}</td>
                                                </tr>
                                            ))
                                        }
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <h3 style={{ color: '#ff4d4d', marginBottom: '14px', fontSize: '0.9rem', letterSpacing: '0.05em' }}>STEALTH DETECTOR</h3>
                            {suspiciousUsers.length === 0
                                ? <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>No suspicious users detected.</div>
                                : (
                                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                                        {suspiciousUsers.map(sus => (
                                            <div key={sus.id} style={{ background: 'rgba(255,77,77,0.06)', border: '1px solid rgba(255,77,77,0.2)', padding: '14px', borderRadius: '10px' }}>
                                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>ID: {sus.id}</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white', margin: '5px 0' }}>{sus.username}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>
                                                    Flagged: {new Date(sus.updatedAt).toLocaleString()}
                                                </div>
                                                <button onClick={() => clearSuspicious(sus.id)} style={{ background: 'none', border: '1px solid rgba(0,255,136,0.4)', color: '#00ff88', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>
                                                    Clear Flag
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )
                            }
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    // ─── VIEW: TRIP PLANNER ───
    return (
        <>
            <style>{globalStyle}</style>
            <div style={{ padding: isMobile ? '12px' : '20px', background: '#080810', color: 'white', minHeight: '100vh' }}>

                {/* Navbar */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '12px', marginBottom: '16px',
                    flexWrap: 'wrap', gap: '10px',
                }}>
                    <div style={{ fontWeight: '900', fontSize: isMobile ? '1.1rem' : '1.3rem', letterSpacing: '-0.02em' }}>
                        TRIP<span style={{ color: '#00e5ff' }}>PLANNER</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Online status */}
                        <span style={{ color: isOnline ? '#00ff88' : '#ff4d4d', fontSize: '0.75rem', fontWeight: 'bold', animation: !isOnline ? 'pulse 1.5s infinite' : 'none' }}>
                            {isOnline ? '● LIVE' : '● OFFLINE'}
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>
                            {user?.username} <span style={{ color: user?.role === 'admin' ? '#ff4d4d' : '#00ff88' }}>[{user?.role}]</span>
                        </span>
                        {user?.role === 'admin' && (
                            <button onClick={() => { setView('admin_panel'); fetchGoldAdminData(); }}
                                style={{ background: 'rgba(255,77,77,0.1)', color: '#ff4d4d', border: '1px solid rgba(255,77,77,0.3)', padding: '6px 12px', cursor: 'pointer', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                🛡️{!isMobile && ' SECURITY'}
                            </button>
                        )}
                        <button onClick={() => setShowChat(!showChat)}
                            style={{ background: showChat ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)', color: '#00e5ff', border: '1px solid rgba(0,229,255,0.3)', padding: '6px 12px', cursor: 'pointer', borderRadius: '6px', fontSize: '0.75rem' }}>
                            💬 Chat
                        </button>
                        <button onClick={() => setView('dashboard_main')}
                            style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', cursor: 'pointer', borderRadius: '6px', fontSize: '0.75rem' }}>
                            ← Home
                        </button>
                    </div>
                </div>

                {/* Stats */}
                {stats && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' }}>
                        {[{ label: 'Total', value: stats.totalTrips }, { label: 'Avg', value: `$${Math.round(stats.avgPrice)}` }, { label: 'Max', value: `$${stats.maxPrice}` }].map(s => (
                            <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', padding: isMobile ? '10px 8px' : '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                                <div style={{ color: '#00e5ff', fontSize: isMobile ? '1.2rem' : '1.5rem', fontWeight: '800' }}>{s.value}</div>
                                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem', marginTop: '2px' }}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Generator toggle */}
                {hasPermission('create_trip') && (
                    <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                        <button onClick={async () => {
                            const action = isGenerating ? 'stop' : 'start';
                            await gqlFetch(`mutation ToggleGen($action: String!) { toggleGenerator(action: $action) }`, { action });
                            setIsGenerating(!isGenerating);
                        }} style={{
                            background: isGenerating ? 'rgba(255,77,77,0.15)' : 'rgba(0,255,136,0.15)',
                            border: `1px solid ${isGenerating ? 'rgba(255,77,77,0.4)' : 'rgba(0,255,136,0.4)'}`,
                            color: isGenerating ? '#ff4d4d' : '#00ff88',
                            padding: '9px 24px', borderRadius: '20px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem', letterSpacing: '0.05em',
                        }}>
                            {isGenerating ? '⏹ STOP GENERATOR' : '▶ START LIVE DATA GENERATOR'}
                        </button>
                    </div>
                )}

                {/* Filters */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <input value={filter.city} onChange={e => setFilter({ ...filter, city: e.target.value })} placeholder="Filter by city..."
                        style={{ ...inputStyle, flex: '2 1 140px', padding: '9px 12px' }} />
                    <input type="number" value={filter.minPrice} onChange={e => setFilter({ ...filter, minPrice: e.target.value })} placeholder="Min $"
                        style={{ ...inputStyle, flex: '1 1 70px', padding: '9px 12px' }} />
                    <input type="number" value={filter.maxPrice} onChange={e => setFilter({ ...filter, maxPrice: e.target.value })} placeholder="Max $"
                        style={{ ...inputStyle, flex: '1 1 70px', padding: '9px 12px' }} />
                    <button onClick={() => fetchTrips(false, 1, filter)} style={{ padding: '9px 16px', background: 'linear-gradient(135deg, #00e5ff, #00b4d8)', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }}>
                        GO
                    </button>
                    <button onClick={() => { const c = { city: '', minPrice: '', maxPrice: '' }; setFilter(c); fetchTrips(false, 1, c); }} style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.82rem' }}>
                        ✕
                    </button>
                </div>

                {/* Main layout — stacked on mobile, side-by-side on desktop */}
                <div style={{ display: 'flex', gap: '16px', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 'calc(100vh - 320px)' }}>

                    {/* Trips Table */}
                    <div style={{ flex: 2, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', minHeight: isMobile ? '360px' : 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <h3 style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em' }}>
                                DESTINATIONS — page {page}/{totalPages}
                            </h3>
                            {hasPermission('create_trip') && (
                                <button onClick={() => { setEditingId(null); setFormData({ dest: '', price: '', days: '', desc: '' }); setShowModal(true); }}
                                    style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.3)', color: '#00e5ff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem' }}>
                                    + NEW
                                </button>
                            )}
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? '0.78rem' : '0.85rem' }}>
                                <thead style={{ position: 'sticky', top: 0, background: '#0e0e1a', zIndex: 1 }}>
                                    <tr style={{ color: 'rgba(0,229,255,0.7)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                        <th style={{ padding: '10px 14px' }}>City</th>
                                        <th style={{ padding: '10px 8px' }}>Days</th>
                                        <th style={{ padding: '10px 8px' }}>Price</th>
                                        <th style={{ padding: '10px 8px' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trips.map(t => (
                                        <tr key={t.id} onClick={() => setSelectedTrip(t)} style={{
                                            borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
                                            background: selectedTrip?.id === t.id ? 'rgba(0,229,255,0.05)' : 'transparent',
                                        }}>
                                            <td style={{ padding: '10px 14px', fontWeight: '600' }}>{t.dest}</td>
                                            <td style={{ padding: '10px 8px', color: 'rgba(255,255,255,0.5)' }}>{t.days}d</td>
                                            <td style={{ padding: '10px 8px', color: '#00ff88', fontWeight: 'bold' }}>${t.price}</td>
                                            <td style={{ padding: '10px 8px' }}>
                                                {hasPermission('edit_trip') && (
                                                    <button onClick={e => { e.stopPropagation(); setEditingId(t.id); setFormData(t); setShowModal(true); }}
                                                        style={{ background: 'none', border: 'none', color: 'orange', cursor: 'pointer', marginRight: '8px', fontSize: '0.75rem' }}>Edit</button>
                                                )}
                                                {hasPermission('delete_trip') && (
                                                    <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete ${t.dest}?`)) handleAction('DELETE', { id: t.id }); }}
                                                        style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer', fontSize: '0.75rem' }}>Del</button>
                                                )}
                                                {!hasPermission('edit_trip') && !hasPermission('delete_trip') && (
                                                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem' }}>view</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div ref={loaderRef} style={{ padding: '12px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>
                                {isLoadingMore ? 'Loading...' : (page >= totalPages ? '— end —' : 'scroll for more')}
                            </div>
                        </div>
                        {/* Pagination */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', padding: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                            <button disabled={page === 1} onClick={() => fetchTrips(false, page - 1)} style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', borderRadius: '4px', fontSize: '0.75rem' }}>←</button>
                            {Array.from({ length: Math.min(totalPages, isMobile ? 3 : 5) }, (_, i) => (
                                <button key={i} onClick={() => fetchTrips(false, i + 1)} style={{ padding: '5px 10px', background: page === i + 1 ? '#00e5ff' : 'rgba(255,255,255,0.06)', color: page === i + 1 ? 'black' : 'white', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', borderRadius: '4px', fontSize: '0.75rem', fontWeight: page === i + 1 ? 'bold' : 'normal' }}>{i + 1}</button>
                            ))}
                            <button disabled={page === totalPages} onClick={() => fetchTrips(false, page + 1)} style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', borderRadius: '4px', fontSize: '0.75rem' }}>→</button>
                        </div>
                    </div>

                    {/* Right panel */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', minWidth: isMobile ? '100%' : '240px' }}>
                        {/* Chart */}
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)', height: isMobile ? '160px' : '180px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', marginBottom: '8px' }}>COST OVERVIEW</div>
                            <ResponsiveContainer width="100%" height="85%">
                                <BarChart data={trips.slice(-10)}>
                                    <XAxis dataKey="dest" hide />
                                    <YAxis hide />
                                    <Tooltip contentStyle={{ background: '#0e0e1a', border: '1px solid rgba(0,229,255,0.3)', fontSize: '0.75rem' }} />
                                    <Bar dataKey="price" fill="#00e5ff" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Trip detail */}
                        <div style={{ background: 'rgba(0,229,255,0.04)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(0,229,255,0.15)', flex: isMobile ? 'unset' : 1 }}>
                            <div style={{ fontSize: '0.72rem', color: 'rgba(0,229,255,0.6)', letterSpacing: '0.1em', marginBottom: '10px' }}>TRIP DETAILS</div>
                            {selectedTrip ? (
                                <div className="fade-in">
                                    <div style={{ fontSize: isMobile ? '1.3rem' : '1.5rem', fontWeight: '800', marginBottom: '8px' }}>{selectedTrip.dest}</div>
                                    <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: '1.6', fontSize: '0.82rem', marginBottom: '14px' }}>{selectedTrip.desc || 'No details available.'}</p>
                                    <div style={{ fontSize: '1.3rem', fontWeight: '800', color: '#00ff88' }}>${selectedTrip.price}</div>
                                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', marginTop: '4px' }}>{selectedTrip.days} days</div>
                                </div>
                            ) : (
                                <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.82rem' }}>← Select a destination</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Chat overlay */}
                {showChat && (
                    <div style={{
                        position: 'fixed',
                        bottom: isMobile ? 0 : '20px',
                        right: isMobile ? 0 : '20px',
                        width: isMobile ? '100%' : '340px',
                        height: isMobile ? '70vh' : '460px',
                        background: '#0e0e1a',
                        border: isMobile ? 'none' : '1px solid rgba(0,229,255,0.25)',
                        borderTop: '1px solid rgba(0,229,255,0.25)',
                        borderRadius: isMobile ? '16px 16px 0 0' : '12px',
                        display: 'flex', flexDirection: 'column', zIndex: 200,
                        boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
                    }}>
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ color: '#00e5ff', fontWeight: '700', fontSize: '0.85rem' }}>💬 Live Chat — #{chatRoom}</div>
                            <button onClick={() => setShowChat(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}>✕</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {chatMessages.map((msg, i) => (
                                <div key={i} style={{ alignSelf: msg.username === user?.username ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                                    {msg.username !== user?.username && (
                                        <div style={{ fontSize: '0.65rem', color: msg.role === 'admin' ? '#ff4d4d' : '#00ff88', marginBottom: '2px' }}>
                                            {msg.username} [{msg.role || 'user'}]
                                        </div>
                                    )}
                                    <div style={{
                                        background: msg.username === 'System' ? 'rgba(255,255,255,0.04)' : msg.username === user?.username ? 'linear-gradient(135deg, #00e5ff, #00b4d8)' : 'rgba(255,255,255,0.07)',
                                        color: msg.username === user?.username ? 'black' : msg.username === 'System' ? 'rgba(255,255,255,0.3)' : 'white',
                                        padding: '8px 12px', borderRadius: '10px', fontSize: '0.82rem',
                                        fontStyle: msg.username === 'System' ? 'italic' : 'normal',
                                    }}>{msg.text}</div>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px' }}>
                            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Type a message..."
                                style={{ ...inputStyle, flex: 1, padding: '9px 12px', fontSize: '0.82rem' }} />
                            <button onClick={sendMessage} style={{ background: 'linear-gradient(135deg, #00e5ff, #00b4d8)', border: 'none', padding: '9px 16px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', color: 'black', fontSize: '0.82rem' }}>
                                →
                            </button>
                        </div>
                    </div>
                )}

                {/* Add/Edit Modal */}
                {showModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'center', zIndex: 100 }}>
                        <div className="fade-in" style={{
                            background: '#0e0e1a',
                            border: '1px solid rgba(0,229,255,0.2)',
                            borderRadius: isMobile ? '16px 16px 0 0' : '14px',
                            padding: isMobile ? '24px 20px 32px' : '28px',
                            width: isMobile ? '100%' : '400px',
                        }}>
                            <h3 style={{ color: '#00e5ff', marginBottom: '18px', fontSize: '0.9rem', letterSpacing: '0.05em' }}>
                                {editingId ? 'MODIFY' : 'CREATE'} TRIP
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <input value={formData.dest} onChange={e => setFormData({ ...formData, dest: e.target.value })} placeholder="Destination City" style={inputStyle} />
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) })} placeholder="Price ($)" style={{ ...inputStyle, flex: 1 }} />
                                    <input type="number" value={formData.days} onChange={e => setFormData({ ...formData, days: parseInt(e.target.value) })} placeholder="Days" style={{ ...inputStyle, flex: 1 }} />
                                </div>
                                <textarea value={formData.desc} onChange={e => setFormData({ ...formData, desc: e.target.value })} placeholder="Description..."
                                    style={{ ...inputStyle, height: '80px', resize: 'vertical' }} />
                            </div>
                            <button onClick={() => handleAction('SAVE', formData)} style={{ ...btnPrimary, marginTop: '16px' }}>CONFIRM</button>
                            <button onClick={() => setShowModal(false)} style={{ width: '100%', marginTop: '8px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '10px', fontSize: '0.82rem' }}>
                                Discard
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default App;